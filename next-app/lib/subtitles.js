// 字幕パイプライン（検索候補選別・SRTパース・活用形・語／フレーズ照合・タイムスタンプ）。
// js/app.js から移植。
//
// ★2026-09-12（公開拡大前ブロッカー B）: このモジュールは**純粋関数だけ**になった。
//   生SRT・整形本文はクライアントへ配らない（30条の4 の内部解析はサーバ内で完結）ので、
//   字幕の取得（fetchEpisodeSubtitle / fetchRawSrtIfMissing）・localStorage キャッシュ
//   （cl_sub_* / cl_sub_raw_* / cl_sub_lru・subtitleCacheKey 等）・VOD 実時刻補正（cl_vodsync）は
//   すべて撤去した。残っている関数はサーバ（lib/server/*・app/api/*）と seed（素の Node）が
//   import する＝ここでは 'next/server' や '@/…' エイリアス・window/localStorage を使わない。
//   配信経路（findExampleForWord / findExampleByAnchor）と保存経路（findWordCueSec →
//   attachBaseTimestamps）は同じ照合器 wordMatchRegex/exampleContainsWord を使う（memory
//   「字幕tsSec二重パスの罠」）。

// ── SRT パース ──────────────────────────────────────────────
// 3つの使い道（生成に渡す本文 parseSrt／生成の📍 parseCues／配信の例文 parseServeCues）は、
// すべてこの1つの分割関数 splitSrtCues を通す（2026-10-20 /decide C）。経路ごとに分割や除外の
// 規則が割れると「字幕tsSec二重パスの罠」が再発する（例: 旧 parseSrt は♪の行を本文に残し、
// parseCues は♪のキューを捨てていた＝歌詞から選ばれた例文に📍が付かない）。
//
// 分割はタイムスタンプ行（-->）で切る。空行には頼らない（空行に空白が混じる・空行が無い・
// 改行が CR だけ、という形式崩れの SRT でもキューが正しく分かれる）。
// 除外の規則（2026-10-20 /decide B）:
//   - 歌詞: ♪〜♪ で囲まれた区間は本文ごと消す（歌詞は台詞と別の著作物で、出所表示も不正確になる）。
//     ♪ で始まり閉じが無い行は行ごと歌詞扱い。判定は行ごと。残った単独の♪は記号だけ消す。
//   - クレジット・宣伝: "subtitles by"・"original air date"・"sync, corrected by"・"opensubtitles"
//     や URL を含むキューは丸ごと捨てる（OS は誰でも上げられる＝宣伝文が例文として配られるのを防ぐ）。
// 上限: 生 SRT 全体・キュー数・1キューの長さ（異常なファイルで処理が膨らまないように）。
export const SRT_MAX_CHARS = 2_000_000; // 通常の1話は 30〜150KB・長編映画でも数百KB
export const SRT_MAX_CUES = 20_000; // 通常 600〜2000
export const CUE_MAX_CHARS = 1_000; // 通常の1キューは 120 字前後

const CREDIT_RE = /original air date|sync,?\s*(?:and\s*)?correct(?:ed|ions)? by|subtitles? by|opensubtitles|addic7ed|https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|tv)\b/i;
const TIMESTAMP_RE = /^\s*(\d{1,2}):(\d{2}):(\d{2})[,.]\d{1,3}\s*-->/;
const NOTE_RE = /[♪♫]/;

// 1キューの行から歌詞を除く（行ごとに判定・歌詞の開きはキュー内の次の行へ持ち越す）。
//   ① 開いた歌詞の続きの行: 閉じの♪までを捨てる（閉じが無ければ行ごと捨てる）
//   ② ♪…♪ の閉じた区間を本文ごと消す（♪ と ♫ は同じ扱い）
//   ③ ♪ で始まり閉じが無い＝行ごと歌詞（次の行へ持ち越す）
//   ④ 残った単独の♪（行の途中・末尾）は記号だけ消す（台詞に紛れた♪）
function stripLyricLines(lines) {
  const out = [];
  let open = false;
  for (let line of lines) {
    if (open) {
      const i = line.search(NOTE_RE);
      if (i < 0) continue; // まだ歌詞の中
      line = line.slice(i + 1);
      open = false;
    }
    if (!NOTE_RE.test(line)) {
      out.push(line);
      continue;
    }
    const rest = line.replace(/[♪♫][^♪♫]*[♪♫]/g, ' ');
    if (/^\s*[♪♫]/.test(rest)) {
      open = true;
      continue;
    }
    out.push(rest.replace(/[♪♫]/g, ' '));
  }
  return out;
}

// 生 SRT → [{ sec, text }]（ファイル順・原文の大小文字・空白は1つに詰める）。
export function splitSrtCues(rawSrt) {
  let raw = String(rawSrt || '');
  if (raw.length > SRT_MAX_CHARS) raw = raw.slice(0, SRT_MAX_CHARS);
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    // 次のキューの番号行が末尾に紛れていたら落とす（空行が無い SRT）
    while (cur.lines.length && /^\s*\d+\s*$/.test(cur.lines[cur.lines.length - 1])) cur.lines.pop();
    const rawText = cur.lines.join(' ');
    if (!CREDIT_RE.test(rawText)) {
      const text = stripLyricLines(cur.lines.map((l) => l.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, CUE_MAX_CHARS);
      if (text) cues.push({ sec: cur.sec, text });
    }
    cur = null;
  };
  for (const line of lines) {
    const mt = line.match(TIMESTAMP_RE);
    if (mt) {
      flush();
      if (cues.length >= SRT_MAX_CUES) break;
      cur = { sec: +mt[1] * 3600 + +mt[2] * 60 + +mt[3], lines: [] };
      continue;
    }
    if (!cur) continue; // 最初のタイムスタンプより前（番号・ヘッダ）
    if (line.trim()) cur.lines.push(line.trim());
  }
  if (cues.length < SRT_MAX_CUES) flush();
  return cues;
}

