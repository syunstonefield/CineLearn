'use client';

// ホーム最上部のヒーローカード（ストリーク・今日の復習・週次進捗）。
// 「今日の復習 N語」を円形カウント＋大型CTAで前面化し、毎日戻る動線にする。
export default function TodayPanel({ streak, hasAnyWord, todayCount, onStartReview }) {
  const streakChip =
    streak > 0 ? (
      <span className="today-streak-chip">🔥 {streak}日連続</span>
    ) : (
      <span className="today-streak-chip is-zero">連続記録をはじめよう</span>
    );

  // まだ単語が1つも無い → 予習を促すヒーロー
  if (!hasAnyWord) {
    return (
      <div className="today-panel">
        <div className="today-hero is-start">
          <div className="today-hero-main">
            <div className="today-hero-title">👋 さっそく始めよう</div>
            <div className="today-hero-sub">ドラマのエピソードを選んで単語を予習しましょう</div>
          </div>
        </div>
      </div>
    );
  }

  // 今日の復習が残っている → 円形カウント＋CTAのヒーロー
  if (todayCount > 0) {
    return (
      <div className="today-panel">
        <div className="today-hero is-due">
          <div className="today-hero-count" aria-hidden="true">
            <svg className="today-ring" viewBox="0 0 72 72">
              <defs>
                <linearGradient id="todayRingGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="var(--accent)" />
                  <stop offset="1" stopColor="var(--gold)" />
                </linearGradient>
              </defs>
              <circle className="today-ring-track" cx="36" cy="36" r="31" />
              <circle
                cx="36"
                cy="36"
                r="31"
                fill="none"
                stroke="url(#todayRingGrad)"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
            <span className="today-hero-count-inner">
              <span className="today-hero-count-num">{todayCount}</span>
              <span className="today-hero-count-unit">語</span>
            </span>
          </div>
          <div className="today-hero-main">
            <div className="today-hero-title">今日の復習</div>
            <div className="today-hero-meta">{streakChip}</div>
          </div>
          <button className="btn-today-review" onClick={onStartReview}>
            復習をはじめる →
          </button>
        </div>
      </div>
    );
  }

  // 今日の復習は完了
  return (
    <div className="today-panel">
      <div className="today-hero is-done">
        <div className="today-hero-check" aria-hidden="true">
          ✓
        </div>
        <div className="today-hero-main">
          <div className="today-hero-title">今日の復習は完了！</div>
          <div className="today-hero-meta">
            {streakChip}
            {weekLine}
          </div>
        </div>
      </div>
    </div>
  );
}
