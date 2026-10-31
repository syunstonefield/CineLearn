// 経路②→①畳み込み（#3）増分2：クリック語に OpenSubtitles の例文1文を補完する読み取りルート。
// 拡張のクリック保存は「単語のみ」を即保存し、本ルートが非同期で例文を埋める（バックフィル）。
// 配信（Netflix/Amazon）の字幕テキストは一切受け取らない・保存しない。返すのは特定した1文のみ。
//
// 層1: vocab_cache（生成済みスーパーセット）の語一致 → その語の example を返す（OS ダウンロード0）。
// 層2: subtitle_raw_cache（生 SRT・30条の4・非配信・TTL）→ 無ければ OpenSubtitles から1回 DL して保存。
//       生 SRT から「クリック語を含む1文」を findExampleForWord で特定して返す（32条 引用）。
//
// 2026-09-12（B・§3・A4・A6）:
//   * 字幕取得・TMDB 解決を lib/server/*（in-process）へ。旧実装は lib/api.js 経由で自分の /api/subtitles・/api/tmdb を
//     HTTP 自己呼び出ししており、Vercel の egress IP で全ユーザー分が1バケットに集約される欠陥があった。
//   * mode:'manual'（アプリの手動追加）を追加。anchor/near 無しで1文を引く経路なので、総当り防止のために
//     ログイン必須・raw cache 命中時のみ（OS DL を誘発しない）・高頻度語は拒否・話あたりの上限・failClosed。
//   * 層2の応答は必ず trimExampleToSentence（200字）を通す（manual に限らず）。
//   * 既存 anchor/near 経路にも IP×話/日 の天井（EXAMPLE_EPISODE_DAY_LIMIT）を足した。
// 2026-10-13（セキュリティ監査 H2・匿名で OS 日次 DL 枠を焼却できた穴）:
//   * S/E を範囲チェック（整数・season 0〜100・episode 0〜500・外れは bad_request）。
//   * manual 以外の層2で OS から DL するのは「その話の vocab_cache 行がある or 作品がカタログ内」のときだけ
//     （lib/server/exampleGate.js）。満たさなければ DL せず not_eligible（待避候補があればそれを返す）。
//   * さらに DL 直前にだけ DL 専用バケット（IP 20話/日・failClosed）を消費する。
//   トレードオフ: 未生成かつカタログ外の作品で、拡張のクリック保存だけしているユーザーには層2の例文補完が付かない
//   （raw cache が残っている間・vocab_cache 行がある話は従来どおり）。
// 2026-10-30（オーナー決定＝案B・法務「条件付きOK」）:
//   * manual の no_match に綴りミスの候補（suggestions・最大3語）を添える（lib/server/spellSuggestManual.js・法務の7条件はそこに）。
// 設計: docs/route-fold-in-design.md ／ 法的整合: public-launch-legal-posture。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { resolveUserId } from '@/lib/server/auth';
import { checkRateLimit, clientIp } from '@/lib/ratelimit';
import { resolveTmdbId } from '@/lib/server/tmdbResolve';
import { fetchEpisodeSrt, fetchEpisodeSrtAlternative } from '@/lib/server/opensubtitles';
import { refetchSubtitleForManual } from '@/lib/server/manualRefetch';
import { rawCacheKey, readRawCache, readRawCacheRow } from '@/lib/server/subtitleRawCache';
import { vocabCacheKey, readVocabRow } from '@/lib/server/vocabCache';
import { manualWordProblem, manualMatchIsExact } from '@/lib/server/commonWords';
import { manualSpellSuggestions } from '@/lib/server/spellSuggestManual';
import { parseSeasonEpisode, exampleDlEligible, exampleWordProblem } from '@/lib/server/exampleGate';
import {
  EXAMPLE_MANUAL_LIMITS,
  EXAMPLE_MANUAL_DL_LIMITS,
  EXAMPLE_EPISODE_DAY_LIMIT,
  EXAMPLE_DL_PER_IP_DAY,
  EXAMPLE_ALT_DL_LIMITS,
  UpstreamError,
} from '@/lib/server/constants';
import {
  getWordVariants,
  exampleContainsWord,
  exactWordRegex,
  normApostrophes,
  findExampleForWord,
  findExampleByAnchor,
  anchorPresentInSrt,
  trimExampleToSentence,
  EXAMPLE_MAX_CHARS,
} from '@/lib/subtitles';

