'use client';

import { useEffect, useMemo } from 'react';
import { loadHistory } from '@/lib/storage';
import { getDramaStudySeconds, formatStudyTime } from '@/lib/studytime';
import TicketPoster from './TicketPoster';

// 半券の詳細ページ（Phase 2）。コレクション一覧のカードをタップで開くサブ画面。
// 学習履歴＋TMDB（seasons キャッシュ）から、作品単位の学習記録を見せる。
// データは捏造しない：episode タイトルは未保持のため SxE＋学習日で表現する。
export default function TicketDetailView({ entry, seasons, onBack, onFav, onStudy, profileId }) {
  // 半券を開いたら常に一番上から表示（一覧でスクロールした位置を引き継がない）。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // 履歴からこのドラマのエピソード（日付つき）と学んだ単語を集める。
  const { eps, words } = useMemo(() => {
    const hist = loadHistory().filter((h) => h.drama?.title === entry.title);
    const eps = hist
      .map((h) => ({ season: h.season, episode: h.episode, date: h.date || '', score: h.quizScore }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const seen = new Set();
    const words = [];
    hist.forEach((h) =>
      (h.words || []).forEach((w) => {
        const k = (w.word || '').toLowerCase();
        if (k && !seen.has(k)) {
          seen.add(k);
          words.push(w.word);
        }
      })
    );
    return { eps, words };
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

        {/* 最近学習したエピソード（episode タイトルは未保持＝SxE＋学習日で表現） */}
        {eps.length > 0 && (
          <section className="td-sec">
            <h2 className="td-sec-title">最近学習したエピソード</h2>
            <div className="td-eps">
              {eps.slice(0, 5).map((e, i) => (
                <div className="td-ep" key={`${e.season}-${e.episode}-${i}`}>
                  <span className="td-ep-se">
                    S{e.season}E{e.episode}
                  </span>
                  <span className="td-ep-date">学習日：{fmtDate(e.date)}</span>
                  {e.score != null && <span className="td-ep-score">{e.score}点</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 学んだ表現・単語 */}
        {words.length > 0 && (
          <section className="td-sec">
            <h2 className="td-sec-title">学んだ表現・単語</h2>
            <div className="td-words">
              {words.slice(0, 18).map((w) => (
                <span className="td-word" key={w}>
                  {w}
                </span>
              ))}
              {words.length > 18 && <span className="td-word td-word-more">+{words.length - 18}</span>}
            </div>
          </section>
        )}

        {/* CTA */}
        <button type="button" className="td-cta" onClick={onStudy}>
          ▶ もう一度この作品を学習する
        </button>
      </div>
    </div>
  );
}
