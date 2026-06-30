'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { loadHistory, learningStatsByTitle, buildLibraryEntries } from '@/lib/storage';
import { getStudySeconds, formatStudyTime } from '@/lib/studytime';
import { loadFavorites, toggleFavorite } from '@/lib/favorites';
import { fetchSeasons, getCachedSeasons, fullRangeLabel } from '@/lib/collection';
import TicketDetailView from './TicketDetailView';
import TicketPoster from './TicketPoster';

// 半券コレクション（Phase 1：一覧画面）。
// 学習履歴を作品単位に集約し、チケット型カードで「学習したドラマの記録」を見せる。
// 総話数・進捗% は TMDB（cl_total_eps_* キャッシュ）から非同期取得。学習時間は前景計測（今から）。
const FILTERS = [
  ['all', 'すべて'],
  ['watching', '視聴中'],
  ['done', '完了'],
  ['fav', 'お気に入り'],
];

const POSTER_COLORS = ['#E50914', '#1A73E8', '#2E7D32', '#7B1FA2', '#E65100', '#00695C', '#AD1457'];

export default function TicketCollectionScreen() {
  const { settings, openDrama, mounted, profile, reviewVersion, cloudVersion, wordbookVersion } = useApp();

  const [favs, setFavs] = useState([]);
  const [seasonsMap, setSeasonsMap] = useState({}); // tmdbId → { total, seasons }
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('added');
  const [detailTitle, setDetailTitle] = useState(null); // 開いている作品詳細（タイトル）

  useEffect(() => {
    setFavs(loadFavorites(profile?.id));
  }, [profile]);

  // 作品エントリ（学習履歴ベース）＋単語数＋追加日。
  const entries = useMemo(() => {
    if (!mounted) return [];
    const history = loadHistory();
    const stats = learningStatsByTitle(history);
    const lib = buildLibraryEntries(history, settings.myDramas || []);
    const firstDate = new Map(); // 追加日＝最古の学習日
    history.forEach((h) => {
      const t = h.drama?.title;
      if (!t) return;
      const d = h.date || '';
      if (!firstDate.has(t) || d < firstDate.get(t)) firstDate.set(t, d);
    });
    return lib.map((e) => {
      const title = e.drama.title;
      const en = e.drama.englishTitle || title;
      return {
        title,
        enTitle: en,
        jaTitle: title !== en ? title : '',
        genre: e.drama.genre || '',
        tmdbId: e.drama.tmdbId || null,
        isMovie: e.drama.type === 'movie',
        posterPath: e.drama.posterPath || null,
        drama: e.drama,
        studiedEps: e.episodes.length,
        episodes: e.episodes,
        wordCount: stats.get(title)?.total || 0,
        addedDate: firstDate.get(title) || e.lastDate || '',
      };
    });
  }, [mounted, settings.myDramas, reviewVersion, cloudVersion, wordbookVersion]);

  // 総話数・シーズン構成を TMDB から非同期取得（キャッシュ優先・1件ずつ）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const e of entries) {
        if (!e.tmdbId || e.isMovie || seasonsMap[e.tmdbId]) continue;
        const cached = getCachedSeasons(e.tmdbId);
        if (cached) {
          setSeasonsMap((m) => ({ ...m, [e.tmdbId]: cached }));
          continue;
        }
        const r = await fetchSeasons(e.tmdbId, false);
        if (cancelled) return;
        if (r) setSeasonsMap((m) => ({ ...m, [e.tmdbId]: r }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // total / progress / range を付与。
  const decorated = useMemo(
    () =>
      entries.map((e) => {
        const sj = e.isMovie ? { total: 1, seasons: [] } : e.tmdbId ? seasonsMap[e.tmdbId] : null;
        const total = e.isMovie ? 1 : sj?.total || null;
        const progress = total ? Math.min(100, Math.round((e.studiedEps / total) * 100)) : null;
        const range = fullRangeLabel(sj?.seasons, e.episodes);
        const isFav = favs.includes(e.title);
        const status = total != null ? (e.studiedEps >= total ? 'done' : 'watching') : 'watching';
        // posterPath は myDramas 由来が第一だが、欠落/同期ズレで消えることがある。
        // tmdbId 単位で永続キャッシュした TMDB ポスターをフォールバックに（リロードで消える対策）。
        const posterPath = e.posterPath || sj?.posterPath || null;
        return { ...e, posterPath, total, progress, range, isFav, status };
      }),
    [entries, seasonsMap, favs]
  );

  // フィルタ→ソート。
  const list = useMemo(() => {
    let l = decorated;
    if (filter === 'watching') l = l.filter((e) => e.status === 'watching');
    else if (filter === 'done') l = l.filter((e) => e.status === 'done');
    else if (filter === 'fav') l = l.filter((e) => e.isFav);
    return [...l].sort((a, b) => {
      if (sort === 'progress') return (b.progress || 0) - (a.progress || 0);
      if (sort === 'name') return a.enTitle.localeCompare(b.enTitle);
      return (b.addedDate || '').localeCompare(a.addedDate || ''); // added=新しい順
    });
  }, [decorated, filter, sort]);

  // 集計（帯）。
  const dramaCount = decorated.length;
  const totalStudiedEps = decorated.reduce((a, e) => a + e.studiedEps, 0);
  const studyTime = mounted ? formatStudyTime(getStudySeconds(profile?.id)) : '0分';

  const onFav = (title) => setFavs(toggleFavorite(profile?.id, title));
  const fmtDate = (s) => (s || '').replace(/-/g, '.');

  // 作品詳細（Phase 2）：カードタップで開くサブ画面。お気に入り等と同期させるため
  // タイトルで decorated から引き直す（スナップショットにしない）。
  const detailEntry = detailTitle ? decorated.find((e) => e.title === detailTitle) : null;
  if (detailEntry) {
    return (
      <TicketDetailView
        entry={detailEntry}
        seasons={
          detailEntry.tmdbId
            ? seasonsMap[detailEntry.tmdbId]
            : detailEntry.isMovie
            ? { total: 1, seasons: [] }
            : null
        }
        onBack={() => setDetailTitle(null)}
        onFav={onFav}
        onStudy={() => openDrama(detailEntry.drama)}
        profileId={profile?.id}
      />
    );
  }

  return (
    <div className="screen active" id="screen-collection">
      <div className="tc-screen">
        <div className="tc-head">
          <h1 className="tc-h1">🎟 半券コレクション</h1>
          <p className="tc-sub">あなたが学習したドラマの記録です</p>
        </div>

        <div className="tc-stats">
          <div className="tc-stat">
            <div className="tc-stat-label">コレクション数</div>
            <div className="tc-stat-num">{dramaCount}</div>
            <div className="tc-stat-unit">作品</div>
          </div>
          <div className="tc-stat">
            <div className="tc-stat-label">視聴エピソード</div>
            <div className="tc-stat-num">{totalStudiedEps}</div>
            <div className="tc-stat-unit">エピソード</div>
          </div>
          <div className="tc-stat">
            <div className="tc-stat-label">学習時間</div>
            <div className="tc-stat-num">{studyTime}</div>
            <div className="tc-stat-unit">&nbsp;</div>
          </div>
        </div>

        <div className="tc-tabs" role="tablist">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={'tc-tab' + (filter === k ? ' is-active' : '')}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tc-sortrow">
          <label className="tc-sort">
            並び替え：
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="added">追加日</option>
              <option value="progress">進捗</option>
              <option value="name">名前</option>
            </select>
          </label>
        </div>

        {list.length === 0 ? (
          <div className="tc-empty">
            <div className="tc-empty-icon" aria-hidden="true">🎟</div>
            <div className="tc-empty-title">
              {filter === 'all' ? 'まだコレクションがありません' : '該当する作品がありません'}
            </div>
            <div className="tc-empty-sub">
              作品を予習・学習すると、ここに「観たドラマの記録」が半券として貯まります。
            </div>
          </div>
        ) : (
          <div className="tc-list">
            {list.map((e, i) => (
              <div
                key={e.title}
                className="tcimg-card"
                role="button"
                tabIndex={0}
                onClick={() => setDetailTitle(e.title)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    setDetailTitle(e.title);
                  }
                }}
              >
                {/* 左の暗部にポスターを重ねる（無ければ頭文字・読み込み失敗もフォールバック） */}
                <TicketPoster
                  src={e.posterPath}
                  label={e.enTitle}
                  color={POSTER_COLORS[i % POSTER_COLORS.length]}
                />

                {/* 本体（ADMIT ONE はテンプレ画像に焼かれている） */}
                <div className="tcimg-body">
                  <div className="tcimg-title">{e.enTitle}</div>
                  {e.jaTitle && <div className="tcimg-ja">{e.jaTitle}</div>}
                  {e.range && <div className="tcimg-range">{e.range}</div>}
                  <div className="tcimg-date">追加日：{fmtDate(e.addedDate)}</div>
                </div>

                {/* 右スタブ：数字だけ重ねる（ラベルは画像） */}
                <div className="tcimg-eps" aria-hidden="true">{e.total != null ? e.total : '—'}</div>
                <div
                  className={'tcimg-prog' + (e.progress != null && e.progress < 100 ? ' is-partial' : '')}
                  aria-hidden="true"
                >
                  {e.progress != null ? `${e.progress}%` : '—'}
                </div>

                {/* お気に入り（画像の★位置に重ねてトグル） */}
                <button
                  type="button"
                  className={'tcimg-fav' + (e.isFav ? ' is-on' : '')}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onFav(e.title);
                  }}
                  aria-label={e.isFav ? 'お気に入りから外す' : 'お気に入りに追加'}
                  aria-pressed={e.isFav}
                >
                  {e.isFav ? '★' : '☆'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
