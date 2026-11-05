// 端末の学習データとアカウントの対応（lib/deviceAccount.js）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEARNING_KEY_RE,
  SEEN_FLAG_KEYS,
  LAST_UID_KEY,
  isLearningKey,
  learningKeysOf,
  shouldWipeForAccount,
  wipeLearningData,
  prepareDeviceForAccount,
  rememberAccount,
  forgetAccount,
  lastAccount,
} from '../lib/deviceAccount.js';

// lib/supabase.js STATE_KEY_RE（user_state に同期する項目）と同じ一覧。ここで落ちたら両方を直す。
const STATE_KEYS = [
  'cl_tickets', 'cl_tickets_p_1', 'cl_fav_dramas', 'cl_fav_dramas_p_1', 'cl_study_sec', 'cl_study_sec_p_1',
  'cl_study_drama', 'cl_study_drama_p_1', 'cl_watch_log', 'cl_watch_log_p_1', 'cl_frame_best', 'cl_frame_best_p_1',
  'cl_prepped', 'cl_seat_counter', 'cl_exp_ledger', 'cl_archived', 'cl_stats_daily',
  'cl_activity_dates', 'cl_review_log', 'cl_quiz_exp_awarded', // 2026-11-05 に同期対象へ（写しがあるので消しても戻る）
];
// signOut が従来から消していたもの＋アプリの他の学習データ・プロフィール別キー
const OTHER_LEARNING = [
  'cl_profiles', 'cl_profiles_updated_at', 'cl_history', 'cl_srs', 'cl_srs_origin_backfill_v1', 'cl_my_words', 'cl_my_words_p_1',
  'cl_deleted_words', 'cl_deleted_words_p_1',
  'cl_recent_searches', 'cl_prep_pos_tt123_s1e1', 'cl_ring_seen', 'cl_plan_cache',
  'cl_trial_done', 'cl_trial_later', 'cl_trial_later_shown',
];
// 端末の設定・キャッシュ・セッション＝残す
const DEVICE_KEYS = [
  'cl_sb_session', 'cl_device_key', 'cl_last_uid', 'cl_usage_tally', 'cl_usage_optout', 'cl_usage_ext_seen', 'cl_theme',
  'cl_title_media2', 'cl_title_alias2', 'cl_total_eps_123', 'cl_sub_lru', 'cl_sub_raw_x', 'cl_ja_sentence_cache_v2',
  'cl_ctx_ja_cache_v3', 'cl_subcache_cleanup_v1', 'cl_ticket_view', 'cl_review_keys_seen', 'cl_sync_recover_v1',
  'cl_predom_fix', 'cl_predom_fix_p_1', // 取り直しの済み印は消さない（消すと通信を伴う取り直しが再実行される）
];

test('学習データのキー: user_state の項目・従来の消去対象・プロフィール別キーを全部拾い、端末の設定とセッションは拾わない', () => {
  for (const k of [...STATE_KEYS, ...OTHER_LEARNING]) assert.ok(isLearningKey(k), `消すべき: ${k}`);
  for (const k of DEVICE_KEYS) assert.ok(!isLearningKey(k), `残すべき: ${k}`);
  for (const k of SEEN_FLAG_KEYS) assert.ok(!LEARNING_KEY_RE.test(k)); // 印は seenFlags で別扱い
  const all = [...STATE_KEYS, ...OTHER_LEARNING, ...DEVICE_KEYS, ...SEEN_FLAG_KEYS];
  assert.deepEqual(new Set(learningKeysOf(all)), new Set([...STATE_KEYS, ...OTHER_LEARNING, ...SEEN_FLAG_KEYS]));
  assert.deepEqual(new Set(learningKeysOf(all, { seenFlags: false })), new Set([...STATE_KEYS, ...OTHER_LEARNING]));
});

test('別のアカウントか: 前回が無ければ消さない・同じなら消さない・違えば消す', () => {
  assert.equal(shouldWipeForAccount(null, 'u1'), false); // ゲスト・体験から初めて登録／ログアウト済み
  assert.equal(shouldWipeForAccount('u1', 'u1'), false); // 期限切れ→同じ人が入り直す
  assert.equal(shouldWipeForAccount('u1', 'u2'), true); // 別の人
  assert.equal(shouldWipeForAccount('u1', null), false);
});

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

