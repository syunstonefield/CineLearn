'use client';

import { IconHeart } from './icons/LineIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { HomeBand, HomeTodayCard, HomeRecord, HomeStart } from './HomeParts';
import { CURATION_ON, SAVE_STAR_SENTENCE } from '@/lib/curation';
import { buildGrass, statsStart } from '@/lib/journey';
import { loadExpLedger } from '@/lib/exp';
import { studiedSummary } from '@/lib/studiedDays';
import LibraryCard from './LibraryCard';
import ContinueCard from './ContinueCard';
import RecommendGrid from './RecommendGrid';
import { getRecommendations } from '@/lib/recommended';
import { isMobileDevice } from '@/lib/device';
import { shouldShowTrialLaterBand, markTrialLaterBandShown } from '@/lib/trialState';
import { trackUsage } from '@/lib/usage';
import { clearExtInstallEntry, isExtInstallEntry } from '@/lib/extEntry';
import { tmdb } from '@/lib/api';
import { pickPosterUrl, fetchMoviePosterById, getCachedMoviePoster } from '@/lib/collection';
import { computeRecap, computeWatchGroup } from '@/lib/reunion';
import { settleRingValues } from '@/lib/rings';
import { recencyMs } from '@/lib/workRemoval';
import { workRecency, byRecency } from '@/lib/workRecency';
import { refetchPreDomExamples } from '@/lib/preDomExamples';
import { usePlan, featureAccess } from '@/lib/plan';
import { dailyReviewCap } from '@/lib/reviewCount';
import { confirmWatch, isWatchConfirmed, isWatchSnoozed, snoozeWatchPrompt, watchEpKey } from '@/lib/watchlog';
import { speak } from '@/lib/speak';
import { fetchCtxJa } from '@/lib/ctxtranslate';
import { fetchJa } from '@/lib/jatranslate';
import { getActiveWords, normTitleForMatch, prewarmTitleAliases, sameWorkTitle } from '@/lib/words';
import { pickTodayWord } from '@/lib/liked';
import { AGAIN_BATCH } from '@/lib/againWords';
import { latestEpisode, canLearn, canQuiz } from '@/lib/continueRow';
import {
  toIsoDate,
  loadStatsDaily,
  statsByDay,
  archiveDrama,
  buildLibraryEntries,
  getAllVocabWords,
  getDueReviewWords,
  getWeekStats,
  isLearned,
  learningStatsByTitle,
  loadArchived,
  loadHistory,
  loadSrs,
  todayStr,
  overallVocabStats,
  activeWordKeys,
  getAgainWords,
  collectRingWords,
  ringCounts,
} from '@/lib/storage';

