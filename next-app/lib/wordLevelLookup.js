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

// tables: [{ id: 'cefrj', levels: { word: 'A1', ... } }, ...]
// 戻り値: lookup(word) → { level, src, via: 'exact'|'lemma', key } | null
export function createWordLevelLookup(tables) {
  const list = (tables || []).filter((t) => t && t.levels);

  // 全表から易しい方を採る
  function hit(key) {
    let best = null;
    for (const t of list) {
      const lv = t.levels[key];
      if (!lv) continue;
      const i = CEFR_ORDER.indexOf(lv);
      if (i < 0) continue;
      if (!best || i < CEFR_ORDER.indexOf(best.level)) best = { level: lv, src: t.id };
    }
    return best;
  }

  return function lookup(word) {
    // 1. 記号を残した形 → 2. 記号を落とした形 の順にそのまま引く
    const light = lightNormalize(word);
    const w = normalizeWord(word);
    if (!w) return null;
    for (const k of light === w ? [w] : [light, w]) {
      const exact = hit(k);
      if (exact) return { ...exact, via: 'exact', key: k };
    }

    const parts = w.split(' ');
    if (parts.length === 1) {
      for (const c of lemmaCandidates(w)) {
        const h = hit(c);
        if (h) return { ...h, via: 'lemma', key: c };
      }
      return null;
    }
    // 複数語: 先頭の語だけ原形化（freaked out → freak out / picks up → pick up）
    const rest = parts.slice(1).join(' ');
    for (const c of lemmaCandidates(parts[0])) {
      const key = `${c} ${rest}`;
      const h = hit(key);
      if (h) return { ...h, via: 'lemma', key };
    }
    return null;
  };
}
