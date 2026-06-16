'use client';

// 拡張機能の導入ガイド（モーダル）。landing.html の手順を next-app に移植したもの。
// まだChromeウェブストア未公開のため、GitHubリリースのzipを「load unpacked（デベロッパーモード）」で
// 入れる方式を案内する。チュートリアルのスライドとダッシュボードの常設バナーから開く。

import { useState } from 'react';
import { useApp } from './AppProvider';

// 公開時にストアURLへ差し替えやすいよう定数化（landing.html と同じリリースを指す）。
const RELEASE_URL = 'https://github.com/syunstonefield/CineLearn/releases/latest';

const STEPS = [
  {
    title: 'GitHubからzipをダウンロード',
    body: '下のボタンからリリースページを開き、CineLearn-extension.zip をダウンロードします。',
  },
  {
    title: 'zipを解凍する',
    body: 'ダウンロードした zip をダブルクリックで解凍。中に出てくる cinelearn フォルダを、デスクトップなど分かりやすい場所に置きます。',
  },
  {
    title: 'Chromeの拡張機能ページを開く',
    body: 'アドレスバーに chrome://extensions と入力してEnter。右上の「デベロッパーモード」をオンにします。',
    code: 'chrome://extensions',
  },
  {
    title: 'フォルダを読み込む',
    body: '「パッケージ化されていない拡張機能を読み込む」をクリックし、解凍した cinelearn フォルダを選択。一覧に「CineLearn」が表示されれば完了です。',
  },
  {
    title: 'Netflixで字幕の単語をクリック',
    body: 'NetflixやAmazon Primeで動画を再生し、字幕の単語をクリックするだけ。辞書ポップアップから単語帳に保存でき、このアプリへ自動同期されます。',
  },
];

export default function ExtensionGuide() {
  const { closeGuide } = useApp();
  const [copied, setCopied] = useState(false);

  const overlayClick = (e) => {
    if (e.target === e.currentTarget) closeGuide();
  };

  const copyExtUrl = async () => {
    try {
      await navigator.clipboard.writeText('chrome://extensions');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* クリップボード不可は無視 */
    }
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
            Netflixなどで字幕の単語を集めるには、無料のChrome拡張機能が必要です。まだストア未公開のため、
            下記の手順で読み込んでください（所要2〜3分・Edgeなど他のChromium系ブラウザも同じ手順です）。
          </p>

          <ol className="ext-guide-steps">
            {STEPS.map((s, i) => (
              <li key={i} className="ext-guide-step">
                <span className="ext-guide-num">{i + 1}</span>
                <div className="ext-guide-step-text">
                  <div className="ext-guide-step-title">{s.title}</div>
                  <p>{s.body}</p>
                  {i === 0 && (
                    <a className="btn-primary ext-guide-dl" href={RELEASE_URL} target="_blank" rel="noopener noreferrer">
                      ⬇ リリースページを開く
                    </a>
                  )}
                  {s.code && (
                    <button className="ext-guide-code" onClick={copyExtUrl} title="コピー">
                      <code>{s.code}</code>
                      <span className="ext-guide-copy">{copied ? '✓ コピーしました' : '📋 コピー'}</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <p className="ext-guide-note">
            ※ 「デベロッパーモードの拡張機能を無効にしてください」という警告がChrome起動時に出ることがありますが、
            「キャンセル」を押せばそのまま使えます。安全のためソースは公開しています。
          </p>
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
