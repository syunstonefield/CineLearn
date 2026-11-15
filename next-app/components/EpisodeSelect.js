'use client';

import { CardPoster } from './CardHome';

// 話を選ぶ画面（リストを作る前・2026-11-15 オーナー決定 案A・見本 reports/episode-select-2026-11-15/mock.html の左）。
//   作品の画面（CardHome 案B）とそろえる: 上に濃い茶の帯（ポスター縦のまま／ドラマ・映画の札／作品名／リストがある話 N話／観る：○○（変更））、
//   帯に少し重ねた白い箱（学ぶ話 → 変更 ▾＝話を選ぶシート／字幕の小さな印／「単語を学ぶ」／学ばなくても、いつでも観られます）、
//   下は行の形（この作品のリストを整理 N話 ›＝2話以上の時だけ）、出典（配信の1行と長い出典の文は組・TMDB の1行）は画面の下に小さく。
//   見た目と大きさの伸び縮みは CardHome の .ch-* をそのまま使う（app/style.css の html.cl-screen-fit 以下）。
//   なくしたもの: 作品名の線つき見出し・英語の「Season 2 Episode 5 字幕あり」・点線の箱「『単語を学ぶ』を押してください」。
//   法務: ポスターは縦のまま・切り抜かない・何も重ねない・スマホ110／PC200まで。帯の色は決まった色だけ。
export function EpisodeSelect({
  drama,
  isMovie,
  season,
  episode,
  listCount = 0,
  svcName = '',
  onSvcChange,
  onPickEpisode,
  status = null, // { tone: 'ok' | 'muted' | 'warn', text }
  genBtn,
  onGenerate,
  onOrganize,
  notes = null, // 配信の1行と長い出典の文（組・無い時は null）
  children, // 状態によって出すもの（ログイン・カタログ外のリクエスト・保存した単語の一覧）
}) {
  const showGo = genBtn && !genBtn.hidden;
  const goText = String(genBtn?.text || '').replace(/\s*→\s*$/, '');
  return (
    <div className="ch-wrap ch-b es-a">
      {/* 帯と白い箱はひとまとまり（箱は帯に少し重なる）。空いた高さは、このまとまりの上と下に半分ずつ */}
      <div className="es-top">
      <div className="ch-hero">
        <CardPoster src={drama?.posterPath} title={drama?.title} />
        <div className="ch-hero-text">
          <div className="ch-kind">{isMovie ? '映画' : 'ドラマ'}</div>
          <h2 className="ch-work-title">{drama?.title}</h2>
          {!isMovie && listCount > 0 && <p className="ch-work-ep">リストがある話 {listCount}話</p>}
          {svcName && (
            <p className="ch-work-ep es-svc">
              観る：
              <button type="button" className="es-svc-btn" onClick={onSvcChange} title="観るサービスを変える">
                {svcName}（変更）
              </button>
            </p>
          )}
        </div>
      </div>

      <div className="ch-learn es-learn">
        {!isMovie && (
          <>
            <div className="ch-peek-t">学ぶ話</div>
            <button type="button" className="es-ep" onClick={onPickEpisode} aria-haspopup="dialog">
              <span className="es-ep-now">
                シーズン{season} 第{episode}話
              </span>
              <span className="es-ep-chg">変更 ▾</span>
            </button>
          </>
        )}
        {status?.text && <p className={'es-st es-st-' + (status.tone || 'muted')}>{status.text}</p>}
        {showGo && (
          <button type="button" className="ch-btn1 es-go" disabled={genBtn.disabled} onClick={onGenerate}>
            {goText}
          </button>
        )}
        {showGo && <p className="ch-small">学ばなくても、いつでも観られます</p>}
      </div>
      </div>

      {children ? <div className="es-extra">{children}</div> : null}

      {listCount >= 2 && onOrganize && (
        <div className="ch-rows-b es-rows">
          <button type="button" className="ch-rowb" onClick={onOrganize}>
            この作品のリストを整理
            <span className="ch-rowb-r">
              <small>{listCount}話</small>
              <i aria-hidden="true">›</i>
            </span>
          </button>
        </div>
      )}

      {/* 出典は画面の下に1か所（配信の1行と長い出典の文は組で・取れない時は両方出さない／TMDB の1行・英語の全文 12px） */}
      <div className="ch-tmdb es-notes">
        {notes}
        <p className="es-tmdb">
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
