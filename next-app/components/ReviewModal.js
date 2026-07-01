'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { speak } from '@/lib/speak';
import {
  loadSrs,
  isDue,
  isLearned,
  isMastered,
  reviewWord,
  recordReviewSession,
  getTodaySessions,
  subtitleCredit,
} from '@/lib/storage';

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
    setBuiltKey(initKey);
  }

  if (!reviewWords) return null;

  const overlayClick = (e) => {
    if (e.target === e.currentTarget) closeReview();
  };

  const rate = (q) => {
    const w = queue[idx];
    const srs = loadSrs();
    const before = srs[w.word.toLowerCase()];
    const wasLearned = isLearned(before);
    const wasMastered = isMastered(before);
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

  const done = idx >= queue.length;
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
          <button className="modal-close" onClick={closeReview}>
            ✕
          </button>
        </div>
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
              onRetryFailed={(failed) => {
                setQueue(failed);
                setIdx(0);
                setFlipped(false);
                setRatings({});
              }}
              onDone={closeReview}
            />
          ) : (
            <ReviewCard
              word={queue[idx]}
              idx={idx}
              total={queue.length}
              flipped={flipped}
              onFlip={() => setFlipped(true)}
              onRate={rate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ word: w, idx, total, flipped, onFlip, onRate }) {
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
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy)) onRate(dx > 0 ? 5 : 0);
  };

  return (
    <div className="review-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="review-counter">
        {idx + 1} / {total}
      </div>
      {/* 本文（単語＋意味＋例文）＝画面中央に配置。採点/確認ボタンは下端(review-card-actions)。 */}
      <div className="review-card-body">
        <div className="review-word-big">
          {w.word}
          <button
            type="button"
            className="review-speak"
            aria-label="発音を聞く"
            onClick={(ev) => {
              ev.stopPropagation();
              speak(w.word);
            }}
          >
            🔊
          </button>
        </div>
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
          <button className="review-flip" onClick={onFlip}>
            タップして意味を確認 →
          </button>
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
          </>
        )}
      </div>
    </div>
  );
}

function ReviewDone({ queue, ratings, promo, currentHistoryId, sessionInfo, setSessionInfo, onRetryFailed, onDone }) {
  const failed = queue.filter((w) => ratings[w.word] === 0);
  const hard = queue.filter((w) => ratings[w.word] === 3);
  const easy = queue.filter((w) => (ratings[w.word] ?? 5) === 5);

  // セッションを1回だけ記録（副作用なので effect 内で・StrictMode 二重実行は ref で防ぐ）
  const recordedRef = useRef(false);
  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    const num = recordReviewSession(currentHistoryId, easy.length, hard.length, failed.length);
    setSessionInfo({ num, sessions: getTodaySessions(currentHistoryId) });
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

  return (
    <div className={'review-done' + (gotMaster ? ' review-done-gold' : '')}>
      <div className="review-hero-emoji" style={{ fontSize: 48, marginBottom: 8 }}>
        {heroEmoji}
      </div>
      <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>復習完了！（今日{sessionNum}回目）</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
        {queue.length}単語を復習しました
      </div>
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
        完了して単語リストへ
      </button>
    </div>
  );
}
