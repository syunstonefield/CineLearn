'use client';

import { IconClose } from './icons/LineIcons';
import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { supaSignIn, supaSignUp, pullFromCloud, migrateLocalToCloudAfterLogin, getSession } from '@/lib/supabase';
import { prepareDeviceForAccount } from '@/lib/deviceAccount';
import { isExtInstallEntry } from '@/lib/extEntry';
import { shouldClearSeenFlagsOnSignup } from '@/lib/firstRun';
import { loadProfiles } from '@/lib/storage';
import { trackUsage } from '@/lib/usage';

// ログイン／新規登録モーダル。リード文は「同期される」ことだけを伝える（旧「試作版・読み取り専用」文言は
// 公開ターゲットが本番に確定した時点で実態と合わなくなったため撤去・A24(2)）。
// ログイン成功時は pullFromCloud のみ（pushLocalToCloud は本番書き込みになるため移植しない）。
export default function AuthModal() {
  const { closeAuth, onLoggedIn, authMode, screen, settings, leaveTrialForAccount } = useApp();
  const inTrial = screen === 'trial' || screen === 'intro'; // スライド式（components/IntroCarousel.js）も初めての流れとして同じ扱い
  // 拡張を入れた直後に開いたタブは「新規登録」から始める（ほとんどの人はまだアカウントが無い）。
  //   このモーダルはクライアントでだけ描画されるので、初期値で印を読める。
  const [extEntry] = useState(isExtInstallEntry);
  //   openAuth({ mode }) で指定があればそのタブから（初回体験など）。
  const [mode, setMode] = useState(authMode || (extEntry ? 'signup' : 'login')); // 'login' | 'signup'
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
    // ログインの前に端末に残っていたセッションの持ち主（期限切れのまま別の人が入る時の見分けに使う・lib/deviceAccount.js）
    const prevSessionUid = getSession()?.user?.id || null;
    const result = mode === 'login' ? await supaSignIn(email.trim(), password) : await supaSignUp(email.trim(), password);
    setBusy(false);

    if (result?.access_token) {
      trackUsage(mode === 'signup' ? 'auth_signup' : 'auth_login');
      // 前回この端末で使っていたアカウントと違う人なら、合算（pull）と引き継ぎの前に端末の学習データを消す。
      //   同じアカウントの入り直し・ゲストや体験からの初めての登録（前回のアカウントが無い）は消さない。
      prepareDeviceForAccount(result.user?.id || getSession()?.user?.id, { prevSessionUid });
      // 新規登録＝まっさらなアカウント。「一度見た」系フラグを消して初回の流れを必ず出す。
      // 前アカウントの残留フラグでスキップされる事故の防止（signOut と同じリセット）。
      // ただし体験中・体験後・利用中のゲストは消さない＝旧アンケートと使い方を復活させない（lib/firstRun.js）。
      if (mode === 'signup') {
        const onboarded = !!settings?.onboarded || loadProfiles().some((p) => p?.settings?.onboarded);
        const keys = shouldClearSeenFlagsOnSignup({ inTrial, onboarded })
          ? ['cl_onboarded', 'cl_tutorial_seen', 'cl_ext_banner_dismissed']
          : ['cl_ext_banner_dismissed'];
        keys.forEach((k) => {
          try {
            localStorage.removeItem(k);
          } catch {
            /* ignore */
          }
        });
      }
      // 読み取り専用：クラウド → localStorage。体験中に既存アカウントへ入る時は、そのアカウントのプロフィールで入り直す
      //   （体験の記録は引き継がない）。それ以外は、クラウドが空なら端末の履歴・プロフィールを pull の前に送る（設計の修正 A）。
      if (mode === 'login' && inTrial) {
        await leaveTrialForAccount(() => pullFromCloud());
      } else {
        await migrateLocalToCloudAfterLogin();
        await pullFromCloud();
      }
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
            <IconClose />
          </button>
        </div>
        <div className="auth-body">
          {inTrial && authMode === 'signup' ? (
            <p className="auth-lead">登録して学習記録を残す</p>
          ) : extEntry ? (
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
            // iPhone でメール欄のキーボードが日本語で出る件（2026-11-05 オーナー）: Web からキーボードの言語は指定できないので、
            // 先頭の大文字化・自動修正・スペルチェックを切って入力ミスを減らす。type=email と autoComplete=email はそのまま。
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <input
            type="password"
            className="auth-input"
            placeholder="パスワード（6文字以上）"
            // 新規登録は new-password（iPhone の強いパスワードの提案が出る）・ログインは current-password（保存済みの候補が出る）
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
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
          {/* 法務指定の一文（2026-11-05・docs/design-first-run-trial-2026-11-05.md）。文言を変える時は法務へ。 */}
          {mode === 'signup' && (
            <p className="auth-consent">
              登録すると、
              <a href="/terms" target="_blank" rel="noopener">
                利用規約
              </a>
              と
              <a href="/privacy" target="_blank" rel="noopener">
                プライバシーポリシー
              </a>
              に同意したものとみなします。
            </p>
          )}
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
