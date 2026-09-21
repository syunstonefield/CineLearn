'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { getActiveWords } from '@/lib/words';
import {
  loadHistory,
  loadSrs,
  isDue,
  isLearned,
  isMastered,
  getDueReviewWords,
  DAILY_REVIEW_CAP,
} from '@/lib/storage';

// 復習ハブ（ボトムナビ「復習」の着地点）。
// それまでは復習/クイズに入るのに単語リストの最下部までスクロールする必要があった
// （単語が増えるほど遠い・2026-08-07 実使用フィードバック）。ここで
//   ①今日の復習（全作品横断・従来のタブ動作。中身は期日到来→未学習の優先を保ちつつ日替わりシャッフル）
//   ②エピソードを選んで復習／クイズ
// を親指の届く位置に集約する。
// 「全作品からランダム出題」は 2026-09-22 に撤去した：未学習語が多い実運用では母集団が
// 今日の復習とほぼ同じになり、違いが語数と順番だけだった（オーナー指摘）。日替わり感は
// getDueReviewWords 側のシャッフルで担う。

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
      // 習得ゲージ用（覚えた=2回連続成功／マスター=覚えたの上位。ホームの作品カードと同じ判定）
      let learned = 0;
      let mastered = 0;
      words.forEach((w) => {
        const e = srs[String(w.word || '').toLowerCase()];
        if (isLearned(e)) learned++;
        if (isMastered(e)) mastered++;
      });
      g.episodes.push({ entry: h, total: words.length, due, learned, mastered });
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

  // ホームの「今日の復習」と同じ母集団にする（myWords を渡す）。渡さないと同じ名前の入口が
  // 画面ごとに別の数字を出す（ホーム=本編+保存語／ここ=本編のみ）＝どちらかが嘘になる。
  const todayCount = useMemo(
    () => (mounted ? Math.min(getDueReviewWords(history, srs, myWords).length, DAILY_REVIEW_CAP) : 0),
    [mounted, history, srs, myWords]
  );

  const myDue = useMemo(() => (myWords || []).filter((w) => isWordDue(w, srs)).length, [myWords, srs]);

  const startToday = () => {
    setCurrentHistoryId(null); // 横断復習（特定エピソードに紐づかない）
    openReview(getDueReviewWords(history, srs, myWords).slice(0, DAILY_REVIEW_CAP));
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

  // 習得ゲージ（行の左）。「あと何語」より「ここまで来た」を見せて復習意欲を上げる（オーナー提案 2026-09-22）。
  //   バー1本＝覚えた率（緑）。マスターは同じバーの濃い部分（金）として重ねる。数字は「覚えた N%」＋マスター到達後は「マスター N%」。
  //   0% は数字を出さず薄いバーのみ（「0%」と書くと逆に萎える）。全語覚えたら「✅ 全部覚えた」。
  //   覚えた率を主役にする理由: マスターは4回連続＋約3週間半かかり序盤は延々0%になるため。
  const Gauge = ({ learned, mastered, total }) => {
    if (!total) return null;
    if (learned >= total) return <span className="rh-gauge-full">✅ 全部覚えた</span>;
    const lp = Math.round((learned / total) * 100);
    const mp = Math.round((mastered / total) * 100);
    return (
      <span className="rh-gauge" title={`覚えた ${learned}/${total}・マスター ${mastered}/${total}`}>
        <span className="rh-gauge-bar" aria-hidden="true">
          <span className="rh-gauge-learned" style={{ width: `${lp}%` }} />
          <span className="rh-gauge-mastered" style={{ width: `${mp}%` }} />
        </span>
        {/* 数字はバーの横にまとめる。スマホ幅では縦1列（覚えた／マスター）に積む（オーナー要望 2026-09-22） */}
        {learned > 0 && (
          <span className="rh-gauge-pcts">
            <span className="rh-gauge-pct">覚えた {lp}%</span>
            {/* マスター率は到達したときだけ数字を出す（序盤は延々0%になるため） */}
            {mastered > 0 && <span className="rh-gauge-mpct">マスター {mp}%</span>}
          </span>
        )}
      </span>
    );
  };

  // 映画は1行しか無いので「映画」というラベルは出さない（作品名の下に「映画」と書いても情報ゼロ・
  // オーナー指摘 2026-09-22）。行の左は語数/復習数を置き、見出し側の重複表示は消す。
  const epLabel = (g, entry) => (g.isMovie ? '' : `S${entry.season}E${entry.episode}`);
  const hasAnything = groups.length > 0 || (myWords || []).length > 0;

  return (
    <div className="screen active" id="screen-review-hub">
      <div className="rh-screen">
        <div className="rh-head">
          <h1 className="rh-h1">🔁 復習</h1>
          <p className="rh-sub">今日の分・エピソード別から選べます</p>
        </div>

        {/* ① 今日の復習（従来のタブ動作＝全作品横断の期日到来分） */}
        <div className={'rh-hero' + (todayCount > 0 ? '' : ' is-done')}>
          <div className="rh-hero-main">
            <div className="rh-hero-title">{todayCount > 0 ? '今日の復習' : '今日の復習は完了！'}</div>
            <div className="rh-hero-sub">
              {todayCount > 0 ? `全作品から ${todayCount}語` : 'エピソード別で追加の復習もできます'}
            </div>
          </div>
          {todayCount > 0 && (
            <button className="rh-hero-btn" onClick={startToday}>
              はじめる →
            </button>
          )}
        </div>

        {/* ② エピソードを選ぶ */}
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
                  <span className="rh-group-title">📖 マイ単語帳</span>
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
                  {!g.isMovie && (
                    <span className="rh-group-meta">
                      {g.total}語{g.due > 0 && <span className="rh-due-badge">復習 {g.due}</span>}
                    </span>
                  )}
                </div>
                {g.episodes.map((ep) => (
                  <div className="rh-ep-row" key={ep.entry.id}>
                    <button type="button" className="rh-ep-main" onClick={() => startEpisodeReview(g, ep)}>
                      {epLabel(g, ep.entry) && <span className="rh-ep-label">{epLabel(g, ep.entry)}</span>}
                      <Gauge learned={ep.learned} mastered={ep.mastered} total={ep.total} />
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
                      aria-label={`${g.title}${epLabel(g, ep.entry) ? ` ${epLabel(g, ep.entry)}` : ''} のクイズ`}
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
