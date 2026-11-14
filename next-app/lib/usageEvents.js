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

// 復習を0〜1枚で抜ける理由を見分ける記録（2026-11-14 オーナー OK・受付経由・★法務の確認中）。固定の名前と回数だけ
//   （語・作品・カード番号・生の秒数は入れない）。今日の復習・作品の復習（復習タブのページ表示）だけ・もう一度は数えない。
//   抜けた時に1回ずつ: めくる前／めくった後・そのカードがはじめての語（回を始めた時に SRS に無い）／期限の語・
//   そのカードが出てから抜けるまでの時間の幅・下のタブで抜けた時の行き先。回を始めた時に1回: はじめての語と期限の語の数の幅。
export const REVIEW_EXIT_TIME_BUCKETS = [
  ['review_exit_t_0_5', 5],
  ['review_exit_t_5_15', 15],
  ['review_exit_t_15_60', 60],
  ['review_exit_t_60p', Infinity],
];
export const REVIEW_MIX_BUCKETS = [
  ['0', 0],
  ['1_5', 5],
  ['6_10', 10],
  ['11_20', 20],
  ['21p', Infinity],
];
// 行き先: 復習のページ表示の間は下のタブが出ない（app/(app)/app/page.js showBottomNav・2026-11-07）ので、
//   抜け道はヘッダー＝ロゴ（home）・「＋ 作品」（add）・単語帳（wordbook・PC の幅）・設定（settings）・使い方（help）・
//   ログイン／ログアウト／プロフィール（account）。下のタブが出る画面に変わった時のため、タブの home/wordbook も同じ名前で受ける。
export const REVIEW_NAV_TARGETS = ['home', 'add', 'wordbook', 'settings', 'help', 'account'];
// 押した物（ヘッダー・下のタブ）から行き先の固定名へ。DOM の要素を受ける（node のテストでは似た形の物を渡す）。
export function reviewNavTargetOf(el) {
  if (!el?.closest) return null;
  const tab = el.closest('.bottom-nav-tab')?.getAttribute('data-tour');
  if (tab) return REVIEW_NAV_TARGETS.includes(tab) ? tab : null;
  if (el.closest('.logo')) return 'home';
  const b = el.closest('button');
  if (!b || !b.closest('header, .header, .app-header, .header-right, .hdr-menu')) return null;
  const tour = b.getAttribute('data-tour');
  if (tour === 'add') return 'add';
  if (tour === 'settings') return 'settings';
  if (tour === 'help') return 'help';
  if (tour === 'login' || b.classList?.contains('btn-profile-switch')) return 'account';
  const label = `${b.getAttribute('title') || ''} ${b.textContent || ''}`;
  if (/単語帳/.test(label)) return 'wordbook';
  if (/設定/.test(label)) return 'settings';
  if (/使い方/.test(label)) return 'help';
  if (/ログイン|ログアウト/.test(label)) return 'account';
  return null;
}
export const REVIEW_EXIT_EVENTS = [
  'review_exit_front', // めくる前（答え合わせの前）に抜けた
  'review_exit_back', // めくった後（答える前）に抜けた
  'review_exit_new', // 抜けた時のカードが、はじめての語（回を始めた時に SRS に無い語）
  'review_exit_due', // 抜けた時のカードが、期限の語（SRS にある語）
  ...REVIEW_EXIT_TIME_BUCKETS.map(([n]) => n),
  ...REVIEW_NAV_TARGETS.map((t) => `review_nav_${t}`), // 別の画面へ抜けた時の行き先（ヘッダーで押した物）
  ...['new', 'due'].flatMap((k) => REVIEW_MIX_BUCKETS.map(([b]) => `review_mix_${k}_${b}`)), // 回を始めた時の内訳の幅
];
const bucketOf = (list, v) => list.find(([, max]) => v <= max)?.[0];
export function reviewMixEvents(newCount, dueCount) {
  const n = Math.max(0, Math.floor(Number(newCount) || 0));
  const d = Math.max(0, Math.floor(Number(dueCount) || 0));
  return [`review_mix_new_${bucketOf(REVIEW_MIX_BUCKETS, n)}`, `review_mix_due_${bucketOf(REVIEW_MIX_BUCKETS, d)}`];
}
export function reviewExitTimeEvent(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s < 0) return null;
  return REVIEW_EXIT_TIME_BUCKETS.find(([, max]) => s < max)[0];
}
// 抜けた時の名前の組（how: x / nav / close。nav の時だけ行き先 target を足す・一覧に無い行き先は足さない）。
export function reviewExitDetailEvents({ flipped, isNew, sec, how, target }) {
  const out = [flipped ? 'review_exit_back' : 'review_exit_front', isNew ? 'review_exit_new' : 'review_exit_due'];
  const t = reviewExitTimeEvent(sec);
  if (t) out.push(t);
  if (how === 'nav' && REVIEW_NAV_TARGETS.includes(target)) out.push(`review_nav_${target}`);
  return out;
}