// 生成に渡す本文（台詞だけを空白で結合）。短すぎ判定（opensubtitles.js）にも使う。
export function parseSrt(srtText) {
  return splitSrtCues(srtText)
    .map((c) => c.text)
    .join(' ');
}

// ── 候補選別（全取得経路で共通） ────────────────────────────
export function selectSubtitleCandidates(subtitles, isMovie, season, episode) {
  if (!Array.isArray(subtitles) || !subtitles.length) return [];

  let candidates = subtitles;
  if (!isMovie) {
    const matched = subtitles.filter((s) => {
      const f = s.attributes.feature_details || {};
      return (
        Number(f.season_number) === Number(season) &&
        Number(f.episode_number) === Number(episode)
      );
    });
    if (matched.length) candidates = matched;
  }

  const rank = (sub) => {
    const attr = sub.attributes;
    const name = (attr.release || attr.files?.[0]?.file_name || '').toLowerCase();
    const featTitle = (
      attr.feature_details?.title ||
      attr.feature_details?.movie_name ||
      ''
    ).toLowerCase();
    if (
      /(making|behind.the.scenes|featurette|trailer|interview|documentary|deleted|bonus|extra|commentary|bloopers?|gag\s*reel|sample)/.test(
        name + ' ' + featTitle
      )
    )
      return 2;
    if (
      isMovie &&
      attr.feature_details?.feature_type &&
      attr.feature_details.feature_type !== 'Movie'
    )
      return 2;
    if (attr.hearing_impaired) return 1;
    if (/\b(hi|hearing|sdh|forced)\b/.test(name)) return 1;
    return 0;
  };
  return [...candidates].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.attributes.download_count || 0) - (a.attributes.download_count || 0)
  );
}

