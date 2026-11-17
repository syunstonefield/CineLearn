// 意味のカテゴリ（関連語・大ごとの復習・2026-11-17 オーナー決定）。★⑦裏側の持ち物（④は読むだけ）。
//   一覧は CineLearn の自作（受付の案＋⑦の試しで足した小分類）。既存の辞書・分類表に沿わせない。
//   語の持ち方: { cat:'emotion', sub:'anger', catv:1 }。合うものが無い語は { cat:'other', sub:'' }＝関連語を出さない。
//   値は生成の時に AI が「その場面での意味」で付ける（lib/vocab.js の k）。前に作った語は seed/backfill-cats.mjs で後から付ける。
//   一覧を直す時は CAT_VERSION を上げる（古い版の語は catOf が null を返す＝付け直しの対象）。
// サーバー（seed の素の Node）とアプリの両方が import する＝相対 import 以外は使わない。

export const CAT_VERSION = 1;
export const CAT_OTHER = 'other';

export const CATEGORIES = [
  { code: 'emotion', label: '感情', subs: [['anger', '怒り・いらだち'], ['joy', '喜び・満足'], ['sadness', '悲しみ・落胆'], ['fear', '不安・恐れ'], ['surprise', '驚き・とまどい'], ['disgust', '嫌悪・うんざり'], ['shame', '恥・後ろめたさ'], ['calm', '安心・落ち着き']] },
  { code: 'character', label: '性格・人がら', subs: [['tough', '強気・頑固'], ['kind', 'やさしさ・誠実'], ['sly', 'ずるさ・不誠実'], ['shy', '内気・慎重'], ['proud', '自信・うぬぼれ'], ['skill', '有能・不器用'], ['cold', '冷たさ・残酷']] },
  { code: 'relation', label: '人との関係', subs: [['trust', '信頼・味方'], ['conflict', '対立・けんか'], ['love', '恋愛・親しさ'], ['rank', '上下・立場'], ['help', '助ける・頼る'], ['betray', '裏切り・距離']] },
  { code: 'thinking', label: '考え・判断', subs: [['guess', '思う・推測'], ['decide', '決める・選ぶ'], ['doubt', '疑う・確かめる'], ['realize', '理解・気づき'], ['plan', '計画・ねらい'], ['opinion', '評価・意見'], ['cause', '原因・結果'], ['belief', '信じる・運命']] },
  { code: 'speech', label: '話す・伝える', subs: [['ask', '頼む・誘う'], ['refuse', '断る・反対'], ['explain', '説明・報告'], ['promise', '約束・同意'], ['joke', '冗談・皮肉'], ['praise', 'ほめる・責める'], ['lie', '隠す・うそ']] },
  { code: 'action', label: '動き・行動', subs: [['move', '移動'], ['startstop', '始める・やめる'], ['try', '試す・がんばる'], ['avoid', '避ける・逃げる'], ['gainlose', '手に入れる・失う'], ['breakfix', 'こわす・直す'], ['split', '分ける・つなぐ']] },
  { code: 'state', label: '物の状態・ようす', subs: [['look', '見た目'], ['quality', '良し悪し・質'], ['difficulty', '難しさ・単純さ'], ['danger', '危険・安全'], ['change', '新旧・変化'], ['clarity', '明らか・あいまい'], ['real', '本物・にせ物']] },
  { code: 'degree', label: '量・程度', subs: [['amount', '多い少ない'], ['emphasis', '強める言い方'], ['approx', 'だいたい・ちょうど'], ['increase', '増減'], ['whole', '全部・一部']] },
  { code: 'time', label: '時間・順序', subs: [['now', '今・すぐ'], ['order', '前後・順番'], ['frequency', '頻度'], ['period', '期間・しめきり'], ['timing', '遅れ・早まり']] },
  { code: 'work', label: '仕事・お金', subs: [['deal', '取引・契約'], ['job', '雇う・辞める'], ['money', 'お金・支払い'], ['result', '成果・失敗'], ['meeting', '会議・手続き'], ['compete', '競争・勝ち負け']] },
  { code: 'life', label: '暮らし・体', subs: [['food', '食べ飲み'], ['health', '体調・けが'], ['home', '家・持ち物'], ['leisure', '休み・遊び'], ['clothes', '服・身なり']] },
  { code: 'society', label: '社会・決まり', subs: [['law', '法・裁判'], ['crime', '犯罪・捜査'], ['rule', '決まり・義務'], ['politics', '政治・権力'], ['fact', '事実・証拠'], ['fight', '戦い・暴力'], ['military', '軍・武器']] },
  { code: 'science', label: '科学・技術', subs: [['machine', '機械・道具'], ['research', '研究・実験'], ['data', '通信・データ']] },
].map((c) => ({ code: c.code, label: c.label, subs: c.subs.map(([code, label]) => ({ code, label })) }));

