'use client';

import { useMemo } from 'react';
import { useApp } from './AppProvider';
import { buildCloze, watchSearchUrl } from '@/lib/prep';

// 予習エンジンの完了 launch ramp（finish line でなく「今夜これを聞きに行こう」と前へ送る）。
// 3バリエ（経路ごとに正直）: quiz / cards / watch。全部同じ Netflix(作品単位) CTA。
// 「覚えた」は使わず誠実指標で語る。未視聴日に罪悪感を出さない誘い文に留める。
export default function PrepLaunch() {
  const { prepLaunch, closePrepLaunch } = useApp();
  const p = prepLaunch;

  // 「今夜聞く3行」: 出題3語の example の対象語をハイライト（クローズ位置で強調）。
  const lines = useMemo(() => {
    if (!p || p.variant !== 'quiz') return [];
    return (p.quizWords || [])
      .filter((w) => w.example)
      .map((w) => ({ word: w.word, cloze: buildCloze(w.example, w.word), example: w.example }));
  }, [p]);

  if (!p) return null;

  const title = p.title || p.drama?.title || 'この作品';
  const service = p.service || '';
  const url = watchSearchUrl(title, service);
  const isNetflix = !service || service.toLowerCase().includes('netflix');
  const ctaLabel = `${isNetflix ? 'Netflix' : service} で ${title} を開く`;

  const openWatch = () => {
    // 作品単位ディープリンク（場面tsSecは使わない）。非提携・正規アプリへ。
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
  };

  const cta = (
    <div className="prep-cta-wrap">
      <button className="btn-primary prep-cta" onClick={openWatch}>
        ▶ {ctaLabel}
      </button>
      <div className="prep-cta-note">提携ではありません ・ 正規アプリを開きます</div>
    </div>
  );

  // 明日の復習の誘い（視聴非依存の retention・罪悪感は出さない）。
  const tomorrow =
    p.variant === 'quiz' ? (
      <div className="prep-tomorrow">
        明日、この{p.freshCount != null ? `${p.freshCount}語の` : ''}新出語の最初の復習が届きます。
      </div>
    ) : p.variant === 'cards' ? (
      <div className="prep-tomorrow">うろ覚えの語は、明日また戻ってきます。</div>
    ) : null;

  return (
    <div className="modal-overlay prep-overlay" style={{ display: 'flex' }} onClick={closePrepLaunch}>
      <div className="modal-panel prep-panel prep-launch-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {p.variant === 'quiz' ? '🎧 耳の準備ができました' : p.variant === 'cards' ? '🃏 一周しました' : '🍿 今夜の準備'}
          </span>
          <button className="modal-close" onClick={closePrepLaunch}>✕</button>
        </div>

        <div className="prep-content prep-launch-content">
          {p.variant === 'quiz' && (
            <>
              <div className="prep-launch-lead">今夜、この3つのセリフを聞きに行こう。</div>
              <div className="prep-listen-lines">
                {lines.map((l) => (
                  <div className="prep-listen-line" key={l.word}>
                    “{l.cloze.blank ? (
                      <>
                        {l.cloze.before}
                        <span className="prep-listen-hl">{l.cloze.blank}</span>
                        {l.cloze.after}
                      </>
                    ) : (
                      l.example
                    )}”
                  </div>
                ))}
              </div>
              {p.integrity && (
                <div className="prep-integrity">
                  <span>仕込んだ語 <b>{p.integrity.prepared}</b></span>
                  <span>実セリフ例文 <b>{p.integrity.withExample}</b></span>
                  <span>今夜が初対面 <b>{p.integrity.fresh}</b></span>
                </div>
              )}
            </>
          )}

          {p.variant === 'cards' && (
            <>
              <div className="prep-launch-lead">
                {p.cardCount != null ? `${p.cardCount}語を一周しました。` : '新出語を一周しました。'}
              </div>
              <div className="prep-launch-sub">今夜、覚えた手応えを物語で答え合わせしよう。</div>
            </>
          )}

          {p.variant === 'watch' && (
            <>
              <div className="prep-launch-lead">今夜「{title}」を観に行こう。</div>
              <div className="prep-launch-sub">クイズとフラッシュカードは、あとで受けられます。</div>
            </>
          )}

          {tomorrow}
          {cta}
        </div>
      </div>
    </div>
  );
}
