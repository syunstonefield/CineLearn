'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { supaSignIn, supaSignUp, pullFromCloud, migrateLocalToCloudAfterLogin } from '@/lib/supabase';
import { isExtInstallEntry } from '@/lib/extEntry';
import { trackUsage } from '@/lib/usage';

// ログイン／新規登録モーダル。リード文は「同期される」ことだけを伝える（旧「試作版・読み取り専用」文言は
// 公開ターゲットが本番に確定した時点で実態と合わなくなったため撤去・A24(2)）。
// ログイン成功時は pullFromCloud のみ（pushLocalToCloud は本番書き込みになるため移植しない）。
export default function AuthModal() {
  const { closeAuth, onLoggedIn } = useApp();
  // 拡張を入れた直後に開いたタブは「新規登録」から始める（ほとんどの人はまだアカウントが無い）。
  //   このモーダルはクライアントでだけ描画されるので、初期値で印を読める。
  const [extEntry] = useState(isExtInstallEntry);
  const [mode, setMode] = useState(extEntry ? 'signup' : 'login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 利用データ（lib/usage.js）: 表示された回数。どう抜けたかは下の auth_signup／auth_login／auth_local。
  useEffect(() => {
    trackUsage('auth_shown');
  }, []);

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
      trackUsage(mode === 'signup' ? 'auth_signup' : 'auth_login');
      // 新規登録＝まっさらなアカウント。「一度見た」系フラグを消して初回体験
      // （アンケート・チュートリアル・拡張バナー）を必ず出す。前アカウントの
      // 残留フラグでスキップされる事故の防止（signOut と同じリセット）。
      if (mode === 'signup') {
        ['cl_onboarded', 'cl_tutorial_seen', 'cl_ext_banner_dismissed'].forEach((k) => {
          try {
            localStorage.removeItem(k);
          } catch {
            /* ignore */
          }
        });
      }
      await migrateLocalToCloudAfterLogin(); // クラウドが空なら端末の履歴・プロフィールを先に送る（初回体験 A・pull より前・この1行は残す）
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
          {extEntry ? (
            <p className="auth-lead">
              拡張機能を追加しました。次はアプリへの登録（ログイン）です。そのあと、動画の字幕の単語をクリックすると保存できます。
              <br />
              <b>ログインしていないと、拡張機能で保存した単語はアプリに届きません。</b>
            </p>
          ) : (
            <p className="auth-lead">
              ログインすると単語・履歴がスマホ / PC / 拡張機能で同期されます。
            </p>
          )}
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
          <button
            className="btn-secondary"
            onClick={() => {
              trackUsage('auth_local');
              closeAuth();
            }}
          >
            このデバイスのみで使う
          </button>
          {/* 拡張の保存先はログイン済みアカウント。未ログインで拡張を使うと単語が届かないため、
              「このデバイスのみ」を選ぶ前にその制約を明示する（A24(2)） */}
          <p style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>
            ※ Chrome 拡張で保存した単語は同期されません
          </p>
          {/* 法務指定の注記（2026-11-04・オーナー承認）。文言を変える時は法務へ。拡張部門の変更と合流する時に消さないこと。 */}
          <p style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>
            学習データはこの端末に保存します。利用統計は設定でオフにできます。
          </p>
        </div>
      </div>
    </div>
  );
}
