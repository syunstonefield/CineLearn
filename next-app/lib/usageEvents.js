// ベータの利用データ（2026-10-09 オーナーと設計・docs/design-usage-stats-2026-10-09.md）。
// アプリ（lib/usage.js）とサーバー（lib/server/usage.js）・週次の表（seed/weekly-stats.mjs）で共有する
// 「数えてよい項目の名前」と、送られてきた値の検査。依存なしの純関数（node のテストと seed から読む）。
//   * 作品名・話の番号・単語・時刻は送らない（名前の一覧に無いものは捨てる）。
//   * ★新しい種類の項目を足す時は、プライバシーポリシー（app/(marketing)/privacy/page.js「利用状況の統計」）と
//     設定画面の説明（components/SettingsScreen.js「利用統計を送る」）の文言で読めるかを確認する。読めなければ
//     足す前に法務部へ（2026-11-04 法務回答・受付経由）。

// 復習の1枚あたりの時間の幅（法務: 生の秒数は送らない・幅の名前はこの一覧で固定）。[名前, 上限の秒（未満）]
export const REVIEW_TIME_BUCKETS = [
  ['review_t_0_5', 5],
  ['review_t_5_10', 10],
  ['review_t_10_20', 20],
  ['review_t_20p', Infinity],
];
export function reviewTimeEvent(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s < 0) return null;
  return REVIEW_TIME_BUCKETS.find(([, max]) => s < max)[0];
}

export const USAGE_EVENTS = [
  'open', // アプリを開いた（ページの読み込みごと）
  'work_review', // 作品・話の復習を始めた
  'work_all_review', // 作品まとめ復習を始めた
  'work_quiz', // 作品・話のクイズを始めた
  'journey_tab', // あゆみを下のタブ（など）から開いた
  'journey_grass', // ホームの「学習した日」からあゆみを開いた
  'trend_seen', // 週ごとの推移が画面に表示された
  'journey_cefr_seen', // 段階ごとの覚えた語（CEFR 目安別）のカードが画面に表示された（半分以上・開くたび1回・2026-11-05・ポリシー文言は法務④の回答待ち）
  'list_open', // 話の単語リストが画面に出た
  'walk_start', // 予習カードを始めた
  'walk_core', // 重要語（最初の最大15枚）を見終えた
  'walk_rest', // 「残りの語も見る」を選んで最後までめくった
  'walk_done', // 予習完了（半券）
  // 初回アンケート（components/Onboarding.js・2026-11-01）。何問目まで進んだか／飛ばしたかだけ（回答の中身は送らない）
  'ob_q1', // 1問目（レベル）が表示された
  'ob_q2', // 2問目（動画サービス）
  'ob_q3', // 3問目（ジャンル）
  'ob_q4', // 4問目（目的）
  'ob_q5', // 5問目（どこで知ったか）
  'ob_skip_q2', // 2問目をスキップした
  'ob_skip_q3',
  'ob_skip_q4',
  'ob_skip_q5',
  'ob_plan', // 「準備ができました」（プラン提示）が表示された
  'ob_done', // 「おすすめから始める」を押した＝アンケート完了
  // 新規の人がどこで離れるか（2026-11-04・docs/research-2026-11-new-user-dropoff.md）。
  //   ログイン画面（components/AuthModal.js）: 表示された／どう抜けたか。✕・外側クリックは数えない（表示−3つの差）。
  'auth_shown', // ログイン画面が表示された（起動時・ヘッダーから）
  'auth_signup', // 新規登録に成功した
  'auth_login', // ログインに成功した
  'auth_local', // 「このデバイスのみで使う」を選んだ
  // 作品を探す（components/SearchScreen.js・2026-11-10 作り替え）。固定の名前と回数だけ（検索語・作品名・札の種類は入れない＝法務 2026-11-10）。
  'search_run', // Enter／「〜で検索」で結果の一覧を出した
  'search_suggest_pick', // 打っている途中の候補から作品を選んだ
  'search_result_pick', // 結果の一覧から作品を選んだ
  'search_none', // 結果が0件だった
  'search_ai', // 「AI に探してもらう」を押した
  'search_chip', // ジャンルの札を押した（どの札かは送らない）
  'search_list_pick', // 「英語学習に向いている作品」の行から作品を選んだ
  'search_recent', // 最近の検索を押した
  'work_select', // 作品を選んだ（ライブラリ・検索・おすすめ・コレクション・復習一覧 → サービス選択／単語リスト）
  'ext_first_save', // 拡張で保存した語がこの端末に初めて届いた（クラウド取込の後に単語帳を見て判定・端末ごとに1回）
  'ext_install_open', // 拡張の導入直後の案内タブ（/app?from=ext_install・Chrome 拡張部門と合わせた形）が開いた。URL から外してから数える
  // 初回体験（登録前に試す流れ・2026-11-05・docs/design-first-run-trial-2026-11-05.md）。名前は作品・予習部門の画面と合わせた。
  //   固定の名前と回数だけ（作品 ID・作品名・レベルの値は入れない＝法務）。ポリシー「初めての方向けの体験をどこまで進めたか、登録を後回しにしたか」。
  'trial_start', // 最初の画面（ようこそ）が出た
  'trial_welcome', // ようこその画面から進んだ
  'trial_level', // レベルを選んだ
  'trial_intro', // チュートリアルの案内の画面から進んだ
  'trial_pick', // 作品を選んだ
  'trial_list', // 5語の画面が出た
  'trial_walk_done', // 予習5枚を終えた
  'trial_quiz_done', // クイズ3問を終えた
  'trial_done', // 完了画面が出た
  'trial_signup_click', // 「登録して学習記録を残す」を押した（登録の成功は auth_signup）
  'trial_later', // 「あとで」を選んだ
  'trial_next', // 次の一歩の画面が出た
  'trial_later_band', // 「あとで」の人への帯が出た
  // 復習カード（復習タブのページ表示だけ・2026-11-07 法務回答の条件つき）。固定の名前と回数だけ（語・作品・カード番号は入れない）。
  //   ポリシー「復習で3つの答えのそれぞれを選んだ回数、復習の1枚あたりにかかったおよその時間（いくつかの幅に区分した値）」
  //   「予習・復習をどこまで進めたか・どう終えたか」。集計（全体・週ごと）にだけ使う＝1人ごとの値で画面を変えない。
  'review_start', // 復習を始めた（1回の復習＝カードの束1つ。知らなかった語のもう一度は数えない）
  'review_done', // 最後のカードまで答えた
  'review_ans_fail', // 「知らなかった」を選んだ
  'review_ans_hard', // 「うろ覚え」を選んだ
  'review_ans_easy', // 「知ってた！」を選んだ
  ...REVIEW_TIME_BUCKETS.map(([name]) => name), // 1枚あたりの時間（カードが出てから答えるまで）の幅
];

