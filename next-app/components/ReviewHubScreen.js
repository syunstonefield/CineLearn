'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { getActiveWords } from '@/lib/words';
import {
  loadHistory,
  loadSrs,
  isDue,
  isMastered,
  getAllVocabWords,
  getDueReviewWords,
  DAILY_REVIEW_CAP,
} from '@/lib/storage';

// 復習ハブ（ボトムナビ「復習」の着地点）。
// それまでは復習/クイズに入るのに単語リストの最下部までスクロールする必要があった
// （単語が増えるほど遠い・2026-08-07 実使用フィードバック）。ここで
//   ①今日の復習（全作品横断・従来のタブ動作）
//   ②全作品からランダム出題
//   ③エピソードを選んで復習／クイズ
// を親指の届く位置に集約する。

const RANDOM_SIZE = 10;

// ReviewModal が読める形へ整える（拡張保存語は definition/example を持たず ja/sentence を持つ）。
function toCard(w) {
  return {
    ...w,
    definition: w.ja || w.definition || '',
    example: w.example || w.sentence || '',
  };
}

function isWordDue(w, srs) {
  const e = srs[String(w.word || '').toLowerCase()];
  return !e || isDue(e);
}

// 拡張保存語の出所メタ（48条の出所明示に使う）。話数が分からない語（映画・保存元不明）は
// type:'movie' 扱いにして「S1E1」のような偽の話数を書かない（subtitleCredit の分岐）。
function srcForMyWord(w, movieTitles) {
  const hasEp = w.season != null && w.episode != null;
  return {
    title: w.dramaTitle,
    season: w.season,
    episode: w.episode,
    type: !hasEp || movieTitles.has(w.dramaTitle) ? 'movie' : 'tv',
  };
}

