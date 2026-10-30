// 語→CEFR 段階の lookup（表そのものは持たない純関数・2026-10-30）。
//   表（CEFR-J 1.6 / Octanove C1/C2）は lib/server/wordLevel.js が server-only で読み込んでここへ渡す。
//   クライアントへ表を配らない（法務 条件4）ため、このファイルは表を import しない。
//
// 引き方:
//   1. 正規化した語でそのまま引く（NFKC・小文字・連続空白の圧縮。まず記号を残した形 'm / mr. で、
//      無ければ前後の引用符や記号を落とした形で）
//   2. 無ければ原形の候補（不規則形の表 → -s/-es/-ies・-ed/-ied・-ing・-er/-est の規則）で順に引く
//      複数語（句動詞など）は先頭の語だけ原形化して引き直す（freaked out → freak out）
//   3. 複数の表に載っている語は易しい方の段階を採る（変換時の「品詞違いは易しい方」と同じ向き）
//   表に無い語は null（呼び出し側が AI の level などにフォールバックする）。

export const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// 記号を落とさない正規化（表の見出し語 'm / mr. / a.m. をそのまま引くため・変換スクリプトと同じ規則）
export function lightNormalize(word) {
  return String(word ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// 記号まで落とす正規化（台詞から拾った "Hello!" / (sigh) / Okay. を引くため）
export function normalizeWord(word) {
  let w = lightNormalize(word)
    .replace(/^[\s"'“”(\[]+|[\s"“”)\],!?;:]+$/g, '')
    .trim();
  // 文末のピリオドは落とす。ただし途中にもピリオドがある略語（a.m. / p.m. / u.s.）は残す
  if (w.endsWith('.') && !w.slice(0, -1).includes('.')) w = w.slice(0, -1).trim();
  return w;
}

// 不規則形 → 原形（ドラマの台詞に多いものに絞る。表の見出し語に無い原形は引けても null になるだけ）
const IRREGULAR = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', does: 'do', did: 'do', done: 'do',
  went: 'go', gone: 'go', made: 'make', said: 'say', took: 'take', taken: 'take',
  came: 'come', saw: 'see', seen: 'see', got: 'get', gotten: 'get', knew: 'know', known: 'know',
  thought: 'think', told: 'tell', found: 'find', gave: 'give', given: 'give', felt: 'feel',
  left: 'leave', brought: 'bring', began: 'begin', begun: 'begin', kept: 'keep', held: 'hold',
  wrote: 'write', written: 'write', stood: 'stand', heard: 'hear', meant: 'mean', met: 'meet',
  ran: 'run', paid: 'pay', sat: 'sit', spoke: 'speak', spoken: 'speak', led: 'lead', grew: 'grow',
  grown: 'grow', lost: 'lose', fell: 'fall', fallen: 'fall', sent: 'send', built: 'build',
  understood: 'understand', drew: 'draw', drawn: 'draw', broke: 'break', broken: 'break',
  spent: 'spend', rose: 'rise', risen: 'rise', drove: 'drive', driven: 'drive', bought: 'buy',
  wore: 'wear', worn: 'wear', chose: 'choose', chosen: 'choose', caught: 'catch', taught: 'teach',
  fought: 'fight', threw: 'throw', thrown: 'throw', sold: 'sell', ate: 'eat', eaten: 'eat',
  drank: 'drink', drunk: 'drink', slept: 'sleep', woke: 'wake', woken: 'wake', won: 'win',
  forgot: 'forget', forgotten: 'forget', hid: 'hide', hidden: 'hide', flew: 'fly', flown: 'fly',
  hung: 'hang', shot: 'shoot', sang: 'sing', sung: 'sing', swam: 'swim', struck: 'strike',
  stole: 'steal', stolen: 'steal', froze: 'freeze', frozen: 'freeze', bit: 'bite', bitten: 'bite',
  lay: 'lie', lain: 'lie', lied: 'lie', dealt: 'deal', fed: 'feed', fled: 'flee', sought: 'seek',
  swore: 'swear', sworn: 'swear', tore: 'tear', torn: 'tear', shook: 'shake', shaken: 'shake',
  forgave: 'forgive', forgiven: 'forgive', betrayed: 'betray',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth', mice: 'mouse',
  lives: 'life', wives: 'wife', knives: 'knife', thieves: 'thief', selves: 'self',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
};

