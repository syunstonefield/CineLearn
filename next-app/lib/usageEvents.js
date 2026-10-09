// ベータの利用データ（2026-10-09 オーナーと設計・docs/design-usage-stats-2026-10-09.md）。
// アプリ（lib/usage.js）とサーバー（lib/server/usage.js）・週次の表（seed/weekly-stats.mjs）で共有する
// 「数えてよい項目の名前」と、送られてきた値の検査。依存なしの純関数（node のテストと seed から読む）。
//   * 作品名・話の番号・単語・時刻は送らない（名前の一覧に無いものは捨てる）。

export const USAGE_EVENTS = [
  'open', // アプリを開いた（ページの読み込みごと）
  'work_review', // 作品・話の復習を始めた
  'work_all_review', // 作品まとめ復習を始めた
  'work_quiz', // 作品・話のクイズを始めた
  'journey_tab', // あゆみを下のタブ（など）から開いた
  'journey_grass', // ホームの「学習した日」からあゆみを開いた
  'trend_seen', // 週ごとの推移が画面に表示された
  'list_open', // 話の単語リストが画面に出た
  'walk_start', // 予習カードを始めた
  'walk_core', // 重要語（最初の最大15枚）を見終えた
  'walk_rest', // 「残りの語も見る」を選んで最後までめくった
  'walk_done', // 予習完了（半券）
];

// 途中で抜けた: exit_<段階>_<何割まで 0〜10>_<抜け方>
//   段階  list＝単語リスト（一覧のスクロール位置）／core＝重要語のカード／rest＝残りの語のカード
//   抜け方 walk＝予習カードへ進んだ（一覧のみ）／x＝✕・Esc／later＝「あとで予習する」／nav＝別の画面へ／close＝タブ・アプリを閉じた
export const EXIT_STAGES = ['list', 'core', 'rest'];
export const EXIT_HOWS = ['walk', 'x', 'later', 'nav', 'close'];
const EXIT_RE = /^exit_(list|core|rest)_(10|[0-9])_(walk|x|later|nav|close)$/;

export function exitEventName(stage, decile, how) {
  const d = Math.min(10, Math.max(0, Math.floor(Number(decile) || 0)));
  return `exit_${stage}_${d}_${how}`;
}
export function parseExitEvent(name) {
  const m = EXIT_RE.exec(String(name));
  return m ? { stage: m[1], decile: Number(m[2]), how: m[3] } : null;
}
// 進んだ割合（見た数 / 全体）を 0〜10 の「何割」に。
export function toDecile(seen, total) {
  if (!(total > 0)) return 0;
  return Math.min(10, Math.max(0, Math.floor((seen / total) * 10)));
}

export function isUsageEvent(name) {
  return USAGE_EVENTS.includes(name) || EXIT_RE.test(String(name));
}

export const USAGE_COUNT_MAX = 500; // 1項目の1日の回数の上限
export const USAGE_WORDS_MAX = 9999; // 語数の上限
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{4,64}$/;

const clampInt = (v, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null;
};

// 送られてきた本文の検査。不正なら null。
//   { day:'YYYY-MM-DD', device:'d_…', c:{名前:回数}, r:{n:初めて, c:継続, l:残り} }
export function sanitizeUsage(body) {
  if (!body || typeof body !== 'object') return null;
  const day = String(body.day || '');
  const device = String(body.device || '');
  if (!DAY_RE.test(day) || !DEVICE_RE.test(device)) return null;
  const c = {};
  let keys = 0;
  for (const [k, v] of Object.entries(body.c && typeof body.c === 'object' ? body.c : {})) {
    if (!isUsageEvent(k) || ++keys > 200) continue;
    const n = clampInt(v, USAGE_COUNT_MAX);
    if (n) c[k] = n;
  }
  let r = null;
  if (body.r && typeof body.r === 'object') {
    const n = clampInt(body.r.n, USAGE_WORDS_MAX);
    const cc = clampInt(body.r.c, USAGE_WORDS_MAX);
    const l = clampInt(body.r.l, USAGE_WORDS_MAX);
    if (n != null && cc != null && l != null) r = { n, c: cc, l };
  }
  return { day, device, c, r };
}
