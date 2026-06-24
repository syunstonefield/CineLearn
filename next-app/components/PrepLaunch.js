'use client';

import { useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { buildCloze, watchSearchUrl } from '@/lib/prep';

// 予習エンジンの完了 = 映画館の「今夜のチケット＋開演」。
// quiz 完了は public/premiere-pass.png（文字なしの紙チケット・形と質感は画像と一致）を
//   背景にして、作品名・話数・予習クリア・指定席・日付を上に重ねる。タップで裏返すと
//   今夜の聞きどころ。入場（視聴サービスへ）は下に常時。cards / watch は暖色シネマページ。
// window.open は入場タップのジェスチャ内で呼びポップアップブロックを回避。
export default function PrepLaunch() {
  const { prepLaunch, closePrepLaunch } = useApp();
  const p = prepLaunch;
  const [flipped, setFlipped] = useState(false);

  // 「今夜聞く3行」: 出題3語の example の対象語をクローズ位置で強調。
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
  const serviceLabel = isNetflix ? 'Netflix' : service;

  // チケットは英語表記で統一（元画像に合わせる）。英題が無ければ表示名にフォールバック。
  const enTitle = p.drama?.englishTitle || title;
  const hasSE = !p.isMovie && p.season != null && p.episode != null;
  const seLabel = hasSE ? `SEASON ${p.season} · EPISODE ${p.episode}` : '';
  // 指定席は PrepQuiz が nextSeat() で採番した通し番号（A-01→…→B-01…）。payload から受ける。
  const seat = p.seat || 'A-01';
  const d = new Date();
  const dateLabel = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

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

  // ── quiz 完了 = プレミアパス（画像チケット＋オーバーレイ＋フリップ）──
  if (p.variant === 'quiz') {
    return (
      <div className="prep-cinema-overlay" onClick={closePrepLaunch}>
        <div className="prep-cinema-panel" onClick={(e) => e.stopPropagation()}>
          <div className="prep-cinema-head">
            <span className="prep-cinema-title">🎟 今夜のチケット</span>
            <button className="prep-cinema-close" onClick={closePrepLaunch} aria-label="閉じる">
              ✕
            </button>
          </div>

          <div className="prep-cinema-body">
            <div className="prep-cinema-earned">✓ 今夜の半券を手に入れた</div>

            <div
              className={`pf-ticket-card${flipped ? ' is-flipped' : ''}`}
              onClick={() => setFlipped((f) => !f)}
            >
              <div className="pf-ticket-inner">
                {/* 表＝プレミアパス。位置%(top/left)はテンプレ画像に合わせて要微調整(TUNE)。 */}
                <div className="pf-face pf-front">
                  <div className="pf-ov pf-ov-title" style={{ top: '45%', left: '42%' }}>
                    {enTitle}
                  </div>
                  {seLabel && (
                    <div className="pf-ov pf-ov-se" style={{ top: '57%', left: '42%' }}>
                      {seLabel}
                    </div>
                  )}
                  <div className="pf-ov pf-ov-result" style={{ top: '63%', left: '42%' }}>
                    TEST CLEARED
                  </div>
                  <div className="pf-ov pf-ov-seat" style={{ top: '49%', left: '84.5%' }}>
                    {seat}
                  </div>
                  <div className="pf-ov pf-ov-date" style={{ top: '63%', left: '84.5%' }}>
                    {dateLabel}
                  </div>
                </div>

                {/* 裏＝今夜の聞きどころ */}
                <div className="pf-face pf-back">
                  <div className="pf-back-head">今夜、この3つを聞きに行こう</div>
                  <div className="pf-back-lines">
                    {lines.map((l) => (
                      <div className="pf-back-line" key={l.word}>
                        “
                        {l.cloze.blank ? (
                          <>
                            {l.cloze.before}
                            <span className="pf-back-hl">{l.cloze.blank}</span>
                            {l.cloze.after}
                          </>
                        ) : (
                          l.example
                        )}
                        ”
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="pf-hint">タップで裏 ・ 今夜の聞きどころ</div>
          </div>

          {foot}
        </div>
      </div>
    );
  }

  // ── cards / watch = 暖色シネマページ ──
  const tomorrow =
    p.variant === 'cards' ? (
      <div className="prep-cinema-tomorrow">うろ覚えの語は、明日また戻ってきます。</div>
    ) : null;
  const headTitle = p.variant === 'watch' ? '🍿 今夜の上映' : '🎟 今夜の予習';

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
