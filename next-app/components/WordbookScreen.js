'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import VocabItem from './VocabItem';
import { getActiveWords, deleteMyWord, clearAllWords } from '@/lib/words';
import { loadSrs, skipWord, unskipWord } from '@/lib/storage';
import { fetchJa } from '@/lib/jatranslate';

// マイ単語帳（ページ版・表示は単語リスト＝VocabItem と同じ折りたたみカード）。
// 旧 WordbookModal をモーダル→screen='wordbook' に置き換え。
function speak(word) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  }
}

// 出所明示（48条）：例文があるときだけ字幕の入手元を併記（旧モーダルと同じ書式）。
function wordSource(w) {
  if (w.dramaTitle) {
    return (
      `📺 ${w.dramaTitle}` +
      (w.season != null ? ` S${w.season}` : '') +
      (w.episode != null ? `E${w.episode}` : '') +
      (w.sentence ? '（字幕：OpenSubtitles）' : '')
    );
  }
  if (w.source) return `${w.source}${w.sentence ? '（字幕：OpenSubtitles）' : ''}`;
  if (w.sentence) return '字幕：OpenSubtitles';
  return '';
}

export default function WordbookScreen() {
  const { profile, settings, wordbookVersion, bumpWordbook, loggedIn, refreshFromCloud } = useApp();
  const pid = profile?.id;
  const [words, setWords] = useState(null); // null=読み込み中
  const [srs, setSrs] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [exJa, setExJa] = useState({}); // word(小文字) → 例文の和訳（/api/translate）

  useEffect(() => {
    setSrs(loadSrs());
    let cancelled = false;
    getActiveWords(pid).then((w) => {
      if (!cancelled) setWords(w);
    });
    return () => {
      cancelled = true;
    };
  }, [pid, wordbookVersion]);

  // 例文の和訳を /api/translate から取得（端末キャッシュ・短文のみ・鍵未設定なら null＝和訳なし）。
  useEffect(() => {
    if (!words || !words.length) return;
    let cancelled = false;
    (async () => {
      for (const w of words) {
        const sent = w.example || w.sentence;
        if (!sent) continue;
        const ja = await fetchJa(sent);
        if (cancelled) return;
        if (ja != null) {
          const wl = w.word.toLowerCase();
          setExJa((m) => (m[wl] === ja ? m : { ...m, [wl]: ja }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [words]);

  const testTiers = settings.testTiers || ['core', 'advanced'];
  const handleSkip = (word, isSkip) => {
    isSkip ? unskipWord(word) : skipWord(word);
    setSrs(loadSrs());
  };
  const handleCopyTime = (t) => navigator.clipboard?.writeText(t).catch(() => {});
  const onDelete = async (word) => {
    await deleteMyWord(pid, word);
    bumpWordbook();
  };
  const onClear = async () => {
    if (!confirm('保存した単語をすべて削除しますか？')) return;
    await clearAllWords(pid);
    bumpWordbook();
  };
  const onSync = async () => {
    setSyncing(true);
    const ok = await refreshFromCloud();
    setSyncing(false);
    if (!ok) alert('クラウドから取得できませんでした。ログイン状態を確認してください。');
  };

  return (
    <div className="screen active" id="screen-wordbook">
      <div className="wb-screen">
        <div className="wb-head">
          <h1 className="wb-h1">📖 マイ単語帳</h1>
          <p className="wb-sub">Netflix・YouTubeの字幕で単語をクリックすると、ここに保存されます</p>
        </div>

        {words === null ? (
          <div className="loading" style={{ margin: 24 }}>
            <div className="spinner" />
          </div>
        ) : words.length === 0 ? (
          <div className="empty-state" style={{ margin: 24 }}>
            まだ単語が保存されていません。
            <br />
            <br />
            拡張機能をインストールして Netflix などで動画を再生すると、
            <br />
            字幕の各単語をクリックしてここに保存できます。
          </div>
        ) : (
          <>
            <div className="wb-toolbar">
              <span className="wb-count">{words.length}単語</span>
              <span className="wb-actions">
                {loggedIn && (
                  <button className="btn-secondary wb-sync" disabled={syncing} onClick={onSync}>
                    {syncing ? '同期中...' : '🔄 再読込'}
                  </button>
                )}
                <button className="btn-clear-all" onClick={onClear}>
                  すべて削除
                </button>
              </span>
            </div>
            <div className="vocab-list">
              {words.map((w) => (
                <VocabItem
                  key={w.word}
                  word={{
                    ...w,
                    example: w.example || w.sentence || '',
                    example_ja: w.example_ja || exJa[w.word.toLowerCase()] || '',
                  }}
                  srs={srs}
                  testTiers={testTiers}
                  ts={null}
                  exampleSource={wordSource(w)}
                  onSpeak={speak}
                  onSkip={handleSkip}
                  onCopyTime={handleCopyTime}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
