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
// 設計: docs/route-fold-in-design.md ／ 法的整合: public-launch-legal-posture。

export const dynamic = 'force-dynamic';

import { allowedOrigin } from '@/lib/server/origin';
import { resolveUserId } from '@/lib/server/auth';
import { checkRateLimit, clientIp } from '@/lib/ratelimit';
import { tmdbSearch } from '@/lib/server/tmdb';
import { fetchEpisodeSrt } from '@/lib/server/opensubtitles';
import { rawCacheKey, readRawCache } from '@/lib/server/subtitleRawCache';
import { vocabCacheKey, readVocabRow } from '@/lib/server/vocabCache';
import { manualWordProblem } from '@/lib/server/commonWords';
import { EXAMPLE_MANUAL_LIMITS, EXAMPLE_EPISODE_DAY_LIMIT, UpstreamError } from '@/lib/server/constants';
import {
  getWordVariants,
  exampleContainsWord,
  findExampleForWord,
  findExampleByAnchor,
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
function capSentence(sentence, word) {
  const t = trimExampleToSentence(sentence, word);
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

// タイトル文字列 → TMDB ID（拡張は ID を持たないためここで解決）。失敗・曖昧は null。
// 配信サービスの表示タイトルは「スター・ウォーズエピソード3／シスの復讐」のように区切り無しで詰まっていたり
// サブタイトルが付いたりして、TMDB のあいまい検索が空振りする（2026-07-03 実測で確定）。
// そこで複数の候補クエリを順に試し、最初に当たった ID を採用する。
function titleQueryCandidates(title) {
  const t = (title || '').trim();
  if (!t) return [];
  const cands = [t];
  // 区切り（全角/半角スラッシュ・コロン・波ダッシュ・パイプ）を空白へ正規化
  const spaced = t.replace(/[／/:：|｜〜~–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (spaced && spaced !== t) cands.push(spaced);
  // 区切りで分割した各セグメント（長い順）＝サブタイトル単独が最も当たりやすい
  const segs = t.split(/[／/:：|｜]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
  segs.sort((a, b) => b.length - a.length).forEach((s) => cands.push(s));
  return [...new Set(cands)];
}

// 照合用のタイトル正規化（記号・空白・大小の揺れを吸収）。
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s:：・／/｜|,.'"’”!?！？\-–—~〜]/g, '')
    .trim();
}

// 候補から「クエリと同じ作品」を選ぶ。results[0] 直採りは邦題で別作品を掴む。
//   ①原題・邦題のどれかが正規化一致するものを最優先 ②同点なら人気度で決める
// 一致が1つも無ければ null＝**あえて解決しない**（誤った作品の字幕を引くより、例文なしの方が安全）。
function pickTmdbCandidate(results, query, wantMovie) {
  const q = normTitle(query);
  const cands = (results || []).filter((r) => {
    if (!r?.id) return false;
    const mt = r.media_type;
    if (mt && mt !== (wantMovie ? 'movie' : 'tv')) return false;
    return true;
  });
  const named = (r) => [r.title, r.original_title, r.name, r.original_name].filter(Boolean);
  const exact = cands.filter((r) => named(r).some((n) => normTitle(n) === q));
  if (!exact.length) return null;
  return exact.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0].id;
}

// タイトル文字列 → TMDB ID。
// ★2026-08-08: 映画で search_movie の results[0] を無検証で採用していたため、邦題のクエリが別作品に解決されていた
//   （「アイアンマン」→ "Iron Man: Rise of Technovore"）。search_multi（ja-JP）に寄せ、正規化一致を必須にした。
async function resolveTmdbId(title, isMovie) {
  for (const query of titleQueryCandidates(title)) {
    try {
      const results = await tmdbSearch({ action: 'search_multi', query });
      const id = pickTmdbCandidate(results, query, isMovie);
      if (id) return id;
    } catch {
      /* この候補は失敗＝次の候補へ */
    }
  }
  // 保険: 種別特化の検索でも一致を探す（search_multi が取りこぼす綴りの作品向け）。
  const action = isMovie ? 'search_movie' : 'search';
  for (const query of titleQueryCandidates(title)) {
    try {
      const results = await tmdbSearch({ action, query });
      const id = pickTmdbCandidate(results, query, isMovie);
      if (id) return id;
    } catch {
      /* この候補は失敗＝次の候補へ */
    }
  }
  return null;
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

  // S/E がある＝TV、無い＝映画扱い（拡張の getEpisodeContext は映画/未検出で season=null）。
  const hasSE =
    body.season != null && body.season !== '' && body.episode != null && body.episode !== '';
  const isMovie = !hasSE;
  const type = isMovie ? 'movie' : 'tv';
  const s = hasSE ? Number(body.season) : 0;
  const e = hasSE ? Number(body.episode) : 0;

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

  // ── 層1: vocab_cache の語一致（無料）──
  //   ★ drama 語のみを対象にする。drama の example は字幕の逐語文（= OpenSubtitles 引用/32条）だが、
  //     plus 語の example は Claude 生成の作例で「引用」ではない。例文補完に plus を使うと
  //     source:'opensubtitles' の表示が偽りになり #3 の出所明示が崩れるため除外する。
  const cachedRow = await readVocabRow(cacheKey);
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
      (w) => w.word && variants.has(String(w.word).toLowerCase()) && exampleContainsWord(w.example, word)
    );
    const loose = drama.filter((w) => exampleContainsWord(w.example, word));
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
        sentence: capSentence(pick.example, word),
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
    const rl = await checkRateLimit(
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
    if (!rl.ok) {
      if (rl.unavailable) return json({ found: false, reason: 'unavailable', tmdbId: id, type }, 503);
      return json({ found: false, reason: 'rate_limited', tmdbId: id, type }, 429);
    }
    // raw cache に無ければ OS DL は誘発しない（例文なしで保存させる）。
    const raw = await readRawCache(rawKey);
    if (!raw) return json({ found: false, reason: 'no_raw', tmdbId: id, type });
    const hit = findExampleForWord(raw, word);
    console.info('[CL:EXAMPLE] manual', { subject: `user:${auth.uid.slice(0, 8)}`, cacheKey, word, via: hit ? 'raw' : 'no_match' });
    if (!hit) return json({ found: false, reason: 'no_match', tmdbId: id, type });
    return json({
      found: true,
      sentence: capSentence(hit.sentence, word),
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

  let raw = await readRawCache(rawKey);
  if (!raw) {
    try {
      // in-process の OS 取得（raw cache 書込・日次キャップ・残枠ログ・GC は lib 側）。null＝字幕なし。
      const sub = await fetchEpisodeSrt({ tmdbId: id, type, season: s, episode: e });
      if (!sub?.raw) return farFallback('no_subtitle_file');
      raw = sub.raw;
    } catch (err) {
      if (err instanceof UpstreamError) {
        console.warn('[CL:EXAMPLE] subtitle fetch failed', { cacheKey, reason: err.reason, status: err.status ?? null });
        return farFallback(err.reason === 'os_quota' ? 'os_quota' : 'subtitle_fetch_failed');
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
  const via = hit ? 'anchor' : 'raw';
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