// 「観たあとに」のカード（視聴直後リキャップ・docs/design-recap-endroll.md）は、2026-11-12 のホームの見直しでホームから外した
//   （オーナー決定＝ほとんど使っていない）。コードは残してあり、Vercel の環境変数 NEXT_PUBLIC_HOME_WATCH_CARD=on を入れて
//   再デプロイすると、続きから学習の下に戻る（ビルド時に埋め込まれる値なので再デプロイが要る）。
const SHOW_WATCH_CARD = process.env.NEXT_PUBLIC_HOME_WATCH_CARD === 'on';

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
    cloudVersion,
    startFromRecommend,
    openGuide,
    openJourney,
    bumpWordbook,
    wordbookVersion,
    loggedIn,
    openAuth,
    sessionExpired,
    openWordbook,
    openSearch,
    startEpisodeQuiz,
  } = useApp();
  // 今日の復習1回の語数＝復習タブ・ボトムナビのバッジと同じ（設定の語数・既定20語・無料）
  const plan = usePlan(loggedIn);
  const todayCap = dailyReviewCap(settings, featureAccess('reviewCount', plan).usable);
  // ホームの「学習した日」（草）。EXP 台帳から描く（あゆみタブと同じ部品の compact 版）。記録が無い新規の人には出さない。
  const homeGrass = useMemo(() => {
    // ホームの学習した日は誰でも使える（homeGrass＝free・オーナー決定 2026-11-12）。あゆみの中の詳しい版は grass（プラス）のまま。
    if (!mounted || !featureAccess('homeGrass', plan).usable) return null;
    const grass = buildGrass(loadExpLedger(), new Date());
    if (!grass.studied) return null;
    const days = statsByDay(loadStatsDaily());
    return { grass, days, dailyStart: statsStart(days) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, plan, reviewVersion, cloudVersion]);
  const [tick, setTick] = useState(0); // 再読込トリガ
  const [expiredBandClosed, setExpiredBandClosed] = useState(false); // 期限切れの帯を閉じた（次に開くとまた出る）
  // 拡張機能の導入バナー（最初の関門対策で常設）。拡張未検出の判定はできないため、
  // インストール済みの人向けに×で消せる（消去は端末ローカルに記憶）。
  const [extBannerDismissed, setExtBannerDismissed] = useState(true); // SSR/初回は隠す
  // モバイル（iOS/Android）では Chrome 拡張を入れられないため、インストール導線ではなく
  // 「予習・復習用」の説明に切り替える。SSR/初回は false（デスクトップ扱い）で統一。
  const [isMobile, setIsMobile] = useState(false);
  // 拡張を入れた直後のタブ（lib/extEntry.js）。導入の案内は出さず、次にすることだけ伝える。
  const [extEntry, setExtEntry] = useState(false);
  // 初回体験で「あとで」を選んだ人に、次に開いた時に1回だけ出す帯（モーダルにしない・設計の決定5）。
  const [trialBand, setTrialBand] = useState(false);
  useEffect(() => {
    if (loggedIn || !shouldShowTrialLaterBand()) return;
    markTrialLaterBandShown();
    trackUsage('trial_later_band');
    setTrialBand(true);
  }, [loggedIn]);
  useEffect(() => {
    setIsMobile(isMobileDevice());
    const fromExt = isExtInstallEntry();
    setExtEntry(fromExt);
    try {
      if (fromExt) localStorage.setItem('cl_ext_banner_dismissed', '1'); // もう入れた人に導入の案内を出さない
      setExtBannerDismissed(localStorage.getItem('cl_ext_banner_dismissed') === '1');
    } catch {
      setExtBannerDismissed(false);
    }
  }, []);
  const closeExtEntry = () => {
    clearExtInstallEntry();
    setExtEntry(false);
  };
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
  // 映画の ID → その ID のポスター（'' は無し）。コレクションと同じ取り方（lib/collection.js・端末に90日）。
  //   保存された URL は「どの ID の画像か」を持たないので、ID が直っても古い画像が残る（X-Men のアポカリプスの画像・2026-11-12）。
  const [moviePosters, setMoviePosters] = useState({});
  // 進捗バー用のシーズン別話数（{ season番号: 話数 }）。posterOverrides と同じく override で補完。
  const attemptedEpisodes = useRef(new Set());
  const [episodeOverrides, setEpisodeOverrides] = useState({}); // title → seasonCounts
  // 「続きから学習」を全部見るか（既定は2件・それ以上は「すべて見る」で展開）
  const [showAllContinue, setShowAllContinue] = useState(false);

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
  // マイ単語帳の語（拡張クリック保存・手動追加）。累計ゲージの母数に足すため state で保持する
  // （getActiveWords は非同期＝クラウド取り込みを含むので data の useMemo からは呼べない）。
  const [myWords, setMyWords] = useState([]);
  // 「今日の語」（2026-11-07・法務の条件＝語が見出し・例文は従）: ♡ を付けた語から日付で1つ。無ければ出さない。
  const todayWord = useMemo(() => pickTodayWord(myWords, new Date().toISOString().slice(0, 10)), [myWords]);
  const [myWordsLoaded, setMyWordsLoaded] = useState(false); // 円の記録は単語帳の語が揃ってから（途中の小さい値を残さない）
  // 切り替え前（2026-07-03 より前）に拡張で保存した語の例文＝画面字幕の行を、OpenSubtitles の1文に
  // 取り直す（ログイン時のみ・1回 8 語まで・済んだ語は端末に記録＝lib/preDomExamples.js）。
  const preDomRan = useRef(false);
  useEffect(() => {
    if (!mounted || !loggedIn || !myWordsLoaded || preDomRan.current) return;
    preDomRan.current = true;
    refetchPreDomExamples(myWords, { profileId: profile?.id, myDramas })
      .then((changed) => changed && bumpWordbook())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, loggedIn, myWordsLoaded]);
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    getActiveWords(profile?.id)
      .then(async (words) => {
        if (cancelled) return;
        setMyWords(words);
        setMyWordsLoaded(true);
        const history = loadHistory();
        // 再会判定の同一作品除外（sameWorkTitle）は同期でキャッシュしか見ないため、
        // 保存語・履歴の日本語タイトルの英語 alias を先に解決してから計算する
        // （解決済みは即返り。これが無いと alias 未整備の端末で初回セッションだけ
        //   日英表記ゆれの同一作品を別作品と誤認＝疑似再会が出る）。
        await prewarmTitleAliases([
          ...words.map((w) => w.dramaTitle),
          ...history.map((h) => h.drama?.title),
        ]);
        if (cancelled) return;
        // maxItems: Infinity＝グループ全語を分類（v2の単語カード/統計用）。表示側で必要数に絞る。
        // 映画作品のタイトル集合（日英とも）: 再会表示で映画に S/E を出さないための判定源
        const movieTitles = new Set(
          (settings.myDramas || [])
            .filter((d) => d.type === 'movie' || d.mediaType === 'movie')
            .flatMap((d) => [d.title, d.englishTitle].filter(Boolean).map(normTitleForMatch))
        );
        setRecap(
          computeRecap({ words, history: loadHistory(), srs: loadSrs(), maxItems: Infinity, movieTitles })
        );
        setWatchGroup(computeWatchGroup({ words }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // 単語帳の増減（追加/削除＝wordbookVersion）でも引き直す＝累計ゲージが常に最新になる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, profile, tick, cloudVersion, reviewVersion, wordbookVersion]);

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

  // まだ復習していない語（保存した日以降に一度も採点していない語）。さっと復習の対象と数はこちらで出し、
  // 全部復習し終わったら復習ボタン（祝いの軽量版はカードごと）を出さない（オーナー 2026-10-08：
  // 「復習してもずっと表示される」＝全語モードで開くので、いつまでも出す語が尽きなかった）。
  const pendingQuick = useMemo(() => {
    const srs = loadSrs();
    return quickReviewWords.filter((w) => {
      const e = srs[String(w.word || '').toLowerCase()];
      if (!e?.lastReview) return true;
      const saved = toIsoDate(String(w.savedAt || '').slice(0, 10)) || '';
      return saved ? e.lastReview < saved : false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickReviewWords, reviewVersion]);

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
      return { history: [], entries: [], learnStats: new Map(), totalLearned: 0, totalMastered: 0, totalWords: 0, studied: { days: 0, today: false }, hasAnyWord: false, dueCount: 0, weekStats: { reviewedThisWeek: 0, mastered: 0 } };
    }
    const history = loadHistory();
    const archived = new Set(loadArchived()); // 「棚から外した」作品は一覧から隠す（履歴は残す）
    // 作品カードの「✅覚えた/⭐マスター n/総数」。追加した語も同じ作品に算入する＝カードの数と
    // その作品の単語リストの数が一致する（作品同定は日英跨ぎの sameWorkTitle に委ねる）。
    const learnStats = learningStatsByTitle(history, loadSrs(), myWords, sameWorkTitle);
    // 累計の「覚えた／マスター」（ホームの達成感＝復習モチベ用）。履歴の語＋追加した語を
    // 語で名寄せして数える＝単語帳の件数と一致する（追加した語が母数から抜けない）。
    // 棚から外した作品の「まだ復習していない語」は分母と今日の復習から外す（activeWordKeys）。
    // 保存語の作品名は日英で揺れるので名寄せ込みの sameWorkTitle で判定する。
    const activeKeys = activeWordKeys(history, myWords, sameWorkTitle);
    const overall = overallVocabStats(history, myWords, loadSrs(), activeKeys);
    // 作品の「最近触った」時刻（作った日・復習・保存・開いた/戻した）。続きから学習の並びに使う（lib/workRecency.js）。
    const recency = workRecency({ history, srs: loadSrs(), myWords, myDramas, sameTitle: sameWorkTitle });
    return {
      history,
      recency,
      entries: buildLibraryEntries(history, myDramas).filter((e) => !archived.has(e.drama.title)),
      learnStats,
      totalLearned: overall.learned,
      totalMastered: overall.mastered,
      totalWords: overall.total,
      // 今日の復習の札の「学習した日」（累計・あゆみと同じ数え方・オーナー決定 2026-11-13＝連続日数はやめた）
      studied: studiedSummary(loadExpLedger(), todayStr()),
      hasAnyWord: overall.total > 0,
      dueCount: getDueReviewWords(history, loadSrs(), myWords, activeKeys).length,
      weekStats: getWeekStats(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, profile, myDramas, tick, reviewVersion, cloudVersion, myWords]);

  // 3重の円の値を日ごとの記録 cl_stats_daily に残す（円は「あゆみ」タブ・オーナー 2026-10-08）。
  // ホームには円を出さないが、週ごとの推移の線（覚えた・マスター）はこの記録から描くので、
  // ホームを開くたびに今日の行へ最高値を残しておく（あゆみタブを開かない日も線が途切れない）。
  useEffect(() => {
    if (!mounted || !myWordsLoaded) return;
    settleRingValues(ringCounts(collectRingWords(data.history, myWords, loadSrs(), sameWorkTitle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, myWordsLoaded]);

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
      // ★ここでは作品の ID（tmdbId）を書き換えない（2026-11-12）。以前は題名でドラマを検索し、1番目の ID で上書きしていた
      //   ＝映画の X-Men（36657）がドラマの X-メン（4574）に置き換わり、単語リストが別の作品で作られる原因になった。
      for (const { drama } of missing) {
        try {
          let p = null;
          const old = drama.posterPath || '';
          if (/\/w(500|780)\//.test(old)) {
            // 同じポスターの大きさ違い＝通信なしで縦の w342 に付け替える
            p = old.replace(/\/w(500|780)\//, '/w342/');
          } else {
            const res = await fetch('/api/tmdb', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: drama.type === 'movie' || drama.mediaType === 'movie' ? 'search_movie' : 'search',
                query: drama.englishTitle || drama.title,
              }),
            });
            const json = await res.json();
            const results = json.results || [];
            // ID の分かっている作品は、その ID の結果だけ使う（別の作品のポスターを付けない）。映画で一致が無ければ頭文字の札のまま。
            const hit = drama.tmdbId ? results.find((r) => r.id === drama.tmdbId) : results[0];
            // 縦のポスターだけ。無ければ頭文字の札のまま（横長の backdrop＝場面写真を縦の枠で代用しない・法務 2026-11-12）
            if (!hit?.poster_path) continue;
            p = `https://image.tmdb.org/t/p/w342${hit.poster_path}`;
          }
          found[drama.title] = p;

          const m = md.find((d) => d.title === drama.title);
          if (m) {
            m.posterPath = p;
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

  // 映画の作品の ID（作品の記録 → 履歴の行の順）。映画でなければ null。
  function movieIdOf(e) {
    const md = myDramas.find((d) => d.title === e.drama.title);
    const isMovie = [md?.type, md?.mediaType, e.drama.type, e.drama.mediaType].includes('movie');
    if (!isMovie) return null;
    return Number(md?.tmdbId || e.drama.tmdbId) || null;
  }
  // 映画の ID のポスターを取る（端末に90日覚える・同時4件）。コレクションと同じ。
  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(data.entries.map(movieIdOf).filter((id) => id && !(id in moviePosters)))];
    if (!ids.length) return undefined;
    const titlesOf = (id) =>
      data.entries.filter((e) => movieIdOf(e) === id).flatMap((e) => {
        const md = myDramas.find((d) => d.title === e.drama.title);
        return [e.drama.title, md?.englishTitle, e.drama.englishTitle];
      });
    const cached = {};
    const toFetch = [];
    ids.forEach((id) => {
      const c = getCachedMoviePoster(id);
      if (c !== null) cached[id] = c;
      else toFetch.push(id);
    });
    if (Object.keys(cached).length) setMoviePosters((m) => ({ ...m, ...cached }));
    (async () => {
      for (let i = 0; i < toFetch.length && !cancelled; i += 4) {
        const res = await Promise.all(toFetch.slice(i, i + 4).map((id) => fetchMoviePosterById(id, titlesOf(id)).then((u) => [id, u])));
        if (cancelled) return;
        const upd = {};
        res.forEach(([id, u]) => {
          if (u !== null) upd[id] = u;
        });
        if (Object.keys(upd).length) setMoviePosters((m) => ({ ...m, ...upd }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 取得済みポスター・全話数をカードに適用（履歴由来カードは drama オブジェクトが
  // 再生成されるため、override で都度補完する）。縦ポスターへ取り直した既存カードも
  // override で上書きして表示を差し替える。
  //   映画は、その ID のポスターを最優先（保存された URL が古い ID の画像でも直る）。ID は作品の記録（myDramas・
  //   単語リストの画面で直される）を、学習の履歴の行の ID（取り違えた時の ID のまま残る）より優先する。
  const entries = data.entries.map((e) => {
    const id = movieIdOf(e);
    const idPoster = id ? moviePosters[id] : null;
    const poster = pickPosterUrl({ idPoster, override: posterOverrides[e.drama.title] });
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

  // サブスク風に「続き（学習中）」と「マイリスト（未着手）」へ二分し、続きは最近触った順
  //   （作った日・復習・拡張の保存・開いた/戻した時刻の新しい方・lib/workRecency.js。オーナー 2026-11-07）。
  const continueEntries = entries
    .filter((e) => e.episodes.length > 0)
    .sort(byRecency(data.recency || new Map(), (e) => e.drama.title, (e) => recencyMs(e.lastDate, e.drama?.touchedAt)));
  const listEntries = entries.filter((e) => e.episodes.length === 0);

  // 空のダッシュボード（履歴・ライブラリ0件）で中央に出すおすすめ6件
  const recommendItems = useMemo(
    () => getRecommendations(settings.userLevel || 'B1', settings.selectedServices || []),
    [settings.userLevel, settings.selectedServices]
  );

  // 棚から外す（＝学習中から一旦外す）。学習記録（単語リスト・覚えた/マスター）は一切消さない。
  // まだ復習していない語がホームの分母と今日の復習から外れる（lib/storage.js activeWordKeys）。
  // 同じ作品を開き直せば自動で棚に戻る（openDrama の unarchiveDrama）。
  const handleArchive = (title) => {
    if (
      !confirm(
        `「${title}」を学習中から外しますか？\n` +
          `まだ復習していない語が「今日の復習」と覚えた数の母数から外れます。\n` +
          `覚えた・マスターの記録と単語リストは残り、作品を開き直すと元に戻ります。`
      )
    )
      return;
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
  // 再訪時の軽量版は、さっと復習する語が残っている間だけ出す（全部復習したら閉じる＝半券の入口に戻る）
  const showWatchCelebrateLight =
    showWatchCelebrate && justConfirmed !== watchMeta?.epKey && pendingQuick.length > 0;
  const watchSeLabel =
    watchMeta && watchMeta.season != null && watchMeta.episode != null
      ? ` S${watchMeta.season}E${watchMeta.episode}`
      : '';
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
    openReview(pendingQuick.slice(0, 5), { all: true });
  };
  const startFullReview = () => {
    setCurrentHistoryId(null);
    openReview(pendingQuick, { all: true });
  };

  // 続きから学習の下に回す欄（観たあとに）＝オーナー 2026-10-08。拡張機能の案内は ✕ で閉じるまで一番上（同日オーナー）
  const midSections = (
    <>
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
          {/* 復習を「観終わった」の後ろに置かない（2026-08-08）。
              祝い（再会・半券）を申告の後に置くのは誤爆ゼロのためで正しいが、復習まで一緒に
              後ろへ置いた結果「観終わったと申告しないと復習できない」＝途中で止めた人が
              嘘の申告を強いられていた。復習はいつ実行しても誤爆しないので申告の前に出す。
              ⚠この導線は申告ではない: confirmWatch を呼ばない・半券を出さない・カードも閉じない。
              対象語は「保存＝画面に出た字幕からしか作れない」ため、絞り込み不要でそのまま
              「観た範囲の語」になる（computeWatchGroup が同一話の保存語を集めている）。
              日をまたぐと前回分も含むので、文言は「今日」ではなく「ここまで」にする
              （savedAt は日付のみ・UTC基準で、深夜は前日に落ちるため「今日」は嘘になり得る）。*/}
          {pendingQuick.length > 0 && (
            <button className="recap-more-link" onClick={startFullReview}>
              ここまでの{pendingQuick.length}語を復習する →
            </button>
          )}
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
          {pendingQuick.length > 0 && (
            <button className="reunion-review-btn" onClick={startQuickReview}>
              この{Math.min(5, pendingQuick.length)}語をさっと復習する
            </button>
          )}
          {pendingQuick.length > 5 && (
            <button className="recap-more-link" onClick={startFullReview}>
              すべての{pendingQuick.length}語を復習する →
            </button>
          )}
        </div>
      )}
      {showWatchCelebrateLight && (
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
          {pendingQuick.length > 0 && (
            <button className="reunion-review-btn" onClick={startQuickReview}>
              この{Math.min(5, pendingQuick.length)}語をさっと復習する
            </button>
          )}
          {pendingQuick.length > 5 && (
            <button className="recap-more-link" onClick={startFullReview}>
              すべての{pendingQuick.length}語を復習する →
            </button>
          )}
        </div>
      )}


    </>
  );

  // 「もう一度：知らなかった／うろ覚え」（復習・クイズの新機能・lib/againWords.js）。母集団は今日の復習と同じ。
  //   始め方も復習タブ（ReviewHubScreen startAgain）と同じ＝1回 20語・openReview(..., { again })。利用データも同じ again_*_start に入る（ReviewModal）。
  const againLists = useMemo(() => {
    if (!mounted || !data.hasAnyWord) return { unknown: [], shaky: [] };
    const h = data.history || loadHistory();
    const srs = loadSrs();
    const keys = activeWordKeys(h, myWords, sameWorkTitle);
    return {
      unknown: getAgainWords('unknown', h, srs, myWords, keys),
      shaky: getAgainWords('shaky', h, srs, myWords, keys),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, data, myWords]);
  const startAgain = (kind) => {
    const list = againLists[kind] || [];
    if (!list.length) return;
    setCurrentHistoryId(null);
    openReview(list.slice(0, AGAIN_BATCH), { again: kind });
  };
  const startToday = () => {
    // 横断復習（特定エピソードに紐づかない）→ historyId は null
    setCurrentHistoryId(null);
    const h = loadHistory();
    openReview(getDueReviewWords(h, loadSrs(), myWords, activeWordKeys(h, myWords, sameWorkTitle)).slice(0, todayCap));
  };
  const journeyOk = featureAccess('ring', plan).usable;

  // 2026-11-12 見直し（受付の見本 reports/home-ui-2026-11-12/mock.html・オーナー了承）:
  //   帯 → 今日の復習 → 記録（2枚） → 続きから学習 → 今日の語 → マイリスト → おすすめ（→ TMDB の表示は layout）。
  //   帯は1行の細い帯に（出す条件・順番・1回だけ等は今のまま）。文は短くした（オーナー確認用に受付へ報告）。
  return (
    <div className="screen active" id="screen-main">
      <div className="hm">
        {/* ログインの期限切れ（起動時にログイン画面を出さない代わりの案内・初回体験の修正 D）。「この端末の記録は消えません」は必ず添える */}
        {sessionExpired && !loggedIn && !expiredBandClosed && (
          <HomeBand
            text="同期が止まっています。この端末の記録は消えません"
            linkLabel="ログイン"
            onLink={() => openAuth({ mode: 'login' })}
            onClose={() => setExpiredBandClosed(true)}
          />
        )}
        {extEntry && (
          <HomeBand
            text={
              loggedIn
                ? CURATION_ON
                  ? `拡張機能を追加しました。${SAVE_STAR_SENTENCE}`
                  : '拡張機能を追加しました。字幕の単語をクリックして「✓ 保存」で単語帳へ'
                : '拡張機能を追加しました。単語を届けるにはログインが必要です'
            }
            linkLabel={loggedIn ? null : '登録・ログイン'}
            onLink={() => openAuth()}
            onClose={closeExtEntry}
          />
        )}
        {trialBand && !loggedIn && (
          <HomeBand
            text="学習記録はこの端末に保存されています。登録すると、ほかの端末でも見られます"
            linkLabel="登録する"
            onLink={() => openAuth({ mode: 'signup', source: 'trial_band' })}
            onClose={() => setTrialBand(false)}
          />
        )}
        {/* 拡張機能の案内は ✕ で閉じるまで一番上に出す（オーナー 2026-10-08）。スマホは入れられないので PC の手順への案内 */}
        {!extBannerDismissed && (
          <HomeBand
            text={
              isMobile
                ? 'PC の Chrome 拡張機能で、観ながら字幕の単語を保存できます'
                : '無料の Chrome 拡張機能とログインで、Netflix・Prime Video の字幕の単語を集められます'
            }
            linkLabel={isMobile ? '導入手順' : '入れ方を見る'}
            onLink={openGuide}
            onClose={dismissExtBanner}
          />
        )}

        {data.hasAnyWord && (
          <HomeTodayCard
            studied={data.studied}
            todayCount={Math.min(data.dueCount, todayCap)}
            weekStats={data.weekStats}
            onStart={startToday}
            again={{ unknown: againLists.unknown.length, shaky: againLists.shaky.length }}
            onAgain={startAgain}
          />
        )}

        {/* 記録（2枚）: 左＝覚えた・マスター（分母＝出会った語）、右＝学習した日（誰でも・押すとあゆみの学習した日の欄へ＝journey_grass）。
            左を押すとあゆみ（journey_tab と同じ数え方）。正式版の無料では、学習した日だけ押せる（あゆみの学習した日へ・無料 2026-11-12）。
            覚えた・マスターの札は押せない（あゆみの円はプラス＝押すとプラスの説明に進む形にしない）。 */}
        <HomeRecord
          learned={data.totalLearned}
          mastered={data.totalMastered}
          total={data.totalWords}
          grass={homeGrass?.grass || null}
          onOpenJourney={journeyOk ? () => openJourney() : null}
          onOpenGrass={() => openJourney('grass')}
        />

        {entries.length === 0 ? (
          <HomeStart items={recommendItems} userLevel={settings.userLevel || 'B1'} onFind={() => openSearch()} onPick={startFromRecommend} />
        ) : (
          <>
            {continueEntries.length > 0 && (
              <section className="hm-section" aria-labelledby="hm-cont-h">
                <div className="hm-sec">
                  <h3 id="hm-cont-h">続きから学習</h3>
                  {continueEntries.length > 2 && (
                    <button type="button" onClick={() => setShowAllContinue((s) => !s)}>
                      {showAllContinue ? '閉じる' : 'すべて見る ›'}
                    </button>
                  )}
                </div>
                <div className="hm-rows">
                  {/* 行＝単語リスト（作品の画面をはさまない）／「学ぶ」＝行の話の単語のカードを直接／「クイズ」＝その話のクイズ（誰でも・戻るは「← ホーム」）。
                      札は出せる時だけ（lib/continueRow.js）。✕はやめ、単語リストのいちばん下の「ホームの続きから外す」へ（オーナー決定 2026-11-12）。 */}
                  {(showAllContinue ? continueEntries : continueEntries.slice(0, 2)).map((entry) => {
                    const ep = latestEpisode(entry.episodes);
                    const h = ep
                      ? (data.history || []).find(
                          (x) =>
                            x.drama?.title === entry.drama.title &&
                            (x.season || 1) === (ep.season || 1) &&
                            (x.episode || 1) === (ep.episode || 1)
                        ) || null
                      : null;
                    const srsNow = loadSrs();
                    const learnOk = !!h && canLearn(h, srsNow, todayStr());
                    const quizOk = !!h && canQuiz(h, srsNow);
                    return (
                      <ContinueCard
                        key={entry.drama.title}
                        entry={entry}
                        stats={data.learnStats.get(entry.drama.title)}
                        onSelect={(drama) => openDrama(drama, false, { startView: 'list' })}
                        onLearn={
                          learnOk
                            ? () => openDrama(entry.drama, false, { startView: 'list', startCards: true, season: h.season, episode: h.episode })
                            : null
                        }
                        onQuiz={quizOk ? () => startEpisodeQuiz(h, { returnTo: 'main' }) : null}
                      />
                    );
                  })}
                </div>
              </section>
            )}
            {SHOW_WATCH_CARD && <div className="hm-watch">{midSections}</div>}
          </>
        )}

        {/* ♡今日の語（2026-11-07・法務の条件＝語が見出し・例文は “ ”＋出所の従）。ほかの札と同じ幅・同じ札に */}
        {todayWord && (
          <button type="button" className="hm-card home-today-word" onClick={openWordbook} title="単語帳で見る">
            <span className="htw-label">
              <IconHeart /> 今日の語
            </span>
            <span className="htw-word">{todayWord.word}</span>
            {(todayWord.ja || todayWord.definition) && <span className="htw-def">{todayWord.ja || todayWord.definition}</span>}
            <span className="htw-ex">“{todayWord.sentence || todayWord.example}”</span>
            {todayWord.dramaTitle && (
              <span className="htw-src">
                📺 {todayWord.dramaTitle}
                {todayWord.season != null && todayWord.episode != null ? ` S${todayWord.season}E${todayWord.episode}` : ''}（字幕：OpenSubtitles）
              </span>
            )}
          </button>
        )}

        {entries.length > 0 && listEntries.length > 0 && (
          <section className="hm-section" aria-labelledby="hm-list-h">
            <div className="hm-sec">
              <h3 id="hm-list-h">マイリスト</h3>
            </div>
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
        {entries.length > 0 && recommendItems.length > 0 && (
          <section className="hm-section" aria-labelledby="hm-reco-h">
            <div className="hm-sec">
              <h3 id="hm-reco-h">おすすめ</h3>
            </div>
            <p className="hm-sec-sub">CineLearn が選んだ作品から、あなたのレベルに合うものです</p>
            <RecommendGrid items={recommendItems} onPick={startFromRecommend} userLevel={settings.userLevel || 'B1'} variant="mini" />
          </section>
        )}
      </div>
    </div>
  );
}