// 入口の印（?from=<値>・2026-11-13・宣伝の動画のプロフィールのリンクと「PC で開くリンク」・instagram はオーナーのストーリーでの告知）。決まった値だけ受け付ける。
//   値ごとに固定名 from_<値> を「来た回数」として数える（だれが・どの動画から・時刻は入れない）。
//   ext_install は lib/extEntry.js の別の印（ext_install_open）なのでここには入れない。
export const FROM_SOURCES = ['tiktok', 'youtube', 'share', 'instagram'];
export const FROM_EVENTS = FROM_SOURCES.map((s) => `from_${s}`);
export function fromEvent(value) {
  const v = String(value || '').trim().toLowerCase();
  return FROM_SOURCES.includes(v) ? `from_${v}` : null;
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
  // 入場（予習のあとの「入場する ▶」・components/PrepLaunch.js・2026-11-10）。サービス名は入れない（法務）。
  'enter_open', // 視聴サービスの検索ページを開いた
  'enter_ask', // 開く先が決まらず、観るサービスを聞くシートを出した
  'svc_change', // 単語リストの「観る：○○（変更）」から別のサービスに変えた
  'work_select', // 作品を選んだ（ライブラリ・検索・おすすめ・コレクション・復習一覧 → 単語リスト）
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
  // スライド式チュートリアルとボタン案内（2026-11-10〜・components/IntroCarousel.js／HomeTour.js）。初めての流れの時だけ数える
  //   （「? 使い方」から見直した時は数えない）。固定の名前と回数だけ（レベルの値・作品 ID は入れない＝法務）。
  'intro_start', // 1枚目（ようこそ）が出た
  'intro_s2', // 2枚目に進んだ
  'intro_s3',
  'intro_s4',
  'intro_s5',
  'intro_s6', // 6枚目（拡張機能）に進んだ
  'intro_skip', // スライドの「スキップ」を押した（レベルの質問へ）
  'intro_share', // 拡張機能のスライド（スマホだけ）の「PC で開くリンクを送る」を押した回数（送り先・内訳は記録しない・2026-11-13）
  'intro_guest', // 「登録せずに開始」を押した
  'intro_auth_click', // 「ログイン・新規登録」かログインの文字リンクを押した（登録の成功は auth_signup）
  'intro_level', // レベルを選んだ（値は入れない）
  'tour_start', // ボタン案内が始まった
  'tour_skip', // ボタン案内の「スキップ」を押した
  'tour_done', // ボタン案内を最後まで進んだ
  'tour_add', // 最後の札の「作品を選んではじめる」を押した
  // 復習カード（復習タブのページ表示だけ・2026-11-07 法務回答の条件つき）。固定の名前と回数だけ（語・作品・カード番号は入れない）。
  //   ポリシー「復習で3つの答えのそれぞれを選んだ回数、復習の1枚あたりにかかったおよその時間（いくつかの幅に区分した値）」
  //   「予習・復習をどこまで進めたか・どう終えたか」。集計（全体・週ごと）にだけ使う＝1人ごとの値で画面を変えない。
  'review_start', // 復習を始めた（1回の復習＝カードの束1つ。知らなかった語のもう一度は数えない）
  'review_done', // 最後のカードまで答えた
  'review_ans_fail', // 「知らなかった」を選んだ
  'review_ans_hard', // 「うろ覚え」を選んだ
  'review_ans_easy', // 「知ってた！」を選んだ
  ...REVIEW_TIME_BUCKETS.map(([name]) => name), // 1枚あたりの時間（カードが出てから答えるまで）の幅
  ...REVIEW_EXIT_EVENTS, // 抜けた理由の見分け（上の REVIEW_EXIT_EVENTS・2026-11-14・法務の確認中）
  // 「知らなかった／うろ覚えの語をもう一度」（復習タブのカード・2026-11-12）。固定の名前と回数だけ（語・語数は入れない）。
  //   ★法務の確認待ち（受付経由）。上の review_* には数えない（今日の復習の流れと混ぜない）。
  'again_unknown_start', // 「知らなかった語をもう一度」を始めた
  'again_shaky_start', // 「うろ覚えの語をもう一度」を始めた
  'again_done', // 最後のカードまで答えた（どちらも）
  'again_next', // 完了画面の「続きの N語」を押した
  // 「単語を学ぶ」の流れ（作品・予習部門の画面・2026-11-13 オーナー決定・法務 可・ポリシーの追記不要＝「予習・復習をどこまで進めたか・どう終えたか」）。
  //   固定の名前と回数だけ（語・作品・語数は入れない）。
  'learn_start', // 「単語を学ぶ」を始めた
  'learn_done', // 最後まで終えた
  'learn_more', // 終えたあとに「続けて学ぶ」を選んだ
  'learn_quit', // 途中で抜けた
  'learn_first', // 初めての5枚を見た（端末ごとに1回・人数としては読まない）
  'home_learn', // ホームの「学ぶ」を押した
  'home_quiz', // ホームの「クイズ」を押した
  // 入口の印（上の FROM_SOURCES）。?from= 付きで来た人が /app に入った時に1回（紹介ページでは送らない）。
  ...FROM_EVENTS,
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
