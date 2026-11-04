// 2026-11-05 初回体験（lib/trial.js・components/TrialFlow.js）の単体テスト。
//   語の選び方・作品の並び・法務の条件（書かない言葉・出典の3か所・ポスターの条件）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TRIAL_LEVELS,
  TRIAL_TITLES,
  TRIAL_MORE_TITLES,
  bandOf,
  buildTrialSession,
  filterEnabled,
  isTrialEligible,
  orderTrialTitles,
  pickTrialWords,
  posterUrl,
  trialDrama,
} from '../lib/trial.js';

const source = (name) => fs.readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8');

const mk = (word, extra = {}) => ({
  word,
  source: 'drama',
  tier: 'core',
  level: 'B1',
  pos: 'noun',
  definition: '意味',
  example: `This sentence has the ${word} inside it.`,
  example_ja: '和訳',
  tsSec: 100,
  ...extra,
});
const suits = TRIAL_TITLES.find((t) => t.id === 'suits');
const lowWords = suits.bands.low.words;

test('確定の語: 6作×2帯とも5語・クイズ3語はその5語の中', () => {
  for (const t of [...TRIAL_TITLES, ...TRIAL_MORE_TITLES]) {
    for (const band of ['low', 'high']) {
      const b = t.bands[band];
      assert.equal(new Set(b.words).size, 5, `${t.id} ${band}`);
      assert.equal(b.quiz.length, 3, `${t.id} ${band}`);
      for (const q of b.quiz) assert.ok(b.words.includes(q), `${t.id} ${band} ${q}`);
    }
  }
});

test('帯: 〜600点と600点〜（4段階のレベルと一致）', () => {
  assert.deepEqual(TRIAL_LEVELS.map((l) => bandOf(l.score)), ['low', 'low', 'high', 'high']);
});

test('並び: 4作は同じ顔ぶれで先頭だけレベルで変わる', () => {
  assert.equal(orderTrialTitles(300)[0].id, 'stranger');
  assert.equal(orderTrialTitles(900)[0].id, 'suits');
  for (const s of [300, 550, 750, 900]) assert.equal(new Set(orderTrialTitles(s).map((t) => t.id)).size, 4);
});

test('権利者の要請で外す: enabled に無い作品を隠す・取得失敗は全部出す', () => {
  assert.deepEqual(filterEnabled(TRIAL_TITLES, [1668]).map((t) => t.id), ['friends']);
  assert.equal(filterEnabled(TRIAL_TITLES, null).length, 4);
});

test('確定の語が行にあれば、その語とクイズの語を使う', () => {
  const r = pickTrialWords(suits, lowWords.map((w) => mk(w)), 550);
  assert.deepEqual(r.words.map((w) => w.word), lowWords);
  assert.deepEqual(r.quiz.map((w) => w.word), suits.bands.low.quiz);
  assert.equal(r.fromFixed, 5);
});

test('確定の語が行に無ければ機械の選び方で埋める', () => {
  const list = [...lowWords.slice(0, 3).map((w) => mk(w)), mk('window'), mk('garden')];
  const r = pickTrialWords(suits, list, 550);
  assert.equal(r.words.length, 5);
  assert.equal(r.fromFixed, 3);
  assert.equal(r.quiz.length, 3);
});

test('機械の選び方: AI のおすすめ語・context・語句・強い表現・長い例文は使わない', () => {
  assert.equal(isTrialEligible(mk('window')), true);
  assert.equal(isTrialEligible(mk('window', { source: 'plus' })), false);
  assert.equal(isTrialEligible(mk('window', { tier: 'context' })), false);
  assert.equal(isTrialEligible(mk('hang out')), false);
  assert.equal(isTrialEligible(mk('bitch')), false);
  assert.equal(isTrialEligible(mk('window', { example: 'You idiot, this goddamn window is broken again.' })), false);
  assert.equal(isTrialEligible(mk('window', { example: `The window ${'x'.repeat(90)}` })), false);
  assert.equal(isTrialEligible(mk('window', { example_ja: '' })), false);
});

test('機械の選び方: 同じ語が行に2回あっても重ねない', () => {
  const more = TRIAL_MORE_TITLES[0];
  const r = pickTrialWords(more, [mk('window'), mk('window', { tsSec: 200 }), mk('garden'), mk('kitchen')], 550);
  assert.deepEqual(r.words.map((w) => w.word).sort(), ['garden', 'kitchen', 'window']);
});

test('語が足りない作品は出さない（null）', () => {
  assert.equal(pickTrialWords(suits, [mk('window')], 550), null);
  assert.equal(buildTrialSession(suits, [], 550), null);
});

test('クイズの選択肢は体験の5語の中だけ（一覧全体の語を使わない）', () => {
  const words = lowWords.map((w) => mk(w));
  const list = [...words, mk('shithole'), mk('bitch'), mk('window')];
  const s = buildTrialSession(suits, list, 550);
  assert.equal(s.questions.length, 3);
  for (const q of s.questions) {
    assert.ok(q.choices.length >= 3);
    for (const c of q.choices) assert.ok(lowWords.includes(c), c);
  }
  assert.equal(s.list.length, list.length, '「全部で○語」はその人の全語');
});

