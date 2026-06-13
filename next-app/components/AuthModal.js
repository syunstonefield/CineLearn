'use client';

import { useState } from 'react';
import { useApp } from './AppProvider';
import { supaSignIn, supaSignUp, pullFromCloud } from '@/lib/supabase';

// 既存 authModal の再現（Supビュー読み取り専用）。
// ログイン成功時は pullFromCloud のみ（pushLocalToCloud は本番書き込みになるため移植しない）。
export default function AuthModal() {
  const { closeAuth, onLoggedIn } = useApp();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }
    setBusy(true);
    setError('');
    const result = mode === 'login' ? await supaSignIn(email.trim(), password) : await supaSignUp(email.trim(), password);
    setBusy(false);

    if (result?.access_token) {
      await pullFromCloud(); // 読み取り専用：クラウド → localStorage
      onLoggedIn();
    } else {
      setError(result?.error_description || result?.msg || 'エラーが発生しました');
    }
  };

  const overlayClick = (e) => {
    if (e.target === e.currentTarget) closeAuth();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={overlayClick}>
      <div className="modal-panel auth-modal-panel">
        <div className="modal-header" style={{ borderBottom: 'none', paddingBottom: 8 }}>
          <span className="modal-title" style={{ fontSize: 22 }}>
            🎬 CineLearn
          </span>
          <button className="modal-close" onClick={closeAuth}>
            ✕
          </button>
        </div>
        <div className="auth-body">
          <p className="auth-lead">
            ログインすると、本番アプリ（cine-learn.vercel.app）に保存した単語・履歴を
            この試作版でも読み込めます（読み取り専用・本番データは変更しません）。
          </p>
          <div className="auth-tabs">
            <button className={'auth-tab' + (mode === 'login' ? ' active' : '')} onClick={() => setMode('login')}>
              ログイン
            </button>
            <button className={'auth-tab' + (mode === 'signup' ? ' active' : '')} onClick={() => setMode('signup')}>
              新規登録
            </button>
          </div>
          <input
            type="email"
            className="auth-input"
            placeholder="メールアドレス"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <input
            type="password"
            className="auth-input"
            placeholder="パスワード（6文字以上）"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {error && (
            <div className="auth-error" style={{ display: 'block' }}>
              {error}
            </div>
          )}
          <button className="btn-primary" disabled={busy} onClick={submit}>
            {busy ? '処理中...' : mode === 'login' ? 'ログイン' : 'アカウントを作成'}
          </button>
          <div className="auth-divider">または</div>
          <button className="btn-secondary" onClick={closeAuth}>
            このデバイスのみで使う
          </button>
        </div>
      </div>
    </div>
  );
}
