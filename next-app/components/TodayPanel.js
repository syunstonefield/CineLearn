'use client';

// 既存 renderTodayPanel() の再現（ストリーク・今日の復習・週次進捗）
export default function TodayPanel({ streak, hasAnyWord, todayCount, weekStats, onStartReview }) {
  return (
    <div id="todayPanel" className="today-panel">
      {streak > 0 ? (
        <div className="today-streak">
          🔥 <b>{streak}</b>日連続
        </div>
      ) : (
        <div className="today-streak today-streak-zero">今日から連続記録をはじめよう</div>
      )}

      {!hasAnyWord ? (
        <div className="today-review-card done-review">
          <div className="today-review-title">👋 さっそく始めよう</div>
          <div className="today-review-sub">ドラマのエピソードを選んで単語を予習しましょう</div>
        </div>
      ) : todayCount > 0 ? (
        <div className="today-review-card has-review">
          <div className="today-review-title">
            📖 今日の復習 <b>{todayCount}</b>単語
          </div>
          <button className="btn-today-review" onClick={onStartReview}>
            復習をはじめる →
          </button>
        </div>
      ) : (
        <div className="today-review-card done-review">
          <div className="today-review-title">✅ 今日の復習は完了！</div>
          <div className="today-review-sub">新しいエピソードを予習してみましょう</div>
        </div>
      )}

      {hasAnyWord && (
        <div className="today-stats">
          今週 <b>{weekStats.reviewedThisWeek}</b>単語復習 · 習得 <b>{weekStats.mastered}</b>語
        </div>
      )}
    </div>
  );
}
