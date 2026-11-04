'use client';
import { useApp } from './AppProvider';

// 体験の最初の画面（ようこそ）の下に出す入口（ログイン・規約リンク）。
//   設計の修正 D「ログイン入口は最初の画面に残す」・法務「最初の画面に利用規約とプライバシーポリシーのリンク」。
//   登録を済ませて来た人（拡張から来た人）にログインの入口は出さない。
export default function TrialAuthLinks() {
  const { openAuth, loggedIn } = useApp();
  return (
    <div className="trial-auth-links">
      {!loggedIn && (
        <button type="button" className="trial-text-link" onClick={() => openAuth({ mode: 'login' })}>
          すでにアカウントをお持ちの方はログイン
        </button>
      )}
      <div className="trial-legal-links">
        <a href="/terms" target="_blank" rel="noopener">
          利用規約
        </a>
        <a href="/privacy" target="_blank" rel="noopener">
          プライバシーポリシー
        </a>
      </div>
    </div>
  );
}
