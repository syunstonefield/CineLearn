'use client';

import { useState } from 'react';
import { platformColor } from '@/lib/storage';

// マイリストの1枚（小型ポスター＋学習状況キャプション）。
// ポスター上：進捗バー（現在シーズンの学習済割合）・棚から外す(✕)。作品名は title 属性に残す。
// ポスター下：作品ごとの学習状況（全エピソード合算）✅覚えた / ⭐マスター。
// stats = { total, learned, mastered }（学習履歴のある作品のみ・未学習は undefined）。
export default function LibraryCard({ entry, onSelect, onArchive, stats }) {
  const { drama, episodes } = entry;
  // ポスター画像の読み込み失敗を検知して頭文字フォールバックへ切り替える（白い空カード対策）
  const [imgFailed, setImgFailed] = useState(false);
  // 読み込み完了までシマー（スケルトン）を出す
  const [imgLoaded, setImgLoaded] = useState(false);

  const studied = episodes.length;
  // 現在のシーズン＝学習した最大シーズン番号。そのシーズン内の進捗をバーにする。
  const curSeason = studied > 0 ? Math.max(...episodes.map((e) => e.season || 1)) : 0;
  const curStudied = studied > 0 ? episodes.filter((e) => (e.season || 1) === curSeason).length : 0;
  const curTotal = drama.seasonCounts ? drama.seasonCounts[curSeason] || 0 : 0;
  const pct = curTotal > 0 ? Math.min(100, Math.round((curStudied / curTotal) * 100)) : 0;

  // ポスター未設定 or 読み込み失敗のときは、プラットフォーム色＋頭文字で必ず埋める。
  const showPoster = drama.posterPath && !imgFailed;

  return (
    <div className="library-card library-card-mini" onClick={() => onSelect(drama)} title={drama.title}>
      <div
        className="library-card-banner"
        style={showPoster ? undefined : { background: platformColor(drama.platform) }}
      >
        {showPoster ? (
          <>
            {!imgLoaded && <span className="img-skeleton" aria-hidden="true" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="library-card-poster"
              src={drama.posterPath}
              alt=""
              loading="lazy"
              style={{ opacity: imgLoaded ? 1 : 0 }}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgFailed(true)}
            />
          </>
        ) : (
          <span className="library-card-letter">{drama.title.charAt(0)}</span>
        )}
        <button
          className="library-card-delete"
          title="棚から外す（学習記録は残ります）"
          onClick={(e) => {
            e.stopPropagation();
            onArchive(drama.title);
          }}
        >
          ✕
        </button>
        {/* 進捗バー：背表紙の下端に重ねる（現在シーズンの話数が分かる作品のみ） */}
        {curTotal > 0 && (
          <div className="library-card-progress" title={`シーズン${curSeason}：${curStudied}/${curTotal}話 学習済み`}>
            <span className="library-card-progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {/* 学習状況（全エピソード合算）。保存単語がある作品だけ表示する。 */}
      {stats && stats.total > 0 && (
        <div className="library-card-caption">
          <span className="lc-stat lc-learned" title="覚えた（全エピソード合計）">
            ✅ 覚えた {stats.learned}/{stats.total}
          </span>
          <span className="lc-stat lc-mastered" title="マスター（全エピソード合計）">
            ⭐ マスター {stats.mastered}/{stats.total}
          </span>
        </div>
      )}
    </div>
  );
}
