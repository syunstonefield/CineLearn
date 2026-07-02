'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { loadProfiles, saveProfiles, patchProfileSettings, unarchiveDrama } from '@/lib/storage';
import { issueTicket as issueTicketLib, loadTickets } from '@/lib/tickets';
import { addStudySeconds, addDramaStudySeconds } from '@/lib/studytime';
import { applyTheme, getThemePref } from '@/lib/theme';
import {
  ensureFreshSession,
  pullFromCloud,
  isLoggedIn,
  supaSignOut,
  clearSession,
  deleteProfileRow,
} from '@/lib/supabase';
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
  // オンボーディング（初回ログイン時の6問アンケート）で取得・記憶する項目。
  learningGoal: null, // 学ぶ目的（subtitles-free/travel/work/exam/hobby）
  learnStyle: null, // 学習スタイル fun=楽しく / efficient=効率的に（映画館演出の既定に効かせる）
  referralSource: null, // 流入元（どこでCineLearnを知ったか）＝マーケ参考
  onboarded: false, // 初回アンケート完了フラグ。true 以降はオンボーディングを出さない。
};

const AVATAR_COLORS = [
  '#E50914', '#1A73E8', '#2E7D32', '#7B1FA2',
  '#E65100', '#00695C', '#F57F17', '#AD1457',
];

// プロフィール選択（「だれが観ますか？」マルチプロフィール）の封印フラグ。
// 単一ユーザー運用に寄せるため、選択画面を出さず既定プロフィールへ直行する。
// ★戻したくなったら true にするだけ。ProfileSelect コンポーネントや
//   addProfile / selectProfile / switchProfile などのロジックは全て残してある。
export const PROFILE_SELECT_ENABLED = false;
// 封印時、ローカルにプロフィールが1つも無い新規ユーザー向けに静かに作る既定名。
const DEFAULT_PROFILE_NAME = 'あなた';

// 使い方ガイドは「自動ポップアップは端末ごとに一度だけ」。閉じる時ではなく
// “表示した瞬間”に既読化する（閉じずにリロード／タブを閉じても再表示しないため）。
// 以降は必要な人がヘッダーの「?」から開く。
function markTutorialSeen() {
  try {
    localStorage.setItem('cl_tutorial_seen', '1');
  } catch {
    /* ignore */
  }
}

// オンボーディング（初回アンケート）の既読は「端末ごとに一度だけ」。
// ★重要★ cl_profiles はログイン時の pullFromCloud で丸ごと上書きされ、
// クラウド未同期の settings.onboarded が毎回消える＝「アンケートが毎回出る」バグになる。
// そこで既読フラグは cl_tutorial_seen と同様に端末ローカルの独立キーで持ち、
// クラウド同期に左右されないようにする（pull は cl_onboarded を触らない）。
function markOnboardedSeen() {
  try {
    localStorage.setItem('cl_onboarded', '1');
  } catch {
    /* ignore */
  }
}
function hasOnboardedSeen() {
  try {
    return localStorage.getItem('cl_onboarded') === '1';
  } catch {
    return false;
  }
}

