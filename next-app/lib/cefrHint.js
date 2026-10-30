// 単語リストの各語に出す CEFR の目安（2026-10-30・表を持たない純関数＝クライアントで使う）。
//   値: サーバが添えた levelShown（字幕の語で難易度表に載っていた語の段階）があればそれ、無ければ AI の level。
//   句動詞・イディオムなど複数語は段階になじまないので出さない。A1〜C2 以外の値も出さない。
//   表現の決まり（法務 2026-10-30）: 各語は段階だけ（「B1」）。「公式」「認定」「判定」は使わない／全語を
//   「CEFR-J レベル」と呼ばない／TOEIC の点数と並べない。「目安」であることは画面の一行（CefrNote）で伝える。
const ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// 戻り値: { level: 'B1', ai: boolean } | null（ai＝表に無く AI の推定を出している）
export function cefrHintOf(w) {
  if (!w || /\s/.test(String(w.word || '').trim())) return null;
  const shown = String(w.levelShown || '').trim().toUpperCase();
  if (ORDER.includes(shown)) return { level: shown, ai: false };
  const lv = String(w.level || '').trim().toUpperCase();
  return ORDER.includes(lv) ? { level: lv, ai: true } : null;
}

// 1語の印にかぶせる説明（title・読み上げ）
export function cefrHintTitle(h) {
  if (!h) return '';
  return h.ai ? `CEFR の目安 ${h.level}（AI による推定）` : `CEFR の目安 ${h.level}（CEFR-J Wordlist・Octanove Vocabulary Profile に基づく）`;
}