// ── 活用形バリアント ────────────────────────────────────────
const IRREGULAR_VERBS = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  say: ['says', 'said', 'saying'],
  get: ['gets', 'got', 'gotten', 'getting'],
  make: ['makes', 'made', 'making'],
  know: ['knows', 'knew', 'known', 'knowing'],
  think: ['thinks', 'thought', 'thinking'],
  take: ['takes', 'took', 'taken', 'taking'],
  see: ['sees', 'saw', 'seen', 'seeing'],
  come: ['comes', 'came', 'coming'],
  give: ['gives', 'gave', 'given', 'giving'],
  find: ['finds', 'found', 'finding'],
  tell: ['tells', 'told', 'telling'],
  feel: ['feels', 'felt', 'feeling'],
  keep: ['keeps', 'kept', 'keeping'],
  run: ['runs', 'ran', 'running'],
  leave: ['leaves', 'left', 'leaving'],
  hear: ['hears', 'heard', 'hearing'],
  let: ['lets', 'letting'],
  begin: ['begins', 'began', 'begun', 'beginning'],
  show: ['shows', 'showed', 'shown', 'showing'],
  lead: ['leads', 'led', 'leading'],
  mean: ['means', 'meant', 'meaning'],
  meet: ['meets', 'met', 'meeting'],
  lose: ['loses', 'lost', 'losing'],
  pay: ['pays', 'paid', 'paying'],
  sit: ['sits', 'sat', 'sitting'],
  stand: ['stands', 'stood', 'standing'],
  understand: ['understands', 'understood', 'understanding'],
  speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  write: ['writes', 'wrote', 'written', 'writing'],
  read: ['reads', 'reading'],
  bring: ['brings', 'brought', 'bringing'],
  buy: ['buys', 'bought', 'buying'],
  send: ['sends', 'sent', 'sending'],
  build: ['builds', 'built', 'building'],
  fall: ['falls', 'fell', 'fallen', 'falling'],
  hold: ['holds', 'held', 'holding'],
  spend: ['spends', 'spent', 'spending'],
  cut: ['cuts', 'cutting'],
  put: ['puts', 'putting'],
  set: ['sets', 'setting'],
  try: ['tries', 'tried', 'trying'],
  become: ['becomes', 'became', 'becoming'],
  happen: ['happens', 'happened', 'happening'],
  suppose: ['supposes', 'supposed', 'supposing'],
  // ── 2026-10-20 /decide A: 拡充（別の語と同形になる形は入れない＝rose(rise)・lay(lie)・bound(bind)・
  //    ground(grind)・wound(wind)・bore/born(bear)・drew(draw＝人名 Drew)・slew(slay)・dove(dive)・bit(bite)・
  //    tore(tear＝涙)・lit は残す（light を表に入れないので lit→light の逆引きは起きない）。
  arise: ['arises', 'arose', 'arisen', 'arising'],
  awake: ['awakes', 'awoke', 'awoken', 'awaking'],
  beat: ['beats', 'beaten', 'beating'],
  bend: ['bends', 'bent', 'bending'],
  bet: ['bets', 'betting'],
  bite: ['bites', 'bitten', 'biting'],
  bleed: ['bleeds', 'bled', 'bleeding'],
  blow: ['blows', 'blew', 'blown', 'blowing'],
  break: ['breaks', 'broke', 'broken', 'breaking'],
  breed: ['breeds', 'bred', 'breeding'],
  burn: ['burns', 'burnt', 'burned', 'burning'],
  catch: ['catches', 'caught', 'catching'],
  choose: ['chooses', 'chose', 'chosen', 'choosing'],
  cling: ['clings', 'clung', 'clinging'],
  cost: ['costs', 'costing'],
  creep: ['creeps', 'crept', 'creeping'],
  deal: ['deals', 'dealt', 'dealing'],
  dig: ['digs', 'dug', 'digging'],
  draw: ['draws', 'drawn', 'drawing'],
  dream: ['dreams', 'dreamt', 'dreamed', 'dreaming'],
  drink: ['drinks', 'drank', 'drunk', 'drinking'],
  drive: ['drives', 'drove', 'driven', 'driving'],
  dwell: ['dwells', 'dwelt', 'dwelling'],
  eat: ['eats', 'ate', 'eaten', 'eating'],
  feed: ['feeds', 'fed', 'feeding'],
  fight: ['fights', 'fought', 'fighting'],
  flee: ['flees', 'fled', 'fleeing'],
  fling: ['flings', 'flung', 'flinging'],
  fly: ['flies', 'flew', 'flown', 'flying'],
  forbid: ['forbids', 'forbade', 'forbidden', 'forbidding'],
  forget: ['forgets', 'forgot', 'forgotten', 'forgetting'],
  forgive: ['forgives', 'forgave', 'forgiven', 'forgiving'],
  freeze: ['freezes', 'froze', 'frozen', 'freezing'],
  grow: ['grows', 'grew', 'grown', 'growing'],
  hang: ['hangs', 'hung', 'hanged', 'hanging'],
  hide: ['hides', 'hid', 'hidden', 'hiding'],
  hit: ['hits', 'hitting'],
  hurt: ['hurts', 'hurting'],
  kneel: ['kneels', 'knelt', 'kneeling'],
  lay: ['lays', 'laid', 'laying'],
  leap: ['leaps', 'leapt', 'leaped', 'leaping'],
  learn: ['learns', 'learnt', 'learned', 'learning'],
  lend: ['lends', 'lent', 'lending'],
  mislead: ['misleads', 'misled', 'misleading'],
  mistake: ['mistakes', 'mistook', 'mistaken', 'mistaking'],
  overcome: ['overcomes', 'overcame', 'overcoming'],
  overtake: ['overtakes', 'overtook', 'overtaken', 'overtaking'],
  prove: ['proves', 'proved', 'proven', 'proving'],
  quit: ['quits', 'quitting'],
  repay: ['repays', 'repaid', 'repaying'],
  rewrite: ['rewrites', 'rewrote', 'rewritten', 'rewriting'],
  ride: ['rides', 'rode', 'ridden', 'riding'],
  ring: ['rings', 'rang', 'rung', 'ringing'],
  seek: ['seeks', 'sought', 'seeking'],
  sell: ['sells', 'sold', 'selling'],
  sew: ['sews', 'sewed', 'sewn', 'sewing'],
  shake: ['shakes', 'shook', 'shaken', 'shaking'],
  shed: ['sheds', 'shedding'],
  shine: ['shines', 'shone', 'shined', 'shining'],
  shoot: ['shoots', 'shot', 'shooting'],
  shrink: ['shrinks', 'shrank', 'shrunk', 'shrinking'],
  shut: ['shuts', 'shutting'],
  sing: ['sings', 'sang', 'sung', 'singing'],
  sink: ['sinks', 'sank', 'sunk', 'sinking'],
  sleep: ['sleeps', 'slept', 'sleeping'],
  slide: ['slides', 'slid', 'sliding'],
  sling: ['slings', 'slung', 'slinging'],
  speed: ['speeds', 'sped', 'speeding'],
  spill: ['spills', 'spilt', 'spilled', 'spilling'],
  spin: ['spins', 'spun', 'spinning'],
  spit: ['spits', 'spat', 'spitting'],
  split: ['splits', 'splitting'],
  spread: ['spreads', 'spreading'],
  spring: ['springs', 'sprang', 'sprung', 'springing'],
  steal: ['steals', 'stole', 'stolen', 'stealing'],
  stick: ['sticks', 'stuck', 'sticking'],
  sting: ['stings', 'stung', 'stinging'],
  stink: ['stinks', 'stank', 'stunk', 'stinking'],
  stride: ['strides', 'strode', 'striding'],
  strike: ['strikes', 'struck', 'stricken', 'striking'],
  strive: ['strives', 'strove', 'striven', 'striving'],
  swear: ['swears', 'swore', 'sworn', 'swearing'],
  sweep: ['sweeps', 'swept', 'sweeping'],
  swim: ['swims', 'swam', 'swum', 'swimming'],
  swing: ['swings', 'swung', 'swinging'],
  teach: ['teaches', 'taught', 'teaching'],
  throw: ['throws', 'threw', 'thrown', 'throwing'],
  undergo: ['undergoes', 'underwent', 'undergone', 'undergoing'],
  undertake: ['undertakes', 'undertook', 'undertaken', 'undertaking'],
  undo: ['undoes', 'undid', 'undone', 'undoing'],
  upset: ['upsets', 'upsetting'],
  uphold: ['upholds', 'upheld', 'upholding'],
  wake: ['wakes', 'woke', 'woken', 'waking'],
  wear: ['wears', 'wore', 'worn', 'wearing'],
  weave: ['weaves', 'wove', 'woven', 'weaving'],
  weep: ['weeps', 'wept', 'weeping'],
  win: ['wins', 'won', 'winning'],
  withdraw: ['withdraws', 'withdrew', 'withdrawn', 'withdrawing'],
  withhold: ['withholds', 'withheld', 'withholding'],
  withstand: ['withstands', 'withstood', 'withstanding'],
  wring: ['wrings', 'wrung', 'wringing'],
};

