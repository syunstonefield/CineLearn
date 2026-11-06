// 端末に残る学習データとアカウントの対応（2026-11-05・受付経由オーナー報告: 同じ端末で別のアカウントに入ると、
// 前のアカウントの「学習した日」などが新しいアカウントに引き継がれた）。
//   原因: ログアウトが消すのは決まった項目だけで、user_state に同期する項目（cl_stats_daily・cl_exp_ledger・
//   cl_tickets・cl_study_sec …）や「学習した日」（cl_activity_dates）が端末に残り、次のアカウントの pullFromCloud が
//   残りをそのアカウントのクラウドと合算して書き戻していた。
//   対策:
//     1. ログアウト時に、学習データのキーを全部この端末から消す（wipeLearningData）。未送信の同期は先に送る（lib/supabase.js flushStatePushQueue）。
//     2. 「前回この端末で使っていたアカウント」（cl_last_uid）を覚え、違うアカウントでログインした時は合算の前に消す
//        （prepareDeviceForAccount）。セッション切れのあと同じアカウントで入り直す時は消さず合算する。
//        ゲスト・初回体験のあとの新規登録（前回のアカウントが無い）は消さない＝引き継ぎはそのまま。
//   残すもの: 端末の設定・キャッシュ（cl_device_key・cl_usage_*・cl_theme・cl_title_*・cl_total_eps_*・cl_sub*・翻訳キャッシュ・
//   cl_ticket_view・cl_review_keys_seen・cl_last_uid）とセッション（cl_sb_session は clearSession が別に消す）。
//   ★学習データのキーを新しく足したら LEARNING_KEY_RE にも足す（lib/supabase.js STATE_KEY_RE と scripts/deviceAccount.test.mjs を参照）。
// 依存なしの純関数＋storage を引数で受けるヘルパ（node のテストから読む）。

export const LAST_UID_KEY = 'cl_last_uid';

// 学習データ（アカウントに属するもの）。プロフィール別キー（cl_my_words_<pid> など）も接頭辞で拾う。
export const LEARNING_KEY_RE =
  /^cl_(profiles|history|srs|my_words|deleted_words|tickets|fav_dramas|study_sec|study_drama|watch_log|frame_best|prepped|seat_counter|exp_ledger|archived|stats_daily|activity_dates|review_log|quiz_exp_awarded|recent_searches|prep_pos|ring_seen|plan_cache|trial_done|trial_later|trial_later_shown|removed_works|ring_met_reset)(_|$)/;
// 消すキーとクラウドの写し（2026-11-05 受付レビューで一覧化。写しがある＝同じアカウントの入り直しで戻る）:
//   profiles(+_updated_at)→profiles表／history→history表／srs→srs_data／my_words(_pid)→my_words／
//   tickets・fav_dramas・study_sec・study_drama・watch_log・frame_best・prepped・seat_counter・exp_ledger・archived・stats_daily→user_state／
//   activity_dates・review_log・quiz_exp_awarded→user_state（2026-11-05 に同期対象へ追加・lib/stateMergeRules.js）
//   写しが無く消えるもの（アカウントの記録ではない・戻らなくてよい）: deleted_words(_pid)＝削除語の目印（クラウドの削除が正）／
//   srs_origin_backfill_v1＝一度きりの埋め戻しの印（入り直しで再実行・通信なし）／recent_searches＝検索欄の履歴／prep_pos＝カードの途中位置／
//   ring_seen＝リングの前回値／plan_cache＝プランの前回値（uid 付き）／trial_*＝体験の印（従来から消していた）／sessionStorage の後回し。
//   消さないもの: predom_fix(_pid)＝切り替え前の例文の取り直しの済み印（プロフィール ID 付き・消すと通信を伴う取り直しが再実行される）。

// 「一度見た」系の印。ログアウトと別アカウントへの切り替えでは消す（残すと次の人が初回の流れを見られない・従来の signOut と同じ）。
export const SEEN_FLAG_KEYS = ['cl_onboarded', 'cl_tutorial_seen', 'cl_ext_banner_dismissed'];

// sessionStorage に置く学習中の一時状態（「観終わった？」の後回し）。
export const SESSION_LEARNING_PREFIXES = ['cl_watch_snooze_'];

export function isLearningKey(key) {
  return LEARNING_KEY_RE.test(String(key));
}

// 消すキーだけを返す（純関数）。
export function learningKeysOf(keys, { seenFlags = true } = {}) {
  const out = [];
  for (const k of keys || []) {
    if (isLearningKey(k) || (seenFlags && SEEN_FLAG_KEYS.includes(k))) out.push(k);
  }
  return out;
}

// 別のアカウントか。前回のアカウントが分からない（ゲスト・体験から初めて登録・ログアウト済み）時は消さない。
export function shouldWipeForAccount(prevUid, uid) {
  return !!prevUid && !!uid && String(prevUid) !== String(uid);
}

function keysOf(storage) {
  const out = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k != null) out.push(k);
    }
  } catch {}
  return out;
}
function defaultLocal() {
  return typeof window !== 'undefined' ? window.localStorage : null;
}
function defaultSession() {
  return typeof window !== 'undefined' ? window.sessionStorage : null;
}

// この端末の学習データを消す。戻り値＝消したキー。
export function wipeLearningData({ seenFlags = true, local = defaultLocal(), session = defaultSession() } = {}) {
  const removed = [];
  if (local) {
    for (const k of learningKeysOf(keysOf(local), { seenFlags })) {
      try {
        local.removeItem(k);
        removed.push(k);
      } catch {}
    }
  }
  if (session) {
    for (const k of keysOf(session)) {
      if (!SESSION_LEARNING_PREFIXES.some((p) => k.startsWith(p))) continue;
      try {
        session.removeItem(k);
        removed.push(k);
      } catch {}
    }
  }
  return removed;
}

export function lastAccount(local = defaultLocal()) {
  try {
    return local?.getItem(LAST_UID_KEY) || null;
  } catch {
    return null;
  }
}
export function rememberAccount(uid, local = defaultLocal()) {
  if (!uid) return;
  try {
    local?.setItem(LAST_UID_KEY, String(uid));
  } catch {}
}
export function forgetAccount(local = defaultLocal()) {
  try {
    local?.removeItem(LAST_UID_KEY);
  } catch {}
}

// ログイン／登録に成功した直後（pull・引き継ぎの前）に呼ぶ。
//   prevSessionUid … ログインの前に端末に残っていたセッションの利用者 ID（期限切れのまま別の人が入る時の保険。
//                    cl_last_uid がまだ無い古い端末でも、残っていたセッションの持ち主と違えば消す）。
//   戻り値 { wiped, prevUid }
export function prepareDeviceForAccount(uid, { prevSessionUid = null, local = defaultLocal(), session = defaultSession() } = {}) {
  const prevUid = lastAccount(local) || prevSessionUid || null;
  let wiped = false;
  if (shouldWipeForAccount(prevUid, uid)) {
    wipeLearningData({ seenFlags: true, local, session });
    wiped = true;
  }
  rememberAccount(uid, local);
  return { wiped, prevUid };
}
