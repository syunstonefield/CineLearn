'use client';

import { useEffect, useState } from 'react';

// 半券の左暗部に重ねるポスター。
// 状態遷移：解決待ち/読み込み中＝スケルトン（シマー）→ 画像ロード完了でフェードイン。
// URL が無いまま一定時間（4s）経過 or 読み込み失敗＝頭文字の色ブロックにフォールバック。
// これで「空白→頭文字→画像」の2-3段ちらつきを「シマー→画像」の1段に抑える。
export default function TicketPoster({ src, label, color, eager = false }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // 画像が差し替わったら読み込み状態をリセット。
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  // URL 未確定（解決中）が続く場合のみ、4秒でフォールバックへ（本当にポスターが無い作品対策）。
  useEffect(() => {
    if (src) return;
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [src]);

  const showImg = src && !failed;
  const showFallback = failed || (!src && timedOut);

  return (
    <span className="tcimg-poster">
      {showImg ? (
        <>
          {!loaded && <span className="img-skeleton" aria-hidden="true" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="tcimg-poster-img"
            src={src}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : undefined}
            style={{ opacity: loaded ? 1 : 0 }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      ) : showFallback ? (
        <span className="tcimg-poster-fallback" style={{ background: color }} aria-hidden="true">
          {(label || '?').charAt(0)}
        </span>
      ) : (
        // 解決中（URL未確定）＝シマーを出して頭文字のチラ見せを防ぐ
        <span className="img-skeleton" aria-hidden="true" />
      )}
    </span>
  );
}