export default function ReviewHubScreen() {
  const {
    profile,
    settings,
    mounted,
    reviewVersion,
    cloudVersion,
    wordbookVersion,
    openReview,
    setCurrentHistoryId,
    startEpisodeQuiz,
    setScreen,
  } = useApp();

  const [myWords, setMyWords] = useState([]);

  // 履歴・SRS は localStorage 由来。復習完了/クラウド取込/単語帳更新で読み直す。
  const history = useMemo(
    () => (mounted ? loadHistory() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, profile, reviewVersion, cloudVersion, wordbookVersion]
  );
  const srs = useMemo(
    () => (mounted ? loadSrs() : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, profile, reviewVersion, cloudVersion, wordbookVersion]
  );

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    getActiveWords(profile?.id)
      .then((w) => {
        if (!cancelled) setMyWords(w || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mounted, profile, wordbookVersion, cloudVersion]);

  // 履歴の drama は {title,genre,platform} だけで type を持たない。
  // 映画かどうかはライブラリ(myDramas)側の型で判定する（Dashboard と同じ手口）。
  const movieTitles = useMemo(
    () =>
      new Set(
        (settings.myDramas || [])
          .filter((d) => d.type === 'movie' || d.mediaType === 'movie')
          .map((d) => d.title)
      ),
    [settings.myDramas]
  );

  // 作品ごとにエピソードをまとめる。history は新しい順なので、作品の並びも「最近見た順」になる。
  const groups = useMemo(() => {
    const m = new Map();
    history.forEach((h) => {
      const title = h.drama?.title;
      const words = h.words || [];
      if (!title || !words.length) return;
      let g = m.get(title);
      if (!g) {
        g = { title, isMovie: movieTitles.has(title), episodes: [], total: 0, due: 0 };
        m.set(title, g);
      }
      const due = words.filter((w) => isWordDue(w, srs)).length;
      g.episodes.push({ entry: h, total: words.length, due });
      g.total += words.length;
      g.due += due;
    });
    m.forEach((g) =>
      g.episodes.sort(
        (a, b) => (a.entry.season || 0) - (b.entry.season || 0) || (a.entry.episode || 0) - (b.entry.episode || 0)
      )
    );
    return [...m.values()];
  }, [history, srs, movieTitles]);

  const todayCount = useMemo(
    () => (mounted ? Math.min(getDueReviewWords(history, srs).length, DAILY_REVIEW_CAP) : 0),
    [mounted, history, srs]
  );

  // ランダム出題の母集団：全履歴＋拡張で保存した単語（重複は語で排除）。
  // マスター済みは出題しない（#7b）。除外して少なすぎる時だけ全語に戻す。
  const randomPool = useMemo(() => {
    // getAllVocabWords の _src.type は履歴に型が無いので常に undefined＝TV扱いになる。
    // 映画に「S1E1」と書かないよう、ライブラリの型で補正してから出所明示に渡す。
    const pool = getAllVocabWords(history).map((w) =>
      toCard({
        ...w,
        _src: { ...(w._src || {}), type: movieTitles.has(w._src?.title) ? 'movie' : w._src?.type },
      })
    );
    const seen = new Set(pool.map((w) => String(w.word || '').toLowerCase()));
    (myWords || []).forEach((w) => {
      const k = String(w.word || '').toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      pool.push(toCard({ ...w, _src: srcForMyWord(w, movieTitles) }));
    });
    const unmastered = pool.filter((w) => !isMastered(srs[String(w.word || '').toLowerCase()]));
    return unmastered.length >= 4 ? unmastered : pool;
  }, [history, myWords, srs, movieTitles]);

  const myDue = useMemo(() => (myWords || []).filter((w) => isWordDue(w, srs)).length, [myWords, srs]);

  const startToday = () => {
    setCurrentHistoryId(null); // 横断復習（特定エピソードに紐づかない）
    openReview(getDueReviewWords(history, srs).slice(0, DAILY_REVIEW_CAP));
  };

  const startRandom = () => {
    const picked = [...randomPool].sort(() => Math.random() - 0.5).slice(0, RANDOM_SIZE);
    if (!picked.length) return;
    setCurrentHistoryId(null);
    openReview(picked, { all: true }); // ランダムは期日を問わない＝空にしない
  };

  const startEpisodeReview = (g, ep) => {
    const { entry } = ep;
    const words = (entry.words || []).map((w) => ({
      ...toCard(w),
      // 出所明示（48条）用に作品/話メタを付帯（VocabScreen の復習と同形）
      _src: {
        title: g.title,
        season: entry.season,
        episode: entry.episode,
        type: g.isMovie ? 'movie' : 'tv',
      },
    }));
    if (!words.length) return;
    setCurrentHistoryId(entry.id);
    if (ep.due > 0) openReview(words.filter((w) => isWordDue(w, srs)));
    else openReview(words, { all: true }); // 期日前でも「もう一度見る」は許す
  };

  const startMyWordsReview = () => {
    const words = (myWords || []).map((w) => toCard({ ...w, _src: srcForMyWord(w, movieTitles) }));
    if (!words.length) return;
    setCurrentHistoryId(null);
    if (myDue > 0) openReview(words.filter((w) => isWordDue(w, srs)).slice(0, DAILY_REVIEW_CAP));
    else openReview(words.slice(0, DAILY_REVIEW_CAP), { all: true });
  };

  const epLabel = (g, entry) => (g.isMovie ? '映画' : `S${entry.season}E${entry.episode}`);
  const hasAnything = groups.length > 0 || (myWords || []).length > 0;

  return (
    <div className="screen active" id="screen-review-hub">
      <div className="rh-screen">
        <div className="rh-head">
          <h1 className="rh-h1">🔁 復習</h1>
          <p className="rh-sub">今日の分・ランダム・エピソード別から選べます</p>
        </div>

        {/* ① 今日の復習（従来のタブ動作＝全作品横断の期日到来分） */}
        <div className={'rh-hero' + (todayCount > 0 ? '' : ' is-done')}>
          <div className="rh-hero-main">
            <div className="rh-hero-title">{todayCount > 0 ? '今日の復習' : '今日の復習は完了！'}</div>
            <div className="rh-hero-sub">
              {todayCount > 0 ? `全作品から ${todayCount}語` : 'ランダムやエピソード別で追加の復習もできます'}
            </div>
          </div>
          {todayCount > 0 && (
            <button className="rh-hero-btn" onClick={startToday}>
              はじめる →
            </button>
          )}
        </div>

        {/* ② 全作品からランダム出題 */}
        <button
          type="button"
          className="rh-random"
          onClick={startRandom}
          disabled={randomPool.length === 0}
        >
          <span className="rh-random-icon" aria-hidden="true">🎲</span>
          <span className="rh-random-text">
            <span className="rh-random-title">全作品からランダム出題</span>
            <span className="rh-random-sub">
              {randomPool.length === 0
                ? 'まだ単語がありません'
                : `${Math.min(RANDOM_SIZE, randomPool.length)}語をシャッフルして出題（${randomPool.length}語から）`}
            </span>
          </span>
        </button>

        {/* ③ エピソードを選ぶ */}
        <div className="rh-section-label">エピソードを選ぶ</div>

        {!hasAnything ? (
          <div className="empty-state" style={{ padding: '24px 8px' }}>
            まだ復習できる単語がありません。
            <br />
            <br />
            <button type="button" className="btn-secondary" onClick={() => setScreen('search')}>
              作品を追加して予習する →
            </button>
          </div>
        ) : (
          <div className="rh-groups">
            {(myWords || []).length > 0 && (
              <div className="rh-group">
                <div className="rh-group-head">
                  <span className="rh-group-title">✏️ 追加した単語</span>
                  <span className="rh-group-meta">{myWords.length}語</span>
                </div>
                <div className="rh-ep-row">
                  <button type="button" className="rh-ep-main" onClick={startMyWordsReview}>
                    <span className="rh-ep-label">視聴中に保存した単語</span>
                    <span className="rh-ep-meta">
                      {myWords.length}語
                      {myDue > 0 ? (
                        <span className="rh-due-badge">復習 {myDue}</span>
                      ) : (
                        <span className="rh-ep-done">✅ 今日の分は完了</span>
                      )}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {groups.map((g) => (
              <div className="rh-group" key={g.title}>
                <div className="rh-group-head">
                  <span className="rh-group-title">{g.title}</span>
                  <span className="rh-group-meta">
                    {g.total}語{g.due > 0 && <span className="rh-due-badge">復習 {g.due}</span>}
                  </span>
                </div>
                {g.episodes.map((ep) => (
                  <div className="rh-ep-row" key={ep.entry.id}>
                    <button type="button" className="rh-ep-main" onClick={() => startEpisodeReview(g, ep)}>
                      <span className="rh-ep-label">{epLabel(g, ep.entry)}</span>
                      <span className="rh-ep-meta">
                        {ep.total}語
                        {ep.due > 0 ? (
                          <span className="rh-due-badge">復習 {ep.due}</span>
                        ) : (
                          <span className="rh-ep-done">✅ 今日の分は完了</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rh-ep-quiz"
                      onClick={() => startEpisodeQuiz(ep.entry)}
                      aria-label={`${g.title} ${epLabel(g, ep.entry)} のクイズ`}
                    >
                      クイズ
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