test('出典: ドラマは話数あり・映画は話数なし（48条）', () => {
  const words = lowWords.map((w) => mk(w));
  assert.equal(buildTrialSession(suits, words, 550).meta.credit, '📺 Suits S1E1（字幕：OpenSubtitles）');
  const iron = TRIAL_TITLES.find((t) => t.id === 'ironman');
  const ironWords = iron.bands.low.words.map((w) => mk(w));
  const m = buildTrialSession(iron, ironWords, 550).meta;
  assert.equal(m.credit, '📺 Iron Man（字幕：OpenSubtitles）');
  assert.equal(m.isMovie, true);
  assert.equal(m.trial, true);
});

test('出典が3か所に出る: 単語リスト・カード・クイズ（法務）', () => {
  assert.match(source('TrialFlow.js'), /session\.meta\.credit/);
  assert.match(source('PrepWalkthrough.js'), /meta\.credit/);
  assert.match(source('PrepQuiz.js'), /meta\?\.credit/);
});

test('体験では予習済み・EXP・PrepLaunch を通らない', () => {
  const walk = source('PrepWalkthrough.js');
  const finish = walk.slice(walk.indexOf('const finish = () =>'), walk.indexOf('const next = () =>'));
  assert.ok(finish.indexOf('if (trial)') < finish.indexOf('addExp'), 'trial の分岐が EXP より先');
  assert.ok(finish.indexOf('if (trial)') < finish.indexOf('markPrepped'), 'trial の分岐が予習済みより先');
  const quiz = source('PrepQuiz.js');
  assert.ok(quiz.indexOf('last && meta?.trial') < quiz.indexOf('openPrepLaunch({'), 'trial の分岐が PrepLaunch より先');
});

test('書かない言葉（法務）: 作品データと体験の画面', () => {
  const ui = source('TrialFlow.js').replace(/^\s*\/\/.*$/gm, '');
  for (const ng of ['獲得', 'もらえる', '限定', 'コンプリート', '公式', '配信中', 'いま話題', '独占', 'オリジナル', 'おすすめ', '人気']) {
    assert.ok(!ui.includes(ng), `画面に「${ng}」`);
    for (const t of [...TRIAL_TITLES, ...TRIAL_MORE_TITLES]) assert.ok(!t.reason.includes(ng), `${t.id} の理由に「${ng}」`);
  }
  // 作品選択の画面と理由に配信サービスの名前を書かない。配信先のボタンは完了画面のデータから出す
  for (const t of [...TRIAL_TITLES, ...TRIAL_MORE_TITLES]) assert.ok(!/Netflix|MARVEL|マーベル/i.test(t.reason), t.id);
  assert.ok(!ui.includes('Netflix'), '画面に Netflix を直接書かない（作品ごとの watchService から出す）');
});

test('法務の文言がそのまま入っている', () => {
  const ui = source('TrialFlow.js');
  assert.ok(ui.includes('作品はご自身が契約する配信サービスでご覧ください。本サービスは作品の権利者・配信サービスと提携していません。'));
  assert.ok(ui.includes('の学習記録をコレクションに追加しました'));
  assert.ok(ui.includes('ポスター画像は作品を見分けるための表示です（画像：TMDB）。作品の権利者・配信サービスとは提携していません。'));
  assert.ok(ui.includes('登録して学習記録を残す'));
  assert.ok(ui.includes('配信状況は変わることがあります。本サービスは {service} と提携していません。'));
  assert.ok(ui.includes('迷ったらこの4作から'));
});

test('ポスター: w342 固定・上に文字を重ねない作り（CSS は 40vw/160px・切らない）', () => {
  for (const t of TRIAL_TITLES) assert.match(posterUrl(t), /^https:\/\/image\.tmdb\.org\/t\/p\/w342\/[A-Za-z0-9]+\.jpg$/);
  const css = fs.readFileSync(new URL('../app/style.css', import.meta.url), 'utf8');
  const rule = (name) => css.slice(css.indexOf(name), css.indexOf('}', css.indexOf(name)));
  assert.match(rule('.trial-poster {'), /width: 40vw; max-width: 160px/);
  assert.match(rule('.trial-poster img {'), /aspect-ratio: 2 \/ 3; object-fit: contain/);
});

test('ホームから開く時にサービス選択を出さず、ドラマ版/映画版の選択も出さない形', () => {
  const d = trialDrama(suits);
  assert.equal(d.viewingService, 'Netflix');
  assert.equal(d.mediaType, 'tv');
  assert.equal(d.tmdbId, 37680);
  assert.equal(trialDrama(TRIAL_TITLES.find((t) => t.id === 'ironman')).mediaType, 'movie');
});