test('消去: 学習データと印だけ消え、セッション・端末キー・使用統計は残る。sessionStorage の後回しも消える', () => {
  const local = fakeStorage({
    cl_sb_session: '{"access_token":"t","user":{"id":"u1"}}', cl_device_key: 'd_1', cl_usage_tally: '{}', cl_theme: 'dark',
    cl_profiles: '[]', cl_stats_daily: '{}', cl_activity_dates: '[]', cl_exp_ledger: '{}', cl_tickets_p_1: '[]', cl_my_words_p_1: '[]',
    cl_onboarded: '1', cl_tutorial_seen: '1', cl_review_keys_seen: '1', cl_last_uid: 'u1',
  });
  const session = fakeStorage({ cl_watch_snooze_x: '1', cl_ext_install_entry: '1' });
  const removed = wipeLearningData({ local, session });
  assert.deepEqual(new Set(removed), new Set(['cl_profiles', 'cl_stats_daily', 'cl_activity_dates', 'cl_exp_ledger', 'cl_tickets_p_1', 'cl_my_words_p_1', 'cl_onboarded', 'cl_tutorial_seen', 'cl_watch_snooze_x']));
  assert.deepEqual(new Set(local.keys()), new Set(['cl_sb_session', 'cl_device_key', 'cl_usage_tally', 'cl_theme', 'cl_review_keys_seen', 'cl_last_uid']));
  assert.deepEqual(session.keys(), ['cl_ext_install_entry']);
  // 印を残す指定
  const local2 = fakeStorage({ cl_onboarded: '1', cl_history: '[]' });
  wipeLearningData({ local: local2, session: fakeStorage(), seenFlags: false });
  assert.deepEqual(local2.keys(), ['cl_onboarded']);
});

test('ログイン直後の判定: ゲスト→登録は残す／同じ人の入り直しは残す／別の人は消す／ログアウト後は残す／古い端末はセッションの持ち主で見分ける', () => {
  // ゲスト（体験）→ 初めての登録: 前回のアカウントが無い → 消さない・覚える
  let local = fakeStorage({ cl_history: '[{"id":"h1"}]', cl_stats_daily: '{}' });
  let r = prepareDeviceForAccount('u1', { local, session: fakeStorage() });
  assert.deepEqual(r, { wiped: false, prevUid: null });
  assert.equal(local.getItem('cl_history'), '[{"id":"h1"}]');
  assert.equal(lastAccount(local), 'u1');
  // 期限切れ → 同じ人が入り直す: 消さず合算に回す
  r = prepareDeviceForAccount('u1', { prevSessionUid: 'u1', local, session: fakeStorage() });
  assert.equal(r.wiped, false);
  assert.equal(local.getItem('cl_stats_daily'), '{}');
  // 期限切れ → 別の人が入る: 合算の前に消す・覚え直す
  r = prepareDeviceForAccount('u2', { prevSessionUid: 'u1', local, session: fakeStorage() });
  assert.deepEqual(r, { wiped: true, prevUid: 'u1' });
  assert.equal(local.getItem('cl_history'), null);
  assert.equal(local.getItem('cl_stats_daily'), null);
  assert.equal(lastAccount(local), 'u2');
  // ログアウト（forgetAccount 済み）→ ゲストが使って → 別の人が登録: 消さない（引き継ぎ）
  forgetAccount(local);
  local.setItem('cl_history', '[{"id":"h2"}]');
  r = prepareDeviceForAccount('u3', { local, session: fakeStorage() });
  assert.equal(r.wiped, false);
  assert.equal(local.getItem('cl_history'), '[{"id":"h2"}]');
  // 古い端末（cl_last_uid が無い）: 残っていたセッションの持ち主と違えば消す
  local = fakeStorage({ cl_exp_ledger: '{"x":1}' });
  r = prepareDeviceForAccount('u9', { prevSessionUid: 'u1', local, session: fakeStorage() });
  assert.deepEqual(r, { wiped: true, prevUid: 'u1' });
  assert.equal(local.getItem('cl_exp_ledger'), null);
  assert.equal(local.getItem(LAST_UID_KEY), 'u9');
  // storage が無い環境でも落ちない
  assert.deepEqual(prepareDeviceForAccount('u1', { local: null, session: null }), { wiped: false, prevUid: null });
  rememberAccount('u1', null);
  forgetAccount(null);
});

test('同じアカウントで入り直しても、学習した日・連続日数の元・日ごとの記録は端末から消えない（合算に回る）', () => {
  const local = fakeStorage({
    cl_last_uid: 'u1',
    cl_activity_dates: '["2026-11-03","2026-11-04","2026-11-05"]',
    cl_stats_daily: '{"2026-11-05|d_1":{"ok":3}}',
    cl_exp_ledger: '{"2026-11-05|d_1":12}',
    cl_review_log: '[{"date":"2026-11-05","historyId":"h1","sessionNum":1}]',
  });
  // 期限切れ → 同じ人（セッションの持ち主も同じ）
  const r = prepareDeviceForAccount('u1', { prevSessionUid: 'u1', local, session: fakeStorage() });
  assert.equal(r.wiped, false);
  assert.equal(local.getItem('cl_activity_dates'), '["2026-11-03","2026-11-04","2026-11-05"]');
  assert.equal(local.getItem('cl_stats_daily'), '{"2026-11-05|d_1":{"ok":3}}');
  assert.equal(local.getItem('cl_exp_ledger'), '{"2026-11-05|d_1":12}');
  assert.equal(local.getItem('cl_review_log'), '[{"date":"2026-11-05","historyId":"h1","sessionNum":1}]');
  // 前回の記憶が無い（ログアウト後・古い端末でセッションも無い）→ 残す
  const local2 = fakeStorage({ cl_activity_dates: '["2026-11-01"]' });
  assert.equal(prepareDeviceForAccount('u1', { local: local2, session: fakeStorage() }).wiped, false);
  assert.equal(local2.getItem('cl_activity_dates'), '["2026-11-01"]');
});
