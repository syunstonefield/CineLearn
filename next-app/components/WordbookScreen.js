'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import VocabItem from './VocabItem';
import { getActiveWords, deleteMyWord, clearAllWords } from '@/lib/words';
import { loadSrs, skipWord, unskipWord, isLearned, isMastered, isStruggling } from '@/lib/storage';
import { fetchJa } from '@/lib/jatranslate';
import { fetchCtxJa } from '@/lib/ctxtranslate';
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
  const [filter, setFilter] = useState('all'); // all|unlearned|learned|mastered（stats タイルで切替）
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
        // 単語の和訳。優先順: ①保存時の文脈訳(w.ja・拡張v1.2.2〜) ②例文を添えた文脈訳
        // (wordsense・多義語をその場面の意味に解決) ③従来の1語訳（文脈なし・最後の保険）。
        // docs/design-context-translation.md
        if (w.ja) {
          setWordJa((m) => (m[wl] === w.ja ? m : { ...m, [wl]: w.ja }));
        } else {
          const sent0 = w.sentence || w.example;
          const wja = (sent0 ? await fetchCtxJa(w.word, sent0) : null) ?? (await fetchJa(w.word));
          if (cancelled) return;
          if (wja != null) setWordJa((m) => (m[wl] === wja ? m : { ...m, [wl]: wja }));
        }
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

  // stats タイルで選んだ状態だけに絞り込む（分類＝stats と同じ isMastered/isLearned 基準）。
  const visibleWords = (() => {
    if (!words) return words;
    if (filter === 'all') return words;
    return words.filter((w) => {
      const e = srs[w.word.toLowerCase()];
      if (filter === 'mastered') return isMastered(e);
      if (filter === 'learned') return isLearned(e) && !isMastered(e);
      return !isLearned(e) && !isMastered(e); // unlearned
    });
  })();
  // タイルクリックで絞り込みトグル（同じタイルを再度押すと全件へ戻る）。
  const toggleFilter = (key) => setFilter((f) => (f === key ? 'all' : key));

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
                <button
                  type="button"
                  className={'wb-stat' + (filter === 'all' ? ' is-active' : '')}
                  onClick={() => setFilter('all')}
                >
                  <span className="wb-stat-num">{stats.total}</span>
                  <span className="wb-stat-label">単語</span>
                </button>
                <button
                  type="button"
                  className={'wb-stat' + (filter === 'unlearned' ? ' is-active' : '')}
                  onClick={() => toggleFilter('unlearned')}
                >
                  <span className="wb-stat-num">{stats.unlearned}</span>
                  <span className="wb-stat-label">未学習</span>
                </button>
                <button
                  type="button"
                  className={'wb-stat wb-stat-learned' + (filter === 'learned' ? ' is-active' : '')}
                  onClick={() => toggleFilter('learned')}
                >
                  <span className="wb-stat-num">{stats.learned}</span>
                  <span className="wb-stat-label">覚えた</span>
                </button>
                <button
                  type="button"
                  className={'wb-stat wb-stat-mastered' + (filter === 'mastered' ? ' is-active' : '')}
                  onClick={() => toggleFilter('mastered')}
                >
                  <span className="wb-stat-num">{stats.mastered}</span>
                  <span className="wb-stat-label">マスター</span>
                </button>
              </div>
            )}
            <div className="wb-toolbar">
              <span className="wb-count">
                {filter === 'all' ? `${words.length}単語` : `${visibleWords.length}単語（絞り込み中）`}
              </span>
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
              {visibleWords.length === 0 && (
                <div className="empty-state" style={{ padding: '24px 8px' }}>
                  この分類の単語はまだありません。
                </div>
              )}
              {visibleWords.map((w) => (
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
