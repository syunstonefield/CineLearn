// 半券コレクションの「額縁」（オーナー要望 2026-10-31）。
// 作品ごとの達成度（覚えた語 / この作品で集めた語）が上がるほど、半券とポスターの枠が豪華になる。
// 憲法（罪悪感 UI 禁止）に沿って、一度届いた額縁は下げない＝新しい語を集めて割合が下がっても戻さない。
// 届いた段階は作品タイトル→段階番号の対応で保存し、端末間はキーごとの max でマージする（lib/supabase.js）。

import { queueStatePush } from './supabase';

// min＝その額縁に届く達成度（%）。調整はここだけ直せばよい。
export const FRAME_TIERS = [
  { key: 'plain', label: '標準', min: 0 },
  { key: 'black', label: '黒縁', min: 30 },
  { key: 'silver', label: '銀縁', min: 60 },
  { key: 'gold', label: '金縁', min: 90 },
];

// 達成度（% または null）→ 段階番号。語が無い作品（null）は標準。
export function frameTierFor(progress) {
  if (progress == null || !Number.isFinite(progress)) return 0;
  let tier = 0;
  FRAME_TIERS.forEach((t, i) => {
    if (progress >= t.min) tier = i;
  });
  return tier;
}

// 保存済みの最高段階に、今の達成度で届いた段階を足し込む（上げるだけ・下げない）。
// entries: [{ title, progress }]。best は書き換えずに新しいオブジェクトを返す。
export function raiseFrameBest(best, entries) {
  const out = { ...(best || {}) };
  let changed = false;
  (entries || []).forEach((e) => {
    if (!e?.title) return;
    const now = frameTierFor(e.progress);
    const prev = Number(out[e.title]) || 0;
    if (now > prev) {
      out[e.title] = now;
      changed = true;
    }
  });
  return { best: out, changed };
}

// 表示に使う段階＝保存済みの最高段階と今の段階の大きい方。
export function frameTierOf(best, title, progress) {
  return Math.max(Number(best?.[title]) || 0, frameTierFor(progress));
}

export function frameBestKey(profileId) {
  return profileId ? `cl_frame_best_${profileId}` : 'cl_frame_best';
}

export function loadFrameBest(profileId) {
  try {
    const o = JSON.parse(localStorage.getItem(frameBestKey(profileId)) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export function saveFrameBest(profileId, best) {
  try {
    localStorage.setItem(frameBestKey(profileId), JSON.stringify(best));
    queueStatePush(frameBestKey(profileId), 1000);
  } catch {
    /* ignore */
  }
}