// 層2（生 SRT＝全文がある経路）の例文は「観ている位置 ±N秒の窓内」の1文に限定する。
// near（currentTimeSec）を必須化し窓で足切りすることで、word を変えた総当りで字幕全文を
// 1文ずつ復元される穴を構造的に塞ぐ（非配信＝30条の4の内部運用線を配信層で担保）。
// サーバー側は VOD アンカーが無く補正は無いため、±45秒は VOD/OS の素のオフセット吸収も兼ねる。
const EXAMPLE_WINDOW_SEC = 45;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 配る例文の硬い上限（A4(e)・32条の必要最小限）。trimExampleToSentence は文に割れないときに元文を素通しし、
// expandToFullSentence は 240 字まで連結し得るので、最後にここで 200 字に切る（語境界・末尾に…）。
function capSentence(sentence, word, exact = false) {
  const t = trimExampleToSentence(sentence, word, EXAMPLE_MAX_CHARS, { exact });
  if (!t || t.length <= EXAMPLE_MAX_CHARS) return t;
  const cut = t.slice(0, EXAMPLE_MAX_CHARS);
  const sp = cut.lastIndexOf(' ');
  return (sp > EXAMPLE_MAX_CHARS * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

// 例文とアンカー行（保存時の字幕行）が同じ文か。等しい／一方が他方を含む／トークン Jaccard ≥ 0.5。
//   層1（vocab_cache）の別出現を「アンカー付きの要求」に返さないための判定（レビュー指摘）。
function anchorMatches(example, anchor) {
  const norm = (x) =>
    String(x || '')
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[^a-z0-9' ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const a = norm(example);
  const b = norm(anchor);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter) >= 0.5;
}

// アンカー行が今の字幕ファイルに無い時の代替候補（2026-10-31）。例外を外に出さない＝ { raw, fileId } | null。
//   順序: 適格性 → 専用枠（failClosed）→ OS 検索＋DL（fetchEpisodeSrtAlternative が raw cache を差し替える）。
//   ログは cacheKey・file_id・結果だけ（字幕本文・アンカー行は出さない＝A20）。
async function tryAlternativeSubtitle(req, { cacheKey, id, type, s, e, anchorLine, excludeFileId, hasVocabRow }) {
  try {
    if (!(await exampleDlEligible({ hasVocabRow, tmdbId: id }))) return null;
    const rl = await checkRateLimit(req, 'example-alt-dl', { perMin: 0, perHour: 0, perDay: EXAMPLE_ALT_DL_LIMITS.perIpDay }, {
      failClosed: true,
      extra: [{ keyBase: `rl:example-alt:ep:${cacheKey}`, window: 'day', limit: EXAMPLE_ALT_DL_LIMITS.perEpisodeDay, scope: 'episode' }],
    });
    if (!rl.ok) {
      console.info('[CL:EXAMPLE] alt subtitle skipped', { cacheKey, reason: rl.unavailable ? 'unavailable' : 'rate_limited', scope: rl.scope ?? null });
      return null;
    }
    const alt = await fetchEpisodeSrtAlternative({
      tmdbId: id, type, season: s, episode: e, excludeFileId,
      accept: (srt) => anchorPresentInSrt(srt, anchorLine),
    });
    console.info('[CL:EXAMPLE] alt subtitle', { cacheKey, from: excludeFileId ?? null, to: alt?.fileId ?? null, matched: !!alt, tried: alt?.tried ?? null });
    return alt;
  } catch (err) {
    if (err instanceof UpstreamError) console.warn('[CL:EXAMPLE] alt subtitle failed', { cacheKey, reason: err.reason, status: err.status ?? null });
    else console.error('[CL:EXAMPLE] alt subtitle internal', String(err?.message || err));
    return null;
  }
}

// 例文が付かない時に「どこで落ちたか」を拡張の console から追えるよう、found:false には
// 必ず reason を添える（Disney+ 例文欠落で4回パッチを重ねた原因＝全経路サイレント失敗の反省）。
// reason は診断用の定数文字列のみ・字幕本文等は含まない。
export async function POST(req) {
  if (!allowedOrigin(req)) return json({ found: false, error: 'forbidden', reason: 'forbidden' }, 403);

  // TMDB照会＋OS DL＋subtitle_raw_cache 書き込みを誘発する経路。字幕クリック起点の
  // バックフィルなので上限は緩め（IP単位 60/分・600/時）。Upstash 未設定なら no-op。
  if (!(await checkRateLimit(req, 'example', { perMin: 60, perHour: 600 })).ok) {
    return json({ found: false, error: 'rate_limited', reason: 'rate_limited' }, 429);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    return json({ found: false, reason: 'bad_request' });
  }

  const manual = body.mode === 'manual';
  const word = String(body.word || '').trim();
  const title = String(body.title || '').trim();
  const givenId = Number(body.tmdbId);
  const hasGivenId = Number.isFinite(givenId) && givenId > 0;
  if (!word || (!title && !hasGivenId)) return json({ found: false, reason: 'missing_params' });
  // 語の長さ・語数の上限（ReDoS 対策・2026-10-20 /decide）。manual と anchor/near の両経路に効かせる。
  const wordProblem = exampleWordProblem(word);
  if (wordProblem) return json({ found: false, reason: wordProblem });

  // S/E がある＝TV、無い＝映画扱い（拡張の getEpisodeContext は映画/未検出で season=null）。
  //   TV の S/E は整数・範囲内のみ（監査 H2: 任意の値で raw cache/OS DL のキーを量産させない）。
  const se = parseSeasonEpisode(body);
  if (!se.ok) return json({ found: false, reason: 'bad_request' }, 400);
  const hasSE = se.hasSE;
  const isMovie = !hasSE;
  const type = isMovie ? 'movie' : 'tv';
  const s = se.season;
  const e = se.episode;

  // 呼び出し側が作品を確定できているなら、その ID を使う（曖昧検索より常に正しい）。
  const id = hasGivenId ? givenId : await resolveTmdbId(title, isMovie);
  if (!id) return json({ found: false, reason: 'tmdb_unresolved', type }); // TMDB 未解決 → 拡張は bare のまま

  const cacheKey = vocabCacheKey(id, type, s, e);
  const ip = clientIp(req);

  // 話単位の天井（A4）: IP×話/日。manual も含めて層1の前に張る（manual フラグで迂回させない・レビュー指摘）。
  //   manual 固有の上限（ユーザー×話・話全体）は層2の前で別に張る。
  {
    const ep = await checkRateLimit(req, 'example-ep', { perMin: 0, perHour: 0, perDay: 0 }, {
      ipLimitsOff: true,
      extra: [{ keyBase: `rl:example:${ip}:ep:${cacheKey}`, window: 'day', limit: EXAMPLE_EPISODE_DAY_LIMIT, scope: 'episode' }],
    });
    if (!ep.ok) return json({ found: false, error: 'rate_limited', reason: 'rate_limited' }, 429);
  }

  // 照合専用のアンカー（lineText＝保存時の字幕行／📍修復では保存済み例文）。長さを制限して保存はしない。
  const anchorLine = manual ? '' : String(body.lineText || '').slice(0, 300).trim();
  // 手動追加で、活用形に頻出語が混ざる語は「入力したそのままの形」だけで探す（頻出語ゲートの迂回対策・
  //   2026-10-20 /decide 穴①）。層1（共有リストの例文の流用）と層2（生字幕）の両方に効かせる。
  const exactOnly = manual && manualMatchIsExact(word);
  const exactRe = exactOnly ? exactWordRegex(word) : null;
  const hasWord = (text) => (exactRe ? exactRe.test(normApostrophes(text)) : exampleContainsWord(text, word));

  // ── 層1: vocab_cache の語一致（無料）──
  //   ★ drama 語のみを対象にする。drama の example は字幕の逐語文（= OpenSubtitles 引用/32条）だが、
  //     plus 語の example は Claude 生成の作例で「引用」ではない。例文補完に plus を使うと
  //     source:'opensubtitles' の表示が偽りになり #3 の出所明示が崩れるため除外する。
  const cachedRow = await readVocabRow(cacheKey);
  // 別の話数の字幕で作ったリスト（episode_match='fallback'・2026-10-20 /decide G）では例文を返さない。
  //   共有リストの例文も、この話の raw cache（同じ別ファイル）も別の回の台詞で、📺SxE の出所表示が事実と違ってしまう
  //   （48条）。手動追加・拡張の補完の両方。字幕ファイルが正しく取り直されるまでは「この回では見つからない」扱い。
  if (cachedRow.ok && cachedRow.row?.episode_match === 'fallback') {
    return json({ found: false, reason: 'no_subtitle_file', tmdbId: id, type });
  }
  const cached = cachedRow.ok && cachedRow.row ? cachedRow.row.words : null;
  // 再生位置（保存した場面）。層1でも「どの出現か」を選ぶのに使う。
  const nearSec = Number(body.currentTimeSec);
  const hasNear = isFinite(nearSec);
  // 「語は当たったが保存位置から遠い」候補の待避先。層2が空振りした時の最後の砦。
  let farPick = null;
  if (cached) {
    const variants = getWordVariants(word);
    const drama = cached.filter((w) => w && w.source === 'drama' && w.example);
    const strong = drama.filter(
      (w) =>
        w.word &&
        (exactOnly ? String(w.word).toLowerCase() === word.toLowerCase() : variants.has(String(w.word).toLowerCase())) &&
        hasWord(w.example)
    );
    const loose = drama.filter((w) => hasWord(w.example));
    const pool = strong.length ? strong : loose;
    // ★2026-08-08: 同じ語が作品中に何度も出る場合、保存時の再生位置が分かるなら最も近い出現を選ぶ。
    let pick = pool[0];
    if (hasNear && pool.length) {
      const withTs = pool.filter((w) => typeof w.tsSec === 'number' && isFinite(w.tsSec));
      if (withTs.length) {
        pick = withTs.reduce((a, b) => (Math.abs(b.tsSec - nearSec) < Math.abs(a.tsSec - nearSec) ? b : a));
        // 最も近い出現でも離れすぎている＝その場面の出現がキャッシュに無い。層2で探させるが**捨てはしない**
        // （保存位置そのものが誤っている実データがあるため。層2が空振りしたら最後にこれを返す）。
        if (Math.abs(pick.tsSec - nearSec) > 300) {
          farPick = pick;
          pick = null;
        }
      }
    }
    // アンカー付きの要求（📍修復＝保存済み例文をアンカーにして同じキューの時刻を求める）には、層1の
    // 「同じ語の別の出現」を返さない。アンカーと同じ文の候補だけ採用し、無ければ待避して層2（anchor 照合）へ。
    if (pick && anchorLine && !anchorMatches(pick.example, anchorLine)) {
      const same = pool.find((w) => anchorMatches(w.example, anchorLine));
      if (same) pick = same;
      else {
        farPick = farPick || pick;
        pick = null;
      }
    }
    if (pick) {
      return json({
        found: true,
        // vocab_cache の example は生成時に複数キューがつながって段落化していることがある。配る前に語を含む1文へ詰める。
        sentence: capSentence(pick.example, word, exactOnly),
        source: 'opensubtitles',
        tmdbId: id,
        season: s,
        episode: e,
        tsSec: pick.tsSec ?? null,
        tsLabel: pick.tsLabel ?? null,
        via: 'vocab_cache',
      });
    }
  }

  const rawKey = rawCacheKey(id, s, e);

  // ── 層2（manual）: アプリの手動追加。anchor も near も無いので、総当りにならない条件で1文だけ返す（A4）──
  if (manual) {
    const auth = await resolveUserId(req);
    // 認証サーバー不達はログイン不足ではない（再ログインを誤案内しない・A28）。
    if (!auth.uid && auth.reason === 'unavailable') return json({ found: false, reason: 'unavailable', tmdbId: id, type }, 503);
    if (!auth.uid) return json({ found: false, reason: 'login_required', tmdbId: id, type });
    const problem = manualWordProblem(word);
    if (problem) return json({ found: false, reason: problem, tmdbId: id, type });
    // 手動追加の上限（1分・1日・利用者×話・話全体）を1つ数える。綴りの候補一覧を返す時にもう1回数える
    //   （法務 条件4「上限は見せた文の数で数え、語だけの候補一覧も1回に数える」・2026-10-30）。
    const manualRl = () =>
      checkRateLimit(
        req,
        'example-manual',
        { perMin: EXAMPLE_MANUAL_LIMITS.perMin, perHour: 0, perDay: EXAMPLE_MANUAL_LIMITS.perDay },
        {
          failClosed: true,
          extra: [
            { keyBase: `rl:example-manual:user:${auth.uid}:ep:${cacheKey}`, window: 'day', limit: EXAMPLE_MANUAL_LIMITS.perUserEpisodeDay, scope: 'user-episode' },
            { keyBase: `rl:example-manual:ep:${cacheKey}`, window: 'day', limit: EXAMPLE_MANUAL_LIMITS.perEpisodeDay, scope: 'episode' },
          ],
        }
      );
    const rl = await manualRl();
    if (!rl.ok) {
      if (rl.unavailable) return json({ found: false, reason: 'unavailable', tmdbId: id, type }, 503);
      return json({ found: false, reason: 'rate_limited', tmdbId: id, type }, 429);
    }
    // raw cache（TTLつき）に無ければ、その場で1回だけ取り直す（2026-09-22 オーナー要望）。
    //   ★従来はここで諦めていた（OS DL を誘発しない設計）。その結果、**同じ話でも字幕キャッシュの
    //     TTL が切れた後は手動追加の例文が永久に付かない**——「前は例文付きで保存できた語が、
    //     消して入れ直すと付かない」という実機の症状になっていた。
    //   枠の焼き過ぎは専用の締めで防ぐ: 語ごとではなく**話ごと**に効くので、1話ぶん取れば以降の
    //   手動追加は raw キャッシュに当たり、通常利用では1日1回しか発火しない。
    let raw = await readRawCache(rawKey);
    if (!raw) {
      // 適格性（2026-10-20 /decide・通常経路 H2 と同じ）: その話の vocab_cache 行がある or 作品がカタログ内。
      //   カタログゲートが無効の間は常に通る（全作品許可）＝今の挙動は変わらない。有効化した時に効く。
      if (!(await exampleDlEligible({ hasVocabRow: !!(cachedRow.ok && cachedRow.row), tmdbId: id }))) {
        return json({ found: false, reason: 'not_eligible', tmdbId: id, type });
      }
      // IP 単位の上限も張る（ipLimitsOff を外す）: ユーザー単位の5話/日だけだと、アカウントを増やせば
      //   共有の OS 日次枠（700）を焼ける（1人最大 5話×3候補＝15DL/日 → 約47アカウントで枯渇）。
      const dl = await checkRateLimit(req, 'example-manual-dl', { perMin: 0, perHour: 0, perDay: EXAMPLE_MANUAL_DL_LIMITS.perIpDay }, {
        failClosed: true,
        extra: [
          { keyBase: `rl:example-manual-dl:user:${auth.uid}`, window: 'day', limit: EXAMPLE_MANUAL_DL_LIMITS.perUserDay, scope: 'user' },
          { keyBase: `rl:example-manual-dl:ep:${cacheKey}`, window: 'day', limit: EXAMPLE_MANUAL_DL_LIMITS.perEpisodeDay, scope: 'episode' },
        ],
      });
      if (!dl.ok) {
        // 取り直し枠が尽きた＝今日はもう温められない。例文なしで保存させる（従来と同じ振る舞い）。
        return json({ found: false, reason: dl.unavailable ? 'unavailable' : 'no_raw', tmdbId: id, type }, dl.unavailable ? 503 : 200);
      }
      try {
        // 記録した字幕ファイルで取り直す（検索し直さない）。消えていた時だけ1回検索（lib/server/manualRefetch.js）。
        const sub = await refetchSubtitleForManual({ cacheKey, tmdbId: id, type, season: s, episode: e });
        if (!sub?.raw) return json({ found: false, reason: 'no_subtitle_file', tmdbId: id, type });
        raw = sub.raw;
        console.info('[CL:EXAMPLE] manual raw refetch', { subject: `user:${auth.uid.slice(0, 8)}`, cacheKey, chars: raw.length, via: sub.via });
      } catch (err) {
        if (err instanceof UpstreamError) {
          console.warn('[CL:EXAMPLE] manual subtitle fetch failed', { cacheKey, reason: err.reason, status: err.status ?? null });
          // os_quota は外向きには unavailable にまとめる（共有の取得枠を使い切れたことを外に教えない・2026-10-20 /decide E）
          return json({ found: false, reason: err.reason === 'os_quota' ? 'unavailable' : 'subtitle_fetch_failed', tmdbId: id, type });
        }
        console.error('[CL:EXAMPLE] manual internal', String(err?.message || err));
        return json({ found: false, reason: 'subtitle_fetch_failed', tmdbId: id, type });
      }
    }
    const hit = findExampleForWord(raw, word, undefined, undefined, { exact: exactOnly });
    if (!hit) {
      // 綴りミスの候補（最大3語・例文は最も近い1語だけ・上限をもう1回数える）。条件は lib/server/spellSuggestManual.js。
      const suggestions = await manualSpellSuggestions(word, { cached, raw, charge: manualRl, cap: capSentence });
      // ログは件数だけ（候補の語・文そのものは残さない＝法務 条件6）
      console.info('[CL:EXAMPLE] manual', { subject: `user:${auth.uid.slice(0, 8)}`, cacheKey, word, via: 'no_match', suggestions: suggestions.length });
      return json({ found: false, reason: 'no_match', tmdbId: id, type, ...(suggestions.length ? { suggestions } : {}) });
    }
    console.info('[CL:EXAMPLE] manual', { subject: `user:${auth.uid.slice(0, 8)}`, cacheKey, word, via: 'raw' });
    return json({
      found: true,
      sentence: capSentence(hit.sentence, word, exactOnly),
      source: 'opensubtitles',
      tmdbId: id,
      season: s,
      episode: e,
      tsSec: hit.sec,
      tsLabel: hit.label,
      via: 'manual',
    });
  }

  // ── 層2: 生 SRT（raw cache → 無ければ OS から1回 DL）──
  //   ★アンカー（lineText＝画面に出ている字幕行）か near（再生位置）のどちらも無ければ層2に
  //     入らない＝OS DL もしない。任意位置の1文を当て推量で引ける穴を構造的に塞ぐ（総当り防止）。
  const near = nearSec;

  // 層1で「語は当たったが保存位置から遠い」候補を待避してある時は、層2の空振りより優先して返す。
  const farFallback = (reason) =>
    farPick
      ? json({
          found: true,
          sentence: capSentence(farPick.example, word),
          source: 'opensubtitles',
          tmdbId: id,
          season: s,
          episode: e,
          tsSec: farPick.tsSec ?? null,
          tsLabel: farPick.tsLabel ?? null,
          via: 'vocab_cache_far',
        })
      : json({ found: false, reason, tmdbId: id, type });
  if (!anchorLine && !isFinite(near)) {
    return farFallback('no_anchor_no_near'); // 手がかり無し → 待避候補があればそれ、無ければ bare（OS DL せず）
  }

  const rawRow = await readRawCacheRow(rawKey);
  let raw = rawRow?.raw || null;
  let rawFileId = rawRow?.fileId ?? null; // 代替候補を探す時に「今のファイル」を除くため
  if (!raw) {
    // ── OS DL の前の締め（監査 H2）──
    //   ① 適格性: その話の vocab_cache 行がある（層1で読んだ cachedRow を再利用・再クエリしない）か、作品がカタログ内
    //     （/api/vocab-generate の匿名ゲートと同じ isInCatalog）。どちらでもなければ DL しない。
    //     cachedRow.ok:false（DB 不調で行の有無が不明）は「行なし」としてカタログ照合へ回す。
    if (!(await exampleDlEligible({ hasVocabRow: !!(cachedRow.ok && cachedRow.row), tmdbId: id }))) {
      return farFallback('not_eligible');
    }
    //   ② DL 専用バケット（IP 20/日＝EXAMPLE_DL_PER_IP_DAY）。実際に DL する直前にだけ消費する（raw 命中・不適格では減らない）。
    //     failClosed＝Upstash 不調なら DL しない（共有の OS 枠を守る側に倒す・manual の DL 締めと同じ）。
    const dl = await checkRateLimit(req, 'example-dl', { perMin: 0, perHour: 0, perDay: EXAMPLE_DL_PER_IP_DAY }, { failClosed: true });
    if (!dl.ok) return farFallback(dl.unavailable ? 'unavailable' : 'rate_limited');
    try {
      // in-process の OS 取得（raw cache 書込・日次キャップ・残枠ログ・GC は lib 側）。null＝字幕なし。
      const sub = await fetchEpisodeSrt({ tmdbId: id, type, season: s, episode: e });
      if (!sub?.raw) return farFallback('no_subtitle_file');
      raw = sub.raw;
      rawFileId = sub.fileId ?? null;
    } catch (err) {
      if (err instanceof UpstreamError) {
        console.warn('[CL:EXAMPLE] subtitle fetch failed', { cacheKey, reason: err.reason, status: err.status ?? null });
        return farFallback(err.reason === 'os_quota' ? 'unavailable' : 'subtitle_fetch_failed'); // os_quota は外向き unavailable
      }
      console.error('[CL:EXAMPLE] internal', String(err?.message || err));
      return farFallback('subtitle_fetch_failed');
    }
  }

  // 本命＝アンカー照合（時計ズレ非依存・未知本文の抽出不能）。anchorLine は照合のみで保存しない。
  // アンカー無し／不一致のときだけ ±EXAMPLE_WINDOW_SEC 窓フォールバック（near 必須・任意位置総当り防止）。
  let hit = anchorLine
    ? findExampleByAnchor(raw, word, anchorLine, isFinite(near) ? near : undefined)
    : null;
  let via = hit ? 'anchor' : 'raw';
  // ── 代替候補（2026-10-31）: アンカー行が raw の**どこにも**無い＝字幕ファイルが配信版と別の編集・書き起こし
  //   （Suits S1E1 の 31:50〜32:01 の台詞が OS 字幕に無く、4語が no_match になった実データ）。
  //   OS の別候補を上位から最大2件 DL し、アンカー行が在る方を raw cache に差し替えて照合し直す。
  //   枠: 話ごと1日1回（当たらなくても消費）＋ IP ごと/日・failClosed。適格性（vocab 行 or カタログ）は通常 DL と同じ。
  //   失敗・枠切れ・上流不調は今の raw のまま続行（near 窓フォールバック→ no_match）＝従来と同じ結果に倒れる。
  if (!hit && anchorLine && !anchorPresentInSrt(raw, anchorLine)) {
    const alt = await tryAlternativeSubtitle(req, { cacheKey, id, type, s, e, anchorLine, excludeFileId: rawFileId, hasVocabRow: !!(cachedRow.ok && cachedRow.row) });
    if (alt?.raw) {
      raw = alt.raw;
      hit = findExampleByAnchor(raw, word, anchorLine, isFinite(near) ? near : undefined);
      if (hit) via = 'anchor_alt';
    }
  }
  if (!hit && isFinite(near)) hit = findExampleForWord(raw, word, near, EXAMPLE_WINDOW_SEC);
  if (!hit) return farFallback('no_match'); // アンカー不一致＋窓内該当なし → 待避候補 or bare

  return json({
    found: true,
    sentence: capSentence(hit.sentence, word), // 層2は常に1文・200字の硬い上限（A4(e)）
    source: 'opensubtitles',
    tmdbId: id,
    season: s,
    episode: e,
    tsSec: hit.sec,
    tsLabel: hit.label,
    via,
  });
}
