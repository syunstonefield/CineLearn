'use client';

// 累計の語彙進捗（ホームの別枠カード）。「今日やること（今日の復習ヒーロー）」とは分離し、
// 「これまでの積み上げ」を独立で見せる。覚えた＝エメラルド／マスター＝ゴールドで達成感→復習の動機に。
export default function VocabProgress({ learned = 0, mastered = 0, total = 0 }) {
  if (total <= 0) return null;
  return (
    <div className="vocab-progress">
      <div className="vocab-progress-card">
        <div className="vp-tile vp-learned">
          <span className="vp-label">✅ 覚えた</span>
          <span className="vp-num">
            {learned}
            <span className="vp-sub"> / {total}</span>
          </span>
        </div>
        <span className="vp-divider" aria-hidden="true" />
        <div className="vp-tile vp-mastered">
          <span className="vp-label">⭐ マスター</span>
          <span className="vp-num">
            {mastered}
            <span className="vp-sub"> / {total}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
