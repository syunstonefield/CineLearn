'use client';

import { tomorrowSubLine } from '@/lib/tomorrowPreview';
import { LEARNED_LABEL, MASTERED_LABEL, LEARNING_LABEL, MASTERED_OF_LEARNED_LABEL } from '@/lib/learnedTerms';
import { IconOpenBook, IconTarget, IconFilm, IconClose, IconSparkle } from './icons/LineIcons';
// 下の札の絵＝線の絵（components/icons/LineIcons.js・2026-11-12 オーナー決定）

// 作品を選んだあと＝カード中心（2026-11-12 オーナー決定・見本 reports/prep-card-first-2026-11-12/mock.html）。
//   CardHome: 単語リストができた作品を開いた時の最初の画面（大きい「単語を学ぶ」＋下に「単語リストを見る」）。
//   CardDone: カードを終えた時の画面（明日 復習できる単語 N個 → 残りの単語も見る／観に行く・今日はここまで＝ホームへ／単語リストを見る・✕＝始めた画面へ）。
// 決まり: ポスターは縦のまま小さく・何も重ねない（TMDB の表示は画面の下の共通の行）／残りの数や「あと○語」は出さない／
//   観ることは止めない（「観に行く」はいつでも押せる・← で抜けられる）。

function Poster({ src, title }) {
  if (!src) return <div className="ch-poster ch-poster-empty" aria-hidden="true">{String(title || '').slice(0, 1)}</div>;
  return <img className="ch-poster" src={src} alt="" loading="lazy" />;
}

// 作品の画面（2026-11-12 オーナー決定・見直しの見本 reports/card-home-redesign-2026-11-12/mock.html）。
//   上の札＝ポスター＋題名・話数・この話の語の数＋記録の小さな札3つ（学習中／覚えた／うち マスター）＋進み具合の線（マスター・覚えた・学習中）。
//   「次に出てくる単語」＝次に出るカードの見出し語を3つ（和訳・例文は出さない）＋「ほか」。「単語を学ぶ」の下に枚数。
//   次につながる1行（今日の復習にこの話から N語／明日 復習できる単語 N個・0 は出さない）。下は札3つ（単語リスト・クイズ・ほかの話）。
//   残りの数・「あと○語」・赤は使わない。時間の目安は測れていないので出さない（枚数だけ・受付 2026-11-12）。
export function CardHome({
  drama,
  season,
  episode,
  isMovie,
  total,
  seen = 0,
  learned = 0,
  mastered = 0,
  peek = [],
  peekMore = false,
  cardN = 0,
  canStart,
  todayDue = 0,
  tomorrow = 0,
  quizPct = null,
  onStart,
  onList,
  onOtherEpisode,
  onQuiz,
}) {
  // 札と線（2026-11-13 オーナー決定）: 学習中＝答えたことがあり、まだ覚えたになっていない語（覚えたとは重ならない）／
  //   覚えた／うち マスター（覚えたの内側）。線は左から マスター（濃い茶）→ 覚えた（茶）→ 学習中（淡い金）。説明の文は出さない。
  const pct = (n) => (total > 0 ? Math.max(0, Math.min(100, (n / total) * 100)) : 0);
  const learning = Math.max(0, seen - learned);
  const masteredW = pct(Math.min(mastered, learned));
  const learnedW = Math.max(0, pct(learned) - masteredW);
  const learningW = Math.min(100 - masteredW - learnedW, pct(learning));
  const nextLine =
    todayDue > 0 ? (
      <>
        今日の復習に、{isMovie ? 'この映画' : 'この話'}から <b>{todayDue}語</b>
      </>
    ) : tomorrow > 0 ? (
      <>
        明日 復習できる単語 <b>{tomorrow}個</b>
      </>
    ) : null;
  const showOther = !isMovie && !!onOtherEpisode;
  const tiles = 1 + (onQuiz ? 1 : 0) + (showOther ? 1 : 0);
  return (
    <div className="ch-wrap">
      <div className="ch-work">
        <Poster src={drama?.posterPath} title={drama?.title} />
        <div className="ch-work-text">
          <h2 className="ch-work-title">{drama?.title}</h2>
          <p className="ch-work-ep">
            {isMovie ? '映画・この映画の語' : `シーズン${season} 第${episode}話・この話の語`} {total}
          </p>
          <div className="ch-stats">
            <div className="ch-stat">
              <b>{learning}</b>
              {LEARNING_LABEL}
            </div>
            <div className="ch-stat">
              <b>{learned}</b>
              {LEARNED_LABEL}
            </div>
            <div className="ch-stat">
              <b>{mastered}</b>
              {MASTERED_OF_LEARNED_LABEL}
            </div>
          </div>
          <div className="ch-bar" aria-hidden="true">
            <i className="ch-bar-m" style={{ width: `${masteredW}%` }} />
            <i className="ch-bar-a" style={{ width: `${learnedW}%` }} />
            <i className="ch-bar-b" style={{ width: `${learningW}%` }} />
          </div>
          <div className="ch-legend" aria-hidden="true">
            <span className="ch-lg-m">{MASTERED_LABEL}</span>
            <span className="ch-lg-a">{LEARNED_LABEL}</span>
            <span className="ch-lg-b">{LEARNING_LABEL}</span>
          </div>
        </div>
      </div>
      <div className="ch-learn">
        {canStart ? (
          <>
            {peek.length > 0 && (
              <>
                <div className="ch-peek-t">次に出てくる単語</div>
                <div className="ch-peek">
                  {peek.map((w) => (
                    <span key={w} lang="en">
                      {w}
                    </span>
                  ))}
                  {peekMore && <em>ほか</em>}
                </div>
              </>
            )}
            <button type="button" className="ch-btn1 ch-btn1-2l" onClick={onStart}>
              単語を学ぶ
              {cardN > 0 && <small>{cardN}枚</small>}
            </button>
          </>
        ) : (
          <p className="ch-none">
            この話の単語は、今日はここまでです。
            <br />
            明日の復習に出てきます。
          </p>
        )}
        {nextLine && <div className="ch-next">{nextLine}</div>}
      </div>
      <div className={`ch-tiles ch-tiles-${tiles}`}>
        <button type="button" className="ch-tile" onClick={onList}>
          <span className="ch-tile-i"><IconOpenBook /></span>
          <b>単語リスト</b>
          <small>{total}語</small>
        </button>
        {/* クイズ（問題が作れる時だけ onQuiz が来る・ホームの続きから学習の「クイズ」と同じ行き先・2026-11-12） */}
        {onQuiz && (
          <button type="button" className="ch-tile" onClick={onQuiz}>
            <span className="ch-tile-i"><IconTarget /></span>
            <b>クイズ</b>
            {quizPct != null ? <small>前回 {quizPct}%</small> : <small>&nbsp;</small>}
          </button>
        )}
        {showOther && (
          <button type="button" className="ch-tile" onClick={onOtherEpisode}>
            <span className="ch-tile-i"><IconFilm /></span>
            <b>ほかの話</b>
            <small>
              S{season}E{episode}
            </small>
          </button>
        )}
      </div>
      <p className="ch-small">学ばなくても、いつでも観られます</p>
    </div>
  );
}

