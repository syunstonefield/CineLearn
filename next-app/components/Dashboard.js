'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import TodayPanel from './TodayPanel';
import VocabProgress from './VocabProgress';
import HomeStubCard from './HomeStubCard';
import LibraryCard from './LibraryCard';
import ContinueCard from './ContinueCard';
import AddDramaModal from './AddDramaModal';
import RecommendGrid from './RecommendGrid';
import { getRecommendations } from '@/lib/recommended';
import { isMobileDevice } from '@/lib/device';
import { tmdb } from '@/lib/api';
import {
  DAILY_REVIEW_CAP,
  archiveDrama,
  buildLibraryEntries,
  getAllVocabWords,
  getDueReviewWords,
  getStreak,
  getWeekStats,
  learningStatsByTitle,
  loadArchived,
  loadHistory,
} from '@/lib/storage';

// まだ Next.js 版に移植していない画面・機能の仮ハンドラ
function notYet(name) {
  alert(`「${name}」は次のステップで移植予定です（Next.js版 試作中）`);
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
    openGuide,
    tickets,
    openSceneCards,
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
  // 進捗バー用のシーズン別話数（{ season番号: 話数 }）。posterOverrides と同じく override で補完。
  const attemptedEpisodes = useRef(new Set());
  const [episodeOverrides, setEpisodeOverrides] = useState({}); // title → seasonCounts
  // ドラマ追加モーダル（null=閉、{tab, query}=開）
  const [addModal, setAddModal] = useState(null);
  // 「続きから学習」を全部見るか（既定は2件・それ以上は「すべて見る」で展開）
  const [showAllContinue, setShowAllContinue] = useState(false);

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
      return { history: [], entries: [], learnStats: new Map(), totalLearned: 0, totalMastered: 0, totalWords: 0, streak: 0, hasAnyWord: false, dueCount: 0, weekStats: { reviewedThisWeek: 0, mastered: 0 } };
    }
    const history = loadHistory();
    const archived = new Set(loadArchived()); // 「棚から外した」作品は一覧から隠す（履歴は残す）
    // 全作品合算の「覚えた／マスター」語数（ホームの達成感＝復習モチベ用）。per-drama統計と同じ数え方で集計。
    const learnStats = learningStatsByTitle(history);
    let totalLearned = 0;
    let totalMastered = 0;
    let totalWords = 0;
    learnStats.forEach((s) => {
      totalLearned += s.learned;
      totalMastered += s.mastered;
      totalWords += s.total;
    });
    return {
      history,
      entries: buildLibraryEntries(history, myDramas).filter((e) => !archived.has(e.drama.title)),
      learnStats,
      totalLearned,
      totalMastered,
      totalWords,
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
        // 縦長カード化に伴い、未設定/旧縦長(w500)に加えて横長(w780)も縦ポスター(w342)へ取り直す
        (!d.drama.posterPath ||
          d.drama.posterPath.includes('/w500') ||
          d.drama.posterPath.includes('/w780')) &&
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

          // 縦長カード用に縦ポスター(poster_path)を優先。無ければ横長で代替。
          const imgPath = hit.poster_path || hit.backdrop_path;
          const p = `https://image.tmdb.org/t/p/w342${imgPath}`;
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

  // シーズン別話数（進捗バーの分母）を tmdbId のある作品だけ取得する。映画は対象外。
  // /tv/{id} の seasons[].episode_count から { season番号: 話数 } を作る（Specials=0は除外）。
  // 取得結果は myDramas（posterPath と同じく）へ永続化＋ override で表示補完する。
  useEffect(() => {
    const missing = data.entries.filter(
      (e) =>
        e.drama.tmdbId &&
        e.drama.type !== 'movie' &&
        !e.drama.seasonCounts &&
        !episodeOverrides[e.drama.title] &&
        !attemptedEpisodes.current.has(e.drama.title)
    );
    if (!missing.length) return;
    missing.forEach((m) => attemptedEpisodes.current.add(m.drama.title));

    (async () => {
      const found = {}; // title → seasonCounts
      const md = [...myDramas];
      let mdChanged = false;
      for (const { drama } of missing) {
        try {
          const d = await tmdb({ action: 'seasons', tvId: drama.tmdbId });
          const seasons = Array.isArray(d?.seasons) ? d.seasons : [];
          const counts = {};
          seasons.forEach((s) => {
            // Specials(season 0)は除外。本編シーズンのみ分母に使う。
            if (s.season_number > 0 && s.episode_count > 0) counts[s.season_number] = s.episode_count;
          });
          if (Object.keys(counts).length) {
            found[drama.title] = counts;
            const m = md.find((x) => x.title === drama.title);
            if (m) {
              m.seasonCounts = counts;
              mdChanged = true;
            }
          }
        } catch {
          /* 取得失敗は無視（バー非表示のまま） */
        }
      }
      if (Object.keys(found).length) setEpisodeOverrides((prev) => ({ ...prev, ...found }));
      if (mdChanged) updateSettings({ myDramas: md });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 取得済みポスター・全話数をカードに適用（履歴由来カードは drama オブジェクトが
  // 再生成されるため、override で都度補完する）。縦ポスターへ取り直した既存カードも
  // override で上書きして表示を差し替える。
  const entries = data.entries.map((e) => {
    const poster = posterOverrides[e.drama.title];
    const seasonCounts = episodeOverrides[e.drama.title];
    if (!poster && !seasonCounts) return e;
    return {
      ...e,
      drama: {
        ...e.drama,
        ...(poster ? { posterPath: poster } : {}),
        ...(seasonCounts ? { seasonCounts } : {}),
      },
    };
  });

  // サブスク風に「続き（学習中）」と「マイリスト（未着手）」へ二分し、続きは最終学習日の新しい順。
  const continueEntries = entries
    .filter((e) => e.episodes.length > 0)
    .sort((a, b) => String(b.lastDate || '').localeCompare(String(a.lastDate || '')));
  const listEntries = entries.filter((e) => e.episodes.length === 0);

  // 空のダッシュボード（履歴・ライブラリ0件）で中央に出すおすすめ6件
  const recommendItems = useMemo(
    () => getRecommendations(settings.userLevel || 'B1', settings.selectedServices || []),
    [settings.userLevel, settings.selectedServices]
  );

  // 棚から外す（アーカイブ）。学習記録（単語・スコア・履歴）は残し、一覧から隠すだけ。
  // 同じ作品を開き直せば自動で棚に戻る（openDrama の unarchiveDrama）。
  const handleArchive = (title) => {
    if (!confirm(`「${title}」を棚から外しますか？\n学習記録（単語・スコア）は残ります。`)) return;
    archiveDrama(title);
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
        onStartReview={() => {
          // 横断復習（特定エピソードに紐づかない）→ historyId は null
          setCurrentHistoryId(null);
          openReview(getDueReviewWords().slice(0, DAILY_REVIEW_CAP));
        }}
      />

      {/* 累計の語彙進捗（別枠）。今日の復習とは分けて「これまでの積み上げ」を見せる。 */}
      <VocabProgress learned={data.totalLearned} mastered={data.totalMastered} total={data.totalWords} />

      {/* 半券（観た証）＝観た後に戻る入口。シーン記憶カードへ。最新1枚だけ出して混雑を避ける。 */}
      {(() => {
        const withWords = (tickets || []).filter((t) => (t.words || []).length > 0);
        if (!withWords.length) return null;
        const latest = withWords[withWords.length - 1];
        const poster =
          posterOverrides[latest.title] ||
          myDramas.find((d) => d.title === latest.title)?.posterPath ||
          entries.find((e) => e.drama.title === latest.title)?.drama.posterPath ||
          null;
        return (
          <>
            <h2 className="home-section-title">おすすめの復習</h2>
            <div className="stub-row">
              <HomeStubCard ticket={latest} poster={poster} onOpen={openSceneCards} />
            </div>
          </>
        );
      })()}

      {/* 検索・ジャンル別検索・おすすめ・作品追加はすべてヘッダーの「＋」モーダルへ集約。
          ホームのツールバーは撤去して散らかりを減らす（おすすめは下のセクションにも残す）。 */}

      {entries.length === 0 ? (
        <div id="dramaLibrary" className="drama-library">
          {/* 履歴・ライブラリが空 → 中央におすすめ（横スクロール行で「サブスク風」に） */}
          <div className="library-empty recommend-empty-wrap">
            <div className="recommend-heading">🎬 気になる作品を選んで始めましょう</div>
            <div className="recommend-subheading">あなたのレベルと契約サービスに合った人気作品です</div>
            <RecommendGrid items={recommendItems} onPick={startFromRecommend} userLevel={settings.userLevel || 'B1'} variant="row" />
          </div>
        </div>
      ) : (
        <div id="dramaLibrary" className="library-sections">
          {continueEntries.length > 0 && (
            <section className="library-section">
              <div className="library-section-head">
                <h2 className="library-section-title">続きから学習</h2>
                {continueEntries.length > 2 && (
                  <button
                    type="button"
                    className="section-see-all"
                    onClick={() => setShowAllContinue((s) => !s)}
                  >
                    {showAllContinue ? '閉じる' : 'すべて見る →'}
                  </button>
                )}
              </div>
              <div className="continue-list">
                {(showAllContinue ? continueEntries : continueEntries.slice(0, 2)).map((entry) => (
                  <ContinueCard
                    key={entry.drama.title}
                    entry={entry}
                    stats={data.learnStats.get(entry.drama.title)}
                    onSelect={(drama) => openDrama(drama)}
                    onArchive={handleArchive}
                  />
                ))}
              </div>
            </section>
          )}
          {listEntries.length > 0 && (
            <section className="library-section">
              <h2 className="library-section-title">🎬 マイリスト</h2>
              <div className="library-grid">
                {listEntries.map((entry) => (
                  <LibraryCard
                    key={entry.drama.title}
                    entry={entry}
                    stats={data.learnStats.get(entry.drama.title)}
                    onSelect={(drama) => openDrama(drama)}
                    onArchive={handleArchive}
                  />
                ))}
              </div>
            </section>
          )}
          {recommendItems.length > 0 && (
            <section className="library-section">
              <h2 className="library-section-title">✨ おすすめ</h2>
              <RecommendGrid
                items={recommendItems}
                onPick={startFromRecommend}
                userLevel={settings.userLevel || 'B1'}
                variant="mini"
              />
            </section>
          )}
        </div>
      )}

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