// ── 対応表に載せた語だけに足す変化形（2026-10-20 /decide A）──────────────
//   規則で機械的に足すと、品詞を知らない照合器では別の語に当たる（numb→number・safe→saves・
//   filled→filed・floor→flour・setup→"set up"）。誤一致した字幕文は生成時に plus→drama 昇格で
//   出所付きの引用になってしまうので、比較級・f→ves・英米綴り・ハイフンは表に載った語だけにし、
//   規則での「逆剥がし」（-er を外す等）はしない。表の形からの逆引き（stronger→strong）は完全一致なので可。
// 比較級・最上級を持つ形容詞（形は規則で作る: e→r/st・子音+y→ier/iest・短母音+子音→重ね・他→er/est）。
//   入れない語: light（lighter＝ライター）・late（later＝あとで）・fit（fitter）・good/bad/far/little（不規則で別語っぽい）。
const COMPARATIVE_ADJ = `strong weak small tall short long old young fast slow hard high low rich poor smart dumb cheap clean
bright calm cold warm cool deep dark kind loud quick rough sharp soft strict sweet thick tight tough weird wild fair firm
fresh full grand neat near plain proud quiet smooth steep stiff great dear harsh brief clever narrow shallow mean keen damp
dull faint mild odd sick slight bold broad crisp
safe wise brave rude cute pure rare nice strange gentle simple close large fine ripe wide true loose vague fierce polite
humble noble pale dense
happy easy early busy crazy dirty dry funny heavy lucky angry healthy hungry lazy lonely noisy pretty scary silly sleepy
tidy ugly wealthy friendly tiny messy risky tricky nasty sneaky creepy shady fancy handy filthy steady sturdy chilly cozy
big sad hot fat thin wet mad slim dim red grim`
  .split(/\s+/)
  .filter(Boolean);
function comparativeForms(a) {
  if (a.endsWith('e')) return [a + 'r', a + 'st'];
  if (/[^aeiou]y$/.test(a)) return [a.slice(0, -1) + 'ier', a.slice(0, -1) + 'iest'];
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(a)) return [a + a.slice(-1) + 'er', a + a.slice(-1) + 'est'];
  return [a + 'er', a + 'est'];
}
const COMPARATIVES = Object.fromEntries(COMPARATIVE_ADJ.map((a) => [a, comparativeForms(a)]));
// f/fe → ves（入れない語: life→lives＝live の3単現・leaf→leaves＝leave の3単現）
const VES_PLURALS = {
  knife: 'knives', wife: 'wives', half: 'halves', wolf: 'wolves', shelf: 'shelves', thief: 'thieves',
  calf: 'calves', loaf: 'loaves', elf: 'elves', scarf: 'scarves', self: 'selves', hoof: 'hooves',
};
// 英米綴り・ハイフンの有無（どちらから引いても相手の活用形まで含める）
const SPELLING_PAIRS = [
  ['realize', 'realise'], ['recognize', 'recognise'], ['apologize', 'apologise'], ['organize', 'organise'],
  ['criticize', 'criticise'], ['emphasize', 'emphasise'], ['prioritize', 'prioritise'], ['authorize', 'authorise'],
  ['memorize', 'memorise'], ['minimize', 'minimise'], ['maximize', 'maximise'], ['specialize', 'specialise'],
  ['sympathize', 'sympathise'], ['summarize', 'summarise'], ['utilize', 'utilise'], ['analyze', 'analyse'],
  ['paralyze', 'paralyse'], ['finalize', 'finalise'], ['characterize', 'characterise'], ['organization', 'organisation'],
  ['color', 'colour'], ['honor', 'honour'], ['favor', 'favour'], ['behavior', 'behaviour'], ['neighbor', 'neighbour'],
  ['humor', 'humour'], ['labor', 'labour'], ['rumor', 'rumour'], ['flavor', 'flavour'], ['harbor', 'harbour'],
  ['endeavor', 'endeavour'], ['savior', 'saviour'], ['favorite', 'favourite'], ['neighborhood', 'neighbourhood'],
  ['colorful', 'colourful'], ['honorable', 'honourable'],
  ['center', 'centre'], ['theater', 'theatre'], ['fiber', 'fibre'], ['defense', 'defence'], ['offense', 'offence'],
  ['license', 'licence'], ['pretense', 'pretence'], ['gray', 'grey'], ['catalog', 'catalogue'], ['practice', 'practise'],
  ['mold', 'mould'], ['plow', 'plough'], ['skeptical', 'sceptical'], ['jewelry', 'jewellery'], ['traveler', 'traveller'],
  ['counselor', 'counsellor'], ['judgment', 'judgement'], ['aging', 'ageing'], ['fulfill', 'fulfil'], ['enroll', 'enrol'],
  ['email', 'e-mail'], ['coworker', 'co-worker'], ['cooperate', 'co-operate'], ['online', 'on-line'],
];
const SPELLING = {};
for (const [a, b] of SPELLING_PAIRS) {
  SPELLING[a] = b;
  SPELLING[b] = a;
}
const TABLE_REVERSE = {}; // 表の形 → 原形（完全一致の逆引き）
for (const [a, forms] of Object.entries(COMPARATIVES)) for (const f of forms) TABLE_REVERSE[f] ??= a;
for (const [a, f] of Object.entries(VES_PLURALS)) TABLE_REVERSE[f] ??= a;

const IRREGULAR_REVERSE = {};
for (const [base, forms] of Object.entries(IRREGULAR_VERBS)) {
  for (const f of forms) IRREGULAR_REVERSE[f] = base;
}

