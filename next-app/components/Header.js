'use client';

// 既存 index.html の <header> を再現。
// アイコンは OS依存の絵文字をやめ、単色のラインアイコン（currentColor）で統一する。

const ICON = {
  strokeWidth: 1.8,
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function IconBook() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.8 2.5-2.8 2.5" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </svg>
  );
}

function IconLogin() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function Header({
  profile,
  wordCount,
  onLogoClick,
  onSwitchProfile,
  onWordbook,
  onSettings,
  onHelp,
  loggedIn,
  onAuth,
  onSignOut,
}) {
  return (
    <header>
      <div className="logo" style={{ cursor: 'pointer' }} onClick={onLogoClick}>
        Cine<span>Learn</span>
      </div>
      <div className="header-right">
        {/* .btn-profile-switch のCSS既定は display:none。既存JSと同様に表示時だけ flex を当てる */}
        {profile && (
          <button
            className="btn-profile-switch"
            style={{ display: 'flex' }}
            title="プロフィールを切り替える"
            onClick={onSwitchProfile}
          >
            <span className="mini-avatar" style={{ background: profile.color }}>
              {profile.name.charAt(0)}
            </span>
            <span>{profile.name}</span>
          </button>
        )}
        {/* 単語帳・設定はモバイルではボトムナビと重複するため隠す（PCのみ表示） */}
        <button className="btn-header-icon header-only-desktop" title="単語帳" onClick={onWordbook}>
          <IconBook />
          <span className="header-badge">{wordCount > 0 ? wordCount : ''}</span>
        </button>
        <button className="btn-header-icon header-only-desktop" title="設定" onClick={onSettings}>
          <IconSettings />
        </button>
        {/* 使い方ガイド再表示。モバイルでもボトムナビに枠が無いのでヘッダーに常設する */}
        {profile && onHelp && (
          <button className="btn-header-icon" title="使い方ガイド" onClick={onHelp}>
            <IconHelp />
          </button>
        )}
        {loggedIn ? (
          <button className="btn-header-icon" title="ログアウト" onClick={onSignOut}>
            <IconLogout />
          </button>
        ) : (
          <button className="btn-header-icon" title="ログイン（クラウド読込）" onClick={onAuth}>
            <IconLogin />
          </button>
        )}
      </div>
    </header>
  );
}
