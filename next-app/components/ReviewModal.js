'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { speak } from '@/lib/speak';
import { chunkParts } from '@/lib/chunk';
import {
  loadSrs,
  isDue,
  isLearned,
  isMastered,
  reviewWord,
  restoreSrsEntry,
  recordReviewSession,
  getTodaySessions,
  subtitleCredit,
} from '@/lib/storage';
import { addExp, levelInfo, expForReviewSession } from '@/lib/exp';

const KEYS_SEEN_KEY = 'cl_review_keys_seen';

// 操作ヘルプ（初回に一度だけ自動表示・以後は右上の「?」）。
// 使い方ガイド（WelcomeTutorial）と同じスライド型モーダルにする（オーナー要望 2026-09-29）。
// PC＝キーボード、スマホ＝タップ/スワイプを各スライドに併記。Enter/Space/→ で次へ・← で戻る・Esc で閉じる。
const KEY_ICON = {
  width: 40, height: 40, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};
// 各スライドは「スマホ → PC」の順で並べる（オーナー要望 2026-09-29）。
//   row = { dev:'📱'|'💻', keys:[...]（PC）| gesture:'…'（スマホ）, label }
const KEYS_SLIDES = [
  {
    icon: (
      <svg {...KEY_ICON}>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <line x1="7" y1="14.5" x2="17" y2="14.5" />
        <circle cx="7" cy="10" r="0.6" fill="currentColor" /><circle cx="10.3" cy="10" r="0.6" fill="currentColor" />
        <circle cx="13.7" cy="10" r="0.6" fill="currentColor" /><circle cx="17" cy="10" r="0.6" fill="currentColor" />
      </svg>
    ),
    title: '意味を確認する',
    desc: '意味を開くまでは採点できません（見ずに答えないため）。PCは右手だけで Shift → 矢印 と回せます。',
    rows: [
      { dev: '📱', gesture: 'カードをタップ', label: '意味を確認' },
      { dev: '💻', keys: ['Shift', 'Space', 'Enter'], label: '意味を確認' },
    ],
  },
  {
    icon: (
      <svg {...KEY_ICON}>
        <line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /><polyline points="10 6 4 12 10 18" />
      </svg>
    ),
    title: '採点する',
    desc: '右＝知ってた、左＝知らなかった。スワイプも矢印キーも同じ向きです。',
    rows: [
      { dev: '📱', gesture: '右にスワイプ', label: '知ってた' },
      { dev: '📱', gesture: '左にスワイプ', label: '知らなかった' },
      { dev: '📱', gesture: 'ボタンをタップ', label: 'うろ覚え' },
      { dev: '💻', keys: ['→', '3'], label: '知ってた' },
      { dev: '💻', keys: ['↓', '2'], label: 'うろ覚え' },
      { dev: '💻', keys: ['←', '1'], label: '知らなかった' },
    ],
  },
  {
    icon: (
      <svg {...KEY_ICON}>
        <polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" />
      </svg>
    ),
    title: '押し間違えたら戻る',
    desc: '前のカードに戻って、採点を取り消してやり直せます。',
    rows: [
      { dev: '📱', gesture: '左上の「↩ 前のカードに戻る」', label: '1枚戻る' },
      { dev: '💻', keys: ['↑', 'Backspace'], label: '1枚戻る' },
    ],
  },
  {
    icon: (
      <svg {...KEY_ICON}>
        <circle cx="12" cy="12" r="9.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8v.5" /><circle cx="12" cy="17" r="0.7" fill="currentColor" />
      </svg>
    ),
    title: 'いつでも見返せます',
    desc: 'この操作ガイドは復習画面の右上「?」からいつでも開けます。',
  },
];

function Kbd({ k }) {
  return <kbd className="review-kbd">{k}</kbd>;
}