export function getWordVariants(word) {
  const w = normApostrophes(word).toLowerCase();
  const v = new Set([w]);

  if (IRREGULAR_VERBS[w]) IRREGULAR_VERBS[w].forEach((f) => v.add(f));
  if (IRREGULAR_REVERSE[w]) {
    const base = IRREGULAR_REVERSE[w];
    v.add(base);
    IRREGULAR_VERBS[base]?.forEach((f) => v.add(f));
  }

  function expandBase(base) {
    if (!base || base.length < 2) return;
    v.add(base);
    if (base.endsWith('e')) {
      v.add(base + 's');
      v.add(base.slice(0, -1) + 'ing');
      v.add(base.slice(0, -1) + 'ed');
    } else if (base.endsWith('y') && !/[aeiou]y$/.test(base)) {
      v.add(base.slice(0, -1) + 'ies');
      v.add(base.slice(0, -1) + 'ied');
      v.add(base + 'ing');
    } else {
      v.add(base + 's');
      // 語尾 s/sh/ch/x/z/o は -es（watches・witnesses・boxes・crashes・vetoes）。規則で足しても、
      //   実在しない形（photoes 等）は字幕に現れないので誤一致は生まない（2026-10-20 /decide A）。
      //   2文字の語には付けない（us→uses・to→toes・ho→hoes が別の語になる）。
      if (base.length >= 3 && /(?:s|sh|ch|x|z|o)$/.test(base)) v.add(base + 'es');
      v.add(base + 'ing');
      v.add(base + 'ed');
      v.add(base + 'd');
      if (/[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(base)) {
        v.add(base + base.slice(-1) + 'ing');
        v.add(base + base.slice(-1) + 'ed');
      }
    }
  }

  expandBase(w);

  if (w.endsWith('ing') && w.length > 5) {
    const stem = w.slice(0, -3);
    expandBase(stem + 'e');
    expandBase(stem);
    if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) {
      expandBase(stem.slice(0, -1));
    }
  }
  if (w.endsWith('ed') && w.length > 4) {
    const stem = w.slice(0, -2);
    expandBase(stem + 'e');
    expandBase(stem);
    if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) {
      expandBase(stem.slice(0, -1));
    }
  }
  if (w.endsWith('ies') && w.length > 4) expandBase(w.slice(0, -3) + 'y');
  if (w.endsWith('ied') && w.length > 4) expandBase(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 4) expandBase(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) expandBase(w.slice(0, -1));

  // 対応表（2026-10-20 /decide A）: 表に載った語だけ。逆引きは表の形との完全一致のみ。
  const base = TABLE_REVERSE[w] || w;
  if (base !== w) expandBase(base);
  if (COMPARATIVES[base]) COMPARATIVES[base].forEach((f) => v.add(f));
  if (VES_PLURALS[base]) v.add(VES_PLURALS[base]);
  // 綴りの相手は、ここまでに出た形（realised→realise 等の剥がした形も含む）から引いて活用形ごと足す
  for (const x of [...v]) if (SPELLING[x]) expandBase(SPELLING[x]);

  return v;
}

// 入力語から「語尾を外して戻した原形」の候補だけを返す（入力語から広げた活用形は含めない）。
//   手動追加の頻出語ゲート（lib/server/commonWords.js manualMatchIsExact）が使う。getWordVariants が
//   原形として expandBase する語と同じ規則（逆引き・-ing/-ed/-ies/-ied/-es/-s・表の逆引き・綴りの相手）。
//   例: knowed→know・bedding→bed・happier→happy・sayings→saying。partner→（なし。partners は広げた形）。
export function wordStems(word) {
  const w = normApostrophes(word).toLowerCase().trim();
  const out = new Set();
  if (!w) return out;
  const add = (b) => b && b.length >= 2 && b !== w && out.add(b);
  add(IRREGULAR_REVERSE[w]);
  add(TABLE_REVERSE[w]);
  add(SPELLING[w]);
  for (const suf of ['ing', 'ed']) {
    if (w.endsWith(suf) && w.length > suf.length + 2) {
      const stem = w.slice(0, -suf.length);
      add(stem + 'e');
      add(stem);
      if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) add(stem.slice(0, -1));
    }
  }
  if ((w.endsWith('ies') || w.endsWith('ied')) && w.length > 4) add(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 4) add(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) add(w.slice(0, -1));
  return out;
}

