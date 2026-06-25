'use client';

import { useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { buildCloze, selectQuizWords, nextSeat } from '@/lib/prep';

// 予習（＝生成直後）専用の「1枚ずつめくって見る」ウォークスルー。
// 長い一覧スクロールの代わりに、全語を1枚ずつ通し見してもらう（＝一通り見る を“形式”で担保）。
// ★ここは予習だけ。予習後に単語リストへ戻ったら従来のスクロール一覧のまま（VocabScreen は変更しない）。
// 観るのは常に自由・チケットは特典（ゲートにしない）。最後まで見たら予習完了＝プレミアパス（半券）を発行。
// ✕ / 「あとで予習する」でいつでも離脱できる（強制しない＝法務レッドライン回避）。
function speak(word) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  }
}

export default function PrepWalkthrough() {
  const { prepWalk, closePrepWalk, openPrepLaunch } = useApp();
  const words = useMemo(() => prepWalk?.words || [], [prepWalk]);
  const meta = prepWalk?.meta || null;
  const [idx, setIdx] = useState(0);

  if (!prepWalk || !words.length) return null;

  const total = words.length;
  const w = words[Math.min(idx, total - 1)];
  const last = idx >= total - 1;
  const pct = Math.round(((idx + 1) / total) * 100);

  // 例文中の対象語はハイライト（空欄化ではなく強調＝“見る”ため）。
  const cz = w.example ? buildCloze(w.example, w.word) : null;
  // 出所明示（著作権法48条）：字幕由来（drama/ext）の例文にのみ出典を出す。plus（字幕外の作例）には付けない。
  const showCredit = w.source !== 'plus' && !!w.example && !!meta?.credit;

  const prev = () => setIdx((i) => Math.max(0, i - 1));

  // 予習完了＝報酬（プレミアパス／半券）。視聴は常に自由・チケットは“特典”（ゲートにしない）。
  const finish = () => {
    closePrepWalk();
    const quizWords = selectQuizWords(words, 3); // 0語でも完了は成立（半券は発行・聞きどころが空なだけ）。
    openPrepLaunch({
      variant: 'quiz',
      seat: nextSeat(), // 指定席を1ずつ採番（=観覧通し番号）。ここで一度だけ確定。
      quizWords,
      drama: meta?.drama || null,
      title: meta?.title || '',
      season: meta?.season,
      episode: meta?.episode,
      isMovie: meta?.isMovie,
      service: meta?.service || '',
      integrity: meta?.integrity || null,
      freshCount: meta?.freshCount ?? null,
    });
  };

  const next = () => {
    if (last) finish();
    else setIdx((i) => i + 1);
  };

  return (
    <div className="pw-overlay">
      <div className="pw-panel">
        <div className="pw-head">
          <span className="pw-title">🎬 今夜の予習</span>
          <button className="pw-close" onClick={closePrepWalk} aria-label="閉じる">
            ✕
          </button>
        </div>

        <div className="pw-progress" aria-hidden="true">
          <span className="pw-progress-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="pw-body">
          <div className="pw-counter">
            {idx + 1} / {total}
          </div>
          {/* key で語が変わるたびカードを再生成＝めくり感（reduced-motion では無効化） */}
          <div className="pw-card" key={w.word}>
            <div className="pw-card-top">
              <span className="pw-word">{w.word}</span>
              <button className="pw-speak" onClick={() => speak(w.word)} aria-label="発音を聞く">
                🔊
              </button>
            </div>
            {w.pos && <span className="pw-pos">{w.pos}</span>}
            {w.definition && <div className="pw-def">{w.definition}</div>}
            {w.example && (
              <div className="pw-ex">
                <div className="pw-ex-en">
                  “
                  {cz && cz.blank ? (
                    <>
                      {cz.before}
                      <span className="pw-hl">{cz.blank}</span>
                      {cz.after}
                    </>
                  ) : (
                    w.example
                  )}
                  ”
                </div>
                {w.example_ja && <div className="pw-ex-ja">{w.example_ja}</div>}
                {showCredit && <div className="pw-ex-src">{meta.credit}</div>}
              </div>
            )}
            {w._tsLabel && <div className="pw-ts">📍 {w._tsLabel}</div>}
          </div>
        </div>

        <div className="pw-foot">
          <div className="pw-foot-row">
            <button className="pw-prev" onClick={prev} disabled={idx === 0}>
              ← 戻る
            </button>
            <button className="pw-next" onClick={next}>
              {last ? '予習完了 🎟' : '次へ →'}
            </button>
          </div>
          <button className="pw-skip" onClick={closePrepWalk}>
            あとで予習する（一覧で見る）
          </button>
        </div>
      </div>
    </div>
  );
}
