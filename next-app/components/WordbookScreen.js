'use client';

import { IconStar, IconHeart, IconOpenBook, MarkText } from './icons/LineIcons';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import VocabItem from './VocabItem';
import {
  getWordbookWords,
  deleteMyWord,
  unstarWord,
  clearAllWords,
  likeWord,
  hideFromWordbook,
  saveWordTranslation,
  repairLongExamples,
} from '@/lib/words';
import { loadSrs, loadHistory, skipWord, unskipWord, todayStr, toIsoDate, isEpisodeMismatch } from '@/lib/storage';
import CefrNote from './CefrNote';
import { cefrHintOf } from '@/lib/cefrHint';
import { cefrIndexFromHistory, withWordbookCefr } from '@/lib/wordbookCefr';
import { likedWords, canLikeMore, pickTodayWord, LIKE_CAP_PER_EPISODE } from '@/lib/liked';
import { CURATION_ON } from '@/lib/curation';

// 初回の整理（2026-11-07 オーナー決定）: 単語帳を「覚えたい語の場所」にした時、既に入っている拡張/手入力の語を
// 「このまま残す／★の語だけにする」から一度だけ選ぶ。選ばなければ何もしない。語は消えない（作品の単語リスト・復習に残る）。
const WB_CHOICE_KEY = 'cl_wb_choice_v1';
// 「拡張で保存した語は単語帳に自動で入らない」段（in_wordbook の DB 既定 false）は、拡張 v1.2.12 と案内の文言の公開に
// 合わせて出す（オーナー決定 2026-11-07・受付）。それまでは初回の整理画面と、その前提の文言を出さない。
// 出す時: Vercel の環境変数 NEXT_PUBLIC_WORDBOOK_CURATION=on ＋再デプロイ（SQL supabase_my_words_wordbook_default.sql も同時）。
// 旗の定義は lib/curation.js（案内の文言も同じ旗で切り替わる）
function readChoice() {
  try {
    return localStorage.getItem(WB_CHOICE_KEY) || '';
  } catch {
    return '';
  }
}
function writeChoice(v) {
  try {
    localStorage.setItem(WB_CHOICE_KEY, v);
  } catch {
    /* 保存不可なら次回また出る */
  }
}
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
    // 別の話数の字幕で作ったリストから★で入れた語は話数を付けない（2026-10-20 /decide G）
    const mismatch = isEpisodeMismatch(w.dramaTitle, w.season, w.episode);
    return (
      `📺 ${w.dramaTitle}` +
      (w.season != null && !mismatch ? ` S${w.season}` : '') +
      (w.episode != null && !mismatch ? `E${w.episode}` : '') +
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
  const [syncing, setSyncing] = useState(false);
  const [exJa, setExJa] = useState({}); // word(小文字) → 例文の和訳（/api/translate）
  const [wordJa, setWordJa] = useState({}); // word(小文字) → 単語の和訳（意味を日本語に）
  const [choiceClosed, setChoiceClosed] = useState(false); // 初回の整理を「あとで」で閉じた（この表示の間だけ）
  const [choiceBusy, setChoiceBusy] = useState(false);
  // 画面の一新（オーナー決定 2026-11-07）: 'home'＝2タイル＋今日の語＋最近入れた語／'star'＝★の語の一覧／'liked'＝♡の語の一覧
  const [view, setView] = useState('home');
  const [focusWord, setFocusWord] = useState(null); // 最近の行・今日の語から開いた語（その一覧で開いて見せる）
  const openView = (v, word = null) => {
    setFocusWord(word);
    setView(v);
    if (!word && typeof window !== 'undefined') window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (!focusWord) return;
    const el = document.getElementById('wb-w-' + focusWord.toLowerCase());
    if (el) el.scrollIntoView({ block: 'center' });
  }, [focusWord, view]);
  // CEFR の目安（試作 2026-10-30）: 保存レコードは level を持たないので、端末の予習の記録（cl_history）から
  // 同じ語の level / levelShown を借りる（lib/wordbookCefr.js）。サーバへの照会はしない。
  const [cefrIndex, setCefrIndex] = useState(() => new Map());

  useEffect(() => {
    setSrs(loadSrs());
    setCefrIndex(cefrIndexFromHistory(loadHistory()));
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

  // 2026-11-07: 単語帳＝★「覚えたい」の語（starList）＋ ♡ を付けた語（likedList・例文つき）。
  //   ★の語の集計・絞り込みは starList だけ。♡の節は上に別枠で出す（語が見出し・例文は従＝法務の条件）。
  const starList = words ? words.filter((w) => w.inWordbook !== false) : null;
  const likedList = words ? likedWords(words) : [];
  // 初回の整理の対象＝★以外の経路（拡張・手入力）で入っていて、まだ単語帳に出ている語
  const legacy = words ? words.filter((w) => w.inWordbook !== false && w.source !== 'star') : [];
  const showChoice = CURATION_ON && !!words && legacy.length > 0 && !choiceClosed && !readChoice();
  // 最近入れた語（★と♡をまとめて新しい順・5語）。♡の語は付けた日、★の語は保存した日で並べる。
  const today = todayStr();
  const dayOf = (w) => toIsoDate(w.liked ? w.likedAt || w.savedAt || '' : w.savedAt || '') || '';
  const recent = useMemo(() => {
    if (!words) return [];
    const seen = new Set();
    return [...(likedList || []), ...(starList || [])]
      .filter((w) => {
        const k = String(w.word).toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (dayOf(b) > dayOf(a) ? 1 : dayOf(b) < dayOf(a) ? -1 : 0))
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);
  const todayWord = useMemo(() => pickTodayWord(words || [], today), [words, today]);
  // ★のタイルの名前: 「自動で入れない」（v1.2.12 の旗）の前は拡張で保存した語も★の一覧に入るので、名前もそれに合わせる
  const starTile = CURATION_ON
    ? { title: '覚えたい語', desc: '学びたい表現を集める' }
    : { title: '保存した語', desc: '字幕で保存した語と「★ 覚えたい」の語' };

  // 語数・未学習／覚えた／マスターの数（stats タイル）と、それによる絞り込みは外した（オーナー 2026-11-07「一旦消去していい」）。
  //   各語の状態はカードを開いた時のバッジ（🌱 未学習 など）で見える。
  const visibleWords = starList || [];

  const testTiers = settings.testTiers || ['core', 'advanced'];
  const handleSkip = (word, isSkip) => {
    isSkip ? unskipWord(word) : skipWord(word);
    setSrs(loadSrs());
  };
  const handleCopyTime = (t) => navigator.clipboard?.writeText(t).catch(() => {});
  // 🗑完全削除＝視聴中に拾った語（拡張保存・手動追加）の誤保存/タイポ救済（2026-10-02 拡張保存語にも拡大）。
  //   ★でしか無い語（source:'star'）は★を外せば行ごと消えるので🗑は出さない。単語帳から外すだけなら★（onStar）。
  const onDelete = async (word) => {
    if (!confirm(`「${word}」を完全に削除しますか？（作品の単語リストからも消えます）`)) return;
    await deleteMyWord(pid, word);
    bumpWordbook();
  };
  // ★を外す。視聴中に拾った語は作品の単語リストに残り、★でしか無い語は行ごと消える（lib/words.js）。
  //   ♡の節の語（★なし）には付ける操作もある（saveWordTranslation で旗を立てるだけ）。
  const onStar = async (word, starred) => {
    if (starred) await unstarWord(pid, word);
    else await saveWordTranslation(pid, word, { inWordbook: true });
    bumpWordbook();
  };
  // ♡ お気に入りの例文の印（2026-11-07）。1話あたり LIKE_CAP_PER_EPISODE 件まで。
  const onLike = async (word, liked) => {
    const w = (words || []).find((x) => String(x.word).toLowerCase() === String(word).toLowerCase());
    if (!w) return;
    if (!liked && !canLikeMore(words, { dramaTitle: w.dramaTitle, season: w.season ?? null, episode: w.episode ?? null }, sameWorkTitle)) {
      alert(`この話で保存できる例文は ${LIKE_CAP_PER_EPISODE} 件までです`);
      return;
    }
    await likeWord(pid, w, !liked);
    bumpWordbook();
  };
  // 初回の整理（2026-11-07）: 「このまま残す」＝旗を覚えるだけ／「★の語だけにする」＝拡張・手入力の語の旗を倒す（語は消えない）
  const keepAll = () => {
    writeChoice('kept');
    setChoiceClosed(true);
  };
  const starredOnly = async () => {
    setChoiceBusy(true);
    try {
      await hideFromWordbook(pid, legacy.map((w) => w.word));
      writeChoice('starred');
    } finally {
      setChoiceBusy(false);
      setChoiceClosed(true);
      bumpWordbook();
    }
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
          <h1 className="wb-h1">
            <IconOpenBook className="wb-h1-ic" /> マイ単語帳
          </h1>
          <p className="wb-en">画面で出会った語</p>
        </div>

        {words === null ? (
          <div className="loading" style={{ margin: 24 }}>
            <div className="spinner" />
          </div>
        ) : words.length === 0 ? (
          <div className="empty-state" style={{ margin: 24 }}>
            まだ単語がありません。
            <br />
            <br />
            {CURATION_ON ? (
              <>
                <MarkText text="単語リストや復習カードで「★ 覚えたい」を付けた語と、" />
                <br />
                <MarkText text="例文に「♡」を付けた語がここに集まります。" />
              </>
            ) : (
              <>
                拡張機能をインストールして Netflix などで動画を再生すると、
                <br />
                字幕の各単語をクリックしてここに保存できます。
                <br />
                <MarkText text="単語リストや復習カードの「★ 覚えたい」「♡」でも入ります。" />
              </>
            )}
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
            {showChoice && view === 'home' && (
              <div className="wb-choice" role="region" aria-label="単語帳の整理">
                <div className="wb-choice-title">単語帳を「覚えたい語」の場所にしました</div>
                <div className="wb-choice-text">
                  今入っている {legacy.length} 語（拡張や手入力で保存した語）はどうしますか？ どちらを選んでも、語は作品の単語リストと復習に残ります。
                </div>
                <div className="wb-choice-actions">
                  <button type="button" className="btn-secondary" disabled={choiceBusy} onClick={keepAll}>
                    このまま残す
                  </button>
                  <button type="button" className="btn-secondary" disabled={choiceBusy} onClick={starredOnly}>
                    {choiceBusy ? (
                      '整理中...'
                    ) : (
                      <>
                        <IconStar filled /> の語だけにする
                      </>
                    )}
                  </button>
                  <button type="button" className="wb-choice-later" disabled={choiceBusy} onClick={() => setChoiceClosed(true)}>
                    あとで
                  </button>
                </div>
              </div>
            )}
            {/* 2タイル（オーナー決定 2026-11-07）: ★の語／♡の語の一覧を開く。今開いている方をもう一度押すとホームへ */}
            <div className="wb-tiles">
              <button
                type="button"
                className={'wb-tile is-star' + (view === 'star' ? ' is-active' : '')}
                aria-pressed={view === 'star'}
                onClick={() => openView(view === 'star' ? 'home' : 'star')}
              >
                <span className="wb-tile-ic" aria-hidden="true">
                  <IconStar filled />
                </span>
                <span className="wb-tile-t">{starTile.title}</span>
                <span className="wb-tile-d">
                  <MarkText text={starTile.desc} />
                </span>
                {/* 語数だけ戻す（オーナー 2026-11-07）。「今日 +N」と★一覧の集計タイルは外したまま */}
                <span className="wb-tile-n">
                  <b>{starList.length}</b> 語
                </span>
              </button>
              <button
                type="button"
                className={'wb-tile is-heart' + (view === 'liked' ? ' is-active' : '')}
                aria-pressed={view === 'liked'}
                onClick={() => openView(view === 'liked' ? 'home' : 'liked')}
              >
                <span className="wb-tile-ic" aria-hidden="true">
                  <IconHeart />
                </span>
                <span className="wb-tile-t">例文つきの語</span>
                <span className="wb-tile-d">気に入った例文を、語といっしょに残す</span>
                <span className="wb-tile-n">
                  <b>{likedList.length}</b> 語
                </span>
              </button>
            </div>

            {view === 'home' && (
              <>
                {/* ♡ 今日の語（ホームと同じ・語が見出し・例文は “ ” と出所付きの従）。♡ が無ければ出さない */}
                {todayWord && (
                  <button type="button" className="home-today-word wb-today" onClick={() => openView('liked', todayWord.word)}>
                    <span className="htw-label">
                      <IconHeart /> 今日の語
                    </span>
                    <span className="htw-word">{todayWord.word}</span>
                    {(wordJa[todayWord.word.toLowerCase()] || todayWord.ja || todayWord.definition) && (
                      <span className="htw-def">{wordJa[todayWord.word.toLowerCase()] || todayWord.ja || todayWord.definition}</span>
                    )}
                    <span className="htw-ex">“{todayWord.sentence || todayWord.example}”</span>
                    <span className="htw-src">
                      <MarkText text={wordSource(todayWord)} />
                    </span>
                  </button>
                )}
                {recent.length > 0 && (
                  <section className="wb-section">
                    <h2 className="wb-section-h wb-recent-h">
                      最近入れた語
                      <button type="button" className="wb-seeall" onClick={() => openView(starList.length ? 'star' : 'liked')}>
                        すべて見る ›
                      </button>
                    </h2>
                    <div className="wb-recent">
                      {recent.map((w) => {
                        const lower = w.word.toLowerCase();
                        const def = wordJa[lower] || w.ja || w.definition || '';
                        const src = wordSource(w, isUnassignedTvWord(w, settings.myDramas || []));
                        return (
                          <button
                            type="button"
                            key={'recent-' + w.word}
                            className="wb-recent-row"
                            onClick={() => openView(w.liked ? 'liked' : 'star', w.word)}
                          >
                            <span className={'wb-recent-ic' + (w.liked ? ' is-heart' : ' is-star')} aria-hidden="true">
                              {w.liked ? <IconHeart filled /> : <IconStar filled />}
                            </span>
                            <span className="wb-recent-body">
                              <span className="wb-recent-w">{w.word}</span>
                              {def && <span className="wb-recent-def">{def}</span>}
                              {/* ♡ の語だけ例文を従として添える（語が見出し・“ ” と出所つき＝法務の条件） */}
                              {w.liked && (w.sentence || w.example) && (
                                <>
                                  <span className="wb-recent-ex">“{w.sentence || w.example}”</span>
                                  {(w.example_ja || exJa[lower]) && <span className="wb-recent-ja">{w.example_ja || exJa[lower]}</span>}
                                </>
                              )}
                              {src && (
                                <span className="wb-recent-src">
                                  <MarkText text={w.liked ? src : src.replace(/（字幕：[^）]*）\s*$/, '')} />
                                </span>
                              )}
                            </span>
                            <span className="wb-recent-chev" aria-hidden="true">›</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}
                <p className="wb-foot">
                  <MarkText
                    text={CURATION_ON
                    ? '★ は単語リストや復習カードの「★ 覚えたい」、♡ は例文の下の「♡ この例文を保存」で入ります。外しても作品の単語リストと復習には残ります。'
                    : '字幕で保存した語と、単語リストや復習カードの「★ 覚えたい」を付けた語は ★ に、例文の下の「♡ この例文を保存」を押した語は ♡ に入ります。外しても作品の単語リストと復習には残ります。'}
                  />
                </p>
              </>
            )}

            {view !== 'home' && (
              <button type="button" className="wb-back" onClick={() => openView('home')}>
                ← マイ単語帳
              </button>
            )}

            {/* ♡ を付けた語（例文つき）＝語が見出し・例文は “ ” と出所付きの従（法務 条件付きOK 2026-11-07）。例文が見えるよう開いた状態で出す */}
            {view === 'liked' && likedList.length === 0 && (
              <div className="wb-note">
                <MarkText text="気に入った例文は、例文の下の「♡ この例文を保存」で、語といっしょに残せます。" />
              </div>
            )}
            {view === 'liked' && likedList.length > 0 && (
              <section className="wb-section">
                <h2 className="wb-section-h">
                  <IconHeart /> 例文つきの語
                </h2>
                <div className="vocab-list">
                  {likedList.map((w) => (
                    <div key={'liked-' + w.word} id={'wb-w-' + w.word.toLowerCase()}>
                    <VocabItem
                      word={{
                        ...withWordbookCefr(w, cefrIndex),
                        definition: wordJa[w.word.toLowerCase()] || w.definition,
                        example: w.example || w.sentence || '',
                        example_ja: w.example_ja || exJa[w.word.toLowerCase()] || '',
                      }}
                      srs={srs}
                      testTiers={testTiers}
                      ts={w.tsSec != null ? { sec: w.tsSec, label: secToTimeLabel(w.tsSec) } : null}
                      exampleSource={wordSource(w, isUnassignedTvWord(w, settings.myDramas || []))}
                      showCefr
                      defaultExpanded
                      starred={w.inWordbook !== false}
                      liked
                      onSpeak={speak}
                      onSkip={handleSkip}
                      onCopyTime={handleCopyTime}
                      onStar={onStar}
                      onLike={onLike}
                    />
                    </div>
                  ))}
                </div>
              </section>
            )}
            {view === 'star' && (
              <h2 className="wb-section-h">
                <IconStar filled /> {starTile.title}
              </h2>
            )}
            {view !== 'star' ? null : starList.length === 0 ? (
              <div className="wb-note">
                <MarkText text="単語リストや復習カードで「★ 覚えたい」を付けた語がここに集まります。" />
              </div>
            ) : (
            <>
            {/* 語数の表示は外した（オーナー 2026-11-07）。再読込・すべて削除は右寄せで残す */}
            <div className="wb-toolbar" style={{ justifyContent: 'flex-end' }}>
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
            {/* CEFR の目安の一行（単語リストと同じ CefrNote・法務 条件2）。目安を出せる語が1語でもある時だけ */}
            {visibleWords.some((w) => cefrHintOf(withWordbookCefr(w, cefrIndex))) && <CefrNote />}
            <div className="vocab-list">
              {visibleWords.length === 0 && (
                <div className="empty-state" style={{ padding: '24px 8px' }}>
                  まだ単語がありません。
                </div>
              )}
              {visibleWords.map((w) => {
                // 話数不明（A22(a)）: 拡張が S/E を検出できずに保存した TV の語。作品の各話リストには
                // 出ないので、ここで所在が分かるようバッジを付ける（映画は S/E が無いのが正＝付けない）。
                const unassigned = isUnassignedTvWord(w, settings.myDramas || []);
                const wc = withWordbookCefr(w, cefrIndex); // CEFR の目安の値（履歴から借りる・試作）
                return (
                  <div key={w.word} id={'wb-w-' + w.word.toLowerCase()} style={unassigned ? { position: 'relative' } : undefined}>
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
                        ...wc,
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
                      exampleSource={wordSource(w, unassigned)}
                      showCefr // 各語に「CEFR目安」（試作 2026-10-30・法務の回答まで本番に出さない）
                      defaultExpanded={focusWord === w.word}
                      starred
                      liked={!!w.liked}
                      onSpeak={speak}
                      onSkip={handleSkip}
                      onCopyTime={handleCopyTime}
                      onStar={onStar}
                      onLike={onLike}
                      onDelete={w.source !== 'star' ? onDelete : undefined}
                    />
                  </div>
                );
              })}
            </div>
            </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
