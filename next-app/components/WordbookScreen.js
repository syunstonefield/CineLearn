'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import VocabItem from './VocabItem';
import { getActiveWords, deleteMyWord, clearAllWords } from '@/lib/words';
import { loadSrs, skipWord, unskipWord, isLearned, isMastered, isStruggling } from '@/lib/storage';
import { fetchJa } from '@/lib/jatranslate';
import { speak } from '@/lib/speak';

// マイ単語帳（ページ版・表示は単語リスト＝VocabItem と同じ折りたたみカード）。
// 旧 WordbookModal をモーダル→screen='wordbook' に置き換え。

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
  const [wordJa, setWordJa] = useState({}); // word(小文字) → 単語の和訳（意味を日本語に）

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

  // 単語帳を開いた時にクラウドから最新を取り込む（拡張で保存→約1秒後に後埋めした例文を反映）。
  // 後埋めが初回pullに間に合わないことがあるので、開いた直後＋数秒後の2回引いて取りこぼしを防ぐ。
  // refreshFromCloud は wordbookVersion を上げる→上の effect が再読込する。ログイン時のみ。
  useEffect(() => {
    if (!loggedIn) return;
    refreshFromCloud();
    const t = setTimeout(() => refreshFromCloud(), 6000);
    return () => clearTimeout(t);
  }, [loggedIn, refreshFromCloud]);

  // 例文の和訳を /api/translate から取得（端末キャッシュ・短文のみ・鍵未設定なら null＝和訳なし）。
  useEffect(() => {
    if (!words || !words.length) return;
    let cancelled = false;
    (async () => {
      for (const w of words) {
        const wl = w.word.toLowerCase();
        // 単語の和訳（意味を日本語に・英語定義しか無い保存語向け）
        const wja = await fetchJa(w.word);
        if (cancelled) return;
        if (wja != null) setWordJa((m) => (m[wl] === wja ? m : { ...m, [wl]: wja }));
        // 例文の和訳
        const sent = w.example || w.sentence;
        if (sent) {
          const ja = await fetchJa(sent);
          if (cancelled) return;
          if (ja != null) setExJa((m) => (m[wl] === ja ? m : { ...m, [wl]: ja }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [words]);

  // 上部stats（単語/未学習/覚えた/マスター）。未学習＝まだ「覚えた」未到達（合計に一致させる）。
  const stats = (() => {
    if (!words) return null;
    let mastered = 0;
    let learned = 0;
    for (const w of words) {
      const e = srs[w.word.toLowerCase()];
      if (isMastered(e)) mastered++;
      else if (isLearned(e)) learned++;
    }
    return { total: words.length, learned, mastered, unlearned: words.length - learned - mastered };
  })();

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
          <p className="wb-sub">Netflix・Amazon Prime・Disney+の字幕で単語をクリックすると、ここに保存されます</p>
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
            {stats && (
              <div className="wb-stats">
                <div className="wb-stat">
                  <span className="wb-stat-num">{stats.total}</span>
                  <span className="wb-stat-label">単語</span>
                </div>
                <div className="wb-stat">
                  <span className="wb-stat-num">{stats.unlearned}</span>
                  <span className="wb-stat-label">未学習</span>
                </div>
                <div className="wb-stat wb-stat-learned">
                  <span className="wb-stat-num">{stats.learned}</span>
                  <span className="wb-stat-label">覚えた</span>
                </div>
                <div className="wb-stat wb-stat-mastered">
                  <span className="wb-stat-num">{stats.mastered}</span>
                  <span className="wb-stat-label">マスター</span>
                </div>
              </div>
            )}
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
                    definition: wordJa[w.word.toLowerCase()] || w.definition,
                    example: w.example || w.sentence || '',
                    example_ja: w.example_ja || exJa[w.word.toLowerCase()] || '',
                  }}
                  srs={srs}
                  testTiers={testTiers}
                  ts={null}
                  priority={isStruggling(srs[w.word.toLowerCase()])}
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