// 拡張で保存した語か。拡張は source に配信サイトの画面タイトル（Netflix 等）を入れ、アプリの保存は
// 'star'（★）／'manual'（手入力）だけ（lib/words.js・components/VocabScreen.js）。source が無い語は判定しない。
const APP_WORD_SOURCES = ['star', 'manual'];
export function isExtSavedWord(w) {
  const src = w && typeof w === 'object' ? w.source : null;
  return typeof src === 'string' && src.trim() !== '' && !APP_WORD_SOURCES.includes(src);
}
export function hasExtSavedWord(words) {
  return Array.isArray(words) && words.some(isExtSavedWord);
}


// 途中で抜けた: exit_<段階>_<何割まで 0〜10>_<抜け方>
//   段階  list＝単語リスト（一覧のスクロール位置）／core＝重要語のカード／rest＝残りの語のカード／review＝復習のカード（2026-11-07）
//   抜け方 walk＝予習カードへ進んだ（一覧のみ）／x＝✕・Esc／later＝「あとで予習する」／nav＝別の画面へ／close＝タブ・アプリを閉じた
export const EXIT_STAGES = ['list', 'core', 'rest', 'review'];
export const EXIT_HOWS = ['walk', 'x', 'later', 'nav', 'close'];
const EXIT_RE = /^exit_(list|core|rest|review)_(10|[0-9])_(walk|x|later|nav|close)$/;

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
  // 運営の端末の印（オーナー・部門の確認用ブラウザ・2026-11-07）。週次の表がこの端末の全ての行を外す（lib/usageReport.js excludeStaff）。
  const staff = body.staff === 1 || body.staff === true;
  return { day, device, c, r, ...(staff ? { s: 1 } : {}) };
}