export function CardDone({ count, tomorrow, tomorrowWord = null, canMore, onMore, onWatch, onList, onClose, onDoneToday }) {
  return (
    <div className="ch-wrap ch-done">
      <div className="ch-done-head">
        <button type="button" className="ch-close" onClick={onClose} aria-label="閉じる">
          <IconClose />
        </button>
      </div>
      <div className="ch-done-body">
        <div className="ch-stars" aria-hidden="true">
          <IconSparkle />
          <IconSparkle />
          <IconSparkle />
        </div>
        <h2 className="ch-done-title">{count}語 見ておきました</h2>
        {tomorrow > 0 && (
          <div className="ch-tom">
            <b>明日 復習できる単語 {tomorrow}個</b>
            <div>{tomorrowSubLine(tomorrowWord, tomorrow)}</div>
          </div>
        )}
      </div>
      {canMore && (
        <button type="button" className="ch-btn1" onClick={onMore}>
          残りの単語も見る
        </button>
      )}
      {/* 終わるためのボタン（2026-11-12 オーナー決定・✕は中断に見えるため）。動きは ✕ と同じ＝始めた画面へ戻る。 */}
      <div className="ch-done-pair">
        <button type="button" className="ch-btn2" onClick={onWatch}>
          観に行く
        </button>
        <button type="button" className="ch-btn2" onClick={onDoneToday || onClose}>
          今日はここまで
        </button>
      </div>
      <button type="button" className="ch-row" onClick={onList}>
        単語リストを見る<span>›</span>
      </button>
    </div>
  );
}
