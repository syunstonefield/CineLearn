'use client';

// 作品を選んだあと＝カード中心（2026-11-12 オーナー決定・見本 reports/prep-card-first-2026-11-12/mock.html）。
//   CardHome: 単語リストができた作品を開いた時の最初の画面（大きい「単語を学ぶ」＋下に「単語リストを見る」）。
//   CardDone: カードを終えた時の画面（明日 復習できる単語 N個 → 残りの単語も見る／観に行く／単語リストを見る）。
// 決まり: ポスターは縦のまま小さく・何も重ねない（TMDB の表示は画面の下の共通の行）／残りの数や「あと○語」は出さない／
//   観ることは止めない（「観に行く」はいつでも押せる・← で抜けられる）。

function Poster({ src, title }) {
  if (!src) return <div className="ch-poster ch-poster-empty" aria-hidden="true">{String(title || '').slice(0, 1)}</div>;
  return <img className="ch-poster" src={src} alt="" loading="lazy" />;
}

export function CardHome({ drama, season, episode, isMovie, total, seen, canStart, onStart, onList, onOtherEpisode }) {
  return (
    <div className="ch-wrap">
      <div className="ch-work">
        <Poster src={drama?.posterPath} title={drama?.title} />
        <div className="ch-work-text">
          <h2 className="ch-work-title">{drama?.title}</h2>
          <p className="ch-work-ep">{isMovie ? '映画' : `シーズン${season} 第${episode}話`}</p>
        </div>
      </div>
      <div className="ch-big">
        <div className="ch-big-n">{total}</div>
        <div className="ch-big-l">
          この話の語{seen > 0 ? `（うち ${seen}語は見ておきました）` : ''}
        </div>
        {canStart ? (
          <button type="button" className="ch-btn1" onClick={onStart}>
            単語を学ぶ
          </button>
        ) : (
          <p className="ch-none">この話の単語は、今日はここまでです。明日の復習に出てきます。</p>
        )}
      </div>
      <div className="ch-rows">
        <button type="button" className="ch-row" onClick={onList}>
          単語リストを見る<span>{total}語 ›</span>
        </button>
        {!isMovie && onOtherEpisode && (
          <button type="button" className="ch-row" onClick={onOtherEpisode}>
            ほかの話を選ぶ<span>›</span>
          </button>
        )}
      </div>
      <p className="ch-small">学ばなくても、いつでも観られます</p>
    </div>
  );
}

export function CardDone({ count, tomorrow, canMore, onMore, onWatch, onList, onClose }) {
  return (
    <div className="ch-wrap ch-done">
      <div className="ch-done-head">
        <button type="button" className="ch-close" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="ch-done-body">
        <div className="ch-stars" aria-hidden="true">✦✦✦</div>
        <h2 className="ch-done-title">{count}語 見ておきました</h2>
        {tomorrow > 0 && (
          <div className="ch-tom">
            <b>明日 復習できる単語 {tomorrow}個</b>
            <div>1日あけて思い出すと、覚えやすくなります</div>
          </div>
        )}
      </div>
      {canMore && (
        <button type="button" className="ch-btn1" onClick={onMore}>
          残りの単語も見る
        </button>
      )}
      <button type="button" className="ch-btn2" onClick={onWatch}>
        観に行く
      </button>
      <button type="button" className="ch-row" onClick={onList}>
        単語リストを見る<span>›</span>
      </button>
    </div>
  );
}
