'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { loadHistory, learningStatsByTitle, buildLibraryEntries } from '@/lib/storage';
import { loadFavorites, toggleFavorite } from '@/lib/favorites';
import { fetchSeasons, getCachedSeasons } from '@/lib/collection';
import TicketDetailView from './TicketDetailView';
import TicketPoster from './TicketPoster';
import { previewWorkRemoval, removeWork, undoWorkRemoval, UNDO_MS } from '@/lib/workRemovalStore';
import { removalConfirmLines } from '@/lib/workRemoval';
import { FRAME_TIERS, frameTierOf, raiseFrameBest, loadFrameBest, saveFrameBest } from '@/lib/ticketFrame';

// 半券コレクション（Phase 1：一覧画面）。
// 学習履歴を作品単位に集約し、チケット型カードで「学習したドラマの記録」を見せる。
// 総話数・進捗% は TMDB（cl_total_eps_* キャッシュ）から非同期取得。学習時間は前景計測（今から）。
// 「視聴中／完了」は廃止（2026-10-31 オーナー「くくりが謎」）。完了の基準が「単語リストを作った話数 ≥ 総話数」で、
// 映画は1回で完了・総話数が取れない作品は永遠に視聴中、と学習の実感と噛み合わなかった。
const FILTERS = [
  ['all', 'すべて'],
  ['fav', '★ お気に入り'],
];

// 表示の切り替え（半券／ポスター壁）。端末ごとの好みなので localStorage に置く（同期しない）。
// 既定はポスター（オーナー 2026-11-10）。自分で選んだ端末はその選択のまま。
const VIEW_KEY = 'cl_ticket_view';
const VIEWS = [
  ['poster', '🖼 ポスター'],
  ['ticket', '🎟 半券'],
];

const POSTER_COLORS = ['#E50914', '#1A73E8', '#2E7D32', '#7B1FA2', '#E65100', '#00695C', '#AD1457'];

