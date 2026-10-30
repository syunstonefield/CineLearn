// 単語リストの各語に出す「CEFR目安」（2026-10-30・表を持たない純関数＝クライアントで使う）。
//   値: サーバが添えた levelShown（(A) 方式＝難易度表の段階）があればそれ、無ければ AI の level（(B) 方式）。
//   句動詞・イディオムなど複数語は段階になじまないので出さない。A1〜C2 以外の値も出さない。
const ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function cefrHintOf(w) {
  if (!w || /\s/.test(String(w.word || '').trim())) return null;
  const lv = String(w.levelShown || w.level || '').trim().toUpperCase();
  return ORDER.includes(lv) ? lv : null;
}

// 見出しの説明（title・読み上げ）。点数や公式の判定と誤認させない言い方にする。
export const CEFR_HINT_TITLE = 'CEFR の目安（本サービス独自の判定で、公式の判定ではありません）';
