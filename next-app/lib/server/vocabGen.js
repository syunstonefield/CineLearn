// サーバ側の単語リスト生成（§1・A1・A6・A20）。/api/vocab-generate と seed が使う唯一の生成経路。
//   generateEpisodeVocab: TMDB 解決 → fetchEpisodeSrt（raw cache → OpenSubtitles）→ parseSrt → generateSuperset（LLM 注入）
//     → attachBaseTimestamps（📍＝example 基準・plus は null）→ 品質ゲート（旧 vocab-contribute の規則）→ coverageOk
//     → { words, storeWords, contributed, reason, … }。書込（writeVocabRow）は route 側で await する（応答前に完了）。
//   * 作品名は TMDB の解決値だけを使う（body.title は使わない＝A6）。Haiku プロンプトには英題（OS 字幕は英語）、
//     vocab_cache.display_title には邦題。
//   * ★戻り値に raw / parsed 本文を絶対に含めない（クライアントへ字幕全文を配らない＝30条の4 の線）。
//   * ★ログにプロンプト・raw・parsed・LLM 応答本文を出さない（A20）。語数・チャンク数・文字数・status のみ。
//   * 失敗は UpstreamError（tmdb / os_* / llm / timeout / generation / misconfigured）。字幕なしは throw せず { nosub:true }。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { parseSrt, attachBaseTimestamps, exampleContainsWord } from '../subtitles.js';
import { generateSuperset, CHUNK_CHARS } from '../vocab.js';
import { coverageOk } from '../coverage.js';
import { fetchEpisodeSrt } from './opensubtitles.js';
import { resolveByTmdbId } from './tmdb.js';
import { callHaiku } from './anthropic.js';
import { coverageRange, normalizeEpisode, vocabCacheKey } from './vocabCache.js';
import {
  MIN_WORDS,
  MIN_DRAMA_WORDS,
  MAX_WORDS,
  MIN_SRT_CHARS,
  VOCAB_COUNT_MIN,
  VOCAB_COUNT_MAX,
  VOCAB_COUNT_DEFAULT,
  HAIKU_MODEL,
  GENERATE_DEADLINE_MS,
  UpstreamError,
} from './constants.js';

// vocab_cache.subtitle_provider に書く値（seed の 'opensubtitles' / 旧寄与の 'opensubtitles(auto)' と区別する）。
export const SUBTITLE_PROVIDER = 'opensubtitles(server)';

// vocabCount を受理範囲に丸める（route の検証と同じ規則・既定 40）。
export function clampVocabCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return VOCAB_COUNT_DEFAULT;
  return Math.min(VOCAB_COUNT_MAX, Math.max(VOCAB_COUNT_MIN, Math.round(n)));
}

// 品質ゲート（決定E・旧 /api/vocab-contribute から移設）＋時間カバレッジ。
//   clean: definition あり／drama は example に語（活用形込み）が含まれる／plus は許容
//   合格: clean ≥ MIN_WORDS(20) かつ drama ≥ MIN_DRAMA_WORDS(5) かつ ≤ MAX_WORDS、かつ coverageOk（📍の分布）
//   戻り値: { ok, reason:'ok'|'gate'|'coverage', clean, dramaCount, storeWords }（storeWords＝transient フラグを落とした clean）
export function qualityGate(words, rawSrt) {
  const clean = (Array.isArray(words) ? words : []).filter(
    (w) =>
      w &&
      typeof w.word === 'string' &&
      w.word.trim() &&
      w.definition &&
      (w.source === 'plus' || (w.example && exampleContainsWord(w.example, w.word)))
  );
  const dramaCount = clean.filter((w) => w.source === 'drama').length;
  const storeWords = clean.map(({ example_ja_ok, ...w }) => w);
  if (clean.length < MIN_WORDS || dramaCount < MIN_DRAMA_WORDS || clean.length > MAX_WORDS) {
    return { ok: false, reason: 'gate', clean, dramaCount, storeWords };
  }
  if (!coverageOk(clean, rawSrt)) return { ok: false, reason: 'coverage', clean, dramaCount, storeWords };
  return { ok: true, reason: 'ok', clean, dramaCount, storeWords };
}

// 既定の LLM 注入（lib/server/anthropic.js）。deps.callLlm を差し替えればテスト/別モデルに切り替えられる。
const defaultCallLlm = (prompt, maxTokens, o = {}) =>
  callHaiku(prompt, maxTokens, {
    deadlineAt: o.deadlineAt,
    onRetry: o.onRetry,
    label: o.nChunks > 1 ? `chunk ${o.chunk}/${o.nChunks}` : '',
  });

