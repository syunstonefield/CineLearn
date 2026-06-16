'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import TodayPanel from './TodayPanel';
import LibraryCard from './LibraryCard';
import AddDramaModal from './AddDramaModal';
import RecommendGrid from './RecommendGrid';
import { getRecommendations } from '@/lib/recommended';
import { aiResolveTitles } from '@/lib/recommend';
import { isMobileDevice } from '@/lib/device';
import {
  DAILY_REVIEW_CAP,
  buildLibraryEntries,
  deleteDramaLocal,
  getAllVocabWords,
  getDueReviewWords,
  getStreak,
  getWeekStats,
  loadHistory,
} from '@/lib/storage';

// まだ Next.js 版に移植していない画面・機能の仮ハンドラ
function notYet(name) {
  alert(`「${name}」は次のステップで移植予定です（Next.js版 試作中）`);
}

// ── タイトル検索（TMDB search_multi）の共通ユーティリティ ──
const tmdbImg = (p, size) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

// TMDBの1結果（映画/TV）を候補オブジェクトに正規化
function mapTmdbResult(r) {
  const isMovie = r.media_type === 'movie';
  const en = isMovie ? r.original_title || r.title : r.original_name || r.name;
  const loc = isMovie ? r.title : r.name;
  const date = isMovie ? r.release_date : r.first_air_date;
  return {
    tmdbId: r.id,
    mediaType: r.media_type, // 'movie' | 'tv'
    title: en,
    englishTitle: en,
    localizedTitle: loc,
    year: (date || '').slice(0, 4),
    posterPath: tmdbImg(r.poster_path, 'w185'),
  };
}

// 関連度スコア：人気×投票数を基礎に、タイトル一致とポスター有無で補正してノイズを後ろへ
function scoreTmdbResult(r, ql) {
  const isMovie = r.media_type === 'movie';
  const en = (isMovie ? r.original_title || r.title : r.original_name || r.name || '').toLowerCase();
  let s = (r.popularity || 0) * Math.log10((r.vote_count || 0) + 10);
  if (en === ql) s *= 6;
  else if (en.startsWith(ql)) s *= 2.5;
  else if (en.includes(ql)) s *= 1.3;
  s *= r.poster_path ? 1.5 : 0.5;
  return s;
}

// 映画/TVのみ＆アダルト除外
function isWantedResult(r) {
  return (r.media_type === 'movie' || r.media_type === 'tv') && !r.adult && !r.softcore;
}

