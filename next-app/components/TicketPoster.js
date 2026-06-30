'use client';

import { useState } from 'react';

// 半券の左暗部に重ねるポスター。画像URLが無い／読み込み失敗時は頭文字の色ブロックにフォールバック。
// リロードで画像が出たり出なかったりする問題への保険（CDN一時失敗でも空白にしない）。
export default function TicketPoster({ src, label, color }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="tcimg-poster"
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="tcimg-poster tcimg-poster-fallback" style={{ background: color }} aria-hidden="true">
      {(label || '?').charAt(0)}
    </span>
  );
}
