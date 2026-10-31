// AI 作例（/api/claude mode:'example_ai'）の作り方（2026-10-31）。
//   v1 は3語とも「Honestly, …」で始まり、数が増えると単調だった（オーナー実画面・Suits S1E1）。
//   v2: 語ごとに文の型を1つ割り当てて文頭を散らし、決まった書き出し（Honestly/Well/So…）を禁止する。
//   ★法務の条件は v1 のまま: 入力は語・品詞・語義だけ（字幕の行・作品名は渡さない）、固有名詞なし、
//     実在の作品・台詞を真似ない。
//   サーバ（プロンプト・検査）とアプリ（保存済み作例の作り直し判定）の両方がこれを使う。

// 共有キャッシュ（translation_ctx_cache・word='__aiex__'）のキーに入る版。上げると全語が作り直しになる。
export const AI_EXAMPLE_VERSION = 'v2';

// 会話の決まった書き出し。文頭がこれなら単調になるので配らない（作り直す）。
const FILLER_OPENER =
  /^(?:honestly|well|so|look|listen|okay|ok|actually|seriously|oh|hey|yeah|yes|no|man|wow|basically|frankly|anyway|right|now|you know|i mean|to be honest|the truth is|truth is)\b\s*(?:[,.!…]|-\s|—)/i;
export function hasFillerOpener(en) {
  return FILLER_OPENER.test(String(en || '').trim().replace(/^["“]/, ''));
}

// 固有名詞らしき語（文中で大文字始まり）。v2 の試作で「the promotion Sarah got」が出た（法務条件＝固有名詞なし）。
//   1語目は文頭なので見ない。I / I'm 等と、3文字までの略語（CEO・HR・TV）は通す。
const CAP_OK = /^(?:I|I'm|I'll|I've|I'd|OK)$/;
export function hasProperNoun(en) {
  const toks = String(en || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^["“'(]+|["”'),.!?;:…]+$/g, '').replace(/[’]/g, "'"));
  return toks.slice(1).some((t) => /^[A-Z]/.test(t) && !CAP_OK.test(t) && !/^[A-Z]{2,3}s?$/.test(t));
}

// 配れない作例か（作り直す対象）。サーバは新規生成とキャッシュ命中の両方、アプリは保存済み作例の作り直しに使う。
export function aiExampleNeedsRedo(en) {
  return hasFillerOpener(en) || hasProperNoun(en);
}

// 文の型。語から決まる（同じ語は毎回同じ型＝キャッシュのキーが安定する）。
export const AI_EXAMPLE_SHAPES = [
  '疑問文（Do / Did / Are / Is / Can / Why / How / What などで始める）',
  '相手への提案・頼みごと（動詞の原形、または Let\'s / Can you / Could we で始める）',
  '主語 I で始める平叙文',
  '主語 We / They / She / He / You のどれかで始める平叙文',
  'If / When / Before / After / Once などの節で始まる文',
  'The / This / That / Our / Your + 名詞で始まる平叙文',
  '否定文（I don\'t / You can\'t / It wasn\'t / Nobody / Never などを含む）',
];
export function pickAiExampleShape(word) {
  // FNV-1a（32bit）。Math.random を使わないのは、同じ語で型が揺れてキャッシュが割れないようにするため。
  let h = 0x811c9dc5;
  for (const ch of String(word || '').toLowerCase()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return AI_EXAMPLE_SHAPES[h % AI_EXAMPLE_SHAPES.length];
}

export function buildAiExamplePrompt({ word, pos, sense, retry = false }) {
  return (
    `英単語 "${word}"${pos ? `（品詞: ${pos}）` : ''}${sense ? `（意味: ${sense}）` : ''} を使った英語の例文を1つ作り、日本語訳を付けてください。\n` +
    `規則:\n` +
    `- 海外ドラマの会話に出てきそうな自然な口語の1文。8〜18語。\n` +
    `- 文の型: ${pickAiExampleShape(word)}。\n` +
    `- Honestly / Well / So / Look / Okay / Actually / You know のような決まった書き出し（間投詞・つなぎ言葉）で始めない。\n` +
    `- "${word}" をそのまま（または自然な活用形で）必ず1回含める。${sense ? `意味は「${sense}」として使う。` : ''}\n` +
    `- 実在の作品・人物・台詞を引用したり真似たりしない。人名・地名・会社名などの固有名詞は使わない（人は you / she / my boss のように言う）。\n` +
    `- 日本語訳は自然な話し言葉。\n` +
    (retry ? `- ★前回は決まった書き出しで始まっていたか、固有名詞が入っていました。どちらも避けてください。\n` : '') +
    `JSON だけを1行で出力: {"en": 英文, "ja": 日本語訳}`
  );
}
