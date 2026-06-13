'use client';

import { useEffect, useState } from 'react';
import { tmdb } from '@/lib/api';

// ポスターのモジュールキャッシュ（tmdbId → URL|null）。
// null も保持して取得失敗の再試行を防ぐ（クォータ節約）。
const _posterCache = {};

// タイトル照合用の正規化（小文字化・英数字以外を除去）
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// 名前がタイトルと大きく食い違わないか（部分一致で緩めに判定）
const nameMatches = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

// 1作品のポスターを取得する。
// 1) /tv/{tmdbId}（action:'seasons' は /tv/{id} 詳細を返す）から poster_path。
//    ただし返ってきた作品名が title と食い違う場合は tmdbId が古い/誤りとみなし不採用。
// 2) その場合は /search/tv?query={title}（action:'search'）で照合して取り直し、
//    正しい tmdbId を item に書き戻す（クリック後の選択でも正しい id を使うため）。
async function fetchPoster(item) {
  if (item.tmdbId in _posterCache) return _posterCache[item.tmdbId];
  let url = null;
  try {
    const d = await tmdb({ action: 'seasons', tvId: item.tmdbId });
    // 名前が一致する時だけ詳細のポスターを採用（誤ったidの別作品ポスターを防ぐ）
    if (d?.poster_path && nameMatches(d.name || d.original_name, item.title)) {
      url = `https://image.tmdb.org/t/p/w300${d.poster_path}`;
    }
  } catch {
    /* 取得失敗は無視（下のフォールバックへ） */
  }
  if (!url) {
    try {
      const s = await tmdb({ action: 'search', query: item.title });
      const hit = s.results?.[0];
      if (hit?.id) item.tmdbId = hit.id; // 正しいidに補正（pick時の selectedDrama にも反映）
      if (hit?.poster_path) url = `https://image.tmdb.org/t/p/w300${hit.poster_path}`;
    } catch {
      /* フォールバックも失敗 → 画像なしで表示 */
    }
  }
  _posterCache[item.tmdbId] = url;
  return url;
}

// おすすめ6件の 2×3 グリッド。
// items: getRecommendations() の戻り値。onPick(item) でカードタップを通知する。
// userLevel: バッジ表示用。作品がそのレベルを含めばユーザーのレベルを優先表示する。
export default function RecommendGrid({ items, onPick, userLevel }) {
  const [posters, setPosters] = useState({}); // tmdbId → URL

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const item of items) {
        const url = await fetchPoster(item);
        if (cancelled) return;
        if (url) setPosters((prev) => ({ ...prev, [item.tmdbId]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (!items.length) {
    return (
      <div className="recommend-empty">
        現在のレベル・サービスに合うおすすめが見つかりませんでした。
        設定からサービスを追加すると候補が増えます。
      </div>
    );
  }

  return (
    <div className="recommend-grid">
      {items.map((item) => {
        // バッジ：作品がユーザーのレベルを含めばそれを、無ければ先頭を代表表示（level-pill 流用）
        const badge = item.level.includes(userLevel) ? userLevel : item.level[0];
        const poster = posters[item.tmdbId];
        return (
          <div key={item.tmdbId} className="recommend-card" onClick={() => onPick(item)}>
            <div className="recommend-poster">
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={poster} alt={item.title} loading="lazy" />
              ) : (
                // ポスター取得失敗時のフォールバック（頭文字）
                <span className="recommend-poster-fallback">{item.title.charAt(0)}</span>
              )}
            </div>
            <div className="recommend-info">
              <div className="recommend-title-row">
                <span className="recommend-title">{item.title}</span>
                <span className={`level-pill level-${badge}`}>{badge}</span>
              </div>
              <div className="recommend-reason">{item.reason}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