function KeysHelp({ onClose }) {
  const [step, setStep] = useState(0);
  const isFirst = step === 0;
  const isLast = step === KEYS_SLIDES.length - 1;
  const slide = KEYS_SLIDES[step];
  const next = () => (isLast ? onClose() : setStep((s) => s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  // ガイド表示中はこちらがキーを受ける（ReviewModal 側は showKeys 中は何もしない）。
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (k === 'Enter' || k === ' ' || k === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (k === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const renderKeys = (ks) =>
    ks.map((k, i) => (
      <span key={k}>
        {i > 0 && <span className="review-kbd-or">/</span>}
        <Kbd k={k} />
      </span>
    ));

  return (
    <div className="modal-overlay tutorial-overlay">
      <div className="modal-panel tutorial-panel" role="dialog" aria-modal="true" aria-label="復習の操作ガイド">
        <button className="modal-close tutorial-skip-x" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
        <div className="tutorial-body">
          <div className="onboarding-steps">
            {KEYS_SLIDES.map((_, i) => (
              <div key={i} className={'onboarding-step' + (i === step ? ' active' : '')} />
            ))}
          </div>
          <div className="tutorial-slide" key={step}>
            <div className="tutorial-badge">{slide.icon}</div>
            <h2 className="onboarding-title">{slide.title}</h2>
            <p className="tutorial-desc">{slide.desc}</p>
            {slide.rows && (
              <table className="review-keys-table">
                <tbody>
                  {slide.rows.map((r, i) => (
                    <tr key={i} className={r.dev === '💻' ? 'is-pc' : 'is-mobile'}>
                      <td className="review-keys-dev" aria-label={r.dev === '💻' ? 'PC' : 'スマホ'}>{r.dev}</td>
                      <td>{r.keys ? renderKeys(r.keys) : <span className="review-keys-gesture">{r.gesture}</span>}</td>
                      <td>{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="tutorial-footer">
          <button className="btn-primary" style={{ width: '100%' }} onClick={next}>
            {isLast ? '閉じる' : '次へ →'}
          </button>
          <div className="tutorial-subnav">
            {!isFirst && (
              <button className="btn-text-link" onClick={prev}>
                ← 戻る
              </button>
            )}
            {!isLast && (
              <button className="btn-text-link" onClick={onClose}>
                スキップ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 既存 startReview / renderReviewCard（SRSフラッシュカード）の再現。
export default function ReviewModal({ asPage = false }) {
  const { reviewWords, reviewAll, closeReview, currentHistoryId } = useApp();

  // 初期キュー：未学習 or 期日到来のみ・シャッフル（reviewWords が変わるたびに作り直す）
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [ratings, setRatings] = useState({}); // word -> quality
  const [promo, setPromo] = useState({ learned: [], mastered: [] });
  const [sessionInfo, setSessionInfo] = useState(null); // 完了時に記録
  // 再挑戦パス（😰知らなかったをもう一度）：採点しない＝「次へ」だけ（2026-09-21 オーナー提案）。
  //   同日2回目の成功は reviewWord が練習扱いにするので日程には元々効かなかったが、
  //   lastQuality/reviewCount の上書きと昇格ボーナスEXPの二重計上が残っていた。採点自体をやめて根絶。
  const [retryMode, setRetryMode] = useState(false);
  // 採点の取り消し用スナップショット（押し間違い救済）。1枚採点するごとに積む。
  const [undoStack, setUndoStack] = useState([]);
  // 操作ヘルプ（キー／スワイプ）。初めて復習を開いた時に一度だけ自動表示し、以後は右上の「?」から
  // （オーナー要望 2026-09-29）。既読は端末ローカル（cl_review_keys_seen）。
  const [showKeys, setShowKeys] = useState(false);
  useEffect(() => {
    if (!reviewWords) return;
    try {
      if (localStorage.getItem(KEYS_SEEN_KEY) === '1') return;
      localStorage.setItem(KEYS_SEEN_KEY, '1');
    } catch {
      return;
    }
    setShowKeys(true);
  }, [reviewWords]);
  const initKey = useMemo(() => (reviewWords ? reviewWords.map((w) => w.word).join('|') : ''), [reviewWords]);
  const [builtKey, setBuiltKey] = useState(null);

  // reviewWords がセットされたらキューを構築（レンダー中の同期初期化）
  if (reviewWords && builtKey !== initKey) {
    const srs = loadSrs();
    const q = reviewWords
      .filter((w) => {
        // reviewAll（半券のシーン記憶カード）は期日に関係なく全語を出す＝場面を必ず振り返れる。
        if (reviewAll) return true;
        const e = srs[w.word.toLowerCase()];
        return !e || isDue(e);
      })
      .sort(() => Math.random() - 0.5);
    setQueue(q);
    setIdx(0);
    setFlipped(false);
    setRatings({});
    setPromo({ learned: [], mastered: [] });
    setSessionInfo(null);
    setRetryMode(false);
    setUndoStack([]);
    setBuiltKey(initKey);
  }

  if (!reviewWords) return null;

  const overlayClick = (e) => {
    if (e.target === e.currentTarget) closeReview();
  };

  const rate = (q) => {
    const w = queue[idx];
    // 再挑戦パスは見直すだけ＝SRS・採点・昇格に触れず次のカードへ
    if (retryMode) {
      setUndoStack((st) => [...st, { word: w.word }]);
      setFlipped(false);
      setIdx((i) => i + 1);
      return;
    }
    const srs = loadSrs();
    const before = srs[w.word.toLowerCase()];
    const wasLearned = isLearned(before);
    const wasMastered = isMastered(before);
    // 取り消し用に採点前の状態を保存（SRSエントリは複製・新規語は undefined のまま）
    setUndoStack((st) => [...st, { word: w.word, before: before ? { ...before } : undefined, promo, ratings }]);
    reviewWord(w.word, q);
    const after = loadSrs()[w.word.toLowerCase()];
    const newPromo = { learned: [...promo.learned], mastered: [...promo.mastered] };
    if (!wasLearned && isLearned(after)) newPromo.learned.push(w.word);
    if (!wasMastered && isMastered(after)) newPromo.mastered.push(w.word);
    setPromo(newPromo);
    setRatings((r) => ({ ...r, [w.word]: q }));
    setFlipped(false);
    setIdx((i) => i + 1);
  };

  // 直前の採点を取り消して1枚戻る（意味を開いた状態で戻す＝すぐ採点し直せる）。
  const undo = () => {
    const snap = undoStack[undoStack.length - 1];
    if (!snap || idx === 0) return;
    if (!retryMode) {
      restoreSrsEntry(snap.word, snap.before);
      setPromo(snap.promo);
      setRatings(snap.ratings);
    }
    setUndoStack((st) => st.slice(0, -1));
    setIdx((i) => i - 1);
    setFlipped(true);
  };

  const done = idx >= queue.length;

  // PCのキーボード操作（オーナー要望 2026-09-29・割り当てはスワイプの左右と一致させる）。
  //   Space/Enter/Shift＝意味を確認。開いた後: →知ってた ←知らなかった ↓うろ覚え ↑/Backspace 前に戻る。
  //   1/2/3 も同じ（Anki 経験者向け）。開く前の矢印は無効（見ずに採点させない＝スワイプと同じ）。
  //   再挑戦パス（採点なし）は Space/Enter/→ のどれでも次へ。入力欄にフォーカス中は無効。
  useEffect(() => {
    if (!reviewWords) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      if (showKeys) return; // ガイド表示中は KeysHelp 側が受ける
      if (done) return;
      if (e.repeat) return; // 押しっぱなしで複数枚進まない（特に Shift／矢印）
      const k = e.key;
      // Shift 単押しも「意味を確認」にする＝右手だけで Shift→矢印 と回せる（オーナー要望 2026-10-01）
      const isOpen = k === ' ' || k === 'Enter' || k === 'Shift';
      if (!flipped) {
        if (isOpen) {
          e.preventDefault();
          setFlipped(true);
        } else if (k === 'ArrowUp' || k === 'Backspace') {
          if (idx > 0) {
            e.preventDefault();
            undo();
          }
        }
        return;
      }
      if (retryMode) {
        if (isOpen || k === 'ArrowRight') {
          e.preventDefault();
          rate(null);
        } else if (k === 'ArrowUp' || k === 'Backspace') {
          if (idx > 0) {
            e.preventDefault();
            undo();
          }
        }
        return;
      }
      const map = { ArrowRight: 5, 3: 5, ArrowLeft: 0, 1: 0, ArrowDown: 3, 2: 3 };
      if (k in map) {
        e.preventDefault();
        rate(map[k]);
      } else if (k === 'ArrowUp' || k === 'Backspace') {
        if (idx > 0) {
          e.preventDefault();
          undo();
        }
      } else if (isOpen) {
        e.preventDefault(); // 開いた後の Space/Enter は何もしない（連打で採点が飛ぶ事故を防ぐ）
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewWords, showKeys, done, flipped, retryMode, idx, queue, promo, ratings, undoStack]);
  // 進捗バー：消化済み（idx）/ 全体。完了画面では満タン表示。
  const pct = queue.length ? Math.round(((done ? queue.length : idx) / queue.length) * 100) : 0;

  return (
    <div
      className={asPage ? 'screen active review-screen' : 'modal-overlay review-overlay'}
      id={asPage ? 'screen-review' : undefined}
      style={asPage ? undefined : { display: 'flex' }}
      onClick={asPage ? undefined : overlayClick}
    >
      <div className={asPage ? 'review-panel' : 'modal-panel review-modal-panel'}>
        <div className="modal-header">
          <span className="modal-title">🃏 復習</span>
          <span className="review-head-btns">
            <button
              type="button"
              className="modal-close review-keys-btn"
              onClick={() => setShowKeys((v) => !v)}
              aria-label="操作方法"
              title="操作方法（キーボード／スワイプ）"
            >
              ?
            </button>
            <button className="modal-close" onClick={closeReview}>
            ✕
          </button>
          </span>
        </div>
        {showKeys && <KeysHelp onClose={() => setShowKeys(false)} />}
        {!done && (
          <div className="review-progress" aria-hidden="true">
            <span className="review-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="review-content">
          {done ? (
            <ReviewDone
              queue={queue}
              ratings={ratings}
              promo={promo}
              currentHistoryId={currentHistoryId}
              sessionInfo={sessionInfo}
              setSessionInfo={setSessionInfo}
              retryMode={retryMode}
              onRetryFailed={(failed) => {
                setQueue(failed);
                setIdx(0);
                setFlipped(false);
                setRatings({});
                setPromo({ learned: [], mastered: [] }); // 1周目の昇格を完了画面で再表示・再加算しない
                setUndoStack([]);
                setRetryMode(true);
              }}
              onDone={closeReview}
            />
          ) : (
            <ReviewCard
              word={queue[idx]}
              idx={idx}
              total={queue.length}
              flipped={flipped}
              retryMode={retryMode}
              onFlip={() => setFlipped(true)}
              onRate={rate}
              onUndo={idx > 0 ? undo : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ word: w, idx, total, flipped, retryMode, onFlip, onRate, onUndo }) {
  // スワイプ採点：右=知ってた(5) / 左=知らなかった(0)。
  // うろ覚え(3)は3択ボタンで常時選べる（中間はSM-2の肝なのでジェスチャーに潰さない）。
  // 判定は意味を表示（flipped）してから有効。
  const touch = useRef({ x: 0, y: 0 });
  const onTouchStart = (e) => {
    const t = e.changedTouches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!flipped) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy)) onRate(retryMode ? null : dx > 0 ? 5 : 0);
  };

  return (
    <div className="review-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="review-card-head">
        {/* 押し間違い救済：直前の採点を取り消して戻る（1枚目には無い）。 */}
        {onUndo ? (
          <button type="button" className="review-undo" onClick={onUndo}>
            ↩ 前のカードに戻る
          </button>
        ) : (
          <span />
        )}
        <div className="review-counter">
          {idx + 1} / {total}
        </div>
      </div>
      {/* 本文（単語＋意味＋例文）＝画面中央に配置。採点/確認ボタンは下端(review-card-actions)。
          カード本文のタップでも意味を表示できる（片手操作・2026-07-03 実使用フィードバック#1。
          🔊等のボタンは除外。スワイプは移動量で click が抑止されるため干渉しない）。 */}
      <div
        className="review-card-body"
        onClick={(e) => {
          if (flipped || e.target.closest('button')) return;
          onFlip();
        }}
      >
        {/* #19: チャンクがあれば「look forward to」のような連語で表示（対象語を強調）。
            単語単体より実際の使われ方の塊で覚える方が応用が効く。無い語は従来どおり単語のみ。 */}
        {(() => {
          const cp = chunkParts(w.chunk, w.word);
          const label = cp ? w.chunk : w.word;
          return (
            // チャンク表示: 対象語はフルサイズ・accent のまま、周辺語だけ小さく淡く
            // （カード全体を縮めると単語が小さく感じる・実機フィードバック 2026-07-16）
            <div className="review-word-big" style={cp ? { lineHeight: 1.25 } : undefined}>
              {cp && cp.hit ? (
                <>
                  <span style={{ fontSize: '0.5em', color: 'var(--text-muted)', fontWeight: 600 }}>{cp.before}</span>
                  {cp.hit}
                  <span style={{ fontSize: '0.5em', color: 'var(--text-muted)', fontWeight: 600 }}>{cp.after}</span>
                </>
              ) : (
                w.word
              )}
              <button
                type="button"
                className="review-speak"
                aria-label="発音を聞く"
                onClick={(ev) => {
                  ev.stopPropagation();
                  speak(label);
                }}
              >
                🔊
              </button>
            </div>
          );
        })()}
        {w.pos && <div className="review-pos-tag">{w.pos}</div>}
        {flipped && (
          <div className="review-answer" style={{ display: 'block' }}>
            <div className="review-def-text">{w.definition || ''}</div>
            {w.example && (
              <div className="review-example-text">
                <div>
                  &quot;{w.example}&quot;
                  <button
                    type="button"
                    className="review-speak review-speak-sm"
                    aria-label="例文を聞く"
                    onClick={() => speak(w.example)}
                  >
                    🔊
                  </button>
                </div>
                {w.example_ja && <div className="review-example-ja">{w.example_ja}</div>}
                {/* 出所明示（著作権法48条）：例文を引いた作品・話・字幕元 */}
                {subtitleCredit(w) && <div className="review-example-source">{subtitleCredit(w)}</div>}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="review-card-actions">
        {!flipped ? (
          <>
            <button className="review-flip" onClick={onFlip}>
              タップして意味を確認 →
            </button>
            <div className="review-key-hint" aria-hidden="true">
              <kbd>Shift</kbd> / <kbd>Space</kbd> で意味を確認
            </div>
          </>
        ) : retryMode ? (
          // 再挑戦パス：採点ボタンを出さず「次へ」だけ
          <>
            <button className="review-flip review-next" onClick={() => onRate(null)}>
              次へ →
            </button>
            <div className="review-key-hint" aria-hidden="true">
              <kbd>Shift</kbd> / <kbd>Space</kbd> / <kbd>→</kbd> 次へ　<kbd>↑</kbd> 戻る
            </div>
          </>
        ) : (
          <>
            <div className="review-rate-btns">
              <button className="btn-rate btn-rate-fail" onClick={() => onRate(0)}>
                <span className="btn-rate-emoji">😟</span>
                <span className="btn-rate-label">知らなかった</span>
                <span className="btn-rate-sub">覚え直す</span>
              </button>
              <button className="btn-rate btn-rate-hard" onClick={() => onRate(3)}>
                <span className="btn-rate-emoji">🙂</span>
                <span className="btn-rate-label">うろ覚え</span>
                <span className="btn-rate-sub">あとで復習</span>
              </button>
              <button className="btn-rate btn-rate-easy" onClick={() => onRate(5)}>
                <span className="btn-rate-emoji">🔥</span>
                <span className="btn-rate-label">知ってた！</span>
                <span className="btn-rate-sub">次へ進む</span>
              </button>
            </div>
            <div className="review-swipe-hint" aria-hidden="true">
              ← 知らなかった　｜　知ってた →
            </div>
            <div className="review-key-hint" aria-hidden="true">
              <kbd>←</kbd> 知らなかった　<kbd>↓</kbd> うろ覚え　<kbd>→</kbd> 知ってた　<kbd>↑</kbd> 戻る
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewDone({ queue, ratings, promo, currentHistoryId, sessionInfo, setSessionInfo, retryMode, onRetryFailed, onDone }) {
  const failed = queue.filter((w) => ratings[w.word] === 0);
  const hard = queue.filter((w) => ratings[w.word] === 3);
  const easy = queue.filter((w) => (ratings[w.word] ?? 5) === 5);

  // EXP: カード数×2＋昇格ボーナス。加算後の総EXPからレベルを出す（表示専用の状態）。
  const [expGain, setExpGain] = useState(null); // { earned, level } 記録後にセット

  // セッションを1回だけ記録（副作用なので effect 内で・StrictMode 二重実行は ref で防ぐ）
  const recordedRef = useRef(false);
  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    // 再挑戦パスは採点していないので復習セッション（今日N回目・内訳）には数えない。
    // EXPはカード×2だけ付ける（見直しの手間への報酬・昇格ボーナスは1周目で付与済み）。
    if (retryMode) {
      const earned = expForReviewSession({ cards: queue.length });
      setExpGain({ earned, level: levelInfo(addExp(earned)) });
      return;
    }
    const num = recordReviewSession(currentHistoryId, easy.length, hard.length, failed.length);
    setSessionInfo({ num, sessions: getTodaySessions(currentHistoryId) });
    const earned = expForReviewSession({
      cards: queue.length,
      learned: promo.learned.length,
      mastered: promo.mastered.length,
    });
    setExpGain({ earned, level: levelInfo(addExp(earned)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionNum = sessionInfo?.num ?? 1;
  const sessions = sessionInfo?.sessions ?? [];

  const allPerfect = failed.length === 0 && hard.length === 0;
  const gotMaster = promo.mastered.length > 0;
  const gotLearned = promo.learned.length > 0;
  const heroEmoji = gotMaster ? '⭐' : gotLearned || !allPerfect ? '🎉' : '🌟';

  const group = (words, icon, label, cls) =>
    words.length > 0 && (
      <div className="review-summary-group">
        <div className={`review-summary-label ${cls}`}>
          {icon} {label}（{words.length}単語）
        </div>
        {words.map((w) => (
          <div className="review-summary-item" key={w.word}>
            <span className="review-summary-word">{w.word}</span>
            <span className="review-summary-def">{w.definition || ''}</span>
          </div>
        ))}
      </div>
    );

  if (retryMode) {
    return (
      <div className="review-done">
        <div className="review-hero-emoji" style={{ fontSize: 48, marginBottom: 8 }}>
          👀
        </div>
        <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>見直し完了！</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
          知らなかった {queue.length}単語をもう一度確認しました
        </div>
        {expGain && <ExpBlock earned={expGain.earned} lv={expGain.level} />}
        <div style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 14px' }}>
          次の復習日は変わりません（明日また出ます）
        </div>
        <button className="btn-primary" style={{ maxWidth: '100%', width: '100%' }} onClick={onDone}>
          復習を終える
        </button>
      </div>
    );
  }

  return (
    <div className={'review-done' + (gotMaster ? ' review-done-gold' : '')}>
      <div className="review-hero-emoji" style={{ fontSize: 48, marginBottom: 8 }}>
        {heroEmoji}
      </div>
      <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>復習完了！（今日{sessionNum}回目）</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
        {queue.length}単語を復習しました
      </div>
      {expGain && <ExpBlock earned={expGain.earned} lv={expGain.level} />}
      {(gotLearned || gotMaster) && (
        <div className="review-promotions">
          {gotLearned && <div className="review-promo learned">✅ {promo.learned.length}単語が「覚えた」に昇格！</div>}
          {gotMaster && <div className="review-promo mastered">⭐ {promo.mastered.length}単語がマスターに到達！</div>}
        </div>
      )}
      <div className="review-session-badges" style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
        <span className="badge-easy">✅ 知ってた {easy.length}</span>
        <span className="badge-hard">🤔 うろ覚え {hard.length}</span>
        <span className="badge-fail">😰 知らなかった {failed.length}</span>
      </div>
      {sessions.length > 1 && (
        <details className="review-history-details" style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            今日の復習履歴（{sessions.length}回）
          </summary>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left' }}>回数</th>
                <th style={{ padding: '4px 8px' }}>知ってた</th>
                <th style={{ padding: '4px 8px' }}>うろ覚え</th>
                <th style={{ padding: '4px 8px' }}>知らなかった</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.sessionNum}>
                  <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{s.sessionNum}回目</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>✅ {s.easy}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>🤔 {s.hard}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>😰 {s.fail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {allPerfect ? (
        <div className="review-all-perfect">全問正解！すばらしい 🎊</div>
      ) : (
        <div className="review-summary">
          {group(failed, '😰', '知らなかった', 'label-fail')}
          {group(hard, '🤔', 'うろ覚え', 'label-hard')}
          {group(easy, '✅', '完璧！', 'label-easy')}
        </div>
      )}
      {failed.length > 0 && (
        <button className="btn-secondary" style={{ marginBottom: 8, width: '100%' }} onClick={() => onRetryFailed(failed)}>
          😰 知らなかった {failed.length}単語をもう一度
        </button>
      )}
      <button className="btn-primary" style={{ maxWidth: '100%', width: '100%' }} onClick={onDone}>
        {/* 戻り先は入口によって変わる（単語リスト/ホーム/復習ハブ）ので行き先を名指ししない */}
        復習を終える
      </button>
    </div>
  );
}

// ── EXP獲得の表示（復習完了画面の主役）─────────────────────────
// 獲得ぶんのカウントアップ＋レベルバー。加算そのものは ReviewDone の記録effectで済んでいて、
// ここは渡された結果を見せるだけ（描画をアンマウントしても二重加算しない）。
function ExpBlock({ earned, lv }) {
  // 0→earned のカウントアップ。止まる瞬間の気持ちよさ優先で ease-out。
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (earned <= 0) return;
    // 動きを減らす設定・非表示タブでは rAF が回らず 0 で固まるため即最終値。
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.hidden) {
      setShown(earned);
      return;
    }
    const dur = 800;
    let raf = 0;
    let start = null;
    const tick = (t) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / dur);
      setShown(Math.round(earned * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // 途中でタブが隠れて rAF が止まっても最終値だけは必ず出す保険
    const snap = setTimeout(() => setShown(earned), dur + 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(snap);
    };
  }, [earned]);

  return (
    <div className="exp-block">
      <div className="exp-gain">
        <span className="exp-gain-num">+{shown}</span>
        <span className="exp-gain-unit">EXP</span>
      </div>
      <div className="exp-level">
        <div className="exp-level-head">
          <span className="exp-level-name">Lv {lv.level}</span>
          <span className="exp-level-total">通算 {lv.total.toLocaleString()} EXP</span>
        </div>
        <div className="exp-level-bar">
          <span className="exp-level-fill" style={{ width: `${Math.round(lv.progress * 100)}%` }} />
        </div>
        {lv.next != null && <div className="exp-level-next">Lv {lv.level + 1} まで あと {lv.toNext.toLocaleString()}</div>}
      </div>
    </div>
  );
}