// generateEpisodeVocab(input, deps)
//   input: { tmdbId, type:'movie'|'tv', season, episode, vocabCount?, deadlineAt? }
//          （title/englishTitle/displayTitle は受け取らない＝TMDB 解決値を使う。route はログ用途にだけ持つ）
//   deps : { callLlm?, log?, fetchSrt?, resolveTitles?, onProgress?, onRetry? }（テスト・seed 用の注入）
//   戻り値:
//     { nosub:true, cacheKey }                                            … 字幕なし（OS 検索が空・候補全滅）
//     { nosub:false, words, storeWords, contributed, reason, coverage, wordCount, dramaCount, provider, model,
//       englishTitle, displayTitle, posterPath, fileId, subtitleVia, cacheKey, chunks, elapsedMs }
//       words        … 表示用の全語（example_ja_ok 等の transient は除去済み・plus は tsSec null）
//       storeWords   … 品質ゲートを通った語（vocab_cache に書く形）。contributed=false でも参考値として返す
//       contributed  … 品質/coverage ゲートを通った＝route は writeVocabRow して良い（実際に書けたかは route が確定）
//       reason       … 'ok' | 'gate' | 'coverage'
//   投げる: UpstreamError（reason: tmdb / os_search / os_download / os_quota / llm / timeout / generation / misconfigured）
export async function generateEpisodeVocab(input, deps = {}) {
  const {
    callLlm = defaultCallLlm,
    log = console,
    fetchSrt = fetchEpisodeSrt,
    resolveTitles = resolveByTmdbId,
    onProgress = null,
    onRetry = null,
  } = deps;
  const t0 = Date.now();
  const id = parseInt(input?.tmdbId, 10);
  if (!id || id <= 0) throw new TypeError('generateEpisodeVocab: tmdbId は正の整数');
  const n = normalizeEpisode(input?.type, input?.season, input?.episode);
  const cacheKey = vocabCacheKey(id, n.type, n.season, n.episode);
  const vocabCount = clampVocabCount(input?.vocabCount);
  const deadlineAt = Number.isFinite(input?.deadlineAt) ? input.deadlineAt : t0 + GENERATE_DEADLINE_MS;
  const epLabel = n.type === 'movie' ? `tmdb${id} movie` : `tmdb${id} s${n.season}e${n.episode}`;

  // 1) 作品名は TMDB から（クライアント由来 title の排除・A6）
  const titles = await resolveTitles({ tmdbId: id, type: n.type });
  const englishTitle = titles?.englishTitle || titles?.displayTitle || '';
  const displayTitle = titles?.displayTitle || englishTitle;
  if (!englishTitle) throw new UpstreamError('tmdb', { status: 404 });

  // 2) 生 SRT（raw cache → OS）。null＝字幕なし
  const sub = await fetchSrt({ tmdbId: id, type: n.type, season: n.season, episode: n.episode });
  if (!sub || !sub.raw) {
    log.info?.(`[CL:GEN] ${epLabel} nosub`);
    return { nosub: true, cacheKey };
  }
  const subtitleText = parseSrt(sub.raw);
  if (subtitleText.length < MIN_SRT_CHARS) {
    // 旧 raw cache 行など極端に短い字幕は生成に耐えない＝字幕なし扱い
    log.warn?.(`[CL:GEN] ${epLabel} parsed subtitle too short (${subtitleText.length} chars) → nosub`);
    return { nosub: true, cacheKey };
  }
  log.info?.(`[CL:GEN] ${epLabel} subtitle via=${sub.via} raw=${sub.raw.length} parsed=${subtitleText.length} chars`);

  // 3) スーパーセット生成（LLM 注入・複数チャンクは並列・deadline 共有）
  const drama = { title: englishTitle, englishTitle, type: n.type, tmdbId: id };
  let superset;
  try {
    superset = await generateSuperset(
      { drama, season: n.season, episode: n.episode, subtitleText, vocabCount, deadlineAt, onProgress },
      onRetry,
      { callLlm, log }
    );
  } catch (err) {
    if (err instanceof UpstreamError) throw err; // llm / timeout はそのまま
    throw new UpstreamError('generation', { cause: err }); // 0語チャンク等（本文はメッセージに含まれない）
  }
  if (!Array.isArray(superset) || !superset.length) throw new UpstreamError('generation');
  const chunks = Math.min(3, Math.max(1, Math.ceil(subtitleText.length / CHUNK_CHARS)));

  // 4) 📍（example 基準・plus は null）。配信/保存の2系統で同じ照合器（wordMatchRegex）を使う不変則。
  attachBaseTimestamps(superset, { title: englishTitle, season: n.season, episode: n.episode, rawSrt: sub.raw });

  // 5) 品質ゲート＋coverage
  const gate = qualityGate(superset, sub.raw);
  const words = superset.map(({ example_ja_ok, ...w }) => w);
  const coverage = coverageRange(gate.ok ? gate.storeWords : words);
  const elapsedMs = Date.now() - t0;
  log.info?.(
    `[CL:GEN] ${epLabel} done ${elapsedMs}ms chunks=${chunks} words=${words.length} clean=${gate.clean.length} drama=${gate.dramaCount} gate=${gate.reason}`
  );
  if (!gate.ok) log.warn?.(`[CL:GEN] ${epLabel} not contributed: ${gate.reason}`);

  return {
    nosub: false,
    words,
    storeWords: gate.storeWords,
    contributed: gate.ok,
    reason: gate.reason,
    coverage,
    wordCount: words.length,
    dramaCount: gate.dramaCount,
    provider: SUBTITLE_PROVIDER,
    model: HAIKU_MODEL,
    englishTitle,
    displayTitle,
    posterPath: titles?.posterPath ?? null,
    fileId: sub.fileId ?? null,
    subtitleVia: sub.via || null,
    cacheKey,
    chunks,
    elapsedMs,
  };
}
