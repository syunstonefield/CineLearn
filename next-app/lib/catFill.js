// 前に学んだ語（端末の history）に「意味のカテゴリ」を後から埋める（関連語・2026-11-17・⑦裏側の持ち物）。
//   値のない語がある話だけ、/api/vocab-cats に {tmdbId,type,season,episode} を送って値を取り、applyCats で写して保存する。
//   ★送るのは作品と話の番号だけ（学んだ語の一覧はサーバーへ送らない）。返ってくるのは 語・cat・sub だけ。
//   1回に1話ずつ・1回の起動で MAX_PER_RUN 話まで。失敗しても画面は止めない（握りつぶして次の機会に回す）。
//   埋め切れなかった話（配信オフの作品・共有キャッシュに無い話・キャッシュに無い語が残る話）は cl_catfill に
//   覚えて、RETRY_DAYS 日は聞き直さない（あとで配信が始まった作品も、いずれ埋まる）。埋め切れた話は覚えない（クラウドから取り直して値が消えても次で埋め直す）。
//   保存は storage.updateHistoryWords（端末に保存＋ログイン中ならクラウドの history へ upsert＝取り直しで消えない）。

import { catOf, applyCats, CAT_VERSION } from './relCategories.js';

export const CATFILL_KEY = 'cl_catfill';
export const MAX_PER_RUN = 40;
export const RETRY_DAYS = 14;

const needs = (w) => !!(w && w.word && !catOf(w));

// 話を見分けるしるし（cl_catfill に覚える）。
export function entryMark(req) {
  return `${CAT_VERSION}:${req.tmdbId}:${req.type}:${req.season}:${req.episode}`;
}

// history の1件 → 送る中身（tmdbId が分からない話は null）。
//   tmdbIdOf(title) … 記録に tmdbId が無い古い話の保険（全プロフィールの作品一覧から引く）。
export function requestFor(h, { tmdbIdOf = () => null, isMovie = () => false } = {}) {
  const title = h?.drama?.title;
  const id = parseInt(h?.drama?.tmdbId ?? tmdbIdOf(title), 10);
  if (!id || id <= 0) return null;
  const movie = isMovie(title, h?.drama?.type);
  return { tmdbId: id, type: movie ? 'movie' : 'tv', season: movie ? 0 : Number(h.season) || 0, episode: movie ? 0 : Number(h.episode) || 0 };
}

// 値を埋める対象の話（新しい順）。
//   tried … { しるし: 覚えた時刻(ms) }。RETRY_DAYS 日より前のものは聞き直す。
export function pickTargets(history, tried, opts, now = Date.now()) {
  const out = [];
  const seen = new Set();
  for (const h of [...(history || [])].reverse()) {
    if (!h?.id || !(h.words || []).some(needs)) continue;
    const req = requestFor(h, opts);
    if (!req) continue;
    const mark = entryMark(req);
    if (now - (Number(tried[mark]) || 0) < RETRY_DAYS * 864e5 || seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({ id: h.id, req, mark });
  }
  return out;
}

let running = false;

// 戻り値: 値を埋めた語の数（0 なら画面を描き直さなくてよい）。
//   deps … { fetchImpl, loadHistory, updateHistoryWords, tmdbIdOf, isMovie, readTried, writeTried, max }
export async function fillHistoryCats(deps) {
  if (running) return 0;
  running = true;
  let filled = 0;
  try {
    const { fetchImpl = fetch, loadHistory, updateHistoryWords, readTried, writeTried, max = MAX_PER_RUN } = deps;
    const now = Date.now();
    const tried = {};
    for (const [k, v] of Object.entries(readTried() || {})) if (now - Number(v) < RETRY_DAYS * 864e5) tried[k] = Number(v); // 古いしるしは捨てる
    const targets = pickTargets(loadHistory(), tried, deps, now).slice(0, max);
    for (const t of targets) {
      let j = null;
      try {
        const res = await fetchImpl('/api/vocab-cats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(t.req),
        });
        if (!res.ok) break; // サーバーの不調・混雑 → 今回はここまで（覚えない＝次の起動でまた聞く）
        j = await res.json();
      } catch {
        break; // 通信できない → 今回はここまで
      }
      if (!j || j.unavailable) break;
      // 送っている間に history が変わっていてもよいように、保存の直前に読み直して写す
      const entry = loadHistory().find((h) => h.id === t.id);
      if (!entry) continue;
      const words = (entry.words || []).map((w) => ({ ...w }));
      const n = j.hit ? applyCats(words, j.cats) : 0;
      if (n) {
        updateHistoryWords(t.id, words);
        filled += n;
      }
      if (words.some(needs)) {
        tried[t.mark] = now; // 埋め切れない話（blocked・miss・キャッシュに無い語）はしばらく聞き直さない
        writeTried(tried);
      }
    }
  } catch {
    /* 画面は止めない */
  } finally {
    running = false;
  }
  return filled;
}