const VOWEL = /[aeiouy]/; // y も母音扱い（lying → ly+ing → lie）

// 原形の候補を「確からしい順」に返す（自分自身は含めない）
export function lemmaCandidates(w) {
  const out = [];
  const push = (c) => {
    if (c && c.length >= 2 && c !== w && !out.includes(c)) out.push(c);
  };
  if (IRREGULAR[w]) push(IRREGULAR[w]);
  if (w.length < 4) return out;

  // 縮約・所有格（he's / dad's）
  if (/'s$/.test(w)) push(w.slice(0, -2));

  // 複数形・三単現
  if (/ies$/.test(w)) push(w.slice(0, -3) + 'y');
  if (/(s|x|z|ch|sh|o)es$/.test(w)) push(w.slice(0, -2));
  if (/[^s]s$/.test(w)) push(w.slice(0, -1));

  // 過去形・過去分詞
  if (/ied$/.test(w)) push(w.slice(0, -3) + 'y');
  if (/ed$/.test(w)) {
    const stem = w.slice(0, -2);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) push(stem.slice(0, -1)); // stopped → stop
    push(stem + 'e'); // hoped → hope（stem+e を先に＝ used → use）
    push(stem); // walked → walk
  }

  // 進行形・動名詞
  if (/ing$/.test(w) && VOWEL.test(w.slice(0, -3))) {
    const stem = w.slice(0, -3);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) push(stem.slice(0, -1)); // running → run
    push(stem); // walking → walk
    push(stem + 'e'); // making → make
    if (/y$/.test(stem)) push(stem.slice(0, -1) + 'ie'); // lying → lie
  }

  // 比較級・最上級
  if (/(ier|iest)$/.test(w)) push(w.replace(/(ier|iest)$/, 'y'));
  if (/(er|est)$/.test(w)) {
    const stem = w.replace(/(er|est)$/, '');
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) push(stem.slice(0, -1)); // bigger → big
    push(stem);
    push(stem + 'e'); // nicer → nice
  }
  return out;
}

// 語リストの品詞（日本語・英語・「名詞/動詞」のような併記）→ 表の品詞名。
// 句動詞・名詞句・固有名詞・イディオムなどは表に対応する品詞が無い＝空集合（品詞を合わせる引き方では引かない）。
const POS_MAP = {
  名詞: ['noun'], noun: ['noun'],
  動詞: ['verb'], verb: ['verb'],
  形容詞: ['adjective'], adjective: ['adjective'],
  副詞: ['adverb'], adverb: ['adverb'],
  前置詞: ['preposition'], preposition: ['preposition'],
  代名詞: ['pronoun'], pronoun: ['pronoun'],
  接続詞: ['conjunction'], conjunction: ['conjunction'],
  間投詞: ['interjection'], 感動詞: ['interjection'], interjection: ['interjection'],
  限定詞: ['determiner'], determiner: ['determiner'],
  数詞: ['number'], number: ['number'],
};
export function tablePosOf(pos) {
  const out = [];
  String(pos ?? '')
    .replace(/[（(][^）)]*[）)]/g, '') // 「動詞（過去分詞）」→「動詞」
    .split(/[\/／・,、]/)
    .forEach((x) => (POS_MAP[x.trim().toLowerCase()] || POS_MAP[x.trim()] || []).forEach((p) => !out.includes(p) && out.push(p)));
  return out;
}

