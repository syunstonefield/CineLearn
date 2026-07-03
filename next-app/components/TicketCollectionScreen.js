'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const { settings, updateSettings, openDrama, mounted, profile, reviewVersion, cloudVersion, wordbookVersion } =
    useApp();

  const [favs, setFavs] = useState([]);
  const [seasonsMap, setSeasonsMap] = useState({}); // tmdbId → { total, seasons }
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('added');
  const [detailTitle, setDetailTitle] = useState(null); // 開いている作品詳細（タイトル）
  const attemptedPosters = useRef(new Set()); // 重複fetch防止
  const [posterOverrides, setPosterOverrides] = useState({}); // title → posterPath（表示補完）

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

  // 総話数・シーズン構成を TMDB から非同期取得。キャッシュ済みは即適用、
  // 未キャッシュは同時4件のプールで並列取得（直列N連の初回待ちを解消＝engineer指摘の本丸）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const toFetch = [];
      const cachedUpdates = {};
      for (const e of entries) {
        if (!e.tmdbId || e.isMovie || seasonsMap[e.tmdbId]) continue;
        const cached = getCachedSeasons(e.tmdbId);
        if (cached) cachedUpdates[e.tmdbId] = cached;
        else toFetch.push(e);
      }
      if (Object.keys(cachedUpdates).length) setSeasonsMap((m) => ({ ...m, ...cachedUpdates }));
      const CONC = 4;
      for (let i = 0; i < toFetch.length && !cancelled; i += CONC) {
        const chunk = toFetch.slice(i, i + CONC);
        const results = await Promise.all(
          chunk.map((e) => fetchSeasons(e.tmdbId, false).then((r) => [e.tmdbId, r]))
        );
        if (cancelled) return;
        const upd = {};
        for (const [id, r] of results) if (r) upd[id] = r;
        if (Object.keys(upd).length) setSeasonsMap((m) => ({ ...m, ...upd }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // ポスター解決（ホーム Dashboard と同じ）：posterPath 未設定/旧サイズ(w500/w780)の作品を
  // TMDB 検索で縦ポスター(w342)に取り直し、表示用 override ＋ myDramas へ永続化。
  // これで「ホームには出るがコレクションに出ない」不一致を解消（どちらの画面を先に開いても揃う）。
  useEffect(() => {
    const missing = entries.filter(
      (e) =>
        ((!e.posterPath || e.posterPath.includes('/w500') || e.posterPath.includes('/w780')) ||
          // ポスターが健在でも tmdbId が無いTVは検索で id を補修する（同期マージで
          // tmdbId が落ちた作品の自己治癒＝総話数「—」の復旧・2026-07-03）。
          (!e.tmdbId && !e.isMovie)) &&
        // TV(tmdbId有)は進捗バー用の seasons 取得でポスターも得られる＝検索往復を省く。
        !(e.tmdbId && !e.isMovie) &&
        !attemptedPosters.current.has(e.title)
    );
    if (!missing.length) return;
    missing.forEach((m) => attemptedPosters.current.add(m.title));
    (async () => {
      const found = {};
      const md = [...(settings.myDramas || [])];
      let mdChanged = false;
      const CONC = 4; // 同時4件のプール（検索往復の直列N連を解消）
      for (let i = 0; i < missing.length; i += CONC) {
        const chunk = missing.slice(i, i + CONC);
        await Promise.all(
          chunk.map(async (e) => {
            try {
              const q = e.drama?.englishTitle || e.title;
              // 映画/TV横断のmulti検索。履歴のみの作品は type が欠けるため、TV検索固定だと
              // 映画が無関係のTV番組に誤マッチする事故が起きた（Toy Story 4→別番組52話・2026-07-03実測）。
              const res = await fetch('/api/tmdb', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'search_multi', query: q }),
              });
              const json = await res.json();
              // タイトルの緩一致を必須にして、無関係な作品の id/ポスターを保存しない。
              const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/g, '');
              const nq = norm(q) || norm(e.title);
              const hit = (json.results || []).find((r) => {
                if (r.media_type !== 'tv' && r.media_type !== 'movie') return false;
                if (!r.poster_path && !r.backdrop_path) return false;
                const names = [r.name, r.title, r.original_name, r.original_title].map(norm);
                return names.some((n) => n && nq && (n.includes(nq) || nq.includes(n)));
              });
              if (!hit) return;
              const isMovieHit = hit.media_type === 'movie';
              const imgPath = hit.poster_path || hit.backdrop_path;
              const p = `https://image.tmdb.org/t/p/w342${imgPath}`;
              found[e.title] = p;
              const m = md.find((d) => d.title === e.title);
              if (m) {
                m.posterPath = p;
                if (hit.id) m.tmdbId = hit.id;
                if (!m.type) m.type = isMovieHit ? 'movie' : 'tv';
                mdChanged = true;
              } else if (hit.id) {
                // 履歴にだけ存在する作品（マイリスト外）にも tmdbId を持たせる受け皿を作る。
                // 2026-07-02 の同期初日にマイリストが巻き戻り、履歴のみの作品は tmdbId を
                // どこからも引けず総話数が「—」のままだった（解決器が id を見つけても
                // md.find が外れて捨てていた）。最小エントリを追加すれば entries が
                // tmdbId を得て seasons 取得が走り、saveProfiles でクラウドにも治癒が伝搬する。
                md.push({
                  title: e.title,
                  englishTitle: e.drama?.englishTitle || e.enTitle || e.title,
                  tmdbId: hit.id,
                  posterPath: p,
                  type: isMovieHit ? 'movie' : 'tv',
                  genre: e.genre || '',
                });
                mdChanged = true;
              }
            } catch {
              /* 取得失敗は無視（onError フォールバックで頭文字表示） */
            }
          })
        );
      }
      if (Object.keys(found).length) setPosterOverrides((prev) => ({ ...prev, ...found }));
      if (mdChanged) updateSettings({ myDramas: md });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

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
        // ポスター優先順位：解決済み override(w342縦) → myDramas → tmdb キャッシュ(w780)。
        // override はホームと同じ TMDB 検索結果＝表示を home と一致させる。
        const posterPath = posterOverrides[e.title] || e.posterPath || sj?.posterPath || null;
        return { ...e, posterPath, total, progress, range, isFav, status };
      }),
    [entries, seasonsMap, favs, posterOverrides]
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

  // 全作品合計の 覚えた/マスター（ヘッダ下の1行・2026-07-03 実使用フィードバック#11）。
  const srsTotals = useMemo(() => {
    if (!mounted) return { learned: 0, mastered: 0 };
    let learned = 0;
    let mastered = 0;
    learningStatsByTitle(loadHistory()).forEach((v) => {
      learned += v.learned;
      mastered += v.mastered;
    });
    return { learned, mastered };
  }, [mounted, reviewVersion, cloudVersion, wordbookVersion]);

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
          {srsTotals.learned + srsTotals.mastered > 0 && (
            <p className="tc-substats">
              📗 覚えた {srsTotals.learned} ・ ⭐ マスター {srsTotals.mastered}
            </p>
          )}
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
                  eager={i < 4}
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
