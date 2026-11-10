'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import ServiceSheet from './ServiceSheet';
import { watchSearchUrl } from '@/lib/prep';
import { entryTarget, sheetOrder, serviceLabel } from '@/lib/serviceEntry';
import { loadAvailability, fetchAvailability } from '@/lib/serviceAvailability';
import { trackUsage } from '@/lib/usage';

// 予習エンジンの完了 = 映画館の「開演」ページ（暖色シネマ）。quiz / cards / watch の3バリエ。
// 入場（視聴サービスへ）は下に常時。半券（プレミアパス画像・席番号）は 2026-10-18 に廃止。
// window.open は入場タップのジェスチャ内で呼びポップアップブロックを回避。
// 観るサービスはここで聞く（2026-11-10・単語リストの前の「視聴サービスを選択」画面の代わり・lib/serviceEntry.js）:
//   この作品で前に選んだ → それ／配信が1つ → それ（開いて覚える）／それ以外・データが取れない → シートで選んでもらう。
//   開く先はボタンのすぐ下に文字で書く（ロゴ・ブランド色なし）・「提携ではありません」・「別のサービスで探す」（法務 2026-11-10）。
export default function PrepLaunch() {
  const { prepLaunch, closePrepLaunch, settings, chooseService } = useApp();
  const p = prepLaunch;
  const [avail, setAvail] = useState(null);
  const [sheet, setSheet] = useState(false);

  const tmdbId = p?.drama?.tmdbId || null;
  const isMovie = !!(p?.isMovie || p?.drama?.type === 'movie' || p?.drama?.mediaType === 'movie');
  useEffect(() => {
    setSheet(false);
    if (!tmdbId) {
      setAvail(null);
      return undefined;
    }
    setAvail(loadAvailability(tmdbId, isMovie));
    let cancelled = false;
    fetchAvailability(tmdbId, isMovie).then((a) => {
      if (!cancelled) setAvail(a);
    });
    return () => {
      cancelled = true;
    };
  }, [tmdbId, isMovie]);

  if (!p) return null;

  const title = p.title || p.drama?.title || 'この作品';
  const chosen = (settings.myDramas || []).find((d) => d.title === title)?.viewingService || p.service || '';
  const target = entryTarget({ chosen, avail });
  const label = target ? serviceLabel(target.service) : '';

  // 入場＝視聴サービスを開く（タップのジェスチャ内で window.open＝ポップアップブロック回避）。
  const openService = (svc) => {
    if (typeof window !== 'undefined') window.open(watchSearchUrl(title, svc), '_blank', 'noopener,noreferrer');
    trackUsage('enter_open');
  };
  const enter = () => {
    if (!target) {
      trackUsage('enter_ask');
      setSheet(true);
      return;
    }
    openService(target.service);
    if (target.auto) chooseService(target.service); // 配信が1つで自動で決めた → 作品ごとに覚える
  };
  const pick = (svc) => {
    setSheet(false);
    openService(svc);
    chooseService(svc);
  };

  const foot = (
    <div className="prep-cinema-foot">
      <button className="prep-cinema-cta" onClick={enter}>
        入場する ▶
      </button>
      <div className="prep-cinema-cta-note">
        {target ? `${label} を開きます ・ 提携ではありません` : '観るサービスを選んでから開きます ・ 提携ではありません'}
      </div>
      {target && (
        <button type="button" className="prep-cinema-other" onClick={() => setSheet(true)}>
          別のサービスで探す
        </button>
      )}
      <ServiceSheet
        open={sheet}
        names={sheetOrder({ avail, contracted: settings.selectedServices })}
        current={target ? target.service : ''}
        onPick={pick}
        onClose={() => setSheet(false)}
        title="どのサービスで観ますか？"
        note="次からこの作品は、選んだサービスで開きます。あとから変えられます。"
      />
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
