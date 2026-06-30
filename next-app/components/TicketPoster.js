'use client';

import { useCallback, useEffect, useState } from 'react';

// 半券の左暗部に重ねるポスター。
// 方針：待たせない。頭文字ブロックを常に即表示（ベース）し、ポスター画像が用意でき次第
// その上にフェードイン（解決はバックグラウンド／取得後 myDramas に保存され次回は即時）。
// キャッシュ済み画像は complete 判定で即不透明＝チラつき無し（Suits 等の「ロード無し」挙動）。
// スケルトン待ちは出さない（=変更前の即時表示の体感に戻す）。
export default function TicketPoster({ src, label, color, eager = false }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  // マウント時に既に読み込み済み（ブラウザキャッシュ）なら即不透明化＝頭文字のチラ見せ無し。
  const checkComplete = useCallback((node) => {
    if (node && node.complete && node.naturalWidth > 0) setLoaded(true);
  }, []);

  const showImg = src && !failed;

  return (
    <span className="tcimg-poster">
      {/* ベース＝頭文字（常に即表示・待たせない）。画像が来たら上にフェードイン */}
      <span className="tcimg-poster-fallback" style={{ background: color }} aria-hidden="true">
        {(label || '?').charAt(0)}
      </span>
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={checkComplete}
          className="tcimg-poster-img"
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
