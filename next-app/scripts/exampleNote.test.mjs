// 2026-10-20 /decide E: 例文が付かなかった時の案内文。分類と、使ってはいけない表現を固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualExampleNote } from '../lib/exampleNote.js';
import { EXAMPLE_FAIL_LABEL } from '../lib/exampleBackfill.js';

const ALL_REASONS = [
  'common_word', 'multi_token', 'too_short', 'too_long', 'tmdb_unresolved', 'missing_params',
  'login_required', 'no_match', 'no_subtitle_file',
  'no_raw', 'os_quota', 'rate_limited', 'unavailable', 'network', 'subtitle_fetch_failed', 'not_eligible', 'something_new',
];
// 当社が字幕を用意・保有しているように読める表現／出所以外での OpenSubtitles 名／取得枠の話
const FORBIDDEN = [/OpenSubtitles/i, /字幕が用意/, /字幕を用意/, /字幕データ/, /取得枠/, /上限/, /枠が/];

test('E: 分類（今後も付かない／入れ直す／ログイン／見つからない）', () => {
  for (const r of ['common_word', 'multi_token', 'too_short', 'too_long', 'tmdb_unresolved']) assert.equal(manualExampleNote(r).kind, 'never', r);
  assert.equal(manualExampleNote('login_required').kind, 'login');
  for (const r of ['no_match', 'no_subtitle_file']) assert.equal(manualExampleNote(r).kind, 'none', r);
  for (const r of ['no_raw', 'os_quota', 'rate_limited', 'unavailable', 'network', 'subtitle_fetch_failed', 'not_eligible', 'something_new'])
    assert.equal(manualExampleNote(r).kind, 'retry', r);
});

test('E: 手動追加の語は自動で取り直さないので「あとで付く」とは書かず、入れ直すよう案内する', () => {
  const t = manualExampleNote('unavailable').text;
  assert.match(t, /入れ直す/);
  assert.doesNotMatch(t, /あとで付きます|自動/);
});

test('E: 案内文に使ってはいけない表現が無い（手動追加の文言・拡張保存語のラベルとも）', () => {
  const texts = [...ALL_REASONS.map((r) => manualExampleNote(r).text), ...Object.values(EXAMPLE_FAIL_LABEL)];
  for (const t of texts) for (const re of FORBIDDEN) assert.doesNotMatch(t, re, t);
});
