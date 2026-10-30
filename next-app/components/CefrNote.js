// 単語リストの一行（CEFR の目安と出典・法務 条件2・2026-10-30）。各語の印は段階だけなので、
// 「目安」であること・何に基づくか・表にない語は AI の推定であることをここで1か所だけ伝える。
// 文言は法務指定（PC＝通常・スマホ＝短縮形）。「出典」は利用規約の第三者データの節へ。
// ⚠ 文言を変える時は法務へ（「公式」「認定」「判定」は使わない／全語を「CEFR-J レベル」と呼ばない／TOEIC と並べない）。
export default function CefrNote() {
  const link = (
    <a href="/terms#third-party" target="_blank" rel="noopener noreferrer">
      出典
    </a>
  );
  return (
    <div className="cefr-note">
      <span className="cefr-note-long">
        CEFR目安：CEFR-J Wordlist（東京外国語大学投野由紀夫研究室）・Octanove Vocabulary Profile（CC BY-SA 4.0）に基づく。表にない語は AI による推定。{link}
      </span>
      <span className="cefr-note-short">
        CEFR目安：CEFR-J・Octanove（CC BY-SA 4.0）／表にない語は AI 推定　
        <a href="/terms#third-party" target="_blank" rel="noopener noreferrer">
          出典›
        </a>
      </span>
    </div>
  );
}
