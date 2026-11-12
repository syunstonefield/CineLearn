// スライド式チュートリアル（components/IntroCarousel.js）と、ホームのボタン案内（components/HomeTour.js）の
// 依存の少ない純関数と文言（node のテストから読む）。オーナー決定 2026-11-10（モック v6・A〜G はおすすめの 1）。
//
// 初めての流れの切り替え（NEXT_PUBLIC_FIRST_RUN）:
//   未設定・'intro' … スライド6枚 → レベル → ホーム → ボタン案内（今の既定）
//   'trial'         … 以前の初回体験（components/TrialFlow.js）。コードは残してある。戻す手順は docs/first-run-switch.md
// どちらでも「初めての流れを終えた」印は cl_trial_done（lib/trialState.js）を共有する＝切り替えても終えた人にはもう出ない。

export const FIRST_RUN_MODE = process.env.NEXT_PUBLIC_FIRST_RUN === 'trial' ? 'trial' : 'intro';
export const INTRO_ON = FIRST_RUN_MODE === 'intro';

// 「＋ 作品を追加」を一度でも押した端末（ボタン案内の終わりに ＋ を光らせない・オーナー決定 E）。
export const TOUR_ADD_USED_KEY = 'cl_tour_add_used';

// ボタン案内の9か所（並び順＝画面の並び。ヘッダー右の4つ → 下のタブ5つ）。key は data-tour の値。
export const TOUR_STEPS = [
  { key: 'add', title: '＋ 作品を探す', text: '観たい作品を選んで、単語リストを作ります。' }, // 題はヘッダーの＋の名前「作品を探す」にそろえる（オーナー決定 2026-11-10 深夜）
  { key: 'settings', title: '⚙ 設定', text: '英語レベルや、予習で見せる語の数を変えられます。' },
  { key: 'help', title: '? 使い方', text: 'このスライドと案内は、ここからもう一度見られます。' },
  { key: 'login', title: 'ログイン', text: '登録すると、PC の拡張機能やほかの端末と記録がつながります。' },
  { key: 'home', title: 'ホーム', text: '今日の復習と、観ている作品の続きがここに出ます。' },
  { key: 'wordbook', title: '単語帳', text: '「★ 覚えたい」で入れた語と、自分で足した語が並びます。' },
  { key: 'review', title: '復習', text: 'その日に復習する語が、カードで出てきます。' },
  { key: 'journey', title: 'あゆみ', text: '覚えた語の数や、学習した日を見られます。' },
  { key: 'collection', title: 'コレクション', text: '単語リストを作った作品が、学習の記録として並びます。' },
];

// 出す手順。ログイン済みは「ログイン」を飛ばす。画面に無いボタン（あゆみのタブが出ない人など）も飛ばす。
//   present: 画面に見えている data-tour の key の集合（Set か配列）。
export function tourSteps({ loggedIn = false, present = [] } = {}) {
  const has = new Set(present);
  return TOUR_STEPS.filter((s) => !(s.key === 'login' && loggedIn) && has.has(s.key));
}

// 最後の札のボタン。作品がまだ無い人だけ「作品を選んではじめる」（押すと作品追加を開く・オーナー決定 E の 1）。
export function lastTipAction({ hasWorks = false } = {}) {
  return hasWorks ? { label: 'はじめる', add: false } : { label: '作品を選んではじめる', add: true };
}

// 終わりに ＋ を光らせるか（E の 2）。作品追加へ進んだ時と、＋ を一度でも押した端末では光らせない。
export function shouldGlowAdd({ addUsed = false, wentToAdd = false } = {}) {
  return !addUsed && !wentToAdd;
}

// 札の置き場所。上半分のボタン（ヘッダー）は下に、下半分のボタン（下のタブ）は上に出す。
//   横は対象の中央に合わせ、画面の端から margin 以上離す。札がボタンにかからないよう gap だけ離す。
//   法務の条件（2026-11-10）: 札をポスターの上に重ねない。avoid（画面に見えているポスターの矩形）にかかる時は、
//   ボタンから離れる向きに、ポスターの手前（上なら上端の上・下なら下端の下）までずらす。どこにも置けなければ
//   ボタンのそばに置いて overlap: true を返す（呼び出し側で記録・確認用）。札の高さ tipH は実際に測った値を渡す。
const hits = (a, b, m) => a.left < b.right + m && a.right > b.left - m && a.top < b.bottom + m && a.bottom > b.top - m;
export function tipPosition({ rect, vw, vh, tipW, tipH, gap = 14, margin = 12, avoid = [] }) {
  const cx = rect.left + rect.width / 2;
  const left = Math.round(Math.min(vw - margin - tipW, Math.max(margin, cx - tipW / 2)));
  const below = rect.top + rect.height / 2 < vh / 2;
  const first = below ? rect.top + rect.height + gap : rect.top - gap - tipH;
  let top = first;
  for (let i = 0; i < 12; i++) {
    const box = { left, right: left + tipW, top, bottom: top + tipH };
    const on = avoid.filter((r) => hits(box, r, 4));
    if (!on.length) return { left, top: Math.round(top), below, overlap: false };
    top = below ? Math.max(...on.map((r) => r.bottom)) + gap : Math.min(...on.map((r) => r.top)) - gap - tipH;
    if (top < margin || top + tipH > vh - margin) break;
  }
  return { left, top: Math.round(first), below, overlap: true };
}

