// 初回体験（登録前に試す流れ・docs/design-first-run-trial-2026-11-05.md）の端末の状態。
//   クラウド同期しない端末ローカルの独立キー（cl_onboarded と同じ理由＝pull で消えないように）。
//   途中で閉じた人は最初からやり直す（「再訪時の続き」は第一版では作らない＝設計の後回し）。
//   ★ signup の既読フラグ消去で消さないこと（AuthModal・設計の修正 C）。

export const TRIAL_DONE_KEY = 'cl_trial_done'; // 体験を終えた（または抜けた）＝自動では二度と出さない
export const TRIAL_LATER_KEY = 'cl_trial_later'; // 「あとで」を選んだ＝次に開いた時に1回だけ帯で案内（設計の決定5）
export const TRIAL_LATER_SHOWN_KEY = 'cl_trial_later_shown'; // その帯を出した
export const TRIAL_KEYS = [TRIAL_DONE_KEY, TRIAL_LATER_KEY, TRIAL_LATER_SHOWN_KEY];

function read(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function write(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
}

export const hasFinishedTrial = () => read(TRIAL_DONE_KEY);
export const markTrialFinished = () => write(TRIAL_DONE_KEY);
export const markTrialLater = () => write(TRIAL_LATER_KEY);
export const shouldShowTrialLaterBand = () => read(TRIAL_LATER_KEY) && !read(TRIAL_LATER_SHOWN_KEY);
export const markTrialLaterBandShown = () => write(TRIAL_LATER_SHOWN_KEY);
