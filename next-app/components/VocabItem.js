'use client';

import { statusBadge, nextReviewLabel } from '@/lib/storage';

// 既存 buildWordHTML / buildExtWordHTML の再現（1単語カード）。
// ts = { sec, label } タイムスタンプ, srs = loadSrs() の結果
export default function VocabItem({ word, srs, testTiers, ts, exampleSource, onSpeak, onSkip, onCopyTime }) {
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

  const cls =
    'vocab-item' +
    (isMast ? ' vocab-mastered' : '') +
    (isLrn ? ' vocab-learned' : '') +
    (isSkip ? ' vocab-skipped' : '') +
    (notInTest ? ' vocab-no-test' : '');

  return (
    <div className={cls}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {badge && <span className={`srs-badge ${badge.cls}`}>{badge.text}</span>}
          <div className="vocab-word">{w.word}</div>
          <span className={`tier-pill ${tierCls}`}>{tierText}</span>
          {next && <span className="srs-next-review">📅 次回: {next}</span>}
          {reviewCountLabel && <span className="review-count-label">{reviewCountLabel}</span>}
          {tsLabel && (
            <span
              className="word-timestamp"
              title="タップしてコピー"
              onClick={() => onCopyTime(tsLabel)}
            >
              📍 {tsLabel}
            </span>
          )}
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
      </div>
      <div className="vocab-pos">{w.pos || ''}</div>
      <div className="vocab-def">{w.definition || ''}</div>
      <div className="vocab-card-actions">
        <button className="btn-speak" title="発音を聞く" onClick={() => onSpeak(w.word)}>
          🔊
        </button>
        <button
          className={'btn-srs-skip' + (isSkip ? ' btn-srs-resume' : '')}
          onClick={() => onSkip(w.word, isSkip)}
        >
          {isSkip ? 'Resume' : 'Skip'}
        </button>
      </div>
    </div>
  );
}
