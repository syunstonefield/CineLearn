'use client';

import { useState } from 'react';
import { statusBadge, nextReviewLabel } from '@/lib/storage';

// 1単語カード。モバイルは折りたたみ（語＋和訳＋状態ドット＋📍時刻のみ）→タップで詳細展開。
// PCでは常時展開（display制御は style.css のメディアクエリ）。
// 詳細は常にDOMに描画し、開閉は is-expanded クラスで切り替える（PC常時表示を両立するため）。
export default function VocabItem({ word, srs, testTiers, ts, exampleSource, onSpeak, onSkip, onCopyTime }) {
  const [expanded, setExpanded] = useState(false);
  const w = word;
  const e = srs[w.word.toLowerCase()];
  const status = (() => {
    if (!e) return 'new';
    if (e.skipped) return 'skipped';
    if (e.repetitions >= 3 && e.interval >= 21 && e.easeFactor >= 2.0) return 'mastered';
    if (e.repetitions >= 2) return 'learned';
    return 'learning';
  })();
  const isMast = status === 'mastered';
  const isLrn = status === 'learned';
  const isSkip = status === 'skipped';

  const reviewCount = e?.reviewCount || 0;
  const hasReviewed = !!e?.lastReview;
  const reviewCountLabel =
    reviewCount > 0 ? `${reviewCount}回復習済み` : hasReviewed ? '復習済み' : '';

  const badge = statusBadge(status === 'learning' ? 'due' : status);
  const tier = w.tier || 'core';
  const tierCls = tier === 'context' ? 'tier-context' : tier === 'advanced' ? 'tier-advanced' : 'tier-core';
  const tierText = tier === 'context' ? 'Context' : tier === 'advanced' ? 'Advanced' : 'Core';
  const notInTest = !testTiers.includes(tier);
  const next = nextReviewLabel(w.word, srs);
  const tsLabel = ts?.label;

  // 状態ドットの色（new はくり抜き・border のみ）
  const dotColor = isMast ? '#f5c518' : isLrn ? 'var(--green)' : isSkip ? 'var(--text-muted)' : status === 'learning' ? 'var(--accent)' : '';

  const cls =
    'vocab-item' +
    (expanded ? ' is-expanded' : '') +
    (isMast ? ' vocab-mastered' : '') +
    (isLrn ? ' vocab-learned' : '') +
    (isSkip ? ' vocab-skipped' : '') +
    (notInTest ? ' vocab-no-test' : '');

  return (
    <div className={cls}>
      <button
        type="button"
        className="vocab-row"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="vocab-dot" style={dotColor ? { background: dotColor, borderColor: dotColor } : undefined} aria-hidden="true" />
        <span className="vocab-word">{w.word}</span>
        <span className="vocab-meaning">{w.definition || ''}</span>
        {tsLabel && (
          <span
            className="word-timestamp"
            title="タップしてコピー"
            onClick={(ev) => {
              ev.stopPropagation();
              onCopyTime(tsLabel);
            }}
          >
            📍 {tsLabel}
          </span>
        )}
        <span className="vocab-chevron" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      <div className="vocab-detail">
        <div className="vocab-detail-tags">
          {badge && <span className={`srs-badge ${badge.cls}`}>{badge.text}</span>}
          <span className={`tier-pill ${tierCls}`}>{tierText}</span>
          {w.pos && <span className="vocab-pos">{w.pos}</span>}
          {next && <span className="srs-next-review">📅 次回: {next}</span>}
          {reviewCountLabel && <span className="review-count-label">{reviewCountLabel}</span>}
        </div>

        {w.example && (
          <div className="word-example-wrap">
            {/* 出所がある＝字幕の逐語引用なので "…" で明瞭区分（著作権法32条） */}
            <span className="word-example-en">{exampleSource ? `“${w.example}”` : w.example}</span>
            {w.example_ja && <span className="word-example-ja">{w.example_ja}</span>}
            {/* 出所明示（著作権法48条）：例文を引いた作品・話・字幕元 */}
            {exampleSource && <span className="word-example-source">{exampleSource}</span>}
          </div>
        )}

        <div className="vocab-detail-actions">
          <button className="btn-speak" title="発音を聞く" onClick={() => onSpeak(w.word)}>
            🔊 発音
          </button>
          <button
            className={'btn-srs-skip' + (isSkip ? ' btn-srs-resume' : '')}
            onClick={() => onSkip(w.word, isSkip)}
          >
            {isSkip ? 'Resume' : 'Skip'}
          </button>
        </div>
      </div>
    </div>
  );
}
