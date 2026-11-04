// 起動時とログイン・登録の分岐（初回体験・docs/design-first-run-trial-2026-11-05.md の修正 C・D）。
// 依存なしの純関数（node のテストから読む）。

// 未ログインで起動した時の分岐。起動時にログイン画面は出さない（修正 D）。
//   expired: セッションが残っているのに更新できなかった人＝ホームの帯でログインし直しを案内する（新規扱いにしない）。
//   openAuth: 拡張を入れた直後のタブは登録を先に出す（設計の決定4）。ログイン歴がある人はログインのタブから。
//     期限切れでこの端末にプロフィールが無い人も、入るホームが無いのでログインを先に出す。
export function startupAuth({ hadSession = false, extEntry = false, hasProfiles = false } = {}) {
  const needLogin = !!hadSession && !hasProfiles;
  return {
    expired: !!hadSession,
    openAuth: !!extEntry || needLogin,
    mode: !extEntry && !needLogin ? null : hadSession ? 'login' : 'signup',
  };
}

// プロフィールに入った時の行き先。'main' | 'trial' | 'onboarding'
//   終えた人と、期限切れの人（帯でログインし直す）はホーム。
//   これから始める人は体験（新規ゲスト・途中で閉じたゲスト・体験の印がある新規アカウント）。
//   旧アンケートが残るのは、体験の印が無いログイン済みアカウントでアンケート未完了の人だけ（既存の動きのまま）。
export function firstRunScreen({ onboarded, onboardedSeen, trialDone, loggedIn, trialPending, expired } = {}) {
  if (onboarded || onboardedSeen || trialDone || expired) return 'main';
  if (loggedIn && !trialPending) return 'onboarding';
  return 'trial';
}

// 新規登録の時に「一度見た」系の印（cl_onboarded・cl_tutorial_seen）を消すか。
//   新しいアカウントが前のアカウントの残りの印で初回の流れを飛ばされないように消す（既存の意図）。
//   ただし、体験の途中や終えたあと、すでに使っているゲストの登録で消すと旧アンケートと使い方が復活するので消さない（修正 C）。
// 体験の入口の source。'extension' は登録済みで来た人だけ（完了画面で登録を案内しない）。
//   拡張から来ても登録せずに閉じた人は、新規と同じく完了画面で登録を案内する。
export function trialSourceOf({ extEntry, loggedIn } = {}) {
  return extEntry && loggedIn ? 'extension' : 'new';
}

export function shouldClearSeenFlagsOnSignup({ inTrial, onboarded } = {}) {
  return !inTrial && !onboarded;
}
