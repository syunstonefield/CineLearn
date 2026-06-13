'use client';

// 既存 index.html の <header> を再現
export default function Header({
  profile,
  wordCount,
  onLogoClick,
  onSwitchProfile,
  onWordbook,
  onSettings,
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
        <button className="btn-header-icon" title="単語帳" onClick={onWordbook}>
          📖<span className="header-badge">{wordCount > 0 ? wordCount : ''}</span>
        </button>
        <button className="btn-header-icon" title="設定" onClick={onSettings}>
          ⚙️
        </button>
        {loggedIn ? (
          <button className="btn-header-icon" title="ログアウト" onClick={onSignOut}>
            🚪
          </button>
        ) : (
          <button className="btn-header-icon" title="ログイン（クラウド読込）" onClick={onAuth}>
            🔑
          </button>
        )}
      </div>
    </header>
  );
}
