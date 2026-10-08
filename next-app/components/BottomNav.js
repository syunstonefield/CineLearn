'use client';

// 常設ボトムタブ（ホーム / 単語帳 / 復習 / あゆみ / 半券）。設定はヘッダー右上へ移した（オーナー 2026-10-08）。
// あゆみ＝3重の円＋学習した日（草）＋週ごとの推移（VocabJourneyScreen・オーナー 2026-10-08）。
// 親指動線を最優先し、復習タブには未消化件数のバッジを出す。
// PC幅でも常時表示（バー全幅・タブ群は中央寄せ）。ヘッダーの単語帳は集約のため隠す。

import { useApp } from './AppProvider';
import { featureAccess, usePlan } from '@/lib/plan';

const ICON = {
  strokeWidth: 1.8,
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function IconHome() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

function IconReview() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

// あゆみ（右上がりの足あと＝積み上げ）
function IconJourney() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M3 20h18" />
      <rect x="5" y="13" width="3" height="5" rx="0.8" />
      <rect x="10.5" y="9" width="3" height="9" rx="0.8" />
      <rect x="16" y="5" width="3" height="13" rx="0.8" />
    </svg>
  );
}

function IconTicket() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </svg>
  );
}

export default function BottomNav({ dueCount = 0, wordCount = 0 }) {
  const {
    screen,
    goHome,
    openWordbook,
    openReviewHub,
    settingsOpen,
    openCollection,
    openJourney,
    reviewWords,
    loggedIn,
  } = useApp();
  // あゆみはプラス（オーナー 2026-10-09）。正式版の無料の人には下のタブに出さない（押せない枠を置かない）＝設定に説明を置く。
  const journeyLocked = featureAccess('ring', usePlan(loggedIn)).locked;

  // 復習タブは即・横断復習ではなく復習ハブへ（エピソード選択／ランダムを選ばせる）。
  const onReview = openReviewHub;

  // アクティブ判定：モーダル系（復習/単語帳/設定）が開いていればそれを優先、
  // それ以外でメイン系画面ならホームを点灯する。
  const reviewActive = !!reviewWords || screen === 'review-hub';
  const wordbookActive = !reviewActive && screen === 'wordbook';
  const collectionActive = !reviewActive && screen === 'collection';
  const journeyActive = !reviewActive && screen === 'journey';
  const settingsActive = !reviewActive && settingsOpen;
  const homeActive = !reviewActive && !wordbookActive && !collectionActive && !journeyActive && !settingsActive && screen === 'main';

  // badgeKind: 'urgent'（赤・要対応＝復習）/ 'count'（中立・在庫＝単語帳）
  const tab = (active, onClick, icon, label, badge, badgeKind) => (
    <button
      className={'bottom-nav-tab' + (active ? ' is-active' : '')}
      onClick={onClick}
      aria-label={badge > 0 ? `${label}（${badge}）` : label}
      aria-current={active ? 'page' : undefined}
    >
      <span className="bottom-nav-icon">
        {icon}
        {badge > 0 && (
          <span className={'bottom-nav-badge' + (badgeKind === 'count' ? ' is-count' : '')}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="bottom-nav-label">{label}</span>
    </button>
  );

  return (
    <nav className="bottom-nav" aria-label="メインナビゲーション">
      {/* 復習=最頻機能を親指が届く中ほどに配置（2026-07-03 実使用フィードバック#15）。あゆみは復習の後ろ（2026-10-08） */}
      {tab(homeActive, goHome, <IconHome />, 'ホーム', 0)}
      {tab(wordbookActive, openWordbook, <IconBook />, '単語帳', wordCount, 'count')}
      {tab(reviewActive, onReview, <IconReview />, '復習', dueCount, 'urgent')}
      {!journeyLocked && tab(journeyActive, openJourney, <IconJourney />, 'あゆみ', 0)}
      {tab(collectionActive, openCollection, <IconTicket />, '半券', 0)}
    </nav>
  );
}
