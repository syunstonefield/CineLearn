'use client';

import { useState } from 'react';

// ★ 覚えたい と ♡ お気に入りの例文の印（2026-11-07 オーナー決定・法務 条件付きOK）。
//   復習カード（ReviewCard / ReviewCinemaCard）と予習カード（PrepWalkthrough）で共用。文言は VocabItem と同じ。
//   ★＝単語帳の「覚えたい語」に入れる（my_words.in_wordbook）。♡＝語に付いた例文（字幕の1文）に印（my_words.liked）。
//   ♡は字幕由来の例文がある時だけ出す（canLike）。onStar(starred) / onLike(liked) は今の状態を受け取る。
//   short: 夕焼けシネマの狭い幅（SE 375×667）向けに ♡ の文言を「♡ 保存／♥ 保存済み」に（aria-label・title は長いまま・復習・クイズ部門 2026-11-07）。
//   icon: 夕焼けシネマの裏の右上（「↩ 戻る」の反対側）に置く、アイコンだけの小さなボタン（押せる領域 44px）。
//     「例文を聞く」との押し間違いを減らし画面をすっきりさせる（オーナー 2026-11-07）。文言は aria-label・title に残す。
//   押している間は両方押せなくする（★と♡をほぼ同時に押すと read-modify-write が競合して★が付かないことがあった）。
export default function WordMarks({ starred, liked, canLike = true, onStar, onLike, compact = false, short = false, icon = false }) {
  const [busy, setBusy] = useState(false);
  if (!onStar && !(onLike && canLike)) return null;
  const run = async (fn, arg) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn(arg);
    } finally {
      setBusy(false);
    }
  };
  const starTitle = starred ? '覚えたい語から外す（作品の単語リストには残ります）' : '覚えたい語として単語帳に入れる';
  const likeTitle = liked ? 'お気に入りの印を外す' : 'この例文を保存';
  return (
    <div className={'word-marks' + (compact ? ' is-compact' : '') + (icon ? ' is-icon' : '')}>
      {onStar && (
        <button
          type="button"
          className={(icon ? '' : 'btn-srs-skip ') + 'btn-wordbook-star' + (starred ? ' is-on' : '')}
          aria-pressed={!!starred}
          aria-label={starTitle}
          title={starTitle}
          disabled={busy}
          onClick={(ev) => {
            ev.stopPropagation();
            run(onStar, !!starred);
          }}
        >
          {icon ? <StarIcon on={!!starred} /> : starred ? '★ 覚えたい' : '☆ 覚えたい'}
        </button>
      )}
      {onLike && canLike && (
        <button
          type="button"
          className={(icon ? '' : 'btn-srs-skip ') + 'btn-like-example' + (liked ? ' is-on' : '')}
          aria-pressed={!!liked}
          aria-label={likeTitle}
          title={likeTitle}
          disabled={busy}
          onClick={(ev) => {
            ev.stopPropagation();
            run(onLike, !!liked);
          }}
        >
          {icon ? (
            <HeartIcon on={!!liked} />
          ) : short ? (
            liked ? '♥ 保存済み' : '♡ 保存'
          ) : liked ? (
            '♥ 保存した例文'
          ) : (
            '♡ この例文を保存'
          )}
        </button>
      )}
    </div>
  );
}

// icon 用（付けた時は塗り・付けていない時は線。色は .is-on の文字色＝コントラスト確認済みの値を currentColor で使う）
function StarIcon({ on }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />
    </svg>
  );
}
function HeartIcon({ on }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 20s-7.5-4.6-7.5-10.1C4.5 7.1 6.6 5 9.1 5c1.3 0 2.3.6 2.9 1.5.6-.9 1.6-1.5 2.9-1.5 2.5 0 4.6 2.1 4.6 4.9C19.5 15.4 12 20 12 20z" />
    </svg>
  );
}
