'use client';

import { formatDateJa, platformColor } from '@/lib/storage';

// 既存 buildLibraryCard() の再現
export default function LibraryCard({ entry, onSelect, onDelete }) {
  const { drama, episodes, bestScore, lastDate } = entry;

  const recent = episodes.slice(-3).map((e) => `S${e.season}E${e.episode}`).join(' · ');
  const scoreClass = bestScore >= 80 ? 'score-high' : bestScore >= 60 ? 'score-mid' : 'score-low';

  const bannerStyle = drama.posterPath
    ? { background: `url('${drama.posterPath}') center/cover no-repeat` }
    : { background: platformColor(drama.platform) };

  return (
    <div className="library-card" onClick={() => onSelect(drama)}>
      <div className="library-card-banner" style={bannerStyle}>
        {!drama.posterPath && <span className="library-card-letter">{drama.title.charAt(0)}</span>}
        <button
          className="library-card-delete"
          title="削除"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(drama.title);
          }}
        >
          ✕
        </button>
      </div>
      <div className="library-card-body">
        <div className="library-card-title">{drama.title}</div>
        <div className="library-card-meta">
          <span className="history-score score-none" style={{ fontSize: 11 }}>
            {drama.platform}
          </span>
          {bestScore !== null && <span className={`history-score ${scoreClass}`}>{bestScore}%</span>}
        </div>
        {recent ? (
          <div className="library-card-episodes">📚 {recent}</div>
        ) : (
          <div className="library-card-episodes" style={{ color: 'var(--text-muted)' }}>
            未学習
          </div>
        )}
      </div>
      <div className="library-card-footer">
        <span className="library-card-date">{lastDate ? formatDateJa(lastDate) : ''}</span>
        <button className="library-card-action">
          {episodes.length > 0 ? '続きを学習 →' : '学習を始める →'}
        </button>
      </div>
    </div>
  );
}
