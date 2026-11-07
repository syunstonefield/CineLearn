'use client';

// ★ 覚えたい と ♡ お気に入りの例文の印（2026-11-07 オーナー決定・法務 条件付きOK）。
//   復習カード（ReviewCard / ReviewCinemaCard）と予習カード（PrepWalkthrough）で共用。文言は VocabItem と同じ。
//   ★＝単語帳の「覚えたい語」に入れる（my_words.in_wordbook）。♡＝語に付いた例文（字幕の1文）に印（my_words.liked）。
//   ♡は字幕由来の例文がある時だけ出す（canLike）。onStar(starred) / onLike(liked) は今の状態を受け取る。
export default function WordMarks({ starred, liked, canLike = true, onStar, onLike, compact = false }) {
  if (!onStar && !(onLike && canLike)) return null;
  return (
    <div className={'word-marks' + (compact ? ' is-compact' : '')}>
      {onStar && (
        <button
          type="button"
          className={'btn-srs-skip btn-wordbook-star' + (starred ? ' is-on' : '')}
          aria-pressed={!!starred}
          title={starred ? '覚えたい語から外す（作品の単語リストには残ります）' : '覚えたい語として単語帳に入れる'}
          onClick={(ev) => {
            ev.stopPropagation();
            onStar(!!starred);
          }}
        >
          {starred ? '★ 覚えたい' : '☆ 覚えたい'}
        </button>
      )}
      {onLike && canLike && (
        <button
          type="button"
          className={'btn-srs-skip btn-like-example' + (liked ? ' is-on' : '')}
          aria-pressed={!!liked}
          title={liked ? 'お気に入りの印を外す' : 'この例文を保存'}
          onClick={(ev) => {
            ev.stopPropagation();
            onLike(!!liked);
          }}
        >
          {liked ? '♥ 保存した例文' : '♡ この例文を保存'}
        </button>
      )}
    </div>
  );
}
