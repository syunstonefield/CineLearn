'use client';

// 拡張機能の導入ガイド（モーダル）。Chrome Web Store 公開済みのため、ストアから1クリックで追加する
// 3ステップ（①ストアで追加 → ②アプリにログイン → ③Netflix / Prime Video で字幕をクリック）を案内する。
// 旧「GitHub の zip を load unpacked（デベロッパーモード）」手順は廃止。
// チュートリアルのスライドとダッシュボードの常設バナーから開く。

import { useApp } from './AppProvider';

// ストアURL（LP app/(marketing)/page.js の STORE_URL と同じものを指す。変える時は両方）。
const STORE_URL = 'https://chromewebstore.google.com/detail/cinelearn/jdhgbdpaeoihopelnnganoojpnplkiie';

// 手順は3件固定。body に JSX を許すのは「ログインが必須」を太字で目立たせるため
// （拡張で集めた単語がアプリに届かない＝最初の関門で最も多い躓き）。
const STEPS = [
  {
    title: 'Chrome Web Store で「Chrome に追加」',
    body: (
      <>
        下のボタンでストアのページを開き、「Chrome に追加」を押すだけ。zip の解凍やデベロッパーモードの設定は不要です
        （Edge など他の Chromium 系ブラウザも同じ手順）。
      </>
    ),
  },
  {
    title: 'このアプリにログインする',
    body: (
      <>
        拡張機能で集めた単語をアプリに届けるには<b>ログインが必須</b>です（ローカルのみの利用は予習・復習向け）。
        ③の前に必ず一度ログインしてください。ログインした状態でこのアプリを開いておくと、拡張機能がログインを自動で引き継ぎます（拡張側での入力は不要です）。
      </>
    ),
  },
  {
    title: 'Netflix / Prime Video で字幕の単語をクリック',
    body: (
      <>
        動画を再生し、字幕の知らない単語をクリックするだけ。辞書ポップアップから単語帳に保存でき、このアプリへ自動同期されます。
        Disney+ は単語保存・例文・セリフコピー対応（◀▶ナビのみ非対応）。
      </>
    ),
  },
];

export default function ExtensionGuide() {
  const { closeGuide, openAuth, loggedIn } = useApp();

  const overlayClick = (e) => {
    if (e.target === e.currentTarget) closeGuide();
  };

  // STEP 2 の「ログインする」: ガイドを閉じてから AuthModal を開く（モーダルの二重表示を避ける）。
  const goLogin = () => {
    closeGuide();
    openAuth();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={overlayClick}>
      <div className="modal-panel ext-guide-panel" role="dialog" aria-modal="true" aria-label="拡張機能の入れ方">
        <div className="modal-header">
          <span className="modal-title">🧩 拡張機能の入れ方</span>
          <button className="modal-close" onClick={closeGuide} aria-label="閉じる">
            ✕
          </button>
        </div>

        <div className="modal-body ext-guide-body">
          <p className="ext-guide-lead">
            Netflix などで字幕の単語を集めるには、無料の Chrome 拡張機能が必要です。Chrome Web Store から1クリックで追加できます
            （所要1分・Edge など他の Chromium 系ブラウザも同じ手順です）。
          </p>
          <p className="ext-guide-note" style={{ marginTop: 0, marginBottom: 14 }}>
            💻 この手順は<b>PC（Chrome / Edge）専用</b>です。スマホでは拡張機能を入れられないため、お使いのPCで開いて進めてください（スマホは予習・復習・テストに使えます）。
          </p>

          <ol className="ext-guide-steps">
            {STEPS.map((s, i) => (
              <li key={i} className="ext-guide-step">
                <span className="ext-guide-num">{i + 1}</span>
                <div className="ext-guide-step-text">
                  <div className="ext-guide-step-title">{s.title}</div>
                  <p>{s.body}</p>
                  {i === 0 && (
                    <a className="btn-primary ext-guide-dl" href={STORE_URL} target="_blank" rel="noopener noreferrer">
                      🧩 Chrome Web Store で追加
                    </a>
                  )}
                  {i === 1 &&
                    (loggedIn ? (
                      <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>✓ ログイン済みです</p>
                    ) : (
                      <button className="btn-secondary ext-guide-dl" onClick={goLogin}>
                        ログインする
                      </button>
                    ))}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="ext-guide-footer">
          <button className="btn-primary" style={{ width: '100%' }} onClick={closeGuide}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
