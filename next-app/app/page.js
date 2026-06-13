'use client';

import { useMemo } from 'react';
import AppProvider, { useApp } from '@/components/AppProvider';
import Header from '@/components/Header';
import Dashboard from '@/components/Dashboard';
import ServiceSelect from '@/components/ServiceSelect';
import VocabScreen from '@/components/VocabScreen';
import QuizScreen from '@/components/QuizScreen';
import ReviewModal from '@/components/ReviewModal';
import SettingsModal from '@/components/SettingsModal';
import ProfileSelect from '@/components/ProfileSelect';
import WordbookModal from '@/components/WordbookModal';
import AuthModal from '@/components/AuthModal';
import Onboarding from '@/components/Onboarding';
import RecommendScreen from '@/components/RecommendScreen';
import { getActiveWordCount } from '@/lib/storage';

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
    settingsOpen,
    openSettings,
    closeSettings,
    switchProfile,
    wordbookOpen,
    openWordbook,
    wordbookVersion,
    authOpen,
    openAuth,
    closeAuth,
    loggedIn,
    signOut,
    cloudVersion,
  } = useApp();
  // localStorage 依存はマウント後のみ（SSR/初回レンダーは 0 で統一）。
  // getActiveWordCount は最大2000語をJSON.parseするので、毎レンダーではなく
  // 関連する依存（profile/単語帳削除/クラウド取込）が変わった時だけ再計算する。
  const wordCount = useMemo(
    () => (mounted ? getActiveWordCount(profile?.id) : 0),
    [mounted, profile, wordbookVersion, cloudVersion]
  );
  // プロフィール選択画面ではヘッダーのプロフィールチップを隠す（既存挙動）
  const headerProfile = screen === 'profile-select' ? null : profile;

  return (
    <>
      <Header
        profile={headerProfile}
        wordCount={wordCount}
        onLogoClick={goHome}
        onSwitchProfile={switchProfile}
        onWordbook={openWordbook}
        onSettings={openSettings}
        loggedIn={loggedIn}
        onAuth={openAuth}
        onSignOut={signOut}
      />

      <main id="mainContent">
        {screen === 'profile-select' && <ProfileSelect />}
        {screen === 'onboarding' && <Onboarding />}
        {screen === 'main' && <Dashboard />}
        {screen === 'recommend' && <RecommendScreen />}
        {screen === 'service-select' && <ServiceSelect />}
        {screen === 'vocab' && <VocabScreen />}
        {screen === 'quiz' && <QuizScreen />}
      </main>

      {reviewWords && <ReviewModal />}
      {settingsOpen && <SettingsModal onClose={closeSettings} />}
      {wordbookOpen && <WordbookModal />}
      {authOpen && <AuthModal />}

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
    </>
  );
}

export default function Page() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
