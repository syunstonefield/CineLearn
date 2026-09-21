'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import VocabItem from './VocabItem';
import {
  getWordbookWords,
  deleteMyWord,
  unstarWord,
  clearAllWords,
  saveWordTranslation,
  repairLongExamples,
} from '@/lib/words';
import { loadSrs, skipWord, unskipWord, isLearned, isMastered, isStruggling, todayStr } from '@/lib/storage';
import { fillTranslations } from '@/lib/translateQueue';
import { speak } from '@/lib/speak';
import { secToTimeLabel } from '@/lib/subtitles';
import { backfillMissingExamples } from '@/lib/exampleBackfill';
import { sameWorkTitle, isUnassignedTvWord } from '@/lib/words';

// マイ単語帳（ページ版・表示は単語リスト＝VocabItem と同じ折りたたみカード）。
// 旧 WordbookModal をモーダル→screen='wordbook' に置き換え。

// 出所明示（48条）：例文があるときだけ字幕の入手元を併記（旧モーダルと同じ書式）。
// unassigned=true（TV なのに S/E が無い語・A22(a)）は作品名の後に「話数不明」を添える。
function wordSource(w, unassigned = false) {
  if (w.dramaTitle) {
    return (
      `📺 ${w.dramaTitle}` +
      (w.season != null ? ` S${w.season}` : '') +
      (w.episode != null ? `E${w.episode}` : '') +
      (unassigned ? '（話数不明）' : '') +
      (w.sentence ? '（字幕：OpenSubtitles）' : '')
    );
  }
  if (w.source) return `${w.source}${w.sentence ? '（字幕：OpenSubtitles）' : ''}`;
  if (w.sentence) return '字幕：OpenSubtitles';
  return '';
}

