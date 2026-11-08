// #19: フラッシュカードのチャンク表示（単語単体でなく "look forward to" のような連語で見せる）。
// chunk 内の対象語（活用形ゆるめ一致）を強調表示できるよう before/hit/after に分割する。
// chunk が無い・対象語を含まない・出さない組の場合は null（呼び出し側は単語のみ表示・単語のみ読み上げ）。
//
// 出さない組（オーナー決定 2026-11-07「消すのは完全に不要な飾りだけ。それ以外の組は残す」）:
//   組から語を除いた残りが前置詞・パーティクル・置き換え記号・軽い動詞だけなら必ず出す（dissipate into・get ahold of・
//   make a fresh start）。そのうえで、確実な飾りだけを消す:
//   - 語が形容詞で、組に前置詞が無い（quantum realm・catastrophic failure）。
//   - 語が名詞で、前に形容詞の形の語（-ic・-ous・-ive・-ful など）が1つ付いただけ（demonic possession）。
//     -al は hospital・animal・criminal など名詞が多いので含めない。CEFR-J で名詞の語（traffic・music 等）も除く。
//   動詞を含む組（file a lawsuit・trigger an alert）はここでは消さない（品詞では分けられない・生成の指示で減らす）。
// 強調は語の全体（fresh start なら2語とも）。語が離れている句（pull it off）は最初から最後までを強調する。

const FUNC = new Set(
  "to of in on at for with from into onto out up down off over about through by as away back around along across against after before under upon a an the one's oneself someone something somebody sb sth it you me him her them us yourself himself herself themselves".split(
    ' '
  )
);
const PREP = new Set(
  'to of in on at for with from into onto out up down off over about through by as away back around along across against after before under upon'.split(
    ' '
  )
);
const LIGHT = new Set('make take get have do give go come put keep set'.split(' '));
const PLACEHOLDER = new Set(['a', 'b']); // accuse A of
const ARTICLE = new Set(['a', 'an', 'the']);
const ADJ_FORM = /(?:ic|ical|ous|ive|ful|less|able|ible)$/;
// 形容詞の形だが名詞として使う語（CEFR-J 1.6 の名詞から抽出＋数語）。前に付いても飾りとみなさない（traffic jam・magic trick 等）。
const NOUN_LIKE = new Set(
  'adjective alcoholic alternative antibiotic arithmetic armful cable captive characteristic chemical classic clinic comic comparative critic detective dive drive ethic executive explosive fabric garlic graphic imperative incentive infinitive initiative logic magic mechanic mimic motive music musical narcotic objective olive panic perspective picnic plastic public radical relative relic representative republic tactic table timetable topic traffic vegetable syllable superlative subjunctive worktable'.split(
    ' '
  )
);

const bareOf = (t) => t.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
const matches = (bare, x) => bare === x || (x.length >= 4 && bare.startsWith(x.slice(0, -1)));
const posKind = (pos) => {
  const p = String(pos || '').toLowerCase();
  if (/形容詞|adj/.test(p)) return 'adj';
  if (/名詞|noun/.test(p)) return 'noun';
  return '';
};

// 組を出すか（items＝組の語の並び・hitIdx＝語に当たる位置）。
function keepChunk(items, hitIdx, pos) {
  const hit = new Set(hitIdx);
  const rest = items.filter((_, i) => !hit.has(i));
  if (rest.every((t) => FUNC.has(t) || LIGHT.has(t) || PLACEHOLDER.has(t))) return true; // 句動詞・前置詞・軽い動詞の慣用句
  if (rest.some((t) => PREP.has(t))) return true;
  const kind = posKind(pos);
  if (kind === 'adj') return false; // 形容詞＋名詞の飾り
  if (kind === 'noun') {
    const first = Math.min(...hitIdx);
    const last = Math.max(...hitIdx);
    const before = items.slice(0, first).filter((t) => !ARTICLE.has(t));
    if (last === items.length - 1 && before.length === 1 && ADJ_FORM.test(before[0]) && !NOUN_LIKE.has(before[0])) return false;
  }
  return true;
}

export function chunkParts(chunk, word, pos = '') {
  const c = String(chunk || '').trim();
  const w = String(word || '').trim();
  if (!c || !w || c.toLowerCase() === w.toLowerCase()) return null;

  const parts = c.split(/(\s+)/); // 区切りの空白も保持
  const items = []; // { bare, start, end }（空白以外の語）
  let at = 0;
  for (const t of parts) {
    if (t && !/^\s+$/.test(t)) items.push({ bare: bareOf(t), start: at, end: at + t.length });
    at += t.length;
  }
  // 語の各語を順に探す（活用形ゆるめ: looks/looking/looked）。見つからなければ組は出さない。
  const hitIdx = [];
  let from = 0;
  for (const x of w.toLowerCase().split(/\s+/)) {
    const i = items.findIndex((it, k) => k >= from && it.bare && matches(it.bare, x));
    if (i < 0) return null;
    hitIdx.push(i);
    from = i + 1;
  }
  if (!keepChunk(items.map((it) => it.bare), hitIdx, pos)) return null;

  const start = items[hitIdx[0]].start;
  const end = items[hitIdx[hitIdx.length - 1]].end;
  return { before: c.slice(0, start), hit: c.slice(start, end), after: c.slice(end) };
}
