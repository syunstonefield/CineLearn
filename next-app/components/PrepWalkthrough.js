'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { buildCloze, selectQuizWords, nextSeat, getPrepped, markPrepped } from '@/lib/prep';
import { chunkParts } from '@/lib/chunk';

// 予習（＝生成直後）専用の「1枚ずつめくって見る」ウォークスルー。
// 長い一覧スクロールの代わりに、全語を1枚ずつ通し見してもらう（＝一通り見る を“形式”で担保）。
// ★ここは予習だけ。予習後に単語リストへ戻ったら従来のスクロール一覧のまま（VocabScreen は変更しない）。
// 観るのは常に自由・チケットは特典（ゲートにしない）。✕/「あとで予習する」でいつでも離脱できる。
//
// 体験磨き：
//   - 賢いデッキ：重要語（新出・高レベル）を先頭に並べ、まず CORE 枚を見せて残りは任意（「残りも見る」）。
//   - 途中再開：閉じた位置を端末に保存し、再入場で続きから。
//   - スワイプ／矢印キー／終盤の「あと◯枚」momentum。
// 整合性：完了で半券（プレミアパス）発行。席番号は初回のみ採番（再予習で増えない）＝markPrepped で固定。
const CORE = 15; // まず見せる「重要語」枚数。これを超える分は任意で「残りも見る」。

function speak(word) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  }
}

const posKeyOf = (epId) => (epId ? `cl_prep_pos_${epId}` : '');
function loadPos(key) {
  if (!key) return 0;
  try {
    return parseInt(localStorage.getItem(key) || '0', 10) || 0;
  } catch {
    return 0;
  }
}
function savePos(key, n) {
  if (!key) return;
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* ignore */
  }
}
function clearPos(key) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export default function PrepWalkthrough() {
  const { prepWalk, closePrepWalk, openPrepLaunch } = useApp();
  const words = useMemo(() => prepWalk?.words || [], [prepWalk]);
  const meta = prepWalk?.meta || null;
  const epId = meta?.epId || '';
  const posKey = posKeyOf(epId);
  const total = words.length;
  const coreCount = Math.min(CORE, total);
  const canStop = total > coreCount; // CORE を超える時だけ「ここで完了／残りも見る」の分岐を出す

  // 途中再開：保存位置から開始。保存位置がコアを超えていれば最初から全語表示にする。
  const [extended, setExtended] = useState(() => loadPos(posKey) >= coreCount && canStop);
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, loadPos(posKey)), Math.max(0, total - 1)));

  const effectiveTotal = extended ? total : coreCount;
  const last = idx >= effectiveTotal - 1;
  const atCoreEnd = canStop && !extended && idx === coreCount - 1; // 重要語を見終えたチェックポイント
  const remaining = effectiveTotal - (idx + 1);

  const go = (n) => {
    const clamped = Math.min(Math.max(0, n), Math.max(0, total - 1));
    setIdx(clamped);
    savePos(posKey, clamped);
  };

  // 予習完了＝報酬（プレミアパス／半券）。視聴は常に自由・チケットは“特典”。
  // 席番号は初回のみ採番（markPrepped が保持）＝リロード/再予習で増えない＝整合性。
  const finish = () => {
    const existing = getPrepped(epId);
    const seat = existing?.seat || nextSeat();
    markPrepped(epId, seat);
    clearPos(posKey); // 次回は最初から
    closePrepWalk();
    const quizWords = selectQuizWords(words, 3, loadSrs()); // 0語でも完了は成立（半券は出る）。マスター済みは出題しない(#7b)
    openPrepLaunch({
      variant: 'quiz',
      seat,
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
    if (atCoreEnd || last) finish();
    else go(idx + 1);
  };
  const prev = () => go(idx - 1);
  const seeRest = () => {
    setExtended(true);
    go(idx + 1);
  };

  // 矢印キー／スペースで送り・戻し、Escで離脱（refで常に最新ハンドラを参照＝リスナーは1本）。
  const nextRef = useRef(next);
  const prevRef = useRef(prev);
  nextRef.current = next;
  prevRef.current = prev;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        nextRef.current();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevRef.current();
      } else if (e.key === 'Escape') {
        closePrepWalk();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePrepWalk]);

  // スワイプ：左＝次へ / 右＝戻る（縦移動が大きい時は無視＝スクロールを潰さない）。
  const touch = useRef({ x: 0, y: 0 });
  const onTouchStart = (e) => {
    const t = e.changedTouches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
  };

  if (!prepWalk || !total) return null;

  const w = words[Math.min(idx, total - 1)];
  // 例文中の対象語はハイライト（空欄化ではなく強調＝“見る”ため）。
  const cz = w.example ? buildCloze(w.example, w.word) : null;
  // 出所明示（著作権法48条）：字幕由来（drama/ext）の例文にのみ出典を出す。plus（字幕外の作例）には付けない。
  const showCredit = w.source !== 'plus' && !!w.example && !!meta?.credit;
  const pct = Math.round(((idx + 1) / effectiveTotal) * 100);

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

        <div className="pw-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="pw-counter">
            {idx + 1} / {effectiveTotal}
            {remaining > 0 && remaining <= 5 && !atCoreEnd && (
              <span className="pw-momentum">あと{remaining}枚！</span>
            )}
          </div>
          {!extended && canStop && (
            <div className="pw-note">重要語から表示中 ・ 全{total}語</div>
          )}
          {/* key で語が変わるたびカードを再生成＝めくり感（reduced-motion では無効化） */}
          <div className="pw-card" key={w.word}>
            {/* #19: チャンクがあれば連語で表示（対象語を強調）・🔊もチャンクを読む */}
            {(() => {
              const cp = chunkParts(w.chunk, w.word);
              const label = cp ? w.chunk : w.word;
              return (
                <div className="pw-card-top">
                  {/* 対象語はフルサイズ維持・周辺語（チャンクの残り）は小さく淡く（実機フィードバック:
                      カード全体を縮めると単語が小さく感じる） */}
                  <span className="pw-word" style={cp ? { lineHeight: 1.25 } : undefined}>
                    {cp && cp.hit ? (
                      <>
                        <span style={{ fontSize: '0.55em', color: 'var(--text-muted)', fontWeight: 600 }}>{cp.before}</span>
                        <span style={{ color: 'var(--accent)', fontWeight: 800 }}>{cp.hit}</span>
                        <span style={{ fontSize: '0.55em', color: 'var(--text-muted)', fontWeight: 600 }}>{cp.after}</span>
                      </>
                    ) : (
                      w.word
                    )}
                  </span>
                  <button className="pw-speak" onClick={() => speak(label)} aria-label="発音を聞く">
                    🔊
                  </button>
                </div>
              );
            })()}
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
              {atCoreEnd || last ? '予習完了 🎟' : '次へ →'}
            </button>
          </div>
          {atCoreEnd ? (
            <button className="pw-more" onClick={seeRest}>
              残り{total - coreCount}語も見る →
            </button>
          ) : (
            <button className="pw-skip" onClick={closePrepWalk}>
              あとで予習する（一覧で見る）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
