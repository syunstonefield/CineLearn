'use client';

// 無料／プラスの出し分け（design-paid-features-2026-10-08「実装メモ 0. 土台: isPro」）。
//   * PLAN_FEATURES: 機能ごとの区分を1か所で切り替える表。
//       'free'      … 誰でも使える・プラス表示なし
//       'plus'      … 正式版ではプラス。ベータ中は全員使える＋「正式版ではプラス」を控えめに表示
//       'undecided' … 有料/無料を保留中。今は誰でも使える・プラス表示も付けない
//                     （ラベルは片道＝無料→プラスは「取り上げ」になるので、確実なものにだけ付ける）
//   * isPro はサーバー（/api/plan・env CL_PLAN_MODE）が決める。クライアントでは決めない。
//   * 課金・決済はまだ無い。正式版の無料の人には「ぼかし」ではなく説明文を出す（featureAccess().locked）。

import { useEffect, useState } from 'react';
import { authHeaders } from './api';
import { getCurrentUser } from './supabase';

export const PLAN_FEATURES = {
  ring: 'plus', // あゆみタブ（3重の円）＝オーナー 2026-10-09 有料に確定。正式版の無料の人は下のタブから外し、設定に説明を置く
  grass: 'plus', // 学習した日（草・ホームの簡易版も）＝同上
  trend: 'plus', // 語彙のあゆみ「週ごとの推移」
  workReview: 'plus', // 作品・話ごとの復習とクイズ
  reviewCount: 'free', // 毎日の復習語数の変更（オーナー 2026-10-08 無料に変更）
  newWordsDaily: 'plus', // 初めて復習する語を1日に何語でも（無料は1日20語まで）＝オーナー 2026-10-09
};

// ベータ中の初期値（/api/plan の応答前・オフライン時）。ベータ中は全員使える約束なので開いておく。
export const DEFAULT_PLAN = { beta: true, isPro: true, plan: null };

// 応答の前回値（新キー・アカウント単位。uid が違えば使わない）。
const CACHE_KEY = 'cl_plan_cache';

function readCache(uid) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.uid === uid && typeof c.isPro === 'boolean') return { beta: !!c.beta, isPro: c.isPro, plan: c.plan ?? null };
  } catch {}
  return null;
}
function writeCache(uid, p) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ uid, beta: p.beta, isPro: p.isPro, plan: p.plan, at: Date.now() }));
  } catch {}
}

// 機能の使える/表示の状態。
//   usable   … 機能を使わせてよいか
//   betaNote … 「正式版ではプラス（ベータ中はどなたでも使えます）」を出すか
//   locked   … 正式版の無料の人＝機能の代わりに説明文を出す（ぼかし禁止）
export function featureAccess(feature, plan = DEFAULT_PLAN) {
  const tier = PLAN_FEATURES[feature];
  if (tier !== 'plus') return { usable: true, betaNote: false, locked: false };
  if (plan.beta) return { usable: true, betaNote: true, locked: false };
  return { usable: !!plan.isPro, betaNote: false, locked: !plan.isPro };
}

// /api/plan を引く。loggedIn が変わったら引き直す（useApp().loggedIn を渡す）。
// 取得失敗（ok:false・通信失敗）は前回値のまま＝一時不調で表示を揺らさない。
export function usePlan(loggedIn) {
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  useEffect(() => {
    let alive = true;
    const uid = (loggedIn && getCurrentUser()?.id) || '';
    const cached = readCache(uid);
    if (cached) setPlan(cached);
    fetch('/api/plan', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d || d.ok === false) return;
        const next = { beta: !!d.beta, isPro: !!d.isPro, plan: d.plan ?? null };
        setPlan(next);
        writeCache(uid, next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loggedIn]);
  return plan;
}