// tables: [{ id: 'cefrj', levels: { word: { noun: 'A1', verb: 'A1' } | 'A1', ... } }, ...]
//   値は品詞ごとの段階（2026-10-30〜）。古い形（段階の文字列だけ）も受け付ける。
// 戻り値: lookup(word, { pos, exactOnly }) → { level, src, via: 'exact'|'lemma', key } | null
//   pos 無し    … 品詞を問わず易しい方（レベル判定用・SRS は品詞を持たない）
//   pos あり    … その品詞の段階だけを見る。品詞が表に無い・対応しない（句動詞など）なら null
//   exactOnly   … 原形化しない（単語リストの絞り込み用。fell(伐採)→fall のような取り違えを避ける）
export function createWordLevelLookup(tables) {
  const list = (tables || []).filter((t) => t && t.levels);

  // 全表から易しい方を採る。posList が空配列なら「品詞を問わない」。
  function hit(key, posList) {
    let best = null;
    for (const t of list) {
      const v = t.levels[key];
      if (!v) continue;
      const cands = typeof v === 'string' ? (posList.length ? [] : [v]) : posList.length ? posList.map((p) => v[p]) : Object.values(v);
      for (const lv of cands) {
        const i = CEFR_ORDER.indexOf(lv);
        if (i < 0) continue;
        if (!best || i < CEFR_ORDER.indexOf(best.level)) best = { level: lv, src: t.id };
      }
    }
    return best;
  }

  return function lookup(word, { pos, exactOnly = false } = {}) {
    const posList = pos == null ? [] : tablePosOf(pos);
    if (pos != null && !posList.length) return null; // 品詞が指定されたが表の品詞に対応しない
    // 1. 記号を残した形 → 2. 記号を落とした形 の順にそのまま引く
    const light = lightNormalize(word);
    const w = normalizeWord(word);
    if (!w) return null;
    for (const k of light === w ? [w] : [light, w]) {
      const exact = hit(k, posList);
      if (exact) return { ...exact, via: 'exact', key: k };
    }
    if (exactOnly) return null;

    const parts = w.split(' ');
    if (parts.length === 1) {
      for (const c of lemmaCandidates(w)) {
        const h = hit(c, posList);
        if (h) return { ...h, via: 'lemma', key: c };
      }
      return null;
    }
    // 複数語: 先頭の語だけ原形化（freaked out → freak out / picks up → pick up）
    const rest = parts.slice(1).join(' ');
    for (const c of lemmaCandidates(parts[0])) {
      const key = `${c} ${rest}`;
      const h = hit(key, posList);
      if (h) return { ...h, via: 'lemma', key };
    }
    return null;
  };
}

// 単語リストの絞り込み用の段階（2026-10-30 オーナー決定・サーバで絞る方式）。
//   対象: 単語（空白なし）・context tier 以外・品詞が表の品詞に対応する語。品詞を合わせ、原形化しない。
//   表に無い語は null（personalizeWords は AI の level を使う）。
export function makeFilterLevelOf(lookup) {
  return (w) => {
    if (!w || /\s/.test(String(w.word || '').trim()) || w.tier === 'context') return null;
    const r = lookup(w.word, { pos: w.pos ?? '', exactOnly: true });
    return r ? r.level : null;
  };
}

// ── 単語リストの「CEFR目安」表示（2026-10-30・オーナー「単語個別の CEFR 表示は実装して欲しい。目安として」）──
// attachDisplayLevels: 表示用の段階 levelShown を語に添える（(A) 方式＝表で品詞一致して引けた語だけ）。
//   語オブジェクトはコピーする（共有キャッシュへ書く元の配列は変えない）。levelOf は makeFilterLevelOf と同じ規則。
export function attachDisplayLevels(words, levelOf) {
  if (!Array.isArray(words) || typeof levelOf !== 'function') return words;
  return words.map((w) => {
    const lv = levelOf(w);
    return lv ? { ...w, levelShown: lv } : w;
  });
}
