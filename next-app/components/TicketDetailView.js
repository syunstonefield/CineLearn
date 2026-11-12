'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadHistory } from '@/lib/storage';
import { FRAME_TIERS } from '@/lib/ticketFrame';
import { useApp } from './AppProvider';
import TicketPoster from './TicketPoster';

// コレクションの作品の詳細（2026-11-12 作り替え・reports/collection-ui-current-2026-11-10/mock.html）。
// ・2026-11-12: 1画面に収める（ポスター スマホ 136px・PC 240px＝法務の上限内・縦のまま切らない・何も重ねない）。
// ・学習した話だけを並べる（「学習エピソード 4 / 140」やシーズン別の「0 / 16」の行はやめた＝未達を見せる分母を出さない）。
// ・学習の記録＝単語リスト○話／覚えた○語／マスター○語＋達成度の線（30・60・90% に額縁の目印。「あと○語」は出さない）。
// ・入口は上の「続きから学習（SxEy）」と、話ごとの行。学習時間は出さない（測っていない人が多い）。
// ・「コレクションから消去」の決まりはそのまま（確認画面・8秒の取り消し＝TicketCollectionScreen）。
// データは捏造しない：話の題は持っていないので SxEy＋学習した日で表す。
export default function TicketDetailView({ entry, onBack, onFav, onStudy, onRemove }) {
  // 詳細を開いたら常に一番上から表示（一覧でスクロールした位置を引き継がない）。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // 話ごとの「単語リスト」へ飛ぶ（既存の VocabScreen＝screen='vocab' を再利用）。
  const { setDrama, setSeason, setEpisode, setScreen, settings } = useApp();
  const openWordList = (s, e) => {
    setDrama(entry.drama);
    setSeason(s);
    setEpisode(e);
    setScreen('vocab');
  };

  // 履歴からこの作品の「学習した話」を集める（season-episode で重複排除・最新日を採用）。新しい日が上。
  const eps = useMemo(() => {
    const hist = loadHistory().filter((h) => h.drama?.title === entry.title && h.words?.length);
    const byEp = new Map();
    hist.forEach((h) => {
      const key = `${h.season}-${h.episode}`;
      const d = h.date || '';
      const prev = byEp.get(key);
      if (!prev || d > prev.date) byEp.set(key, { season: h.season, episode: h.episode, date: d });
    });
    return [...byEp.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.season - a.season || b.episode - a.episode);
  }, [entry.title]);

  // 「続きから学習」の話＝この作品で最後に開いた話（myDramas の lastSeason/lastEpisode・openDrama が復元する）。
  //   記憶が無ければ一番新しく学習した話。映画は話の番号を出さない。
  const saved = (settings.myDramas || []).find((d) => d.title === entry.title);
  const resume = saved?.lastSeason && saved?.lastEpisode ? { season: saved.lastSeason, episode: saved.lastEpisode } : eps[0] || null;
  const resumeLabel = !entry.isMovie && resume ? `続きから学習（S${resume.season}E${resume.episode}）` : '続きから学習';

  // 話の行は絞る（スマホは新しい1話・PC は3話＝1画面に収める・オーナー 2026-11-12）。「すべての話」で全部を出す。
  const [showAll, setShowAll] = useState(false);
  const progress = entry.progress;
  const fmtDate = (s) => (s || '').slice(0, 10).replace(/-/g, '.');

  return (
    <div className="screen active" id="screen-collection-detail">
      <div className="screen-inner cl-screen cld">
        <button type="button" className="btn-back cld-back" onClick={onBack}>
          ← コレクション
        </button>

        <div className="cld-head">
          <span className={`tcp-item frame-${entry.frame.key} cld-ps`}>
            <span className="tcp-frame">
              <span className="tcp-mat">
                <TicketPoster src={entry.posterPath} label={entry.enTitle} color="#7B1FA2" eager className="tcp-poster" showTitle />
              </span>
            </span>
          </span>
          <div className="cld-head-tx">
            <h1 className="cld-title">{entry.enTitle}</h1>
            {entry.jaTitle && <p className="cld-ja">{entry.jaTitle}</p>}
            <p className="cld-meta">
              {entry.isMovie ? '映画' : `単語リスト ${entry.studiedEps}話`}
              {entry.addedDate ? `　はじめた日 ${fmtDate(entry.addedDate)}` : ''}
            </p>
          </div>
        </div>

        <div className="cld-row2">
          <button
            type="button"
            className={'cld-btn2' + (entry.isFav ? ' is-on' : '')}
            onClick={() => onFav(entry.title)}
            aria-pressed={entry.isFav}
          >
            {entry.isFav ? '★ お気に入り' : '☆ お気に入りに入れる'}
          </button>
          {entry.tmdbId && (
            <a
              className="cld-btn2"
              href={`https://www.themoviedb.org/${entry.isMovie ? 'movie' : 'tv'}/${entry.tmdbId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              ⓘ 作品情報
            </a>
          )}
        </div>

        <button type="button" className="btn-primary cld-go" onClick={onStudy}>
          {resumeLabel}
        </button>

        <section className="cld-card">
          <h2 className="cld-card-title">学習の記録</h2>
          <div className="cld-cells">
            <div className="cld-cell">
              <small>単語リスト</small>
              <b>{entry.studiedEps}</b>
              <i>話</i>
            </div>
            <div className="cld-cell">
              <small>覚えた</small>
              <b>{entry.learnedWords ?? 0}</b>
              <i>語</i>
            </div>
            <div className="cld-cell">
              <small>マスター</small>
              <b>{entry.masteredWords ?? 0}</b>
              <i>語</i>
            </div>
          </div>
          {progress != null && (
            <div className="cld-ach">
              <p className="cld-ach-text">
                達成度 {progress}%（集めた {entry.wordCount}語のうち、覚えた {entry.learnedWords ?? 0}語）
              </p>
              <div className="cld-track" role="img" aria-label={`達成度 ${progress}%`}>
                <span className="cld-track-fill" style={{ width: `${progress}%` }} />
                {FRAME_TIERS.slice(1).map((t) => (
                  <span key={t.key} className={`cld-mark mark-${t.key}`} style={{ left: `${t.min}%` }} data-l={t.label} />
                ))}
              </div>
            </div>
          )}
        </section>

        {eps.length > 0 && (
          <section className="cld-card">
            <div className="cld-card-head">
              <h2 className="cld-card-title">話ごとの単語リスト</h2>
              {!showAll && eps.length > 1 && (
                <button
                  type="button"
                  className={'cld-all' + (eps.length <= 3 ? ' is-sp-only' : '')}
                  onClick={() => setShowAll(true)}
                >
                  すべての話（{eps.length}話）›
                </button>
              )}
            </div>
            <div className={'cld-eps' + (showAll ? ' is-all' : '')}>
              {eps.map((e, i) => (
                <button
                  type="button"
                  className={'cld-ep' + (i >= 1 ? ' is-more-sp' : '') + (i >= 3 ? ' is-more-pc' : '')}
                  key={`${e.season}-${e.episode}`}
                  onClick={() => openWordList(e.season, e.episode)}
                >
                  <b>{entry.isMovie ? '映画' : `S${e.season}E${e.episode}`}</b>
                  <span>学習した日 {fmtDate(e.date)}</span>
                  <em aria-hidden="true">›</em>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* コレクションから消去（オーナー 2026-11-07・確認画面で何が消えて何が残るかを件数で出す） */}
        {onRemove && (
          <button type="button" className="cld-del" onClick={onRemove}>
            コレクションから消去
          </button>
        )}

        {/* TMDB の表示（法務の条件 2026-11-12＝画面に見えていること）。画面下の帯はスマホでは下のタブバーの下になり、
            この詳細を1画面に収めるとスクロールしないと見えないため、ここにも1行置く。 */}
        <p className="cld-tmdb">
          This product uses the TMDB API but is not endorsed or certified by{' '}
          <a href="https://www.themoviedb.org" target="_blank" rel="noopener">
            TMDB
          </a>
          .
        </p>
      </div>
    </div>
  );
}