// 明かり（くり抜き）の矩形。ボタンより pad だけ広く。
export function spotRect(rect, pad = 5) {
  return {
    left: Math.round(rect.left - pad),
    top: Math.round(rect.top - pad),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.height + pad * 2),
  };
}

// 初めての流れ・ボタン案内の間は、うしろのページを動かさない（オーナー報告 2026-11-10 深夜: スライドの上で指を動かすと
//   うしろのページがスクロールし、端で引くと読み直し＝スプラッシュ→1枚目に戻った）。html に印を付け、CSS で
//   html・body のスクロールと「引っ張って更新」を止める（復習の cl-review-lock と同じ考え方）。外すのは useLayoutEffect の後始末で。
export const INTRO_LOCK_CLASS = 'cl-intro-lock';
export function lockPage() {
  const root = document.documentElement;
  window.scrollTo(0, 0);
  root.classList.add(INTRO_LOCK_CLASS);
  return () => root.classList.remove(INTRO_LOCK_CLASS);
}

// 初めての流れで何枚目まで進んだか（読み直されても続きから・このタブのあいだだけ＝sessionStorage）。
export const INTRO_STEP_KEY = 'cl_intro_step';
export function parseIntroStep(v, last = 6) {
  if (v === 'level') return 'level';
  const n = Number(v);
  return v != null && v !== '' && Number.isInteger(n) && n >= 0 && n <= last ? n : null;
}

// スライドの文言（モック v6・オーナー確定 2026-11-10）。見本の語・例文・和訳・作品名は自作／架空。
export const INTRO_SAMPLE_NOTE = '見本の画面です（作品名・セリフは架空のものです）';
export const INTRO_SLIDES = [
  { key: 'cover' },
  { key: 'list', h: ['作品を選ぶと、', '単語リストができる'], p: 'あなたのレベルに合う語に、意味と例文つき。' },
  { key: 'review', h: ['忘れる前に、', 'ちょうどよく復習'], p: '「知ってた」「うろ覚え」「知らなかった」で答えるだけ。' },
  { key: 'quiz', h: ['クイズで、', '覚えたか確かめる'], p: 'セリフの空欄に入る語を、4択で。' },
  { key: 'frames', h: ['学んだ作品が、', '記録として並ぶ'], p: '学習が進むと、記録の枠が豪華になります。' },
  { key: 'ext', h: ['観ながら、', '字幕の単語を保存'], p: 'PC の Chrome 拡張機能で、字幕の単語をクリック。', pcP: 'Chrome 拡張機能で、字幕の単語をクリック。' },
  // 「ホーム画面に追加」（オーナー決定 2026-11-12・法務は条件付き可）。スマホだけ・端末で文を出し分ける（homeSlideText）。
  //   PC とすでにホーム画面から開いている時（standalone）は出さない（introSlidesFor）。
  { key: 'home', h: ['ホーム画面に置くと、', 'すぐ開ける'] },
];

// 「ホーム画面に追加」の枚の絵の下の1行（法務の条件 2026-11-12・「見本の画面です」の代わり）。
export const INTRO_HOME_NOTE = '手順の絵はイメージです。表示は端末やブラウザの版によって異なります。';

// 「ホーム画面に追加」の手順の文（端末ごと）。絵は自作（配信サービスの名前・ポスター・作品名は出さない）。
//   android_button＝Chrome から追加の合図（beforeinstallprompt）が来ていて、ボタンひとつで追加できる時。
export const HOME_SLIDE_TEXT = {
  ios: '共有ボタンから「ホーム画面に追加」を選ぶだけ。',
  android: 'Chrome のメニュー（︙）から「ホーム画面に追加」を選ぶだけ。',
  android_button: '下のボタンを押すだけで、ホーム画面に置けます。',
  added: 'ホーム画面に置きました。次からはアイコンから開けます。',
};

// iPhone の共有ボタンが見当たらない時の小さな補足（版によっては「…」の中にある・オーナー決定 2026-11-12）。
export const HOME_IOS_HINT = '見つからない時は「…」の中にあります。';

// 文を選ぶ（依存なしの純関数）。canPrompt＝Android でボタンひとつで追加できる時。
export function homeSlideText(kind, canPrompt = false, added = false) {
  if (added) return HOME_SLIDE_TEXT.added;
  if (kind === 'android' && canPrompt) return HOME_SLIDE_TEXT.android_button;
  return HOME_SLIDE_TEXT[kind] || '';
}

// 'ios'｜'android'｜null（PC・判断できない・すでにホーム画面から開いている）。依存なしの純関数。
export function homeScreenKind({ ua = '', standalone = false } = {}) {
  if (standalone) return null;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return null;
}

// その端末で出すスライド（ホーム画面に追加は kind がある時だけ）。
export function introSlidesFor(kind) {
  return INTRO_SLIDES.filter((s) => s.key !== 'home' || !!kind);
}

// ブラウザで kind を調べる（クライアントだけ）。
export function detectHomeScreenKind() {
  if (typeof window === 'undefined') return null;
  let standalone = false;
  try {
    standalone = !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);
  } catch {
    /* ignore */
  }
  return homeScreenKind({ ua: window.navigator.userAgent || '', standalone });
}
