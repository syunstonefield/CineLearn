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
import { computeRecap, computeWatchGroup } from '@/lib/reunion';
import { confirmWatch, isWatchConfirmed, isWatchSnoozed, snoozeWatchPrompt, watchEpKey } from '@/lib/watchlog';
import { speak } from '@/lib/speak';
import { fetchCtxJa } from '@/lib/ctxtranslate';
import { fetchJa } from '@/lib/jatranslate';
import { getActiveWords } from '@/lib/words';
import {
  DAILY_REVIEW_CAP,
  archiveDrama,
  buildLibraryEntries,
  getAllVocabWords,
  getDueReviewWords,
  getStreak,
  getWeekStats,
  isLearned,
  learningStatsByTitle,
  loadArchived,
  loadHistory,
  loadSrs,
} from '@/lib/storage';

// まだ Next.js 版に移植していない画面・機能の仮ハンドラ
function notYet(name) {
  alert(`「${name}」は次のステップで移植予定です（Next.js版 試作中）`);
}

// 再会の出どころ表示（チップ・単語カード共用）。場面メタ > 日数 > 回数 の順で具体的に。
function pastLabel(past) {
  if (past.title) {
    return `『${past.title}』${past.season != null ? `S${past.season}E${past.episode}` : ''}以来`;
  }
  if (past.daysSince != null && past.daysSince >= 2) {
    return `${past.daysSince}日ぶり・復習${past.repetitions || 1}回`;
  }
  return `復習で${past.repetitions || 1}回学習済み`;
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

  // 視聴直後リキャップ（語彙リユニオンB案・docs/design-recap-endroll.md）。
  // watchGroup=最新の保存グループ（質問カードの対象）／recap=そのうち再会が起きた語（祝いの中身）。
  // getActiveWords が非同期（クラウド語の取り込みを含む）ため state で持つ。
  // 課金導入時はここが「リユニオン初回発動」＝サブスクゲートの起点になる（今は全員に無料表示）。
  const [recap, setRecap] = useState(null);
  const [watchGroup, setWatchGroup] = useState(null);
  // 「観終わった」タップ直後の epKey（獲得演出＋localStorage を再読せず祝い状態へ）。
  // boolean でなく epKey で持つ: 表示中にクラウド同期で別エピソードのグループへ替わっても、
  // 未申告の新グループが祝い状態に化けない。
  const [justConfirmed, setJustConfirmed] = useState(null);
  // 「まだ途中」した epKey（この画面滞在中の抑止・セッション跨ぎは sessionStorage の snooze が担う）
  const [askDismissed, setAskDismissed] = useState(null);
  // 旧形式の保存語の表示補完（v1.2.2以前=ja無し→英英定義に落ちる／ごく初期=sentence無し→例文空）。
  // wordLower → { ja?, example? }。祝い状態になってから非同期で埋める。
  const [wordFills, setWordFills] = useState({});
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    getActiveWords(profile?.id)
      .then((words) => {
        if (cancelled) return;
        // maxItems: Infinity＝グループ全語を分類（v2の単語カード/統計用）。表示側で必要数に絞る。
        setRecap(computeRecap({ words, history: loadHistory(), srs: loadSrs(), maxItems: Infinity }));
        setWatchGroup(computeWatchGroup({ words }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, profile, tick, cloudVersion, reviewVersion]);

  const myDramas = settings.myDramas || [];

  // 質問カード用メタ: epKey は半券と同キー体系（保存語は tmdbId を持たないため myDramas から補完）
  const watchMeta = useMemo(() => {
    if (!watchGroup) return null;
    const tmdbId = myDramas.find((d) => d.title === watchGroup.dramaTitle)?.tmdbId ?? null;
    return {
      ...watchGroup,
      tmdbId,
      epKey: watchEpKey({
        tmdbId,
        title: watchGroup.dramaTitle,
        season: watchGroup.season,
        episode: watchGroup.episode,
      }),
    };
  }, [watchGroup, myDramas]);

  // さっと復習: グループ全語（再会語を先頭に）上限5・ReviewModal が読める形へ整える
  const quickReviewWords = useMemo(() => {
    if (!watchMeta) return [];
    const reunionSet = new Set((recap?.items || []).map((it) => it.word.toLowerCase()));
    const toCard = (w) => {
      const fill = wordFills[String(w.word).toLowerCase()] || {};
      return {
        ...w,
        definition: w.ja || fill.ja || w.definition || '',
        example: w.example || w.sentence || fill.example || '',
      };
    };
    return [...watchMeta.words]
      .sort(
        (a, b) =>
          (reunionSet.has(String(b.word).toLowerCase()) ? 1 : 0) -
          (reunionSet.has(String(a.word).toLowerCase()) ? 1 : 0)
      )
      .map(toCard);
  }, [watchMeta, recap, wordFills]);

  // v2リッチ祝い（タップ直後のみ）用: 全語の単語カード（再会語先頭・再会は出どころつき）と統計。
  // NEWはバッジを付けない（大半が新規＝バッジは情報量ゼロ・光らせるのは再会だけ）。
  const richCards = useMemo(() => {
    if (!watchMeta) return [];
    const byWord = new Map((recap?.items || []).map((it) => [it.word.toLowerCase(), it]));
    return [...watchMeta.words]
      .sort(
        (a, b) =>
          (byWord.has(String(b.word).toLowerCase()) ? 1 : 0) -
          (byWord.has(String(a.word).toLowerCase()) ? 1 : 0)
      )
      .map((w) => {
        const wl = String(w.word).toLowerCase();
        const r = byWord.get(wl);
        return { word: w.word, ja: w.ja || wordFills[wl]?.ja || w.definition || '', past: r ? r.past : null };
      });
  }, [watchMeta, recap, wordFills]);
  // 統計は「実際に起きたことだけ」: 0の項目は表示しない。「覚えてきた」=isLearned(2回以上正解)。
  const watchStats = useMemo(() => {
    if (!watchMeta) return null;
    const srs = loadSrs();
    const reunion = richCards.filter((c) => c.past).length;
    const learned = watchMeta.words.filter((w) => isLearned(srs[String(w.word).toLowerCase()])).length;
    return { fresh: watchMeta.words.length - reunion, reunion, learned };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchMeta, richCards, reviewVersion]);

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

  // ── 観たあとにカード（質問→祝いの2状態・docs/design-recap-endroll.md §2）──
  const watchConfirmed = useMemo(
    () => !!(watchMeta && (justConfirmed === watchMeta.epKey || isWatchConfirmed(profile?.id, watchMeta))),
    [watchMeta, justConfirmed, profile]
  );
  const showWatchAsk =
    !!watchMeta && !watchConfirmed && askDismissed !== watchMeta.epKey && !isWatchSnoozed(watchMeta.epKey);
  const showWatchCelebrate = !!watchMeta && watchConfirmed;
  const watchSeLabel =
    watchMeta && watchMeta.season != null && watchMeta.episode != null
      ? ` S${watchMeta.season}E${watchMeta.episode}`
      : '';
  // この話の半券（予習クイズ済みなら存在）。祝い状態から「あの場面を思い出す」導線に使う。
  // epKey文字列でなくフィールド照合（tmdbId一致 or タイトル一致）＝片側だけtmdbId未解決でも外れない。
  const epTicket = useMemo(() => {
    if (!watchMeta) return null;
    return (
      (tickets || []).find(
        (t) =>
          (t.words || []).length &&
          t.season === watchMeta.season &&
          t.episode === watchMeta.episode &&
          ((watchMeta.tmdbId != null && t.tmdbId === watchMeta.tmdbId) || t.title === watchMeta.dramaTitle)
      ) || null
    );
  }, [tickets, watchMeta]);

  const handleWatchDone = () => {
    if (!watchMeta) return;
    confirmWatch(profile?.id, watchMeta);
    setJustConfirmed(watchMeta.epKey); // 祝い状態へ（獲得演出つき）
  };
  const handleWatchLater = () => {
    if (!watchMeta) return;
    snoozeWatchPrompt(watchMeta.epKey);
    setAskDismissed(watchMeta.epKey);
  };
  // 旧語の補完取得（祝い状態になってから・1グループ1回）。
  // 訳: 単語帳と同じ経路（文脈訳→単語訳・どちらも端末キャッシュつき・失敗はnull＝英英のまま）。
  // 例文: sentenceも無いごく初期の語のみ、/api/example を位置情報なしで叩く
  //       ＝サーバ設計上vocab_cache一致（層1）だけが通る安全経路。見つからなければ例文なしのまま。
  const filledEpRef = useRef(null);
  useEffect(() => {
    if (!watchMeta || !watchConfirmed) return;
    if (filledEpRef.current === watchMeta.epKey) return;
    filledEpRef.current = watchMeta.epKey;
    let cancelled = false;
    (async () => {
      const fills = {};
      await Promise.all(
        watchMeta.words.map(async (w) => {
          const wl = String(w.word).toLowerCase();
          const fill = {};
          if (!w.ja) {
            try {
              fill.ja = (w.sentence ? await fetchCtxJa(w.word, w.sentence) : null) ?? (await fetchJa(w.word));
            } catch {
              /* 補完失敗は英英のまま */
            }
          }
          if (!w.example && !w.sentence) {
            try {
              const res = await fetch('/api/example', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  word: w.word,
                  title: watchMeta.dramaTitle,
                  season: watchMeta.season,
                  episode: watchMeta.episode,
                }),
              });
              const json = await res.json().catch(() => null);
              if (json?.found && json.sentence) fill.example = json.sentence;
            } catch {
              /* 例文なしのまま */
            }
          }
          if (fill.ja || fill.example) fills[wl] = fill;
        })
      );
      if (!cancelled && Object.keys(fills).length) setWordFills((prev) => ({ ...prev, ...fills }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchMeta, watchConfirmed]);

  const startQuickReview = () => {
    setCurrentHistoryId(null); // 横断復習（特定エピソードに紐づかない）
    openReview(quickReviewWords.slice(0, 5), { all: true });
  };
  const startFullReview = () => {
    setCurrentHistoryId(null);
    openReview(quickReviewWords, { all: true });
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

      {/* 観たあとにカード＝視聴直後リキャップ（docs/design-recap-endroll.md）。
          質問状態: 視聴完了の自己申告を静かに聞く（誤爆ゼロの根拠）。無視・まだ途中に罰なし。
          祝い状態: 申告後に同じカードが変化＝再会チップ＋さっと復習。
          罪悪感UI禁止の原則: 催促・バッジ・未記録カウントは置かない。 */}
      {showWatchAsk && (
        <div className="reunion-card">
          <div className="reunion-head">
            <span aria-hidden="true">🎬</span> 観たあとに
          </div>
          <div className="reunion-lead">
            『{watchMeta.dramaTitle}』{watchSeLabel}、観終わりましたか？
          </div>
          <span className="recap-ask-chip">
            <span aria-hidden="true">🔖</span> 保存した語 {watchMeta.words.length}
          </span>
          <div className="recap-ask-actions">
            <button className="reunion-review-btn recap-btn-done" onClick={handleWatchDone}>
              観終わった
            </button>
            <button className="recap-btn-later" onClick={handleWatchLater}>
              まだ途中
            </button>
          </div>
        </div>
      )}
      {/* 祝い状態は二段構え（/decide R1裁定 2026-07-20）: タップ直後だけリッチ版（単語カード＋統計）、
          再訪時は軽量版に畳む＝毎晩ミニエンドロール化してP3の節目演出の希少性を殺さない。 */}
      {showWatchCelebrate && justConfirmed === watchMeta.epKey && (
        <div className="reunion-card recap-celebrate">
          <div className="reunion-head">
            <span aria-hidden="true">🎟</span> 観たあとに
          </div>
          <div className="reunion-lead">
            『{watchMeta.dramaTitle}』{watchSeLabel} を観終わりました。今回出会った語彙です
          </div>
          <div className={`recap-cardrow${richCards.length > 3 ? ' recap-scroll' : ''}`}>
            {richCards.map((c) => (
              <div key={c.word} className={`recap-wordcard${c.past ? ' recap-wordcard-reunion' : ''}`}>
                {c.past && <span className="recap-badge">再会</span>}
                <span className="recap-wordline">
                  <span className="recap-word">{c.word}</span>
                  <button className="recap-speak" onClick={() => speak(c.word)} aria-label={`${c.word} を発音`}>
                    🔊
                  </button>
                </span>
                {c.ja && <span className="recap-ja">{c.ja}</span>}
                {c.past && <span className="recap-src">{pastLabel(c.past)}</span>}
              </div>
            ))}
          </div>
          {watchStats && (
            <div className="recap-stats">
              {watchStats.fresh > 0 && (
                <span className="recap-stat">
                  新規 <strong>{watchStats.fresh}</strong>
                </span>
              )}
              {watchStats.reunion > 0 && (
                <span className="recap-stat">
                  再会 <strong>{watchStats.reunion}</strong>
                </span>
              )}
              {watchStats.learned > 0 && (
                <span className="recap-stat">
                  覚えてきた <strong>{watchStats.learned}</strong>
                </span>
              )}
            </div>
          )}
          <button className="reunion-review-btn" onClick={startQuickReview}>
            この{Math.min(5, quickReviewWords.length)}語をさっと復習する
          </button>
          {quickReviewWords.length > 5 && (
            <button className="recap-more-link" onClick={startFullReview}>
              すべての{quickReviewWords.length}語を復習する →
            </button>
          )}
          {epTicket && (
            <button className="recap-more-link" onClick={() => openSceneCards(epTicket)}>
              🃏 あの場面の聞きどころを思い出す →
            </button>
          )}
        </div>
      )}
      {showWatchCelebrate && justConfirmed !== watchMeta.epKey && (
        <div className="reunion-card">
          <div className="reunion-head">
            <span aria-hidden="true">🎟</span> 観たあとに
          </div>
          <div className="reunion-lead">
            『{watchMeta.dramaTitle}』{watchSeLabel} を観終わりました。
            {recap ? (
              <>
                前に出会った <strong>{recap.items.length}語</strong> との再会です
              </>
            ) : (
              <>保存した {watchMeta.words.length}語 が待っています</>
            )}
          </div>
          {recap && (
            <div className="reunion-words">
              {recap.items.slice(0, 5).map((it) => (
                <span key={it.word} className="reunion-chip">
                  <span className="reunion-word">{it.word}</span>
                  <span className="reunion-src">{pastLabel(it.past)}</span>
                </span>
              ))}
            </div>
          )}
          <button className="reunion-review-btn" onClick={startQuickReview}>
            この{Math.min(5, quickReviewWords.length)}語をさっと復習する
          </button>
          {quickReviewWords.length > 5 && (
            <button className="recap-more-link" onClick={startFullReview}>
              すべての{quickReviewWords.length}語を復習する →
            </button>
          )}
          {epTicket && (
            <button className="recap-more-link" onClick={() => openSceneCards(epTicket)}>
              🃏 あの場面の聞きどころを思い出す →
            </button>
          )}
        </div>
      )}

      {/* 累計の語彙進捗（別枠）。今日の復習とは分けて「これまでの積み上げ」を見せる。 */}
      <VocabProgress learned={data.totalLearned} mastered={data.totalMastered} total={data.totalWords} />

      {/* 半券（観た証）＝観た後に戻る入口。シーン記憶カードへ。最新1枚だけ出して混雑を避ける。
          「観たあとに」カードが出ている間は重複表示になるため隠す（カード統合・混雑回避）。 */}
      {(() => {
        if (showWatchAsk || showWatchCelebrate) return null;
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