export default function TicketCollectionScreen() {
  const {
    settings,
    updateSettings,
    openDrama,
    mounted,
    profile,
    reviewVersion,
    cloudVersion,
    wordbookVersion,
    collectionTabTick,
    bumpWordbook,
    setScreen,
  } = useApp();

  const [favs, setFavs] = useState([]);
  const [seasonsMap, setSeasonsMap] = useState({}); // tmdbId → { total, seasons }
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('added');
  const [view, setView] = useState('poster');
  const [frameBest, setFrameBest] = useState({}); // 作品タイトル → 届いた額縁の段階（上がるだけ）
  const [detailTitle, setDetailTitle] = useState(null); // 開いている作品詳細（タイトル）
  const [framesOpen, setFramesOpen] = useState(false); // 「額縁について」のシート
  // 作品詳細で下の「コレクション」タブを押したら一覧へ（「‹」と同じ戻り方。一覧の表示中は何も起きない）。
  useEffect(() => {
    setDetailTitle(null);
  }, [collectionTabTick]);
  // 詳細を開く前に見ていた一覧の位置へ戻す（「‹」もタブも・オーナー 2026-11-05）。
  //   別のタブへ移るとこの画面ごと消えるので、開き直した時は今までどおり一番上から。
  const listScrollY = useRef(null);
  const openDetail = (title) => {
    listScrollY.current = window.scrollY;
    setDetailTitle(title);
  };
  useLayoutEffect(() => {
    if (detailTitle !== null || listScrollY.current === null) return;
    window.scrollTo(0, listScrollY.current);
    listScrollY.current = null;
  }, [detailTitle]);
  // コレクションから消去（lib/workRemovalStore.js）。確認 → 消去（詳細を閉じて一覧へ）→ 8秒「元に戻す」。
  const [removeAsk, setRemoveAsk] = useState(null); // { title, lines } 確認画面
  const [undoBar, setUndoBar] = useState(null); // { title, id } 元に戻すの帯
  const askRemove = async (title) => {
    const plan = await previewWorkRemoval(title, profile?.id);
    setRemoveAsk({ title, lines: removalConfirmLines(plan.counts) });
  };
  const doRemove = async () => {
    const title = removeAsk?.title;
    setRemoveAsk(null);
    if (!title) return;
    await removeWork(title, profile?.id);
    setDetailTitle(null);
    bumpWordbook();
    setUndoBar({ title, id: Date.now() });
  };
  const doUndo = () => {
    if (undoWorkRemoval()) bumpWordbook();
    setUndoBar(null);
  };
  useEffect(() => {
    if (!undoBar) return undefined;
    const t = setTimeout(() => setUndoBar(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undoBar]);
  // 額縁のシートが出ている間は、うしろのスクロールと「引っ張って更新」を止める（入場のシートと同じ cl-sheet-lock）。
  useLayoutEffect(() => {
    if (!framesOpen) return undefined;
    const root = document.documentElement;
    root.classList.add('cl-sheet-lock');
    return () => root.classList.remove('cl-sheet-lock');
  }, [framesOpen]);
  useEffect(() => {
    if (!framesOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setFramesOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [framesOpen]);
  const attemptedPosters = useRef(new Set()); // 重複fetch防止
  const [posterOverrides, setPosterOverrides] = useState({}); // title → posterPath（表示補完）

  useEffect(() => {
    setFavs(loadFavorites(profile?.id));
    setFrameBest(loadFrameBest(profile?.id));
  }, [profile]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'ticket' || v === 'poster') setView(v);
    } catch {
      /* ignore */
    }
  }, []);
  const changeView = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

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
        learnedWords: stats.get(title)?.learned || 0,
        masteredWords: stats.get(title)?.mastered || 0,
        addedDate: firstDate.get(title) || e.lastDate || '',
      };
    });
  }, [mounted, settings.myDramas, reviewVersion, cloudVersion, wordbookVersion]);

  // 総話数・シーズン構成を TMDB から非同期取得。キャッシュ済みは即適用、
  // 未キャッシュは同時4件のプールで並列取得（直列N連の初回待ちを解消＝engineer指摘の本丸）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 偽ID検出: tmdbId の中身（TMDBの作品名）とチケットのタイトルが緩一致しなければ、
      // 同期事故で紛れ込んだ別作品のIDと判定して外す（→解決器が正しく再解決・クラウドにも伝搬）。
      // 実例: Toy Story 4 にクレしん外伝TVのIDが付き52話と表示された（2026-07-03）。
      const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/g, '');
      const idMatchesTitle = (sj, e) => {
        if (!sj || !Array.isArray(sj.names) || !sj.names.length) return true; // 照合材料なし=判定しない
        const expects = [e.title, e.enTitle, e.drama?.englishTitle].map(norm).filter(Boolean);
        if (!expects.length) return true;
        return sj.names.some((n) => {
          const nn = norm(n);
          return nn && expects.some((x) => nn.includes(x) || x.includes(nn));
        });
      };
      const badTitles = [];
      const toFetch = [];
      const cachedUpdates = {};
      for (const e of entries) {
        if (!e.tmdbId || e.isMovie || seasonsMap[e.tmdbId]) continue;
        const cached = getCachedSeasons(e.tmdbId);
        if (cached) {
          if (idMatchesTitle(cached, e)) cachedUpdates[e.tmdbId] = cached;
          else badTitles.push(e.title);
        } else toFetch.push(e);
      }
      if (Object.keys(cachedUpdates).length) setSeasonsMap((m) => ({ ...m, ...cachedUpdates }));
      const CONC = 4;
      for (let i = 0; i < toFetch.length && !cancelled; i += CONC) {
        const chunk = toFetch.slice(i, i + CONC);
        const results = await Promise.all(
          chunk.map((e) => fetchSeasons(e.tmdbId, false).then((r) => [e, r]))
        );
        if (cancelled) return;
        const upd = {};
        for (const [e, r] of results) {
          if (!r) continue;
          if (idMatchesTitle(r, e)) upd[e.tmdbId] = r;
          else badTitles.push(e.title);
        }
        if (Object.keys(upd).length) setSeasonsMap((m) => ({ ...m, ...upd }));
      }
      // 偽IDを持つ作品: myDramas から tmdbId/posterPath を剥がして再解決に回す。
      if (!cancelled && badTitles.length) {
        const md = [...(settings.myDramas || [])];
        let changed = false;
        md.forEach((d) => {
          if (badTitles.includes(d.title)) {
            delete d.tmdbId;
            delete d.posterPath;
            delete d.type; // 偽マッチ由来のtv/movie判定も捨てて再解決に委ねる
            changed = true;
          }
        });
        badTitles.forEach((t) => attemptedPosters.current.delete(t)); // 解決器の再走を許可
        if (changed) updateSettings({ myDramas: md });
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
                if (!r.poster_path) return false; // 縦のポスターがある候補だけ（backdrop で代用しない・法務 2026-11-12）
                const names = [r.name, r.title, r.original_name, r.original_title].map(norm);
                return names.some((n) => n && nq && (n.includes(nq) || nq.includes(n)));
              });
              if (!hit) return;
              const isMovieHit = hit.media_type === 'movie';
              const imgPath = hit.poster_path;
              const p = `https://image.tmdb.org/t/p/w342${imgPath}`;
              found[e.title] = p;
              const m = md.find((d) => d.title === e.title);
              if (m) {
                m.posterPath = p;
                if (hit.id) m.tmdbId = hit.id;
                m.type = isMovieHit ? 'movie' : 'tv'; // タイトル照合済みのmedia_typeが正
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
        // 半券の PROGRESS＝学習の達成度（覚えた語 / この作品で集めた語）。
        // 旧実装は「単語リストを作った話数 / 総話数」＝観た量で、半券が讃える対象としては
        // 学習の実感と噛み合わなかった（2026-09-21 オーナー指摘）。観た量は TOTAL EPISODES 側が持つ。
        const progress = e.wordCount ? Math.round((e.learnedWords / e.wordCount) * 100) : null;
        const isFav = favs.includes(e.title);
        // ポスター優先順位：解決済み override(w342縦) → myDramas → tmdb キャッシュ(w780)。
        // override はホームと同じ TMDB 検索結果＝表示を home と一致させる。
        const posterPath = posterOverrides[e.title] || e.posterPath || sj?.posterPath || null;
        const frame = FRAME_TIERS[frameTierOf(frameBest, e.title, progress)];
        return { ...e, posterPath, total, progress, isFav, frame };
      }),
    [entries, seasonsMap, favs, posterOverrides, frameBest]
  );

  // 今の達成度で新しい額縁に届いた作品があれば記録する（下げない）。
  useEffect(() => {
    if (!mounted || !entries.length) return;
    const stats = entries.map((e) => ({
      title: e.title,
      progress: e.wordCount ? Math.round((e.learnedWords / e.wordCount) * 100) : null,
    }));
    const { best, changed } = raiseFrameBest(loadFrameBest(profile?.id), stats);
    if (!changed) return;
    saveFrameBest(profile?.id, best);
    setFrameBest(best);
  }, [mounted, entries, profile]);

  // フィルタ→ソート。
  const list = useMemo(() => {
    let l = decorated;
    if (filter === 'fav') l = l.filter((e) => e.isFav);
    return [...l].sort((a, b) => {
      if (sort === 'progress') return (b.progress || 0) - (a.progress || 0);
      if (sort === 'name') return a.enTitle.localeCompare(b.enTitle);
      return (b.addedDate || '').localeCompare(a.addedDate || ''); // added=新しい順
    });
  }, [decorated, filter, sort]);

  // 上の2行目の数字（○作品・単語リスト ○話・覚えた ○・マスター ○）。学習時間は測っていない人が多いので出さない（2026-11-12）。
  const dramaCount = decorated.length;
  const totalStudiedEps = decorated.reduce((a, e) => a + e.studiedEps, 0);

  // 全作品合計の 覚えた/マスター（2026-07-03 実使用フィードバック#11）。
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
  const fmtDate = (s) => (s || '').slice(0, 10).replace(/-/g, '.');

  // 作品詳細（Phase 2）：カードタップで開くサブ画面。お気に入り等と同期させるため
  // タイトルで decorated から引き直す（スナップショットにしない）。
  const detailEntry = detailTitle ? decorated.find((e) => e.title === detailTitle) : null;
  // 確認画面と「元に戻す」の帯（詳細・一覧のどちらにも重ねる）。
  const overlays = (
    <>
      {removeAsk && (
        <div className="modal-overlay wr-overlay" onClick={(e) => e.target === e.currentTarget && setRemoveAsk(null)}>
          <div className="modal-panel wr-panel" role="dialog" aria-modal="true" aria-labelledby="wr-title">
            <h2 className="wr-title" id="wr-title">
              『{removeAsk.title}』をコレクションから消去しますか？
            </h2>
            <ul className="wr-lines">
              {removeAsk.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="wr-actions">
              <button type="button" className="btn-secondary" onClick={() => setRemoveAsk(null)}>
                やめる
              </button>
              <button type="button" className="btn-primary" onClick={doRemove}>
                消去する
              </button>
            </div>
          </div>
        </div>
      )}
      {undoBar && (
        <div className="wr-undo" role="status" key={undoBar.id}>
          <span className="wr-undo-text">『{undoBar.title}』を消去しました</span>
          <button type="button" className="wr-undo-btn" onClick={doUndo}>
            元に戻す
          </button>
        </div>
      )}
    </>
  );

  if (detailEntry) {
    return (
      <>
      {overlays}
      <TicketDetailView
        entry={detailEntry}
        onBack={() => setDetailTitle(null)}
        onFav={onFav}
        onStudy={() => openDrama(detailEntry.drama)}
        onRemove={() => askRemove(detailEntry.title)}
      />
      </>
    );
  }

  const star = (e, cls) => (
    <button
      type="button"
      className={cls + (e.isFav ? ' is-on' : '')}
      onClick={(ev) => {
        ev.stopPropagation();
        onFav(e.title);
      }}
      aria-label={e.isFav ? `『${e.enTitle}』をお気に入りから外す` : `『${e.enTitle}』をお気に入りに入れる`}
      aria-pressed={e.isFav}
    >
      {e.isFav ? '★' : '☆'}
    </button>
  );

  // 額縁つきのポスター（コレクションの .tcp-item.frame-* と同じ・ポスターには何も重ねない＝法務）。
  const framed = (e, i, cls, eager) => (
    <span className={`tcp-item frame-${e.frame.key} ${cls}`}>
      <span className="tcp-frame">
        <span className="tcp-mat">
          <TicketPoster
            src={e.posterPath}
            label={e.enTitle}
            color={POSTER_COLORS[i % POSTER_COLORS.length]}
            eager={eager}
            className="tcp-poster"
            showTitle
          />
        </span>
      </span>
    </span>
  );

  return (
    <div className="screen active" id="screen-collection">
      {overlays}
      <div className="screen-inner cl-screen">
        <div className="cl-head">
          <h1 className="screen-title">コレクション</h1>
          <p className="cl-lead">学習した作品の記録です。</p>
          {dramaCount > 0 && (
            <p className="cl-sum">
              <b>{dramaCount}</b>作品・単語リスト <b>{totalStudiedEps}</b>話・覚えた <b>{srsTotals.learned}</b>・マスター{' '}
              <b>{srsTotals.mastered}</b>
            </p>
          )}
        </div>

        {dramaCount === 0 ? (
          // 0件：額縁の説明は出さない・「作品を探す」で検索画面へ（2026-11-12）。
          <div className="cl-empty">
            <p className="cl-empty-title">まだ作品がありません</p>
            <p className="cl-empty-sub">
              作品を選んで単語リストを作ると、
              <br />
              ここに学習の記録が並びます。
            </p>
            <button type="button" className="btn-primary cl-empty-btn" onClick={() => setScreen('search')}>
              作品を探す
            </button>
          </div>
        ) : (
          <>
            <div className="cl-bar">
              <div className="cl-chips" role="group" aria-label="絞り込み">
                {FILTERS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={'cl-chip' + (filter === k ? ' is-on' : '')}
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="cl-view" role="group" aria-label="表示の切り替え">
                {VIEWS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={'cl-view-btn' + (view === k ? ' is-on' : '')}
                    aria-pressed={view === k}
                    onClick={() => changeView(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="cl-bar2">
              <button type="button" className="cl-frames-link" onClick={() => setFramesOpen(true)}>
                額縁について
              </button>
              <label className="cl-sort">
                並び
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="added">はじめた日</option>
                  <option value="progress">達成度</option>
                  <option value="name">名前</option>
                </select>
              </label>
            </div>

            {list.length === 0 ? (
              <p className="cl-fav-empty">★ を付けた作品が、ここに並びます。</p>
            ) : view === 'poster' ? (
              <div className="cl-wall">
                {list.map((e, i) => (
                  <div className="cl-cell" key={e.title}>
                    <button
                      type="button"
                      className="cl-cell-open"
                      onClick={() => openDetail(e.title)}
                      aria-label={`${e.enTitle}（${e.frame.label}の額縁${e.progress != null ? `・達成度 ${e.progress}%` : ''}）`}
                    >
                      {framed(e, i, 'cl-cell-ps', i < 9)}
                    </button>
                    <div className="cl-cap">
                      <button type="button" className="cl-cap-name" onClick={() => openDetail(e.title)} tabIndex={-1}>
                        {e.enTitle}
                      </button>
                      {e.progress != null && <span className="cl-cap-pct">{e.progress}%</span>}
                      {star(e, 'cl-star')}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cl-tickets">
                {list.map((e, i) => (
                  <div
                    key={e.title}
                    className="cl-tkt"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(e.title)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        openDetail(e.title);
                      }
                    }}
                    aria-label={`${e.enTitle}の詳細`}
                  >
                    {framed(e, i, 'cl-tkt-ps', i < 4)}
                    <div className="cl-tkt-body">
                      <span className="cl-tkt-kicker">ADMIT ONE</span>
                      <span className="cl-tkt-title">{e.enTitle}</span>
                      <span className="cl-tkt-meta">
                        単語リスト {e.studiedEps}話{e.addedDate ? `・${fmtDate(e.addedDate)}〜` : ''}
                      </span>
                    </div>
                    <div className="cl-tkt-stub">
                      <span className="cl-tkt-stub-label">達成度</span>
                      <span className="cl-tkt-stub-num">{e.progress != null ? `${e.progress}%` : '—'}</span>
                    </div>
                    {star(e, 'cl-star cl-tkt-star')}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 額縁について（押した時だけ・スマホは下から・PC は真ん中） */}
      {framesOpen && (
        <div className="cl-sheet-shade" onClick={() => setFramesOpen(false)}>
          <div className="cl-sheet" role="dialog" aria-modal="true" aria-labelledby="cl-frames-title" onClick={(ev) => ev.stopPropagation()}>
            <div className="cl-sheet-head">
              <h2 id="cl-frames-title">額縁について</h2>
              <button type="button" className="cl-sheet-x" onClick={() => setFramesOpen(false)} aria-label="閉じる">
                ✕
              </button>
            </div>
            <div className="cl-frames">
              {FRAME_TIERS.slice(1).map((t) => (
                <div className="cl-frames-item" key={t.key}>
                  <span className={`tcp-item frame-${t.key}`}>
                    <span className="tcp-frame">
                      <span className="tcp-mat">
                        <span className="cl-frames-blank" />
                      </span>
                    </span>
                  </span>
                  <span className="cl-frames-label">
                    {t.label} {t.min}%
                  </span>
                </div>
              ))}
            </div>
            <p className="cl-frames-note">覚えた語の割合で変わります。一度届いた額縁は戻りません。</p>
          </div>
        </div>
      )}
    </div>
  );
}
