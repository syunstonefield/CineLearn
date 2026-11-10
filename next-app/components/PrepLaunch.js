'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { watchSearchUrl } from '@/lib/prep';
import { entryTarget, sheetOrder, serviceLabel } from '@/lib/serviceEntry';
import { loadAvailability, fetchAvailability } from '@/lib/serviceAvailability';
import { trackUsage } from '@/lib/usage';

// 予習のあとの「入場」＝元の画面の上に下から出る明るいシート（2026-11-10 深夜 オーナー決定・旧＝全面が暗い「暖色シネマ」）。
//   quiz（クイズ3問のあと）／cards（カードを一周して閉じたあと）／watch（「今夜は観るだけ」）の3つで、一言だけ変える。
//   観るサービス（lib/serviceEntry.js）: この作品で前に選んだ → それ／配信が1つ → それ（開いて覚える）／
//   それ以外・データが取れない → このシートの中で選んでもらう（自動では開かない・法務 2026-11-10）。
//   開く先はボタンのすぐ下に文字で書く（ロゴ・ブランド色なし）・「提携ではありません」・「別のサービスで探す」。
//   window.open は「入場する」を押したその操作の中で呼ぶ（ポップアップとして止められないように）。
//   閉じる＝✕・シートの外を押す・Esc。入場したらシートも閉じる（元の画面へ戻る）。
export default function PrepLaunch() {
  const { prepLaunch, closePrepLaunch, settings, chooseService } = useApp();
  const p = prepLaunch;
  const [avail, setAvail] = useState(null);
  const [picked, setPicked] = useState(''); // このシートで選んだサービス（入場で開く・覚える）
  const [showList, setShowList] = useState(false); // 「別のサービスで探す」で一覧を開いたか

  const tmdbId = p?.drama?.tmdbId || null;
  const isMovie = !!(p?.isMovie || p?.drama?.type === 'movie' || p?.drama?.mediaType === 'movie');
  useEffect(() => {
    setPicked('');
    setShowList(false);
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
  }, [p, tmdbId, isMovie]);

  useEffect(() => {
    if (!p) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closePrepLaunch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p, closePrepLaunch]);

  const title = p?.title || p?.drama?.title || 'この作品';
  const chosen = p ? (settings.myDramas || []).find((d) => d.title === title)?.viewingService || p.service || '' : '';
  const target = p ? entryTarget({ chosen, avail }) : null;
  // 開く先が決まらず、ここで選んでもらう形で出た時に1回数える（enter_ask・固定の名前と回数だけ）。
  const needAsk = !!p && !target && avail !== null;
  useEffect(() => {
    if (needAsk) trackUsage('enter_ask');
  }, [needAsk, p]);

  if (!p) return null;
  // 開く先：このシートで選んだもの → 決まっている先。どちらも無ければ選んでもらう。
  const service = picked || target?.service || '';
  const listOpen = !target || showList;
  const names = sheetOrder({ avail, contracted: settings.selectedServices });

  const enter = () => {
    if (!service) return;
    if (typeof window !== 'undefined') window.open(watchSearchUrl(title, service), '_blank', 'noopener,noreferrer');
    trackUsage('enter_open');
    if (picked || target?.auto) chooseService(service); // 選んだ・配信が1つで決めた → 作品ごとに覚える
    closePrepLaunch();
  };
  const openList = () => {
    if (!target) return;
    trackUsage('enter_ask');
    setShowList(true);
  };

  const head = p.variant === 'watch' ? '今夜の上映' : '今夜の予習';
  let lead;
  let sub;
  if (p.variant === 'quiz') {
    lead = p.total ? `クイズ ${p.correct ?? 0} / ${p.total} 正解。` : 'クイズを終えました。';
    sub = `今夜、この${(p.quizWords || []).length || 3}語が聞こえたら合図です。`;
  } else if (p.variant === 'cards') {
    lead = p.cardCount != null ? `${p.cardCount}語を一周しました。` : '新出語を一周しました。';
    sub = '今夜、覚えた手応えを物語で答え合わせしよう。';
  } else {
    lead = `今夜「${title}」を観に行こう。`;
    sub = 'クイズとフラッシュカードは、あとで受けられます。';
  }

  return (
    <div className="pl-shade" onClick={closePrepLaunch}>
      <div className="pl-sheet" role="dialog" aria-modal="true" aria-label={head} onClick={(e) => e.stopPropagation()}>
        <div className="pl-grip" aria-hidden="true" />
        <div className="pl-head">
          <span className="pl-kicker">{head}</span>
          <button type="button" className="pl-x" onClick={closePrepLaunch} aria-label="閉じる">
            ✕
          </button>
        </div>
        <p className="pl-lead">{lead}</p>
        <p className="pl-sub">{sub}</p>
        {p.variant === 'cards' && <p className="pl-note">うろ覚えの語は、明日また戻ってきます。</p>}

        {listOpen && (
          <div className="pl-svc">
            <div className="pl-svc-cap">
              {target ? '別のサービスで探す' : '観るサービスを選んでください'}
              <small>次からこの作品は、選んだサービスで開きます。あとから変えられます。</small>
            </div>
            <div className="pl-svc-list" role="radiogroup" aria-label="観るサービス">
              {names.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={service === n}
                  className={'pl-svc-item' + (service === n ? ' is-on' : '')}
                  onClick={() => setPicked(n)}
                >
                  <span className="pl-svc-dot" aria-hidden="true" />
                  {serviceLabel(n)}
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="btn-primary pl-enter" onClick={enter} disabled={!service}>
          入場する ▶
        </button>
        <p className="pl-cta-note">
          {service ? `${serviceLabel(service)} を開きます ・ 提携ではありません` : '観るサービスを選ぶと開けます ・ 提携ではありません'}
        </p>
        {target && !showList && (
          <button type="button" className="pl-other" onClick={openList}>
            別のサービスで探す
          </button>
        )}
      </div>
    </div>
  );
}

