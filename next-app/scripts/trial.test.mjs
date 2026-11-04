// 2026-11-05 初回体験（lib/trial.js・components/TrialFlow.js）の単体テスト。
//   語の選び方・作品の並び・法務の条件（書かない言葉・出典の3か所・ポスターの条件）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TRIAL_LEVELS,
  TRIAL_TITLES,
  TRIAL_MORE_TITLES,
  TRIAL_STAGES,
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

test('作品名は本番の表記（title）にそろえる。文字リンクのプラダだけ法務の指定で日本語の題', () => {
  for (const t of TRIAL_TITLES) assert.equal(t.label, t.title, t.id);
  assert.equal(TRIAL_MORE_TITLES.find((t) => t.id === 'emily').label, 'Emily in Paris');
  assert.equal(TRIAL_MORE_TITLES.find((t) => t.id === 'prada').label, 'プラダを着た悪魔');
  assert.match(source('TrialFlow.js'), /「\{title\.title\}」の学習記録/, '完了画面は本番の表記');
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

test('5語は本番の VocabItem を読み取り専用で使う（SRS・単語帳へ書く操作を渡さない）', () => {
  const flow = source('TrialFlow.js');
  const item = flow.slice(flow.indexOf('<VocabItem'), flow.indexOf('/>', flow.indexOf('<VocabItem')));
  assert.match(item, /readOnly/);
  assert.match(item, /showCefr/);
  assert.match(item, /defaultExpanded=\{i === 0\}/, '最初の1語だけ開く');
  for (const ng of ['onSkip', 'onStar', 'onDelete', 'added', 'starred']) assert.ok(!item.includes(ng), `${ng} を渡さない`);
  assert.match(flow, /<CefrNote \/>/, 'CEFR 目安の一行を同じ画面に');
  const vi = source('VocabItem.js');
  assert.match(vi, /\{!readOnly && \(\s*<button\s+className=\{'btn-srs-skip'/, 'readOnly では Skip を出さない');
  assert.match(vi, /badge && !readOnly/, 'readOnly では状態の印を出さない');
  // 「覚えた語の割合で変わります。」は枠の基準の説明（法務確定の文言）。語の状態としては出さない
  const noFrameNote = flow.replace(/^\s*\/\/.*$/gm, '').replace('覚えた語の割合で変わります。', '');
  for (const ng of ['Skip', 'srs-bar', '覚えた', 'マスター']) assert.ok(!noFrameNote.includes(ng), `体験に「${ng}」を出さない`);
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
  for (const ng of ['獲得', 'もらえる', '限定', 'コンプリート', 'レア', '公式', '配信中', 'いま話題', '独占', 'オリジナル', 'おすすめ', '人気']) {
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
  assert.match(ui, /posterUrl\(title\) \? DONE_NOTE : DONE_NOTE_NO_POSTER/, 'ポスターの無い作品にポスターの文を出さない');
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

test('流れ: ようこそ→レベル→案内→作品の順・ログインと規約はようこその画面に', () => {
  const flow = source('TrialFlow.js');
  assert.match(flow, /useState\('welcome'\)/, '最初はようこそ');
  assert.match(flow, /setStep\('intro'\);\n/, 'レベルの次は案内');
  const at = (s) => flow.indexOf(`if (step === '${s}') {`);
  assert.ok(at('welcome') < at('level') && at('level') < at('intro') && at('intro') < at('pick'));
  const welcome = flow.slice(at('welcome'), at('level'));
  assert.match(welcome, /CineLearn へようこそ/);
  assert.match(welcome, /<TrialAuthLinks \/>/);
  assert.ok(!flow.slice(at('level')).includes('<TrialAuthLinks'), 'ようこそ以外には出さない');
  assert.match(flow.slice(at('level'), at('intro')), /あなたについて教えてください/);
  const intro = flow.slice(at('intro'), at('pick'));
  assert.match(intro, /ここからは<span className="trial-nowrap">チュートリアルに進みます/);
  assert.match(intro, /動画は再生されません/);
  assert.match(intro, /\{!loggedIn && <li>登録するかは最後に選べます<\/li>\}/, '登録済みの人には出さない（法務の文言）');
  const pick = flow.slice(at('pick'));
  assert.ok(pick.indexOf('{PICK_NOTE}') < pick.indexOf('trial-grid'), '提携していない旨はポスターより前（法務の推奨）');
  assert.match(source('TrialAuthLinks.js'), /\{!loggedIn && \(/, '登録済みの人にログインを出さない');
});

test('内容の少ない画面は縦の中央・長い画面は上から・高さは min-height だけ（上が切れない）', () => {
  const flow = source('TrialFlow.js');
  assert.equal(flow.match(/className="trial-flow[^"]*trial-fill"/g).length, 6, 'ようこそ・レベル・案内・完了・次の一歩2種');
  assert.equal(flow.match(/className="trial-flow"/g).length, 2, '作品・5語');
  const css = fs.readFileSync(new URL('../app/style.css', import.meta.url), 'utf8');
  const rule = (name) => css.slice(css.indexOf(name), css.indexOf('}', css.indexOf(name)));
  assert.match(rule('.trial-fill {'), /justify-content: center/);
  assert.ok(!/(^|[\s;{])height:/.test(rule('.trial-fill {')), '固定の高さを持たない');
});

test('完了画面: コレクションの説明は法務の文言・枠の見本にポスターを使わない・基準は lib/ticketFrame と同じ', async () => {
  const flow = source('TrialFlow.js');
  assert.ok(flow.includes('単語リストを開くと、コレクションに学習記録が追加されます。学習が進むと、記録の枠が豪華になります。'));
  assert.ok(flow.includes("'覚えた語の割合で変わります。'"));
  const at = flow.indexOf('<div className="trial-frames">');
  const sample = flow.slice(at, flow.indexOf('{FRAME_NOTE}', at));
  assert.ok(at > 0);
  assert.ok(!/posterUrl|<img/.test(sample), '見本にポスターを使わない');
  assert.match(sample, /FRAME_TIERS\.slice\(1\)/, '黒縁・銀縁・金縁の3つ');
  assert.match(flow, /posterUrl\(title\) \? DONE_NOTE : DONE_NOTE_NO_POSTER/, '法務指定の1行は残す');
  const tiers = fs.readFileSync(new URL('../lib/ticketFrame.js', import.meta.url), 'utf8');
  for (const m of [`label: '黒縁', min: 30`, `label: '銀縁', min: 60`, `label: '金縁', min: 90`]) assert.ok(tiers.includes(m), m);
  assert.ok(flow.includes('3〜5分ほどで終わります'), 'オーナーの実測で確定');
});

test('呼び名はチュートリアルに統一・効果をうたう言葉を書かない', () => {
  const ui = source('TrialFlow.js').replace(/\{\/\*.*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!ui.includes('体験'), '画面に「体験」');
  assert.ok(!ui.includes('身につく'));
  for (const s of TRIAL_STAGES) assert.ok(!s.why.includes('体験') && !s.why.includes('身につく'), s.label);
});

test('ステップ: 4段階を各画面に出す（作品・5語・予習・クイズ）', () => {
  assert.deepEqual(TRIAL_STAGES.map((s) => s.title), ['ステップ1/4 作品を選ぶ', 'ステップ2/4 単語を見る', 'ステップ3/4 予習', 'ステップ4/4 クイズ']);
  const flow = source('TrialFlow.js');
  for (const i of [0, 1]) assert.ok(flow.includes(`{TRIAL_STAGES[${i}].title}`) && flow.includes(`{TRIAL_STAGES[${i}].why}`), `段階${i + 1}`);
  assert.match(flow, /stage: TRIAL_STAGES\[2\]/);
  assert.match(flow, /stage: TRIAL_STAGES\[3\]/);
  for (const m of ['PrepWalkthrough.js', 'PrepQuiz.js']) {
    assert.match(source(m), /meta\.stage\.title/, m);
    assert.match(source(m), /meta\.stage\.why/, m);
  }
});

test('ホームから開く時にサービス選択を出さず、ドラマ版/映画版の選択も出さない形', () => {
  const d = trialDrama(suits);
  assert.equal(d.viewingService, 'Netflix');
  assert.equal(d.mediaType, 'tv');
  assert.equal(d.tmdbId, 37680);
  assert.equal(trialDrama(TRIAL_TITLES.find((t) => t.id === 'ironman')).mediaType, 'movie');
});
