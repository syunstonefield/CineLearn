'use client';

import { useApp } from './AppProvider';
import { watchSearchUrl } from '@/lib/prep';

// 予習エンジンの完了 = 映画館の「開演」ページ（暖色シネマ）。quiz / cards / watch の3バリエ。
// 入場（視聴サービスへ）は下に常時。半券（プレミアパス画像・席番号）は 2026-10-18 に廃止。
// window.open は入場タップのジェスチャ内で呼びポップアップブロックを回避。
export default function PrepLaunch() {
  const { prepLaunch, closePrepLaunch } = useApp();
  const p = prepLaunch;

  if (!p) return null;

  const title = p.title || p.drama?.title || 'この作品';
  const service = p.service || '';
  const url = watchSearchUrl(title, service);
  const isNetflix = !service || service.toLowerCase().includes('netflix');
  const serviceLabel = isNetflix ? 'Netflix' : service;

  // 入場＝視聴サービスを開く（タップのジェスチャ内で window.open＝ポップアップブロック回避）。
  const enter = () => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
  };

  const foot = (
    <div className="prep-cinema-foot">
      <button className="prep-cinema-cta" onClick={enter}>
        入場する ▶
      </button>
      <div className="prep-cinema-cta-note">{serviceLabel} を開きます ・ 提携ではありません</div>
    </div>
  );

  // ── quiz / cards / watch = 暖色シネマページ ──
  const tomorrow =
    p.variant === 'cards' ? (
      <div className="prep-cinema-tomorrow">うろ覚えの語は、明日また戻ってきます。</div>
    ) : null;
  const headTitle = p.variant === 'watch' ? '🍿 今夜の上映' : '🎬 今夜の予習';

  return (
    <div className="prep-cinema-overlay" onClick={closePrepLaunch}>
      <div className="prep-cinema-panel" onClick={(e) => e.stopPropagation()}>
        <div className="prep-cinema-head">
          <span className="prep-cinema-title">{headTitle}</span>
          <button className="prep-cinema-close" onClick={closePrepLaunch} aria-label="閉じる">
            ✕
          </button>
        </div>

        <div className="prep-cinema-body">
          {p.variant === 'quiz' && (
            <>
              <div className="prep-cinema-lead">
                {p.total ? `クイズ ${p.correct ?? 0} / ${p.total} 正解。` : 'クイズを終えました。'}
              </div>
              <div className="prep-cinema-sub">今夜、この{(p.quizWords || []).length || 3}語が聞こえたら合図です。</div>
            </>
          )}
          {p.variant === 'cards' && (
            <>
              <div className="prep-cinema-lead">
                {p.cardCount != null ? `${p.cardCount}語を一周しました。` : '新出語を一周しました。'}
              </div>
              <div className="prep-cinema-sub">今夜、覚えた手応えを物語で答え合わせしよう。</div>
            </>
          )}
          {p.variant === 'watch' && (
            <>
              <div className="prep-cinema-lead">今夜「{title}」を観に行こう。</div>
              <div className="prep-cinema-sub">クイズとフラッシュカードは、あとで受けられます。</div>
            </>
          )}
          {tomorrow}
        </div>

        {foot}
      </div>
    </div>
  );
}
