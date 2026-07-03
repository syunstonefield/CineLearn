'use client';

// 常設ボトムタブ（ホーム / 復習 / 単語帳 / 半券 / 設定）。
// 親指動線を最優先し、復習タブには未消化件数のバッジを出す。
// PC幅でも常時表示（バー全幅・タブ群は中央寄せ）。ヘッダーの単語帳/設定は集約のため隠す。

import { useApp } from './AppProvider';
import { getDueReviewWords, DAILY_REVIEW_CAP } from '@/lib/storage';

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

function IconTicket() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function BottomNav({ dueCount = 0, wordCount = 0 }) {
  const {
    screen,
    goHome,
    openWordbook,
    openSettings,
    openReview,
    setCurrentHistoryId,
    settingsOpen,
    openCollection,
    reviewWords,
  } = useApp();

  const onReview = () => {
    // 横断復習（特定エピソードに紐づかない）→ historyId は null（Dashboard と同形）
    setCurrentHistoryId(null);
    openReview(getDueReviewWords().slice(0, DAILY_REVIEW_CAP));
  };

  // アクティブ判定：モーダル系（復習/単語帳/設定）が開いていればそれを優先、
  // それ以外でメイン系画面ならホームを点灯する。
  const reviewActive = !!reviewWords;
  const wordbookActive = !reviewActive && screen === 'wordbook';
  const collectionActive = !reviewActive && screen === 'collection';
  const settingsActive = !reviewActive && settingsOpen;
  const homeActive = !reviewActive && !wordbookActive && !collectionActive && !settingsActive && screen === 'main';

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
      {/* 復習=最頻機能を親指が最も届く中央に配置（2026-07-03 実使用フィードバック#15） */}
      {tab(homeActive, goHome, <IconHome />, 'ホーム', 0)}
      {tab(wordbookActive, openWordbook, <IconBook />, '単語帳', wordCount, 'count')}
      {tab(reviewActive, onReview, <IconReview />, '復習', dueCount, 'urgent')}
      {tab(collectionActive, openCollection, <IconTicket />, '半券', 0)}
      {tab(settingsActive, openSettings, <IconSettings />, '設定', 0)}
    </nav>
  );
}
