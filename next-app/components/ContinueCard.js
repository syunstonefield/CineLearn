'use client';

import { useState } from 'react';
import { platformColor } from '@/lib/storage';

// 「続きから学習」の行（ポスター左＋本文右・2026-11-12 見直しで小さな行に）。
//   右：作品名・現在地(S/E)・覚えた率・進みの線・✕（棚から外す）。
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

  // 2026-11-12 見直し（受付の見本・オーナー了承）: 小さな行（ポスター小・作品名は茶色・SxEy・覚えた%・進みの線・✕）。
  //   行を押すと今までどおり openDrama。✕＝棚から外す（確認文は Dashboard の handleArchive・今のまま）。
  return (
    <div
      className="hm-row"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(drama)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(drama);
        }
      }}
      title={drama.title}
      aria-label={`${drama.title} ${seLabel}${stats && stats.total > 0 ? `・覚えた ${pct}%` : ''}・つづきを学習`}
    >
      <span
        className="hm-row-ps"
        style={showPoster ? undefined : { background: platformColor(drama.platform) }}
        aria-hidden="true"
      >
        {showPoster ? (
          <>
            {!imgLoaded && <span className="img-skeleton" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={drama.posterPath}
              alt=""
              loading="lazy"
              style={{ opacity: imgLoaded ? 1 : 0 }}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgFailed(true)}
            />
          </>
        ) : (
          <span className="hm-row-letter">{drama.title.replace(/^The /, '').charAt(0)}</span>
        )}
      </span>
      <span className="hm-row-tx">
        <span className="hm-row-t">{drama.title}</span>
        <span className="hm-row-m">
          {seLabel}
          {stats && stats.total > 0 ? `　覚えた ${pct}%` : ''}
        </span>
        {stats && stats.total > 0 && (
          <span className="hm-row-pb" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      <button
        type="button"
        className="hm-row-x"
        title="棚から外す（学習記録は残ります）"
        aria-label={`${drama.title} を棚から外す`}
        onClick={(e) => {
          e.stopPropagation();
          onArchive?.(drama.title);
        }}
      >
        ✕
      </button>
    </div>
  );
}
