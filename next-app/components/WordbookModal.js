'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { getActiveWords, deleteMyWord, clearAllWords } from '@/lib/words';
import { formatDateJa } from '@/lib/storage';

// 既存 wordbookModal / renderWordbook の再現（マイ単語帳）。
export default function WordbookModal() {
  const { profile, closeWordbook, wordbookVersion, bumpWordbook, loggedIn, refreshFromCloud } = useApp();
  const pid = profile?.id;
  const [words, setWords] = useState(null); // null=読み込み中
  const [syncing, setSyncing] = useState(false);

  // クラウドから再読込（Netflixで保存した単語を取り込む）
  const onSync = async () => {
    setSyncing(true);
    const ok = await refreshFromCloud(); // 成功なら wordbookVersion が上がり一覧が再読込される
    setSyncing(false);
    if (!ok) alert('クラウドから取得できませんでした。ログイン状態を確認してください。');
  };

  useEffect(() => {
    let cancelled = false;
    getActiveWords(pid).then((w) => {
      if (!cancelled) setWords(w);
    });
    return () => {
      cancelled = true;
    };
  }, [pid, wordbookVersion]);

  const onDelete = async (word) => {
    await deleteMyWord(pid, word);
    bumpWordbook();
  };
  const onClear = async () => {
    if (!confirm('保存した単語をすべて削除しますか？')) return;
    await clearAllWords(pid);
    bumpWordbook();
  };
  const overlayClick = (e) => {
    if (e.target === e.currentTarget) closeWordbook();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={overlayClick}>
      <div className="modal-panel">
        <div className="modal-header">
          <span className="modal-title">📖 マイ単語帳</span>
          <button className="modal-close" onClick={closeWordbook}>
            ✕
          </button>
        </div>
        <div className="wordbook-info">
          Netflix・YouTubeの字幕で単語をクリックすると、ここに保存されます
          {loggedIn && (
            <button
              className="btn-secondary"
              style={{ marginLeft: 8, padding: '2px 10px', fontSize: 12 }}
              disabled={syncing}
              onClick={onSync}
            >
              {syncing ? '同期中...' : '🔄 クラウドから再読込'}
            </button>
          )}
        </div>
        <div className="modal-body" id="wordbookContent">
          {words === null ? (
            <div className="loading" style={{ margin: 24 }}>
              <div className="spinner"></div>
            </div>
          ) : words.length === 0 ? (
            <div className="empty-state" style={{ margin: 24 }}>
              まだ単語が保存されていません。
              <br />
              <br />
              拡張機能をインストールして Netflix などで
              <br />
              動画を再生すると、字幕の各単語をクリックして
              <br />
              ここに保存できます。
            </div>
          ) : (
            <>
              <div className="wordbook-header">
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{words.length}単語</span>
                <button className="btn-clear-all" onClick={onClear}>
                  すべて削除
                </button>
              </div>
              <div className="vocab-list" style={{ padding: '12px 16px' }}>
                {words.map((w) => (
                  <div className="vocab-item wordbook-item" key={w.word}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <div className="vocab-word">{w.word}</div>
                        {w.phonetic && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{w.phonetic}</span>
                        )}
                      </div>
                      {w.sentence && <div className="wordbook-sentence">&quot;{w.sentence}&quot;</div>}
                      <div className="wordbook-meta">
                        {w.dramaTitle ? (
                          <span>
                            📺 {w.dramaTitle}
                            {w.season != null ? ` S${w.season}` : ''}
                            {w.episode != null ? `E${w.episode}` : ''}
                            {/* 出所明示(48条)：例文があるときだけ字幕の入手元を併記 */}
                            {w.sentence ? '（字幕：OpenSubtitles）' : ''}
                          </span>
                        ) : w.source ? (
                          <span>
                            {w.source}
                            {w.sentence ? '（字幕：OpenSubtitles）' : ''}
                          </span>
                        ) : w.sentence ? (
                          <span>字幕：OpenSubtitles</span>
                        ) : null}
                        <span>{formatDateJa(w.savedAt)}</span>
                      </div>
                    </div>
                    {w.pos && <div className="vocab-pos">{w.pos}</div>}
                    <div className="vocab-def">{w.definition || '（定義なし）'}</div>
                    <button className="btn-word-delete" title="削除" onClick={() => onDelete(w.word)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
