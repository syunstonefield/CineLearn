'use client';

import { useMemo } from 'react';
import AppProvider, { useApp, PROFILE_SELECT_ENABLED } from '@/components/AppProvider';
import Header from '@/components/Header';
import Dashboard from '@/components/Dashboard';
import ServiceSelect from '@/components/ServiceSelect';
import VocabScreen from '@/components/VocabScreen';
import QuizScreen from '@/components/QuizScreen';
import ReviewModal from '@/components/ReviewModal';
import PrepQuiz from '@/components/PrepQuiz';
import PrepLaunch from '@/components/PrepLaunch';
import PrepWalkthrough from '@/components/PrepWalkthrough';
import SettingsScreen from '@/components/SettingsScreen';
import ProfileSelect from '@/components/ProfileSelect';
import WordbookScreen from '@/components/WordbookScreen';
import TicketCollectionScreen from '@/components/TicketCollectionScreen';
import AuthModal from '@/components/AuthModal';
import Onboarding from '@/components/Onboarding';
import RecommendScreen from '@/components/RecommendScreen';
import SearchScreen from '@/components/SearchScreen';
import BottomNav from '@/components/BottomNav';
import WelcomeTutorial from '@/components/WelcomeTutorial';
import ExtensionGuide from '@/components/ExtensionGuide';
import SplashScreen from '@/components/SplashScreen';
import { getActiveWordCount, getDueReviewWords, DAILY_REVIEW_CAP } from '@/lib/storage';

// まだ移植していない画面の仮ハンドラ
function notYet(name) {
  alert(`「${name}」は次のステップで移植予定です（Next.js版 試作中）`);
}


function AppShell() {
  const {
    profile,
    screen,
    goHome,
    mounted,
    reviewWords,
    reviewAsPage,
    prepQuiz,
    prepLaunch,
    prepWalk,
    reviewVersion,
    openSettings,
    switchProfile,
    openWordbook,
    wordbookVersion,
    authOpen,
    openAuth,
    closeAuth,
    loggedIn,
    signOut,
    cloudVersion,
    tutorial,
    openTutorial,
    guideOpen,
    setScreen,
  } = useApp();
  // localStorage 依存はマウント後のみ（SSR/初回レンダーは 0 で統一）。
  // getActiveWordCount は最大2000語をJSON.parseするので、毎レンダーではなく
  // 関連する依存（profile/単語帳削除/クラウド取込）が変わった時だけ再計算する。
  const wordCount = useMemo(
    () => (mounted ? getActiveWordCount(profile?.id) : 0),
    [mounted, profile, wordbookVersion, cloudVersion]
  );
  // ボトムナビ「復習」バッジ用の未消化件数（今日の上限まで）。
  // 復習完了（reviewVersion）・クラウド取込・単語帳更新で再計算する。
  const dueCount = useMemo(
    () => (mounted ? Math.min(getDueReviewWords().length, DAILY_REVIEW_CAP) : 0),
    [mounted, profile, reviewVersion, cloudVersion, wordbookVersion]
  );
  // ボトムナビはアプリ内（プロフィール選択済み）でのみ表示。
  // プロフィール選択・オンボーディング中は出さない。
  const showBottomNav = !!profile && screen !== 'profile-select' && screen !== 'onboarding';
  // プロフィール選択画面ではヘッダーのプロフィールチップを隠す（既存挙動）
  const headerProfile = screen === 'profile-select' ? null : profile;

  // 復習はページ表示（reviewAsPage）時、他画面に代わって <main> 内に出す（ボトムナビ表示）。
  const reviewPage = !!reviewWords && reviewAsPage;

  return (
    <>
      {/* オンボーディング中は全画面ウィザード（Duolingo風）にするためヘッダーを隠す */}
      {screen !== 'onboarding' && (
        <Header
          profile={headerProfile}
          wordCount={wordCount}
          onLogoClick={goHome}
          onSwitchProfile={PROFILE_SELECT_ENABLED ? switchProfile : null}
          onAddDrama={() => setScreen('search')}
          onWordbook={openWordbook}
          onSettings={openSettings}
          onHelp={openTutorial}
          loggedIn={loggedIn}
          onAuth={openAuth}
          onSignOut={signOut}
        />
      )}

      <main id="mainContent">
        {/* 復習（ページ表示）は他画面に代わって <main> 内に出す＝ボトムナビ表示・横スワイプ移動可 */}
        {reviewPage ? (
          <ReviewModal asPage />
        ) : (
          <>
            {/* 封印中（PROFILE_SELECT_ENABLED=false）は「だれが観ますか？」を描画しない。
                AppProvider の自動遷移エフェクトが既定プロフィールへ入れるまでの一瞬だけ空になる。 */}
            {screen === 'profile-select' && PROFILE_SELECT_ENABLED && <ProfileSelect />}
            {screen === 'onboarding' && <Onboarding />}
            {screen === 'main' && <Dashboard />}
            {screen === 'recommend' && <RecommendScreen />}
            {screen === 'search' && <SearchScreen />}
            {screen === 'service-select' && <ServiceSelect />}
            {screen === 'vocab' && <VocabScreen />}
            {screen === 'quiz' && <QuizScreen />}
            {screen === 'collection' && <TicketCollectionScreen />}
            {screen === 'wordbook' && <WordbookScreen />}
            {screen === 'settings' && <SettingsScreen />}
          </>
        )}
      </main>

      {/* 予習フラッシュカードは従来どおり没入オーバーレイ（ページ扱いにしない） */}
      {reviewWords && !reviewAsPage && <ReviewModal />}
      {prepQuiz && <PrepQuiz />}
      {prepLaunch && <PrepLaunch />}
      {prepWalk && <PrepWalkthrough />}
      {authOpen && <AuthModal />}
      {tutorial && <WelcomeTutorial />}
      {guideOpen && <ExtensionGuide />}

      <div
        style={{
          textAlign: 'center',
          padding: 12,
          fontSize: 11,
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          marginTop: 'auto',
        }}
      >
        This product uses the TMDB API but is not endorsed or certified by{' '}
        <a href="https://www.themoviedb.org" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)' }}>
          TMDB
        </a>
        .
      </div>

      {/* 固定ボトムナビの高さ分、最下部に余白を確保（モバイルのみ・CSSで高さ制御） */}
      {showBottomNav && <div className="bottom-nav-spacer" aria-hidden="true" />}
      {showBottomNav && <BottomNav dueCount={dueCount} wordCount={wordCount} />}
    </>
  );
}

export default function Page() {
  return (
    <AppProvider>
      <AppShell />
      {/* 起動スプラッシュ：最前面で画面を覆い、約1.4秒後に自動で消える */}
      <SplashScreen />
    </AppProvider>
  );
}
