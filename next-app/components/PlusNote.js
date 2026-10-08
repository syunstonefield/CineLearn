'use client';

import { featureAccess, DEFAULT_PLAN } from '@/lib/plan';

// 有料予定の機能に添える控えめな表示（design-paid-features-2026-10-08「ベータ方針」）。
//   ベータ中: 「正式版ではプラス（ベータ中はどなたでも使えます）」
//   正式版・無料の人: 説明文（ぼかし・チラ見せはしない）
//   それ以外（無料の機能・保留の機能・正式版のプラスの人）: 何も出さない
//   ★急かす文言（「今だけ」等）・価格・申込導線はここに足さない。
export default function PlusNote({ feature, plan = DEFAULT_PLAN, style }) {
  const a = featureAccess(feature, plan);
  if (!a.betaNote && !a.locked) return null;
  return (
    <span className="plus-note" style={style}>
      {a.betaNote ? (
        <>
          正式版ではプラス<span className="plus-note-sub">（ベータ中はどなたでも使えます）</span>
        </>
      ) : (
        'プラスの機能です'
      )}
    </span>
  );
}