export default function Dashboard() {
  const {
    profile,
    settings,
    updateSettings,
    openDrama,
    mounted,
    openReview,
    setCurrentHistoryId,
    reviewVersion,
    pendingAddDrama,
    setPendingAddDrama,
    cloudVersion,
    startFromRecommend,
    openRecommend,
    openGuide,
  } = useApp();
  const [tick, setTick] = useState(0); // 再読込トリガ
  // 拡張機能の導入バナー（最初の関門対策で常設）。拡張未検出の判定はできないため、
  // インストール済みの人向けに×で消せる（消去は端末ローカルに記憶）。
  const [extBannerDismissed, setExtBannerDismissed] = useState(true); // SSR/初回は隠す
  // モバイル（iOS/Android）では Chrome 拡張を入れられないため、インストール導線ではなく
  // 「予習・復習用」の説明に切り替える。SSR/初回は false（デスクトップ扱い）で統一。
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(isMobileDevice());
    try {
      setExtBannerDismissed(localStorage.getItem('cl_ext_banner_dismissed') === '1');
    } catch {
      setExtBannerDismissed(false);
    }
  }, []);
  const dismissExtBanner = () => {
    try {
      localStorage.setItem('cl_ext_banner_dismissed', '1');
    } catch {
      /* ignore */
    }
    setExtBannerDismissed(true);
  };
  // ポスター取得を試みたタイトル（重複fetch防止）。取得結果は overrides に保持し、
  // 履歴由来のカード（posterPathが永続化されない）でも表示が消えないようにする。
  const attemptedPosters = useRef(new Set());
  const [posterOverrides, setPosterOverrides] = useState({}); // title → posterPath
  // ドラマ追加モーダル（null=閉、{tab, query}=開）
  const [addModal, setAddModal] = useState(null);

  // ── タイトル検索のインライン候補（オートコンプリート） ──
  // 入力中: TMDB即時検索（速い）／Enter: AIで検索語を解釈→TMDB確認（賢い）のハイブリッド。
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [aiMode, setAiMode] = useState(false); // EnterでAI解釈検索を実行中/実行後
  const searchBoxRef = useRef(null);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    setSuggestLoading(true);
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        // search_multi: 映画＋TVを横断検索（language=en-US で英語タイトルが返る）
        const res = await fetch('/api/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'search_multi', query: q }),
        });
        const json = await res.json();
        if (!alive) return;
        const ql = q.toLowerCase();
        // アダルト/映画TV外を除外し、人気×投票数＋タイトル一致＋ポスター有無で関連度順に。
        const items = (json.results || [])
          .filter(isWantedResult)
          .map((r) => ({ r, score: scoreTmdbResult(r, ql) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map(({ r }) => mapTmdbResult(r));
        setSuggestions(items);
      } catch {
        if (alive) setSuggestions([]);
      } finally {
        if (alive) setSuggestLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const pickSuggestion = (s) => {
    setSuggestOpen(false);
    setSearchQuery('');
    setSuggestions([]);
    const mt = s.mediaType === 'movie' ? 'movie' : 'tv';
    openDrama(
      {
        title: s.title,
        englishTitle: s.englishTitle,
        tmdbId: s.tmdbId,
        posterPath: s.posterPath ? s.posterPath.replace('/w185', '/w780') : null,
        type: mt, // 下流（字幕キー・VocabScreen）の主判定
        mediaType: mt, // 映画/ドラマ解決のヒント
        level: settings.userLevel || 'B1',
        platform: '',
        genre: '',
        reason: '',
      },
      true
    );
  };

  // Enter押下時：検索語をAIで解釈→正規の英語タイトル候補を得て、各タイトルをTMDBで実在確認。
  // 曖昧・日本語・うろ覚え・タイポ入力をここで救う（入力中のTMDB即時検索とは別経路）。
  const aiSearchSeq = useRef(0);
  const runAiSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    const seq = ++aiSearchSeq.current;
    setAiMode(true);
    setSuggestOpen(true);
    setSuggestLoading(true);
    try {
      const titles = await aiResolveTitles(q);
      if (seq !== aiSearchSeq.current) return; // 古い結果は破棄
      if (!titles.length) {
        setSuggestions([]);
        return;
      }
      // 各タイトルをTMDBで確認（並列）→ タイトル一致優先で最良の1件を採用
      const hits = await Promise.all(
        titles.map(async (t) => {
          try {
            const res = await fetch('/api/tmdb', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'search_multi', query: t }),
            });
            const j = await res.json();
            const tl = t.toLowerCase();
            const cands = (j.results || []).filter(isWantedResult);
            if (!cands.length) return null;
            cands.sort((a, b) => scoreTmdbResult(b, tl) - scoreTmdbResult(a, tl));
            return mapTmdbResult(cands[0]);
          } catch {
            return null;
          }
        })
      );
      if (seq !== aiSearchSeq.current) return;
      const seen = new Set();
      const items = hits.filter((it) => it && !seen.has(it.tmdbId) && seen.add(it.tmdbId));
      setSuggestions(items);
    } catch {
      // AI失敗時は直前のTMDB候補のまま据え置き
    } finally {
      if (seq === aiSearchSeq.current) setSuggestLoading(false);
    }
  };

  useEffect(() => {
    if (!suggestOpen) return;
    const onDoc = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [suggestOpen]);

  // オンボーディング完了直後はドラマ追加モーダルを検索タブで開く（既存 finishOnboarding 相当）
  useEffect(() => {
    if (pendingAddDrama) {
      setAddModal(pendingAddDrama);
      setPendingAddDrama(null);
    }
  }, [pendingAddDrama, setPendingAddDrama]);

  const myDramas = settings.myDramas || [];

  // localStorage 由来の集計（マウント後のみ・profile/myDramas/tick で再計算）。
  // SSR/初回レンダーは空で統一してハイドレーション不一致を防ぐ。
  const data = useMemo(() => {
    if (!mounted) {
      return { history: [], entries: [], streak: 0, hasAnyWord: false, dueCount: 0, weekStats: { reviewedThisWeek: 0, mastered: 0 } };
    }
    const history = loadHistory();
    return {
      history,
      entries: buildLibraryEntries(history, myDramas),
      streak: getStreak(),
      hasAnyWord: getAllVocabWords(history).length > 0,
      dueCount: getDueReviewWords(history).length,
      weekStats: getWeekStats(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, profile, myDramas, tick, reviewVersion, cloudVersion]);

  // posterPath が未設定 or 古い縦長画像（w500）のドラマを再取得。
  // クラウド pull で後からドラマが増えても（cloudVersion 経由で data が変わる）
  // 未試行タイトルだけ追加で取得する。
  useEffect(() => {
    const missing = data.entries.filter(
      (d) =>
        (!d.drama.posterPath || d.drama.posterPath.includes('/w500')) &&
        !attemptedPosters.current.has(d.drama.title)
    );
    if (!missing.length) return;
    missing.forEach((m) => attemptedPosters.current.add(m.drama.title));

    (async () => {
      const found = {}; // title → posterPath
      const md = [...myDramas];
      let mdChanged = false;
      for (const { drama } of missing) {
        try {
          const res = await fetch('/api/tmdb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'search', query: drama.englishTitle || drama.title }),
          });
          const json = await res.json();
          const hit = json.results?.[0];
          if (!hit?.backdrop_path && !hit?.poster_path) continue;

          const imgPath = hit.backdrop_path || hit.poster_path;
          const p = `https://image.tmdb.org/t/p/w780${imgPath}`;
          found[drama.title] = p;

          const m = md.find((d) => d.title === drama.title);
          if (m) {
            m.posterPath = p;
            if (hit.id) m.tmdbId = hit.id;
            mdChanged = true;
          }
        } catch {
          /* 取得失敗は無視 */
        }
      }
      if (Object.keys(found).length) setPosterOverrides((prev) => ({ ...prev, ...found }));
      if (mdChanged) updateSettings({ myDramas: md }); // 永続化は myDramas のみ（既存 saveSettings と同じ）
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 取得済みポスターをカードに適用（履歴由来カードは drama オブジェクトが
  // 再生成されるため、override で都度補完する）
  const entries = data.entries.map((e) =>
    !e.drama.posterPath && posterOverrides[e.drama.title]
      ? { ...e, drama: { ...e.drama, posterPath: posterOverrides[e.drama.title] } }
      : e
  );

  // 空のダッシュボード（履歴・ライブラリ0件）で中央に出すおすすめ6件
  const recommendItems = useMemo(
    () => getRecommendations(settings.userLevel || 'B1', settings.selectedServices || []),
    [settings.userLevel, settings.selectedServices]
  );

  const handleDelete = (title) => {
    if (!confirm(`「${title}」をライブラリから削除しますか？\n学習履歴もすべて消えます。`)) return;
    deleteDramaLocal(title);
    updateSettings({ myDramas: myDramas.filter((d) => d.title !== title) });
    setTick((t) => t + 1);
  };

  return (
    <div className="screen active" id="screen-main">
      {!extBannerDismissed &&
        (isMobile ? (
          // モバイルは拡張機能を入れられない → 「今すぐ入れる」ではなく、PC向け手順への
          // リンクとして残す（あとでPCで導入できるよう案内）。
          <div className="ext-banner ext-banner-info">
            <span className="ext-banner-icon" aria-hidden="true">📱</span>
            <span className="ext-banner-text">
              ドラマ・映画を視聴中に字幕の単語をクリックして保存するにはPCでChrome拡張導入が必要です。スマホは予習・復習・テストに使えます。
            </span>
            <button className="ext-banner-btn" onClick={openGuide}>
              PCへの導入手順はこちら →
            </button>
            <button className="ext-banner-close" onClick={dismissExtBanner} aria-label="バナーを閉じる">
              ✕
            </button>
          </div>
        ) : (
          <div className="ext-banner">
            <span className="ext-banner-icon" aria-hidden="true">🧩</span>
            <span className="ext-banner-text">
              Netflixなどで単語を集めるには、無料の拡張機能が必要です
            </span>
            <button className="ext-banner-btn" onClick={openGuide}>
              入れ方を見る →
            </button>
            <button className="ext-banner-close" onClick={dismissExtBanner} aria-label="バナーを閉じる">
              ✕
            </button>
          </div>
        ))}

      <TodayPanel
        streak={data.streak}
        hasAnyWord={data.hasAnyWord}
        todayCount={Math.min(data.dueCount, DAILY_REVIEW_CAP)}
        weekStats={data.weekStats}
        onStartReview={() => {
          // 横断復習（特定エピソードに紐づかない）→ historyId は null
          setCurrentHistoryId(null);
          openReview(getDueReviewWords().slice(0, DAILY_REVIEW_CAP));
        }}
      />

      <div className="main-toolbar">
        <div className="toolbar-search-wrap" ref={searchBoxRef}>
          <div className="toolbar-search">
            <input
              type="text"
              id="mainSearchInput"
              placeholder="ドラマのタイトルで検索..."
              autoComplete="off"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setAiMode(false); // 入力が変わったら即時TMDB検索に戻す
                setSuggestOpen(true);
              }}
              onFocus={() => {
                if (suggestions.length) setSuggestOpen(true);
              }}
              onKeyDown={(e) => {
                // Enter は「AIで解釈して検索」。作品選択はクリックのみ（自動選択しない）。
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runAiSearch();
                }
                if (e.key === 'Escape') setSuggestOpen(false);
              }}
            />
            <button
              type="button"
              className="btn-icon-search"
              aria-label="検索"
              onClick={() => runAiSearch()}
            >
              🔍
            </button>
          </div>
          {suggestOpen && searchQuery.trim().length >= 2 && (
            <div className="search-suggest">
              {suggestLoading && (
                <div className="search-suggest-msg">{aiMode ? '🤖 AIが候補を考えています…' : '検索中…'}</div>
              )}
              {!suggestLoading && aiMode && suggestions.length > 0 && (
                <div className="search-suggest-aihint">🤖 AIが解釈した候補（Enter検索）</div>
              )}
              {!suggestLoading && suggestions.length === 0 && (
                <div className="search-suggest-msg">
                  {aiMode ? '該当する作品が見つかりませんでした' : '候補が見つかりません（Enterで詳しく検索）'}
                </div>
              )}
              {suggestions.map((s) => (
                <button
                  key={s.tmdbId}
                  type="button"
                  className="search-suggest-item"
                  onClick={() => pickSuggestion(s)}
                >
                  {s.posterPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="search-suggest-thumb" src={s.posterPath} alt="" />
                  ) : (
                    <span className="search-suggest-thumb search-suggest-thumb-empty">🎬</span>
                  )}
                  <span className="search-suggest-text">
                    <span className="search-suggest-title">{s.englishTitle}</span>
                    {s.localizedTitle && s.localizedTitle !== s.englishTitle && (
                      <span className="search-suggest-sub">{s.localizedTitle}</span>
                    )}
                  </span>
                  <span className={'search-suggest-type ' + (s.mediaType === 'movie' ? 'is-movie' : 'is-tv')}>
                    {s.mediaType === 'movie' ? '映画' : 'ドラマ'}
                  </span>
                  {s.year && <span className="search-suggest-year">{s.year}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* PC: 「ジャンル別検索」(=AI推薦) と「おすすめ」(=RecommendScreen) の2導線。
            モバイルでは下の「＋ドラマを追加」に集約（display制御は style.css）。 */}
        <button
          className="toolbar-btn toolbar-btn-genre toolbar-pc-entry"
          onClick={() => setAddModal({ tab: 'recommend', query: '', variant: 'genre' })}
        >
          ジャンル別検索
        </button>
        <button
          className="toolbar-btn toolbar-btn-reco toolbar-pc-entry"
          onClick={openRecommend}
        >
          ✨ おすすめ
        </button>
        {/* モバイル専用：両導線を含むモーダルを開く単一ボタン */}
        <button
          className="btn-primary btn-add-drama"
          onClick={() => setAddModal({ tab: 'recommend', query: '' })}
        >
          ＋ ドラマを追加
        </button>
      </div>

      <div id="dramaLibrary" className="drama-library">
        {entries.length === 0 && (
          // 履歴・ライブラリが空 → 中央におすすめ6件（仕様：空のダッシュボード）
          <div className="library-empty recommend-empty-wrap">
            <div className="recommend-heading">🎬 気になる作品を選んで始めましょう</div>
            <div className="recommend-subheading">あなたのレベルと契約サービスに合った人気作品です</div>
            <RecommendGrid items={recommendItems} onPick={startFromRecommend} userLevel={settings.userLevel || 'B1'} />
          </div>
        )}
        {entries.map((entry) => (
          <LibraryCard
            key={entry.drama.title}
            entry={entry}
            onSelect={(drama) => openDrama(drama)}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {addModal && (
        <AddDramaModal
          initialTab={addModal.tab}
          initialQuery={addModal.query}
          variant={addModal.variant || 'full'}
          onClose={() => setAddModal(null)}
        />
      )}
    </div>
  );
}