export default function WordbookScreen() {
  const { profile, settings, wordbookVersion, bumpWordbook, loggedIn, refreshFromCloud, openAuth } = useApp();
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
    // ★を外した語（inWordbook:false）は出さない（2026-09-22）。作品の単語リスト側には残っている。
    getWordbookWords(pid).then((w) => {
      if (!cancelled) setWords(w);
    });
    return () => {
      cancelled = true;
    };
  }, [pid, wordbookVersion]);

  // 単語帳を開いた時にクラウドから最新を取り込む（拡張で保存→約1秒後に後埋めした例文を反映）。
  // 後埋めが初回pullに間に合わないことがあるので、開いた直後＋数秒後の2回引いて取りこぼしを防ぐ。
  // refreshFromCloud は wordbookVersion を上げる→上の effect が再読込する。ログイン時のみ。
  // 2026-09-22: 2回目は無条件にやめ、初回 pull の結果に「今日保存されたのに例文がまだ無い語」が
  // ある時だけ引く（拡張の後埋めが着地するのを待つ場面はそれだけ）。全量 pull は語数に比例して
  // egress を食うため（★で語数が増える）、根本は増分同期（pending-fixes）。
  useEffect(() => {
    if (!loggedIn) return;
    let t = null;
    let cancelled = false;
    (async () => {
      await refreshFromCloud();
      if (cancelled) return;
      const today = todayStr();
      const fresh = await getWordbookWords(pid);
      const waiting = (fresh || []).some(
        (w) => !(w.sentence || w.example || '').trim() && String(w.savedAt || '').startsWith(today)
      );
      if (waiting && !cancelled) t = setTimeout(() => refreshFromCloud(), 6000);
    })();
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, refreshFromCloud]);

  // 例文の和訳を /api/translate から取得（端末キャッシュ・短文のみ・鍵未設定なら null＝和訳なし）。
  useEffect(() => {
    if (!words || !words.length) return;
    let cancelled = false;
    (async () => {
      // 段落まるごとの例文（旧データ）を1文へ詰め直してから翻訳する。詰めた行は example_ja を
      // 落としてあるので、下のループがそのまま新しい例文の訳を取り直す。
      if (await repairLongExamples(words, pid)) {
        if (cancelled) return;
        setWords([...words]);
      }
      // 例文が空の語をここでも取り直す（2026-08-08）。従来は作品画面(VocabScreen)でしか
      // 走らなかったため、単語帳だけを見ていると「いつまで経っても例文が付かない」ように見えた。
      // 作品ごとにまとめ、マイリストから tmdbId を解決できる作品だけ（曖昧検索を避ける）。
      const byTitle = new Map();
      words
        .filter((w) => w?.dramaTitle && !(w.example || w.sentence || '').trim())
        .forEach((w) => {
          const list = byTitle.get(w.dramaTitle) || [];
          list.push(w);
          byTitle.set(w.dramaTitle, list);
        });
      for (const [title, group] of byTitle) {
        if (cancelled) return;
        const known = (settings.myDramas || []).find((d) => sameWorkTitle(title, d.title) || sameWorkTitle(title, d.englishTitle));
        if (!known) continue; // 作品を確定できない語は誤った作品を引く恐れがあるので触らない
        const isMovie = known.type === 'movie' || known.mediaType === 'movie' || group.every((w) => w.season == null);
        const hit = await backfillMissingExamples(
          group.map((w) => ({ ...w, example: w.example || w.sentence || '' })),
          { drama: known, season: group[0]?.season ?? 1, episode: group[0]?.episode ?? 1, isMovie, profileId: pid }
        );
        if (hit && !cancelled) bumpWordbook(); // 保存済みを読み直して画面に反映
      }
      // 既に訳を持つ語（拡張v1.2.2〜の保存語・★で入れた生成語）は通信なしで即表示。
      const jaInit = {};
      for (const w of words) if (w.ja) jaInit[w.word.toLowerCase()] = w.ja;
      if (Object.keys(jaInit).length) setWordJa((m) => ({ ...m, ...jaInit }));
      // 残り（語義なし・例文訳なし）は並列＋10文一括で後埋めし、取れた訳は my_words へ書き戻す
      // （2026-09-22・旧実装は1語ずつ直列 await＝1000語で最悪2000往復）。lib/translateQueue.js
      const knownFor = (w) =>
        w?.dramaTitle
          ? (settings.myDramas || []).find((d) => sameWorkTitle(w.dramaTitle, d.title) || sameWorkTitle(w.dramaTitle, d.englishTitle))
          : null;
      await fillTranslations(words, {
        isCancelled: () => cancelled,
        ctxFor: (w) => {
          const known = knownFor(w);
          if (!known?.tmdbId) return null; // 作品を確定できない語は共有キャッシュへの書き戻し座標を付けない
          const type = known.type || known.mediaType || (w.season == null ? 'movie' : 'tv');
          return { tmdbId: known.tmdbId, season: w.season ?? null, episode: w.episode ?? null, type };
        },
        onPatch: (w, patch) => {
          const wl = w.word.toLowerCase();
          if (patch.ja) setWordJa((m) => (m[wl] === patch.ja ? m : { ...m, [wl]: patch.ja }));
          if (patch.example_ja) setExJa((m) => (m[wl] === patch.example_ja ? m : { ...m, [wl]: patch.example_ja }));
        },
        save: (word, patch) => saveWordTranslation(pid, word, patch).catch(() => {}),
      });
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
  // 🗑完全削除＝手動追加語のタイポ救済だけ。単語帳から外すのは★（onStar）。
  const onDelete = async (word) => {
    if (!confirm(`「${word}」を完全に削除しますか？（作品の単語リストからも消えます）`)) return;
    await deleteMyWord(pid, word);
    bumpWordbook();
  };
  // ★を外す。視聴中に拾った語は作品の単語リストに残り、★でしか無い語は行ごと消える（lib/words.js）。
  const onStar = async (word, starred) => {
    if (!starred) return; // 単語帳の行は常に★ON＝ここでは外す操作だけ
    await unstarWord(pid, word);
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
          <p className="wb-sub">字幕で単語をクリックした語と、単語リストで☆を付けた語がここに集まります（★を外すとリストには残ります）</p>
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
            {!loggedIn && (
              <>
                <br />
                <br />
                {/* 未ログインの保存は拡張からアプリへ届かない（A24）。ここが「拡張が壊れた」と誤認する最初の関門 */}
                <span style={{ fontSize: 13, opacity: 0.85 }}>※ 拡張機能で保存した単語をここに表示するにはログインが必要です</span>
                <br />
                <button type="button" className="btn-secondary" style={{ marginTop: 10 }} onClick={openAuth}>
                  ログインする
                </button>
              </>
            )}
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
              {visibleWords.map((w) => {
                // 話数不明（A22(a)）: 拡張が S/E を検出できずに保存した TV の語。作品の各話リストには
                // 出ないので、ここで所在が分かるようバッジを付ける（映画は S/E が無いのが正＝付けない）。
                const unassigned = isUnassignedTvWord(w, settings.myDramas || []);
                return (
                  <div key={w.word} style={unassigned ? { position: 'relative' } : undefined}>
                    {unassigned && (
                      <span
                        className="vocab-added-chip"
                        title="拡張が話数（シーズン/エピソード）を検出できなかった語です。作品の各話リストには出ません"
                        style={{
                          position: 'absolute',
                          top: -7,
                          right: 12,
                          zIndex: 1,
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        話数不明
                      </span>
                    )}
                    <VocabItem
                      word={{
                        ...w,
                        definition: wordJa[w.word.toLowerCase()] || w.definition,
                        example: w.example || w.sentence || '',
                        example_ja: w.example_ja || exJa[w.word.toLowerCase()] || '',
                      }}
                      srs={srs}
                      testTiers={testTiers}
                      // 📍場面時刻（保存時に取れていれば）。単語リストと同じ VocabItem なのに
                      // ここだけ時刻を捨てていた（2026-08-08）。作品横断の一覧なので、出所ラベルと
                      // 並んで「どの作品の何分ごろか」が分かる。
                      ts={w.tsSec != null ? { sec: w.tsSec, label: secToTimeLabel(w.tsSec) } : null}
                      priority={isStruggling(srs[w.word.toLowerCase()])}
                      exampleSource={wordSource(w, unassigned)}
                      starred
                      onSpeak={speak}
                      onSkip={handleSkip}
                      onCopyTime={handleCopyTime}
                      onStar={onStar}
                      onDelete={w.source === 'manual' ? onDelete : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
