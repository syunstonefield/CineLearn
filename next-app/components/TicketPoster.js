'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 半券の左暗部に重ねるポスター。
// 方針：待たせない。頭文字ブロックを常に即表示（ベース）し、ポスター画像が用意でき次第
// その上にフェードイン（解決はバックグラウンド／取得後 myDramas に保存され次回は即時）。
// キャッシュ済み画像は complete 判定で即不透明＝チラつき無し（Suits 等の「ロード無し」挙動）。
// スケルトン待ちは出さない（=変更前の即時表示の体感に戻す）。
// className: 外枠のクラス（既定は半券の左スロット。ポスター壁は 'tcp-poster'）。
// showTitle: 画像が無い時に頭文字の下へ作品名も出す（ポスター壁で何の作品か分かるように）。
export default function TicketPoster({ src, label, color, eager = false, className = 'tcimg-poster', showTitle = false }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);

  // src が変わったら読み込み状態を取り直す。ただし既に読み込み済み（ブラウザキャッシュ）の画像は
  // 不透明のままにする。旧実装はここで無条件に false へ戻していたため、マウント直後に ref 側で
  // true にした値を上書きし、キャッシュ済み画像は onLoad が再発火しないので頭文字のまま残った
  // （2026-10-31 半券のモックで実測：6枚中4枚が読み込み済みなのに透明のまま）。
  useEffect(() => {
    setFailed(false);
    const n = imgRef.current;
    setLoaded(!!(n && n.complete && n.naturalWidth > 0));
  }, [src]);

  // マウント時に既に読み込み済み（ブラウザキャッシュ）なら即不透明化＝頭文字のチラ見せ無し。
  const checkComplete = useCallback((node) => {
    imgRef.current = node;
    if (node && node.complete && node.naturalWidth > 0) setLoaded(true);
  }, []);

  const showImg = src && !failed;

  return (
    <span className={className}>
      {/* ベース＝頭文字（常に即表示・待たせない）。画像が来たら上にフェードイン */}
      <span className="tcimg-poster-fallback" style={{ background: color }} aria-hidden="true">
        {(label || '?').charAt(0)}
        {showTitle && label && <span className="tcimg-poster-fallback-title">{label}</span>}
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
