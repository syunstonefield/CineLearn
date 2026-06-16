'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { loadProfiles, saveProfiles, patchProfileSettings } from '@/lib/storage';
import { ensureFreshSession, pullFromCloud, isLoggedIn, supaSignOut, clearSession } from '@/lib/supabase';
import { recommendedToDrama } from '@/lib/recommended';

// app.js のグローバル状態（selectedDrama / selectedSeason 等）に相当する共有状態。
// 画面間（ダッシュボード / サービス選択 / 単語リスト）で参照・更新する。
const AppCtx = createContext(null);

export function useApp() {
  return useContext(AppCtx);
}

const DEFAULT_SETTINGS = {
  toeicScore: 0,
  targetToeicScore: 0,
  userLevel: 'B1',
  targetLevel: 'B1',
  vocabCount: 30,
  selectedServices: [],
  selectedGenres: ['Crime Thriller'],
  testTiers: ['core', 'advanced'],
  selectedViewingService: null,
  myDramas: [],
};

const AVATAR_COLORS = [
  '#E50914', '#1A73E8', '#2E7D32', '#7B1FA2',
  '#E65100', '#00695C', '#F57F17', '#AD1457',
];

export default function AppProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // 'profile-select'（だれが観ますか）から開始。選択後に 'main' へ。
  const [screen, setScreen] = useState('profile-select'); // | 'service-select' | 'vocab' | 'quiz'
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wordbookOpen, setWordbookOpen] = useState(false);
  const [wordbookVersion, setWordbookVersion] = useState(0); // 削除後のバッジ/一覧再集計
  // Supabase（読み取り専用）
  const [authOpen, setAuthOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [cloudVersion, setCloudVersion] = useState(0); // pull 後のプロフィール再読込
  const [drama, setDrama] = useState(null); // selectedDrama
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  // テスト（screen-5）・復習モーダルの共有状態
  const [quizData, setQuizData] = useState([]); // 表示用（シャッフル済み）
  const [currentHistoryId, setCurrentHistoryId] = useState(null);
  const [reviewWords, setReviewWords] = useState(null); // null=モーダル閉
  const [reviewVersion, setReviewVersion] = useState(0); // 復習完了後の再集計トリガ
  // 初回ウェルカム・チュートリアル：null=閉 / 'onboarding'（設定完了直後→閉じると作品追加へ）/ 'help'（？ボタン再表示）。
  // 「見た」フラグは cl_tutorial_seen（端末ローカル・クラウド同期に左右されない）に保存する。
  const [tutorial, setTutorial] = useState(null);
  // 拡張機能の導入ガイド（モーダル）。チュートリアルのスライド・ダッシュボードの常設バナーから開く。
  const [guideOpen, setGuideOpen] = useState(false);
  // localStorage はクライアントのマウント後にしか読めない。
  // SSR/初回クライアントレンダーは mounted=false で統一し、ハイドレーション不一致を防ぐ。
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // オートログイン：有効なセッションがあればクラウドから読み込む（読み取り専用）。
    (async () => {
      try {
        if (await ensureFreshSession()) {
          await pullFromCloud();
          setLoggedIn(true);
          setCloudVersion((v) => v + 1);
        } else if (isLoggedIn()) {
          setLoggedIn(true);
        } else {
          // 未ログイン（新規ユーザー＋セッション期限切れで実質ログアウトの人）には、
          // 起動時にまずログイン/ようこそ画面を出す（方針: ログイン状態でない人にはログインを促す）。
          // isLoggedIn() は期限切れで false を返すため、期限切れユーザーもここに入る。
          // ※このモーダルはプロフィール選択に重なる。進む導線＝ログイン or「このデバイスのみで使う」。
          setAuthOpen(true);
        }
      } catch {
        /* オートログイン失敗は無視 */
      }
    })();
    // タブを開いている間は期限が近づいたら自動更新（約1時間で失効するため）
    const timer = setInterval(() => {
      ensureFreshSession().catch(() => {});
    }, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // ログイン成功時（AuthModal から呼ぶ）：pull 済みデータを反映
  const onLoggedIn = useCallback(() => {
    setLoggedIn(true);
    setAuthOpen(false);
    setCloudVersion((v) => v + 1);
  }, []);

  // クラウドから再取得（手動🔄・タブ復帰時）。
  // Netflix で拡張機能が保存 → Supabase に同期された単語を、
  // アプリを開き直さなくても単語帳・バッジに反映させる。
  // profile は ref で参照（リスナーを張り直さないため）
  const profileRef = useRef(null);
  const refreshingRef = useRef(false);
  const lastRefreshRef = useRef(0);
  const refreshFromCloud = useCallback(async () => {
    if (refreshingRef.current) return false;
    refreshingRef.current = true;
    try {
      if (!(await ensureFreshSession())) return false;
      await pullFromCloud(profileRef.current?.id || null);
      lastRefreshRef.current = Date.now();
      setLoggedIn(true);
      setCloudVersion((v) => v + 1);
      setWordbookVersion((v) => v + 1); // 単語帳・バッジを再集計
      return true;
    } catch {
      return false;
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // タブ復帰時に自動で再取得（10秒スロットル）。
  // Netflixタブで単語を保存 → このタブに戻る、の典型動線をカバーする。
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefreshRef.current < 10 * 1000) return;
      refreshFromCloud();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshFromCloud]);

  const openAuth = useCallback(() => setAuthOpen(true), []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);

  const signOut = useCallback(async () => {
    // ログアウトはログイン中のみ可能（Header）。保存済みの単語・履歴はクラウドに残り、
    // 再ログイン時に pullFromCloud で復元される。消えるのはこの端末のローカル表示のみ。
    if (
      !confirm(
        'ログアウトしますか？\n\n保存した単語・履歴はクラウドに残るので消えません。\nこの端末の表示だけリセットされ、再ログインすればもとに戻ります。'
      )
    )
      return;
    try {
      await supaSignOut();
    } catch {
      /* ignore */
    }
    clearSession();
    ['cl_profiles', 'cl_history', 'cl_srs', 'cl_my_words'].forEach((k) => localStorage.removeItem(k));
    setLoggedIn(false);
    setProfile(null);
    setScreen('profile-select');
    setCloudVersion((v) => v + 1);
  }, []);

  // プロフィールを選択してアプリに入る（既存 selectProfile 相当）
  const selectProfile = useCallback((id) => {
    const p = loadProfiles().find((x) => x.id === id);
    if (!p) return;
    // クラウド pull で得たグローバル単語をプロフィール別キーへ反映（既存挙動）
    try {
      const cloudWords = localStorage.getItem('cl_my_words');
      if (cloudWords && JSON.parse(cloudWords).length > 0) {
        localStorage.setItem(`cl_my_words_${id}`, cloudWords);
      }
    } catch {
      /* ignore */
    }
    setProfile(p);
    const s = { ...DEFAULT_SETTINGS, ...(p.settings || {}) };
    setSettings(s);
    setScreen('main');
    // 未設定（TOEIC/サービス未入力）なら設定モーダルを開く（オンボーディング代替）
    if (!s.toeicScore || !(s.selectedServices || []).length) setSettingsOpen(true);
  }, []);

  // 新規プロフィール作成 → オンボーディングへ（既存 startOnboarding 相当）
  const addProfile = useCallback((name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const profiles = loadProfiles();
    const color = AVATAR_COLORS[profiles.length % AVATAR_COLORS.length];
    const p = { id: 'p_' + Date.now(), name: trimmed, color, settings: {} };
    saveProfiles([...profiles, p]);
    setProfile(p);
    setSettings({ ...DEFAULT_SETTINGS });
    setScreen('onboarding');
  }, []);

  // オンボーディング完了（既存 finishOnboarding 相当）：
  // 設定を保存してメインへ → ドラマ追加モーダルをタイトル検索タブで開く
  const [pendingAddDrama, setPendingAddDrama] = useState(null); // {tab, query} | null
  const finishOnboarding = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setScreen('main');
    // 初回はまず使い方ガイドを見せ、閉じたときに作品追加へ進む（closeTutorial が担当）。
    // すでにガイドを見た端末（2人目のプロフィール作成など）は従来どおり直接作品追加へ。
    const seen = typeof window !== 'undefined' && localStorage.getItem('cl_tutorial_seen') === '1';
    if (seen) setPendingAddDrama({ tab: 'search', query: '' });
    else setTutorial('onboarding');
  }, []);

  const deleteProfile = useCallback((id) => {
    saveProfiles(loadProfiles().filter((x) => x.id !== id));
  }, []);

  // ヘッダーのプロフィール切替 → 選択画面へ戻る（現在の選択を解除）
  const switchProfile = useCallback(() => {
    setProfile(null);
    setScreen('profile-select');
  }, []);

  // 設定変更を profile に永続化（app.js の saveSettings 相当）。
  // 更新関数（setState）の中で副作用を呼ぶとレンダー中更新になるため、
  // 永続化は state 変更後の effect に分離する。
  const hydrated = useRef(false);
  useEffect(() => {
    // reloadProfile による初回ハイドレーション分は書き戻さない（同一データの無駄書き防止）
    if (!hydrated.current) {
      if (profile) hydrated.current = true;
      return;
    }
    if (profile) patchProfileSettings(profile.id, settings);
  }, [profile, settings]);

  // 設定の部分更新（純粋に state を更新するだけ・永続化は上の effect が担当）
  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // ライブラリのカード/検索結果をクリック → サービス選択画面へ。
  // clearService=true（新規追加時）は前回の視聴サービスをクリアする（既存 selectDrama 準拠）。
  const openDrama = useCallback((d, clearService = false) => {
    setDrama(d);
    setSeason(1);
    setEpisode(1);
    setScreen('service-select');
    setSettings((prev) => {
      const exists = (prev.myDramas || []).some((x) => x.title === d.title);
      const myDramas = exists ? prev.myDramas : [...(prev.myDramas || []), d];
      const next = { ...prev, myDramas };
      if (clearService) next.selectedViewingService = null;
      return next;
    });
  }, []);

  // ジャンルタグのトグル（関数型更新で連続クリックにも耐える）。
  // selectedGenres は settings を単一の真実として扱う。
  const toggleGenre = useCallback((g) => {
    setSettings((prev) => {
      const cur = prev.selectedGenres || [];
      const selectedGenres = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
      return { ...prev, selectedGenres };
    });
  }, []);

  // 視聴サービスを選んで単語リスト画面へ
  const chooseService = useCallback(
    (serviceName) => {
      updateSettings({ selectedViewingService: serviceName });
      setScreen('vocab');
    },
    [updateSettings]
  );

  // 「おすすめから探す」専用画面を開く（履歴あり時の＋追加導線から）
  const openRecommend = useCallback(() => setScreen('recommend'), []);

  // タイトル検索の結果画面を開く（ダッシュボードの検索ボックスから）。
  // 候補をインライン表示せず、おすすめと同じく独立画面へ遷移する。
  const [searchQuery, setSearchQuery] = useState('');
  const openSearch = useCallback((q) => {
    setSearchQuery(q || '');
    setScreen('search');
  }, []);

  // おすすめカードのタップ → 最短ルートで既存フローに合流（仕様：クリック後の動作）。
  // - 既存の selectedDrama 形式に変換（recommendedToDrama）して openDrama に渡す
  //   → myDramas への追加・season/episode 初期化・前回サービスのクリアは openDrama が担当
  // - 契約サービスが1つだけなら、その場で確定してエピソード選択（vocab）へ直行
  // - 複数あるなら openDrama が遷移済みのサービス選択画面で選んでもらう
  const startFromRecommend = useCallback(
    (item) => {
      const services = settings.selectedServices || [];
      const drama = recommendedToDrama(item, settings.userLevel || 'B1');
      openDrama(drama, true); // → screen='service-select'・myDramas追加・視聴サービスクリア
      if (services.length === 1) {
        chooseService(services[0]); // → selectedViewingService 確定・screen='vocab'
      }
    },
    [openDrama, chooseService, settings.selectedServices, settings.userLevel]
  );

  const goHome = useCallback(() => {
    // プロフィール選択済みならメイン、未選択ならプロフィール選択画面へ
    setScreen(profile ? 'main' : 'profile-select');
  }, [profile]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const openWordbook = useCallback(() => setWordbookOpen(true), []);
  const closeWordbook = useCallback(() => setWordbookOpen(false), []);
  const bumpWordbook = useCallback(() => setWordbookVersion((v) => v + 1), []);

  // テスト画面へ（VocabScreen の「テストを受ける」）
  const goToQuiz = useCallback(() => setScreen('quiz'), []);

  // 復習モーダルの開閉（ダッシュボード・単語リストの両方から呼ぶ）
  const openReview = useCallback((words) => setReviewWords(words || []), []);
  const closeReview = useCallback(() => {
    setReviewWords(null);
    setReviewVersion((v) => v + 1); // ダッシュボード/単語リストの再集計を促す
  }, []);

  // 拡張機能の導入ガイドの開閉
  const openGuide = useCallback(() => setGuideOpen(true), []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  // ウェルカム・チュートリアル（ヘッダーの「?」から再表示・常に help モード）
  const openTutorial = useCallback(() => setTutorial('help'), []);
  const closeTutorial = useCallback(() => {
    try {
      localStorage.setItem('cl_tutorial_seen', '1');
    } catch {
      /* ignore */
    }
    // オンボーディング流入時のみ、閉じたら作品追加モーダルへ橋渡しする。
    if (tutorial === 'onboarding') setPendingAddDrama({ tab: 'search', query: '' });
    setTutorial(null);
  }, [tutorial]);

  // 既存ユーザーが初めてダッシュボードに来たときの自動表示（端末ごとに一度だけ）。
  // オンボーディング直後は finishOnboarding が 'onboarding' を立てるので、ここはスキップされる。
  useEffect(() => {
    if (!mounted || !profile || screen !== 'main' || settingsOpen || tutorial) return;
    try {
      if (localStorage.getItem('cl_tutorial_seen') === '1') return;
    } catch {
      return;
    }
    setTutorial('help');
  }, [mounted, profile, screen, settingsOpen, tutorial]);

  const value = {
    profile,
    settings,
    updateSettings,
    screen,
    setScreen,
    drama,
    setDrama,
    season,
    setSeason,
    episode,
    setEpisode,
    selectProfile,
    addProfile,
    deleteProfile,
    switchProfile,
    finishOnboarding,
    pendingAddDrama,
    setPendingAddDrama,
    settingsOpen,
    openSettings,
    closeSettings,
    wordbookOpen,
    openWordbook,
    closeWordbook,
    wordbookVersion,
    bumpWordbook,
    authOpen,
    openAuth,
    closeAuth,
    onLoggedIn,
    loggedIn,
    signOut,
    cloudVersion,
    refreshFromCloud,
    openDrama,
    chooseService,
    openRecommend,
    searchQuery,
    openSearch,
    startFromRecommend,
    toggleGenre,
    goHome,
    mounted,
    quizData,
    setQuizData,
    currentHistoryId,
    setCurrentHistoryId,
    reviewWords,
    openReview,
    closeReview,
    reviewVersion,
    goToQuiz,
    tutorial,
    openTutorial,
    closeTutorial,
    guideOpen,
    openGuide,
    closeGuide,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
