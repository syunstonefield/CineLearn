'use client';

import { useState } from 'react';
import { platformColor } from '@/lib/storage';

// 「続きから学習」の横長カード（ポスター左＋本文右）。
//   右：作品名・現在地(S/E)・覚えた率バー・「つづきを学習」ボタン。
//   進捗％＝覚えた率（覚えた語 / 全保存語）。視聴は検知できないので“学習の進み”で正直に示す。
//   タップ／ボタンで openDrama（→ サービス記憶があれば単語リストへ直行）。
export default function ContinueCard({ entry, stats, onSelect, onArchive }) {
  const { drama, episodes } = entry;
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const showPoster = drama.posterPath && !imgFailed;

  // 現在地＝学習した最大シーズン→その中の最大エピソード（「続き」の起点）。
  const latest = episodes.length
    ? episodes.reduce((a, b) =>
        (b.season || 1) > (a.season || 1) ||
        ((b.season || 1) === (a.season || 1) && (b.episode || 1) > (a.episode || 1))
          ? b
          : a
      )
    : null;
  const seLabel =
    drama.type === 'movie' || !latest ? '映画' : `S${latest.season || 1}E${latest.episode || 1}`;

  // 覚えた率（全エピソード合算）。
  const pct = stats && stats.total > 0 ? Math.round((stats.learned / stats.total) * 100) : 0;

  return (
    <div className="continue-card" onClick={() => onSelect(drama)} title={drama.title}>
      {/* カード右上：棚から外す（一覧から隠すだけ・学習記録＝単語/スコア/履歴は保存される）。 */}
      <button
        type="button"
        className="continue-card-archive"
        title="棚から外す（学習記録は残ります）"
        aria-label="棚から外す"
        onClick={(e) => {
          e.stopPropagation();
          onArchive?.(drama.title);
        }}
      >
        ✕
      </button>
      <div
        className="continue-card-poster-wrap"
        style={showPoster ? undefined : { background: platformColor(drama.platform) }}
      >
        {showPoster ? (
          <>
            {!imgLoaded && <span className="img-skeleton" aria-hidden="true" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="continue-card-poster"
              src={drama.posterPath}
              alt=""
              loading="lazy"
              style={{ opacity: imgLoaded ? 1 : 0 }}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgFailed(true)}
            />
          </>
        ) : (
          <span className="continue-card-letter">{drama.title.charAt(0)}</span>
        )}
      </div>

      <div className="continue-card-body">
        <div className="continue-card-title">{drama.title}</div>
        <div className="continue-card-ep">{seLabel}</div>
        {stats && stats.total > 0 && (
          <>
            <div className="continue-card-progress">
              <div className="continue-card-bar">
                <span className="continue-card-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="continue-card-pct">{pct}%</span>
            </div>
            {/* 色分けの語数（覚えた＝エメラルド／マスター＝ゴールド）。達成感＝復習の動機。 */}
            <div className="continue-card-stats">
              <span className="cc-stat cc-learned">✅ 覚えた {stats.learned}/{stats.total}</span>
              <span className="cc-stat cc-mastered">⭐ マスター {stats.mastered}/{stats.total}</span>
            </div>
          </>
        )}
        <button
          type="button"
          className="continue-card-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(drama);
          }}
        >
          ▶ つづきを学習
        </button>
      </div>
    </div>
  );
}