const BY_CODE = new Map(CATEGORIES.map((c) => [c.code, c]));

// 'emotion.anger' → { cat:'emotion', sub:'anger' }。一覧に無い・空・'other' は { cat:'other', sub:'' }。
export function parseCatKey(k) {
  const [cat, sub] = String(k || '').trim().toLowerCase().split('.');
  const c = BY_CODE.get(cat);
  if (c && c.subs.some((s) => s.code === sub)) return { cat, sub };
  return { cat: CAT_OTHER, sub: '' };
}

// 語に付ける値（生成と後付けで同じ形）。
export function catFields(k) {
  return { ...parseCatKey(k), catv: CAT_VERSION };
}

// 語の値を読む。付いていない・版が違う・一覧に無い → null。'other' はそのまま返す（「付けたが合うものが無い」）。
export function catOf(w) {
  if (!w || w.catv !== CAT_VERSION || !w.cat) return null;
  if (w.cat === CAT_OTHER) return { cat: CAT_OTHER, sub: '' };
  const p = parseCatKey(`${w.cat}.${w.sub}`);
  return p.cat === CAT_OTHER ? null : p;
}

export function catLabel(cat) {
  return BY_CODE.get(cat)?.label || '';
}

export function subLabel(cat, sub) {
  return BY_CODE.get(cat)?.subs.find((s) => s.code === sub)?.label || '';
}

// 生成・後付けの指示に載せる一覧（コードと日本語の名前だけ）。
export function catPromptList() {
  return CATEGORIES.map((c) => `${c.label}: ${c.subs.map((s) => `${c.code}.${s.code}（${s.label}）`).join(' ')}`).join('\n');
}

// 語の一覧 → [{ w, cat, sub }]（/api/vocab-cats の応答・値の無い語・版の違う語は入れない）。
export function catsOfWords(words) {
  const out = [];
  for (const w of Array.isArray(words) ? words : []) {
    const c = catOf(w);
    if (c && w.word) out.push({ w: w.word, cat: c.cat, sub: c.sub });
  }
  return out;
}

// /api/vocab-cats の応答を history の1話の語に写す（語の小文字で突き合わせ・値がもうある語はさわらない）。
//   戻り値: 埋めた語の数（0 なら保存し直さなくてよい）。
export function applyCats(words, cats) {
  const m = new Map((Array.isArray(cats) ? cats : []).map((c) => [String(c.w || '').toLowerCase(), c]));
  let n = 0;
  for (const w of Array.isArray(words) ? words : []) {
    if (!w?.word || catOf(w)) continue;
    const c = m.get(String(w.word).toLowerCase());
    if (!c) continue;
    const p = c.cat === CAT_OTHER ? { cat: CAT_OTHER, sub: '' } : parseCatKey(`${c.cat}.${c.sub}`);
    w.cat = p.cat;
    w.sub = p.sub;
    w.catv = CAT_VERSION;
    n++;
  }
  return n;
}