// ── 語／フレーズ照合器（活用形・句動詞の分離・冠詞/目的語の差を吸収）──────────
// 句動詞・コロケーションは原形（pull off / cut a deal / file a lawsuit）で生成されるが、
// 字幕では "pulled it off" / "cut deals" / "filed a lawsuit" のように活用・分離・冠詞省略で
// 現れる。旧 exampleContainsWord はフレーズ全体を1語として扱い（\bpull off\b＋末尾活用のみ）
// これらを一切拾えなかった。結果、プロンプトが「最優先で拾え」と指示する句動詞が
// refineDramaWords で「字幕に無い drama 語＝水増し」として全て捨てられ、逆に "Genghis Khan"
// のような字面どおりの複合語だけが生き残っていた（本番 vocab_cache 4行を実測: 句動詞の生存ゼロ・
// 2026-09-11）。ここを1つの照合器に集約し、配信経路（findExampleForWord 等）・保存経路
// （findWordCueSec）・生成精査（vocab.js）・クイズ穴埋め（prep.js）が同じ規則で判定する
// （memory「字幕tsSec二重パスの罠」＝経路ごとに照合が割れると再発する）。
//   規則: 各トークン（活用形込み）が語順どおりに、間に最大2語（it / a / the / him 等）を挟んで
//         現れれば一致。冠詞・代名詞などの「埋め草」トークンは必須にしない（cut a deal → cut deals）。
//   単語（1トークン）は従来どおり \b(活用形の選択)\b。
const APOSTROPHE_RE = /[’‘`´]/g;
export function normApostrophes(s) {
  return String(s || '').replace(APOSTROPHE_RE, "'");
}
const PHRASE_FILLERS = new Set([
  'a', 'an', 'the', 'it', 'them', 'him', 'her', 'me', 'us', 'you', 'one', "one's", 'oneself',
  'someone', "someone's", 'somebody', 'something', 'sb', 'sth', 'my', 'your', 'his', 'their',
  'our', 'its', 'yourself',
]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 1語あたりの活用形候補の上限（2026-10-20 /decide・正規表現の肥大化対策）。通常の語は20前後で、ここには届かない。
export const VARIANTS_PER_TOKEN_MAX = 32;
function variantAlternation(tok) {
  // 長い活用形を先に置く（match の一致幅を最長にする＝クイズの空欄化で "running" が "run" に食われない）
  const vs = [...getWordVariants(tok)]
    .sort((a, b) => b.length - a.length)
    .slice(0, VARIANTS_PER_TOKEN_MAX)
    .map(escapeRe);
  return `(?:${vs.join('|')})`;
}
// 照合に効く語の数（フレーズの埋め草＝冠詞・代名詞等を除いた語数）。wordMatchRegex が実際に連結する語の数と同じ。
//   外部入力の語（/api/example）の上限判定に使う（lib/server/exampleGate.js exampleWordProblem）。
export function phraseContentTokenCount(word) {
  const toks = normApostrophes(word).toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (toks.length <= 1) return toks.length;
  const content = toks.filter((t) => !PHRASE_FILLERS.has(t));
  return content.length || toks.length;
}

// 語／フレーズに一致する RegExp を返す（空語は null）。flags は 'i' か 'gi'。
export function wordMatchRegex(word, flags = 'i') {
  const w = normApostrophes(word).toLowerCase().trim();
  if (!w) return null;
  const toks = w.split(/\s+/).filter(Boolean);
  if (toks.length === 1) return new RegExp(`\\b${variantAlternation(w)}\\b`, flags);
  const content = toks.filter((t) => !PHRASE_FILLERS.has(t));
  const seq = content.length ? content : toks;
  const body = seq.map(variantAlternation).join('\\b(?:\\W+\\w+){0,2}?\\W+\\b');
  return new RegExp(`\\b${body}\\b`, flags);
}

// 例文中で実際に使われている形（活用形）を返す。見出し語と同じなら null（単語のみ・フレーズは null）。
//   用途: カードは見出しを原形で出すため、例文の形と品詞が食い違って「誤判定」に見えることがある
//   （revolutionary [名詞] 革命家 ← 例文は revolutionaries＝名詞用法として正しい・2026-10-15 オーナー報告）。
//   見出しの横に「例文では revolutionaries」と添えて、品詞タグが例文中の用法である事を伝える。
export function surfaceFormInExample(example, word) {
  const w = normApostrophes(word).toLowerCase().trim();
  if (!w || /\s/.test(w)) return null;
  const re = wordMatchRegex(w);
  const m = re && normApostrophes(example || '').match(re);
  if (!m) return null;
  const hit = m[0].toLowerCase();
  return hit === w ? null : hit;
}

// 例文に単語／フレーズ（活用形・分離込み）が含まれるか
export function exampleContainsWord(example, word) {
  const re = wordMatchRegex(word);
  return !!re && re.test(normApostrophes(example));
}

// 入力したそのままの形だけに一致する RegExp（活用形を広げない）。手動追加で、変化形に頻出語が
//   混ざる語（bedding→bed・knowed→know）を照合する時に使う（2026-10-20 /decide 穴①・lib/server/commonWords.js
//   manualMatchIsExact）。広げると頻出語ゲートを迂回して頻出語の文を引き出せるため。
export function exactWordRegex(word) {
  const w = normApostrophes(word).toLowerCase().trim();
  if (!w) return null;
  return new RegExp(`\\b${escapeRe(w)}\\b`, 'i');
}
function matchRegexFor(word, exact) {
  return exact ? exactWordRegex(word) : wordMatchRegex(word);
}

// 例文を「その語を含む1〜2文」に詰める。
//   単語帳の例文が段落まるごと（複数人の会話が数百字）になっていた実データがあり
//   （2026-08-07 オーナー報告: personnel の例文が391字＝話者4人分）、
//     ・カードとして読めない（学習の役に立たない）
//     ・和訳ルートが入力300字で頭打ち＝訳が途中で切れる
//     ・引用（32条）としても「必要な範囲」を超える
//   の3点で有害。生成・バックフィルの出口でここを通し、語を含む1文へ落とす。
//   1文が見つからない／もともと短いときは原文をそのまま返す（壊さない・落とさない）。
export const EXAMPLE_MAX_CHARS = 200;
export function trimExampleToSentence(example, word, maxLen = EXAMPLE_MAX_CHARS, { exact = false } = {}) {
  const s = String(example || '').trim();
  if (!s || s.length <= maxLen || !word) return s;
  const parts = s
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return s; // 分割できない＝1文が長いだけ（切ると意味が壊れる）
  const re = matchRegexFor(word, exact);
  const idx = re ? parts.findIndex((p) => re.test(normApostrophes(p))) : -1;
  if (idx < 0) return s;
  let out = parts[idx];
  // 単体だと短すぎて場面が分からない時だけ、直前の1文を足す（それでも上限内に収める）。
  if (out.length < 40 && idx > 0 && parts[idx - 1].length + out.length + 1 <= maxLen) {
    out = `${parts[idx - 1]} ${out}`;
  }
  return out;
}

// 秒数を📍表示用ラベルへ。60分超の作品（映画・パイロット版など）でも
// 分が60を超えないよう、1時間以上は H:MM:SS に繰り上げる。
export function secToTimeLabel(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// 配信時マッチ（findExampleForWord / findExampleByAnchor）用のキュー配列。原文の大小文字を保持する
//   （引用表示用）。分割・除外の規則は splitSrtCues に一本化（生成の parseCues と同じ）。
function parseServeCues(rawSrt) {
  return splitSrtCues(rawSrt);
}

// 字幕照合用にテキストをトークン集合へ正規化（小文字・記号除去・1文字語は捨てる）。
function tokenSet(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[’'`]/g, "'")
      .replace(/[^a-z0-9' ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
}

// マッチした字幕cueの前後を結合して1文に近づける。OS字幕は1文が複数cueに割れて
// "...next door..." のように "..." で継続することがあるため、文頭〜文末まで隣接cueを足す。
// 暴走防止に前後それぞれ最大3cue・合計240字までで足切り（超過は安全側で単cueに戻す）。
function expandToFullSentence(cues, best) {
  const i = cues.indexOf(best);
  if (i < 0) return best.text;
  const MAX = 3;
  const CHAR_CAP = 240;
  const endsSentence = (t) => /[.!?]["'”’)]*\s*$/.test(t) && !/\.\.\.\s*$/.test(t);
  const startsSentence = (t) => {
    const x = t.trim();
    return /^["'“‘(]?[A-Z♪]/.test(x) && !/^\.\.\./.test(x);
  };
  let start = i;
  let end = i;
  let steps = 0;
  while (end < cues.length - 1 && !endsSentence(cues[end].text) && steps < MAX) {
    end++;
    steps++;
  }
  steps = 0;
  while (start > 0 && !startsSentence(cues[start].text) && steps < MAX) {
    start--;
    steps++;
  }
  const parts = cues.slice(start, end + 1).map((c) => c.text.trim());
  for (let k = 0; k < parts.length; k++) {
    if (k > 0) parts[k] = parts[k].replace(/^\.\.\.\s*/, ''); // 継続cueの先頭 "..." を除去
    if (k < parts.length - 1) parts[k] = parts[k].replace(/\s*\.\.\.$/, ''); // 末尾 "..." を除去
  }
  const s = parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (s.length > CHAR_CAP) return best.text;
  return s || best.text;
}

// クリック語を含む字幕キューを1つ特定して返す（経路②→①／#3 のサーバー側マッチ）。
//   ★windowSec 指定時は「再生位置 nearSec ±windowSec の窓内」に足切りしてから最近傍を選ぶ
//     ＝任意位置の総当りで字幕全文を1文ずつ復元される穴を構造的に塞ぐ。lineText アンカーが
//     使えない旧クライアント・アンカー不一致時のフォールバック経路。窓内ヒット0なら null。
//   返す sentence は引用表示用に原文の大小文字を保持する（判定は exampleContainsWord 内で小文字化）。
//   戻り値: { sentence, sec, label } / 一致なし・窓外は null。
export function findExampleForWord(rawSrt, word, nearSec, windowSec, { exact = false } = {}) {
  if (!rawSrt || !word) return null;
  const cues = parseServeCues(rawSrt);
  // 正規表現は1回だけ作る（キューごとに getWordVariants＋RegExp を作り直さない・2026-10-20 /decide）。
  //   exact: 入力したそのままの形だけ（手動追加の頻出語迂回対策・exactWordRegex）。
  const re = matchRegexFor(word, exact);
  if (!re) return null;
  let hits = cues.filter((c) => re.test(normApostrophes(c.text)));
  if (!hits.length) return null;

  const hasNear = typeof nearSec === 'number' && isFinite(nearSec);
  const hasWindow = typeof windowSec === 'number' && isFinite(windowSec) && windowSec >= 0;

  // 窓フィルタ：near と window が有効なら窓外のキューを捨てる。窓内ゼロは null。
  if (hasNear && hasWindow) {
    hits = hits.filter((c) => Math.abs(c.sec - nearSec) <= windowSec);
    if (!hits.length) return null;
  }

  let best = hits[0];
  if (hasNear) {
    best = hits.reduce(
      (a, b) => (Math.abs(b.sec - nearSec) < Math.abs(a.sec - nearSec) ? b : a),
      hits[0]
    );
  }
  return { sentence: expandToFullSentence(cues, best), sec: best.sec, label: secToTimeLabel(best.sec) };
}

// 画面に出ている字幕行（anchorLine）を手がかりに OpenSubtitles の該当キューを特定して返す（本命）。
//   時計（VOD currentTime vs OS 時刻）のズレに依存せず、本文の一致で OS の行に揃える。
//   ★防御上の利点：呼び出し側は「実際に画面に出ていた字幕」を知らないと引けない＝未知本文の
//     総当り抽出が不能（窓フィルタより強い）。anchorLine は照合にのみ使い保存しない（route 側）。
//   一致条件：クリック語を含み、かつ anchorLine とのトークン重なり（Jaccard）が閾値以上のキュー。
//     複数該当は nearSec 最近傍で曖昧性を割る。確信できる一致が無ければ null（→窓フォールバック）。
//   戻り値: { sentence, sec, label } / null。
export function findExampleByAnchor(rawSrt, word, anchorLine, nearSec) {
  if (!rawSrt || !word || !anchorLine) return null;
  const aSet = tokenSet(anchorLine);
  if (aSet.size < 2) return null; // 1語だけの曖昧アンカーは弾く（窓フォールバックへ回す）

  const cues = parseServeCues(rawSrt);
  const re = wordMatchRegex(word); // 1回だけ作る（findExampleForWord と同じ）
  if (!re) return null;
  const cands = cues.filter((c) => re.test(normApostrophes(c.text)));
  if (!cands.length) return null;

  const hasNear = typeof nearSec === 'number' && isFinite(nearSec);
  let best = null;
  let bestScore = 0;
  for (const c of cands) {
    const cSet = tokenSet(c.text);
    let inter = 0;
    for (const t of aSet) if (cSet.has(t)) inter++;
    if (inter < 2) continue; // 共有語2未満は一致と見なさない
    const jacc = inter / (aSet.size + cSet.size - inter);
    const better =
      jacc > bestScore ||
      (jacc === bestScore &&
        best &&
        hasNear &&
        Math.abs(c.sec - nearSec) < Math.abs(best.sec - nearSec));
    if (better) {
      best = c;
      bestScore = jacc;
    }
  }
  // Netflix と OS は書き起こしが少し違う（句読点/SDH/縮約）。0.4 で実用域・誤一致は稀。
  if (!best || bestScore < 0.4) return null;
  return { sentence: expandToFullSentence(cues, best), sec: best.sec, label: secToTimeLabel(best.sec) };
}

// 生SRTを {sec, text} のキュー配列にして時刻昇順で返す（同一署名はキャッシュ）。生成の📍用。
//   分割・除外（歌詞・クレジット）は splitSrtCues に一本化＝配信経路 parseServeCues と必ず同じ。
//   ここでは照合用に小文字化・アポストロフィ統一だけを足す。
let _cueCacheSig = '';
let _cueCacheArr = [];
function parseCues(raw, sig) {
  if (_cueCacheSig === sig) return _cueCacheArr;
  const cues = splitSrtCues(raw).map((c) => ({
    sec: c.sec,
    text: c.text.replace(/[’'`]/g, "'").toLowerCase(),
  }));
  cues.sort((a, b) => a.sec - b.sec);
  _cueCacheSig = sig;
  _cueCacheArr = cues;
  return cues;
}

// ── タイムスタンプ計算（公開API）────────────────────────────
// ctx = { title, season, episode, rawSrt }
// 署名は「作品＋話＋生SRT長」＝同じ話・同じ字幕の間はキュー配列を再パースしない（parseCues の
// 1件キャッシュ）。VOD 実時刻補正（fit）は撤去済み＝常にベース時刻（OS 字幕の時刻）を返す。
function buildTsContext(ctx) {
  const sig = `${ctx.title || ''}|${ctx.season}|${ctx.episode}|${(ctx.rawSrt || '').length}`;
  const cues = parseCues(ctx.rawSrt || '', sig);
  return { cues };
}

// 単語（活用形含む）を含むキューの時刻を1つ返す。
//   保存される example 文がある場合は、その語を含む候補キューのうち example と
//   トークン重なりが最大のキューに揃える＝📍時刻と例文が同じ出現箇所を指すようにする
//   （tsSec と example が別経路で別場面を指していた不一致バグの修正）。
//   example が無い／候補ゼロのときは従来どおり「語を含む最初のキュー」にフォールバック。
function findWordCueSec(cues, word, example) {
  if (!cues.length) return null;
  // ① その語（活用形・句動詞の分離込み）を含むキューに候補を絞る。
  //    配信経路（exampleContainsWord）と同じ照合器を使う＝📍時刻と例文の照合規則を割らない。
  const re = wordMatchRegex(word);
  if (!re) return null;
  const hits = cues.filter((c) => re.test(c.text));
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0].sec;

  // ② example があれば、example 文とのトークン重なりが最大のキューを選ぶ。
  //    "this is a" 等の汎用句だけで別場面を誤マッチする穴を回避するため、
  //    語自体（res で既に保証済）以外の共有トークンで曖昧性を割る。
  const exSet = example ? tokenSet(example) : null;
  if (exSet && exSet.size) {
    let best = hits[0];
    let bestScore = -1;
    for (const c of hits) {
      const cSet = tokenSet(c.text);
      let inter = 0;
      for (const t of exSet) if (cSet.has(t)) inter++;
      if (inter > bestScore) {
        best = c;
        bestScore = inter;
      }
    }
    return best.sec;
  }

  // ③ example 無し → 従来どおり最初のキュー
  return hits[0].sec;
}

// 各単語に「ベース字幕時刻」を tsSec(数値|null)/tsLabel(文字列|null) として付与する（in-place）。
// 保存・サーバー用（lib/server/vocabGen.js の生成経路／seed の backfill）。署名は従来どおり
// (words, { title, season, episode, rawSrt })。
export function attachBaseTimestamps(words, ctx) {
  const map = computeTimestamps(words, ctx);
  for (const w of words) {
    // plus 語＝字幕外のAI作例。📍を付けてはいけない。
    //   ★分割生成では drama/plus の判定が「そのチャンクの本文」に対してだけ行われるのに、
    //     時刻付与は全編の生SRTに対して走る。そのため、あるチャンクで plus（＝作例）と判定された
    //     語が、別の区間のキューから時刻をもらってしまう。実データ: 'proprietary' は
    //     source='plus'・例文はAIの作文なのに📍14:51 が付いており、その時刻のセリフと例文が別物
    //     だった（2026-08-08）。📍は「この場面で実際に言っている」という意味なので、
    //     字幕外の語には付けない（作例に実在の場面を紐づけない）。
    if (w.source === 'plus') {
      w.tsSec = null;
      w.tsLabel = null;
      continue;
    }
    const t = map.get(w.word);
    w.tsSec = t && t.sec !== Infinity ? t.sec : null;
    w.tsLabel = t ? t.label : null;
  }
  return words;
}

// 単語ごとの { sec(ソート用・ベース時刻), label(📍表示) } を一括計算して Map で返す
export function computeTimestamps(words, ctx) {
  const map = new Map();
  if (!ctx?.rawSrt) {
    words.forEach((w) => map.set(w.word, { sec: Infinity, label: null }));
    return map;
  }
  const { cues } = buildTsContext(ctx);
  words.forEach((w) => {
    if (map.has(w.word)) return;
    // example 文があれば、その語を含む候補のうち example に最も一致するキューに揃える
    // （📍時刻と例文の出現箇所を一致させる）。example 無しは語含む最初のキューへフォールバック。
    const sec = findWordCueSec(cues, w.word, w.example);
    if (sec == null) {
      map.set(w.word, { sec: Infinity, label: null });
    } else {
      map.set(w.word, { sec, label: secToTimeLabel(sec) });
    }
  });
  return map;
}