export default function AppProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // 'profile-select'（だれが観ますか）から開始。選択後に 'main' へ。
  const [screen, setScreen] = useState('profile-select'); // | 'service-select' | 'vocab' | 'quiz' | 'settings'
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
  const [reviewWords, setReviewWords] = useState(null); // null=復習閉
  const [reviewAll, setReviewAll] = useState(false); // true=SRS期日に関係なく全語をカード化（半券のシーン記憶カード用）
  // 復習の表示形態：true=ページ（タブ/今日の復習。<main>内・ボトムナビ表示・横スワイプ移動可）／
  // false=オーバーレイ（予習のフラッシュカード＝従来の没入モーダル）。
  const [reviewAsPage, setReviewAsPage] = useState(false);
  const [reviewVersion, setReviewVersion] = useState(0); // 復習完了後の再集計トリガ
  // 半券（観た証）：予習クイズ完了で1枚発行し、ホームの「あの場面を思い出す」入口に使う。
  const [tickets, setTickets] = useState([]);
  // 予習エンジン（Prep Engine）：phase を汚さずに open/close で重ねるモーダル。
  //   prepQuiz   : 「今夜のリハーサル」クイズ3問。null=閉 / { questions, meta }
  //   prepLaunch : 完了 launch ramp。null=閉 / { variant:'quiz'|'cards'|'watch', ...payload }
  const [prepQuiz, setPrepQuiz] = useState(null);
  const [prepLaunch, setPrepLaunch] = useState(null);
  // 予習ウォークスルー（生成直後・全語を1枚ずつ通し見）。null=閉 / { words, meta }
  const [prepWalk, setPrepWalk] = useState(null);
  // 予習の「じっくり覚える」で ReviewModal を起動したとき、閉じたら cards バリエの
  // launch ramp を出すための保留ペイロード（{ words, drama, title, ... } | null）。
  const pendingPrepCardsRef = useRef(null);
  // 初回ウェルカム・チュートリアル：null=閉 / 'onboarding'（設定完了直後→閉じると作品追加へ）/ 'help'（？ボタン再表示）。
  // 「見た」フラグは cl_tutorial_seen（端末ローカル・クラウド同期に左右されない）に保存する。
  const [tutorial, setTutorial] = useState(null);
  // 拡張機能の導入ガイド（モーダル）。チュートリアルのスライド・ダッシュボードの常設バナーから開く。
  const [guideOpen, setGuideOpen] = useState(false);
  // localStorage はクライアントのマウント後にしか読めない。
  // SSR/初回クライアントレンダーは mounted=false で統一し、ハイドレーション不一致を防ぐ。
  const [mounted, setMounted] = useState(false);
  // 起動時の認証判定（オートログイン or ログインモーダル表示）が終わるまでは
  // プロフィール自動遷移を待たせるためのフラグ（封印モードでのみ参照）。
  const [bootstrapping, setBootstrapping] = useState(true);

  // テーマ適用（描画前スクリプトと同期）＋システムテーマ変更の追従（pref='system'時）。
  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      if (getThemePref() === 'system') applyTheme('system');
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    setMounted(true);
    // SW 登録（push 通知の受信路。fetch ハンドラ無しなので配信には干渉しない）。
    // 購読済みユーザーがアプリを開くだけで SW が最新化される。
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
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
      } finally {
        // 認証判定完了。封印モードの自動遷移エフェクトをここから動かす。
        setBootstrapping(false);
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
    // cl_profiles_updated_at も一緒に消す（古い時刻が残ると次のログインの
    // 「新しい方が勝つ」比較に前ユーザーの時刻が混ざるため）。
    ['cl_profiles', 'cl_profiles_updated_at', 'cl_history', 'cl_srs', 'cl_my_words'].forEach((k) =>
      localStorage.removeItem(k)
    );
    setLoggedIn(false);
    setProfile(null);
    setScreen('profile-select');
    setCloudVersion((v) => v + 1);
    // 封印モードでは profile-select 画面を出さないので、ログアウト後はログイン/ようこそを
    // 再提示する（skip すれば自動遷移エフェクトが既定プロフィールへ入れる）。
    if (!PROFILE_SELECT_ENABLED) setAuthOpen(true);
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
    // 初回オンボーディング未完了なら、ログイン状態に関わらず1回だけアンケートへ。
    // 既読は端末ローカル(cl_onboarded)でも判定する＝クラウド pull で settings.onboarded が
    // 消えても、この端末で一度完了していれば二度と出さない（毎回出るバグの修正）。
    if (!s.onboarded && !hasOnboardedSeen()) {
      setScreen('onboarding');
      return;
    }
    setScreen('main');
    // 未設定（TOEIC/サービス未入力）なら設定ページを開く（オンボーディング代替）
    if (!s.toeicScore || !(s.selectedServices || []).length) setScreen('settings');
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
    // 端末で既にオンボーディング済みなら（cl_profiles だけ消えた等）アンケートを出さない。
    setScreen(hasOnboardedSeen() ? 'main' : 'onboarding');
  }, []);

  // オンボーディング完了（既存 finishOnboarding 相当）：
  // 設定を保存してメインへ → ドラマ追加モーダルをタイトル検索タブで開く
  const [pendingAddDrama, setPendingAddDrama] = useState(null); // {tab, query} | null
  const finishOnboarding = useCallback((patch) => {
    // 端末ローカルに既読化（クラウド pull で settings.onboarded が消えても二度と出さない）。
    markOnboardedSeen();
    // 全回答を保存し、onboarded:true を必ず立てる（以降オンボーディングは出さない＝1回だけ）。
    setSettings((prev) => ({ ...prev, ...patch, onboarded: true }));
    setScreen('main');
    // 作品選びはホーム（おすすめ＋検索）に任せるため、ここでは追加モーダルを開かない。
    // 自動の使い方ガイドも抑止（オンボーディングで案内済み）。
    markTutorialSeen();
  }, []);

  const deleteProfile = useCallback((id) => {
    saveProfiles(loadProfiles().filter((x) => x.id !== id));
    // クラウド側の行も消す（upsert だけだと次回 pull で復活してしまう）。
    deleteProfileRow(id);
  }, []);

  // ヘッダーのプロフィール切替 → 選択画面へ戻る（現在の選択を解除）
  const switchProfile = useCallback(() => {
    setProfile(null);
    setScreen('profile-select');
  }, []);

  // プロフィール選択UI封印時の自動遷移。
  // 「未選択・ログインモーダル無し・起動判定済み」の状態になったら既定プロフィールへ入る。
  // この1本で startup（ログイン済み）/ skip / login後 / logout後 を全部カバーする。
  // ログイン済みでクラウドに複数プロフィールがある場合は先頭を採用（単一ユーザー運用の割り切り）。
  useEffect(() => {
    if (PROFILE_SELECT_ENABLED) return;
    if (!mounted || bootstrapping) return; // 認証判定が終わるまで待つ
    if (profile) return;                   // 既にアプリに入っている
    if (authOpen) return;                  // ログイン/ようこそ提示中は待つ
    const profiles = loadProfiles();
    if (profiles.length) selectProfile(profiles[0].id);
    else addProfile(DEFAULT_PROFILE_NAME); // 新規ユーザー → 既定プロフィールを作りオンボーディングへ
  }, [mounted, bootstrapping, profile, authOpen, selectProfile, addProfile]);

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
    // 棚から外していた作品を開き直したら自動で棚に戻す（アーカイブ解除）
    unarchiveDrama(d.title);
    // 2回目以降（ライブラリから再オープン＝clearService=false）で、前回の視聴サービスが
    // 分かっていればサービス選択を省略して直接 vocab へ。新規追加時(clearService)は従来どおり選択させる。
    const remembered = !clearService && d.viewingService ? d.viewingService : null;
    setSettings((prev) => {
      const exists = (prev.myDramas || []).some((x) => x.title === d.title);
      const myDramas = exists ? prev.myDramas : [...(prev.myDramas || []), d];
      const next = { ...prev, myDramas };
      if (clearService) next.selectedViewingService = null;
      else if (remembered) next.selectedViewingService = remembered;
      return next;
    });
    setScreen(remembered ? 'vocab' : 'service-select');
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
      // グローバルの「前回使用」に加え、作品ごとにも視聴サービスを記憶する
      // （2回目以降のオープンで openDrama がこれを見てサービス選択を省略する）。
      setSettings((prev) => {
        const myDramas = (prev.myDramas || []).map((x) =>
          drama && x.title === drama.title ? { ...x, viewingService: serviceName } : x
        );
        return { ...prev, selectedViewingService: serviceName, myDramas };
      });
      setScreen('vocab');
    },
    [drama]
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

  // 復習ページ（reviewWords）は <main> を占有するため、トップレベル画面へ移動する時は必ず閉じる。
  // これをしないと復習ページ表示中にボトムナビ/ヘッダーを押しても画面が変わらない（反応しないように見える）。
  const exitReviewPage = () => {
    setReviewWords(null);
    setReviewAsPage(false);
  };

  const goHome = useCallback(() => {
    exitReviewPage();
    // プロフィール選択済みならメイン、未選択ならプロフィール選択画面へ
    setScreen(profile ? 'main' : 'profile-select');
  }, [profile]);

  const openSettings = useCallback(() => {
    exitReviewPage();
    setScreen('settings');
  }, []);
  const closeSettings = useCallback(() => setScreen('main'), []);

  // マイ単語帳は全画面（ヘッダー・ボトムナビが見える）の screen として扱う。
  const openWordbook = useCallback(() => {
    exitReviewPage();
    setScreen('wordbook');
  }, []);
  const closeWordbook = useCallback(() => setScreen('main'), []);
  // 半券コレクションは全画面（ヘッダー・ボトムナビが見える）の screen として扱う。
  const openCollection = useCallback(() => {
    exitReviewPage();
    setScreen('collection');
  }, []);
  const closeCollection = useCallback(() => setScreen('main'), []);
  const bumpWordbook = useCallback(() => setWordbookVersion((v) => v + 1), []);

  // テスト画面へ（VocabScreen の「テストを受ける」）
  const goToQuiz = useCallback(() => setScreen('quiz'), []);

  // 復習モーダルの開閉（ダッシュボード・単語リストの両方から呼ぶ）
  // opts.all=true で SRS の期日フィルタを通さず全語をカード化（半券のシーン記憶カード用）。
  const openReview = useCallback((words, opts) => {
    setReviewAll(!!(opts && opts.all));
    setReviewAsPage(true); // タブ/今日の復習＝ページ表示（横スワイプ移動可）
    setReviewWords(words || []);
  }, []);
  const closeReview = useCallback(() => {
    setReviewWords(null);
    setReviewAsPage(false);
    setReviewVersion((v) => v + 1); // ダッシュボード/単語リストの再集計を促す
    // 予習の「じっくり覚える」で開いていたら、閉じた直後に cards の launch ramp を出す。
    const pending = pendingPrepCardsRef.current;
    if (pending) {
      pendingPrepCardsRef.current = null;
      setPrepLaunch({ variant: 'cards', ...pending });
    }
  }, []);
  // 予習からフラッシュカード（first-pass）を起動。閉じたら cards launch ramp を予約。
  const openPrepReview = useCallback((words, launchPayload) => {
    pendingPrepCardsRef.current = launchPayload || null;
    setReviewAsPage(false); // 予習フラッシュカードは従来どおり没入オーバーレイ
    setReviewWords(words || []);
  }, []);

  // 予習エンジン：クイズ／launch ramp の開閉（VocabScreen の下部3択から呼ぶ）。
  // openReview/closeReview と同じ素朴な open/close パターン。phase には触れない。
  const openPrepQuiz = useCallback((payload) => setPrepQuiz(payload || null), []);
  const closePrepQuiz = useCallback(() => setPrepQuiz(null), []);
  const openPrepLaunch = useCallback(
    (payload) => {
      setPrepLaunch(payload || null);
      // 予習クイズ完了＝半券を1枚発行（観た後の「あの場面を思い出す」入口に使う）。
      // cards/watch バリエはチケットを作らない（quiz のみ）。
      if (payload && payload.variant === 'quiz' && profile) {
        issueTicketLib(profile.id, payload);
        setTickets(loadTickets(profile.id));
      }
    },
    [profile]
  );
  const closePrepLaunch = useCallback(() => setPrepLaunch(null), []);
  // 予習ウォークスルーの開閉（VocabScreen の「予習する →」から開く）。
  const openPrepWalk = useCallback((payload) => setPrepWalk(payload || null), []);
  const closePrepWalk = useCallback(() => setPrepWalk(null), []);

  // 半券をタップ → そのエピソードの出題語を「シーン記憶カード」として開く。
  // 横断扱い（特定 historyId に紐づけない）＋全語表示（SRS期日で空にしない）。
  const openSceneCards = useCallback(
    (ticket) => {
      if (!ticket) return;
      setCurrentHistoryId(null);
      openReview(ticket.words || [], { all: true });
    },
    [openReview]
  );

  // 拡張機能の導入ガイドの開閉
  const openGuide = useCallback(() => setGuideOpen(true), []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  // ウェルカム・チュートリアル（ヘッダーの「?」から再表示・常に help モード）
  const openTutorial = useCallback(() => setTutorial('help'), []);
  const closeTutorial = useCallback(() => {
    markTutorialSeen(); // 表示時に既読化済みだが念のため
    // オンボーディング流入時のみ、閉じたら作品追加モーダルへ橋渡しする。
    if (tutorial === 'onboarding') setPendingAddDrama({ tab: 'search', query: '' });
    setTutorial(null);
  }, [tutorial]);

  // 既存ユーザーが初めてダッシュボードに来たときの自動表示（端末ごとに一度だけ）。
  // オンボーディング直後は finishOnboarding が 'onboarding' を立てるので、ここはスキップされる。
  useEffect(() => {
    if (!mounted || !profile || screen !== 'main' || tutorial) return;
    try {
      if (localStorage.getItem('cl_tutorial_seen') === '1') return;
    } catch {
      return;
    }
    markTutorialSeen(); // 表示と同時に既読化＝自動表示は一度だけ（以降は「?」から）
    setTutorial('help');
  }, [mounted, profile, screen, tutorial]);

  // 半券（観た証）をプロフィールごとに読み込む（クラウド同期はしない・端末ローカル）。
  useEffect(() => {
    setTickets(profile ? loadTickets(profile.id) : []);
  }, [profile]);

  // 学習画面に居る間だけ、選択中ドラマに時間を帰属させるための参照（作品別学習時間）。
  const studyDramaRef = useRef(null);
  useEffect(() => {
    const studying =
      screen === 'vocab' || screen === 'quiz' || !!reviewWords || !!prepQuiz || !!prepLaunch || !!prepWalk;
    studyDramaRef.current = studying && drama ? drama.title : null;
  }, [screen, drama, reviewWords, prepQuiz, prepLaunch, prepWalk]);

  // 学習時間（今から計測）: アプリを前景で開いている時間を秒で積算する（過去分は0）。
  // 離席（タブ非表示）は加算せず、長すぎる間隔は離席とみなして捨てる。
  // 学習画面に居る時は選択中ドラマにも帰属（作品別・詳細ページ用）。
  useEffect(() => {
    if (!mounted || !profile) return;
    let last = Date.now();
    const flush = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        last = Date.now();
        return;
      }
      const now = Date.now();
      const delta = (now - last) / 1000;
      last = now;
      if (delta > 0 && delta < 90) {
        addStudySeconds(profile.id, delta); // 90秒超は離席→捨てる
        if (studyDramaRef.current) addDramaStudySeconds(profile.id, studyDramaRef.current, delta);
      }
    };
    const iv = setInterval(flush, 20000);
    const onVis = () => { last = Date.now(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', flush);
    return () => {
      flush();
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', flush);
    };
  }, [mounted, profile]);

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
    settingsOpen: screen === 'settings',
    openSettings,
    closeSettings,
    openWordbook,
    closeWordbook,
    openCollection,
    closeCollection,
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
    reviewAll,
    reviewAsPage,
    openReview,
    closeReview,
    openPrepReview,
    reviewVersion,
    tickets,
    openSceneCards,
    goToQuiz,
    prepQuiz,
    openPrepQuiz,
    closePrepQuiz,
    prepLaunch,
    openPrepLaunch,
    closePrepLaunch,
    prepWalk,
    openPrepWalk,
    closePrepWalk,
    tutorial,
    openTutorial,
    closeTutorial,
    guideOpen,
    openGuide,
    closeGuide,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
