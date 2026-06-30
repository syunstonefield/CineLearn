'use client';

import { useEffect, useMemo } from 'react';
import { loadHistory } from '@/lib/storage';
import { getDramaStudySeconds, formatStudyTime } from '@/lib/studytime';
import { useApp } from './AppProvider';
import TicketPoster from './TicketPoster';

// 半券の詳細ページ（Phase 2）。コレクション一覧のカードをタップで開くサブ画面。
// 学習履歴＋TMDB（seasons キャッシュ）から、作品単位の学習記録を見せる。
// データは捏造しない：episode タイトルは未保持のため SxE＋学習日で表現する。
export default function TicketDetailView({ entry, seasons, onBack, onFav, onStudy, profileId }) {
  // 半券を開いたら常に一番上から表示（一覧でスクロールした位置を引き継がない）。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // エピソードごとの「単語リスト」へ飛ぶ（既存の VocabScreen＝screen='vocab' を再利用）。
  const { setDrama, setSeason, setEpisode, setScreen } = useApp();
  const openWordList = (s, e) => {
    setDrama(entry.drama);
    setSeason(s);
    setEpisode(e);
    setScreen('vocab');
  };

  // 履歴からこのドラマの「学習したエピソード」を集める（season-episode で重複排除・最新日を採用）。
  const { eps } = useMemo(() => {
    const hist = loadHistory().filter((h) => h.drama?.title === entry.title && h.words?.length);
    const byEp = new Map();
    hist.forEach((h) => {
      const key = `${h.season}-${h.episode}`;
      const d = h.date || '';
      const prev = byEp.get(key);
      if (!prev || d > prev.date) byEp.set(key, { season: h.season, episode: h.episode, date: d, score: h.quizScore });
    });
    const eps = [...byEp.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
    return { eps };
  }, [entry.title]);

  // シーズン別: 学習済み話数 / 総話数（TMDB）。
  const seasonRows = useMemo(() => {
    const studiedBySeason = {};
    eps.forEach((e) => {
      (studiedBySeason[e.season] = studiedBySeason[e.season] || new Set()).add(e.episode);
    });
    return (seasons?.seasons || []).map((s) => ({
      season: s.season,
      total: s.episodes,
      studied: studiedBySeason[s.season] ? studiedBySeason[s.season].size : 0,
    }));
  }, [eps, seasons]);

  const total = entry.total;
  const progress = entry.progress;
  const studyTime = formatStudyTime(getDramaStudySeconds(profileId, entry.title));
  const fmtDate = (s) => (s || '').replace(/-/g, '.');
  const years = seasons?.firstYear
    ? seasons.lastYear && seasons.lastYear !== seasons.firstYear
      ? `${seasons.firstYear} - ${seasons.lastYear}`
      : seasons.firstYear
    : '';

  return (
    <div className="screen active" id="screen-collection-detail">
      <div className="td-screen">
        <div className="td-header">
          <button className="td-back" onClick={onBack} aria-label="コレクションへ戻る">
            ‹
          </button>
          <span className="td-htitle">半券の詳細</span>
          <span className="td-hspacer" />
        </div>

        {/* ヒーロー：チケット（画像テンプレを大きく） */}
        <div className="tcimg-card td-hero">
          <TicketPoster src={entry.posterPath} label={entry.enTitle} color="#7B1FA2" eager />
          <div className="tcimg-body">
            <div className="tcimg-title">{entry.enTitle}</div>
            {entry.jaTitle && <div className="tcimg-ja">{entry.jaTitle}</div>}
            {entry.range && <div className="tcimg-range">{entry.range}</div>}
            <div className="tcimg-date">{[entry.genre, years].filter(Boolean).join(' ・ ')}</div>
          </div>
          <div className="tcimg-eps" aria-hidden="true">{total != null ? total : '—'}</div>
          <div
            className={'tcimg-prog' + (progress != null && progress < 100 ? ' is-partial' : '')}
            aria-hidden="true"
          >
            {progress != null ? `${progress}%` : '—'}
          </div>
          <button
            type="button"
            className={'tcimg-fav' + (entry.isFav ? ' is-on' : '')}
            onClick={() => onFav(entry.title)}
            aria-label={entry.isFav ? 'お気に入りから外す' : 'お気に入りに追加'}
            aria-pressed={entry.isFav}
          >
            {entry.isFav ? '★' : '☆'}
          </button>
        </div>

        {/* アクション行 */}
        <div className="td-actions">
          <button type="button" className={'td-action' + (entry.isFav ? ' is-on' : '')} onClick={() => onFav(entry.title)}>
            {entry.isFav ? '★' : '☆'} お気に入り
          </button>
          {entry.tmdbId && (
            <a
              className="td-action"
              href={`https://www.themoviedb.org/${entry.isMovie ? 'movie' : 'tv'}/${entry.tmdbId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              ⓘ 作品情報
            </a>
          )}
        </div>

        {/* 学習の記録 */}
        <section className="td-sec">
          <h2 className="td-sec-title">学習の記録</h2>
          <div className="td-stats">
            <div className="td-stat">
              <div className="td-stat-label">学習エピソード</div>
              <div className="td-stat-num">
                {entry.studiedEps}
                {total != null && <span className="td-stat-sub"> / {total}</span>}
              </div>
            </div>
            <div className="td-stat">
              <div className="td-stat-label">学習時間</div>
              <div className="td-stat-num">{studyTime}</div>
            </div>
            <div className="td-stat">
              <div className="td-stat-label">単語帳に追加</div>
              <div className="td-stat-num">
                {entry.wordCount}
                <span className="td-stat-sub"> 語</span>
              </div>
            </div>
          </div>
          {progress != null && (
            <div className="td-progress-row">
              <div className="td-progress-bar">
                <span style={{ width: `${progress}%` }} />
              </div>
              <span className="td-progress-pct">進捗率 {progress}%</span>
              {progress >= 100 && <span className="td-done-badge">完了</span>}
            </div>
          )}
        </section>

        {/* シーズン別の進捗 */}
        {seasonRows.length > 0 && (
          <section className="td-sec">
            <h2 className="td-sec-title">シーズン別の進捗</h2>
            <div className="td-seasons">
              {seasonRows.map((s) => {
                const pct = s.total ? Math.min(100, Math.round((s.studied / s.total) * 100)) : 0;
                return (
                  <div className="td-season" key={s.season}>
                    <span className="td-season-name">シーズン{s.season}</span>
                    <span className="td-season-count">
                      {s.studied} / {s.total}
                    </span>
                    <span className="td-season-bar">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* エピソード別の単語リスト（各行タップで そのエピソードの単語リスト画面へ） */}
        {eps.length > 0 && (
          <section className="td-sec">
            <h2 className="td-sec-title">エピソード別の単語リスト</h2>
            <div className="td-eps">
              {eps.map((e) => (
                <button
                  type="button"
                  className="td-ep td-ep-link"
                  key={`${e.season}-${e.episode}`}
                  onClick={() => openWordList(e.season, e.episode)}
                >
                  <span className="td-ep-se">
                    S{e.season}E{e.episode}
                  </span>
                  <span className="td-ep-date">学習日：{fmtDate(e.date)}</span>
                  {e.score != null && <span className="td-ep-score">{e.score}点</span>}
                  <span className="td-ep-go" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <button type="button" className="td-cta" onClick={onStudy}>
          📖 単語リスト
        </button>
      </div>
    </div>
  );
}
