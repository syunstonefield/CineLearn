'use client';
import { IconSpeaker, IconPin, IconPencil, IconFilm } from './icons/LineIcons';
import { surfaceFormInExample } from '@/lib/subtitles';

import { useState } from 'react';
import { statusBadge, nextReviewLabel } from '@/lib/storage';
import { exampleFailLabel, aiExampleOf, isOtherSceneExample } from '@/lib/exampleBackfill';
import { cefrHintOf, cefrHintTitle } from '@/lib/cefrHint';

// 1単語カード。モバイルは折りたたみ（語＋和訳＋状態ドット＋📍時刻のみ）→タップで詳細展開。
// PCでは常時展開（display制御は style.css のメディアクエリ）。
// 詳細は常にDOMに描画し、開閉は is-expanded クラスで切り替える（PC常時表示を両立するため）。
// starred/onStar: ★「覚えたい」（単語帳メンバーシップ・2026-09-22・名前は 2026-11-07 オーナー決定）。onStar(word, starred) を
// 渡した文脈でだけ発音・Skip の横に「★ 覚えたい / ☆ 覚えたい」トグルを出す（単語リスト・単語帳の両方）。
// liked/onLike: ♡ お気に入りの例文の印（2026-11-07・法務 条件付きOK）。字幕由来の例文（出所あり）の下に「♡ この例文を保存」。
//   語に付く印＝語が見出し・例文は従（見た目は今のカードのまま）。文は書き換えない。
// defaultExpanded: 最初から開いておく（スマホの初回体験の1語目・PC は CSS で常に開いている）。
// readOnly: 初回体験の5語（components/TrialFlow.js）。SRS を持たない人に状態の印と Skip を出さない＝書き込む操作なし。
// showCefr: 各語に CEFR の目安（段階だけ）を出すか（単語リストだけ true・2026-10-30）。値は lib/cefrHint.js（複数語は出さない）。
// 出所の文字の頭の 📺（lib/storage.js episodeCredit が付ける）を外す。絵は IconFilm で前に置く。
const stripCreditMark = (s) => String(s || '').replace(/^📺\s*/, '');

export default function VocabItem({ word, srs, testTiers, ts, exampleSource, added, starred, liked, showCefr, readOnly, defaultExpanded, onSpeak, onSkip, onCopyTime, onDelete, onStar, onLike }) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
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
  const cefr = showCefr ? cefrHintOf(w) : null;

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
        {/* 単語そのものの発音（例文の🔊と対）。折りたたみ中も押せる位置に置く＝一覧を眺めながら
            発音できるのが単語帳の主用途（2026-08-07 オーナー報告「単語の音声ボタンが無い」）。
            ★行全体が <button> なので入れ子の <button> は使えない（📍時刻と同じく span で作る）。 */}
        <span
          className="vocab-word-speak"
          role="button"
          tabIndex={0}
          title="発音を聞く"
          aria-label={`${w.word} を発音`}
          onClick={(ev) => {
            ev.stopPropagation();
            onSpeak(w.word);
          }}
          onKeyDown={(ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            ev.stopPropagation();
            onSpeak(w.word);
          }}
        >
          <IconSpeaker />
        </span>
        {/* 本編の語と混ぜて時刻順に並べる時、どれが自分で足した語かを示す（セクション見出しの代わり） */}
        {added && (
          <span className="vocab-added-chip" title="自分で追加した単語">
            <IconPencil /> 追加
          </span>
        )}
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
            <IconPin /> {tsLabel}
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
          {badge && !readOnly && <span className={`srs-badge ${badge.cls}`}>{badge.text}</span>}
          <span className={`tier-pill ${tierCls}`}>{tierText}</span>
          {/* CEFR の目安＝段階だけ（オーナー 2026-10-30「スッキリ」）。Core/Advanced/Context の横に並べる
              （オーナー 2026-10-30・見出し語のそばから移設）。表に無く AI の推定の値は淡く。
              「目安」であることと出典は単語リストの一行（CefrNote）で伝える（法務 条件2） */}
          {cefr && (
            <span className={'vocab-cefr-chip' + (cefr.ai ? ' is-ai' : '')} title={cefrHintTitle(cefr)} aria-label={cefrHintTitle(cefr)}>
              {cefr.level}
            </span>
          )}
          {/* 薄い表示の理由を初見でも分かるように明示（実使用フィードバック#3） */}
          {notInTest && <span className="tier-excluded-note">クイズ対象外（設定で変更可）</span>}
          {w.pos && (
            <span className="vocab-pos">
              {w.pos}
              {(() => {
                const sf = surfaceFormInExample(w.example, w.word);
                return sf ? <span className="pos-surface">例文では {sf}</span> : null;
              })()}
            </span>
          )}
          {next && <span className="srs-next-review">📅 次回: {next}</span>}
          {reviewCountLabel && <span className="review-count-label">{reviewCountLabel}</span>}
        </div>

        {w.example && (
          <div className="word-example-wrap">
            {/* 出所がある＝字幕の逐語引用なので "…" で明瞭区分（著作権法32条） */}
            <span className="word-example-en">
              {exampleSource ? `“${w.example}”` : w.example}
              <button
                type="button"
                className="word-ex-speak"
                aria-label="例文を聞く"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSpeak(w.example);
                }}
              >
                <IconSpeaker />
              </button>
            </span>
            {w.example_ja && <span className="word-example-ja">{w.example_ja}</span>}
            {/* 出所明示（著作権法48条）：例文を引いた作品・話・字幕元 */}
            {/* 出所の行（48条）: 文字はそのまま・頭の絵文字だけ線のフィルムの絵（飾り・aria-hidden）に（法務 可 2026-11-13） */}
            {exampleSource && (
              <span className="word-example-source">
                <IconFilm /> {stripCreditMark(exampleSource)}
              </span>
            )}
            {/* 保存した場面では見つからず、この回の別の場面の台詞を引いた（2026-10-31）。📍は保存した場面のまま。 */}
            {isOtherSceneExample(w) && <span className="word-example-source">この回の別の場面のセリフです</span>}
            {/* ♡ お気に入りの例文の印（2026-11-07）: 字幕由来の例文（出所あり）にだけ。おすすめ語（plus）の作例には付けない */}
            {onLike && exampleSource && w.source !== 'plus' && (
              <button
                type="button"
                className={'btn-like-example' + (liked ? ' is-on' : '')}
                aria-pressed={!!liked}
                title={liked ? 'お気に入りの印を外す' : 'この例文を保存'}
                onClick={() => onLike(w.word, !!liked)}
              >
                {liked ? '♥ 保存した例文' : '♡ この例文を保存'}
              </button>
            )}
          </div>
        )}

        {/* 例文がまだ付いていない語でも「どの作品で拾ったか」は出す。
            旧実装は出所行を例文ブロックの内側だけに置いていたため、例文の後埋めが失敗した語は
            作品名ごと画面から消えていた（2026-08-08 オーナー報告「単語帳でアイアンマンと
            表示されない」＝作品判定の失敗に見えるが、実際は表示側の欠落）。
            wordSource は例文が無ければ「（字幕：OpenSubtitles）」を付けないので48条の立て付けも保たれる。 */}
        {!w.example && (exampleSource || (w.exampleFail && !aiExampleOf(w))) && (
          <div className="word-example-wrap">
            {/* 引用が無い＝48条の出所明示は不要なので「（字幕：…）」は落とし、作品名だけ残す */}
            {exampleSource && (
              <span className="word-example-source">
                <IconFilm /> {stripCreditMark(exampleSource).replace(/（字幕：[^）]*）\s*$/, '')}
              </span>
            )}
            {/* 例文が取れなかった理由を明示する（③）。無言で欠けていると、ユーザーからも
                デバッグからも「なぜ出ないのか」が全く分からない状態が続く。 */}
            {w.exampleFail && !aiExampleOf(w) && (
              <span className="word-example-source">例文なし — {exampleFailLabel(w.exampleFail)}</span>
            )}
          </div>
        )}

        {/* AI 作例（2026-10-31）: 字幕から例文が取れなかった語の受け皿。作品名（上のブロック）の下に置く（法務の推奨・保存した作品と取り違えないように）。字幕の引用ではないので
            “…” で囲まず、出所（字幕：…）も付けず、AI が作った文だと明示する。字幕の例文が付けばそちらが優先。 */}
        {!w.example && aiExampleOf(w) && (
          <div className="word-example-wrap word-example-ai">
            <span className="word-example-en">
              {aiExampleOf(w).en}
              <button
                type="button"
                className="word-ex-speak"
                aria-label="例文を聞く"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSpeak(aiExampleOf(w).en);
                }}
              >
                <IconSpeaker />
              </button>
            </span>
            {aiExampleOf(w).ja && <span className="word-example-ja">{aiExampleOf(w).ja}</span>}
            <span className="word-example-source">AI 作例（ドラマのセリフではありません）</span>
          </div>
        )}

        <div className="vocab-detail-actions">
          <button className="btn-speak" title="発音を聞く" onClick={() => onSpeak(w.word)}>
            <IconSpeaker /> 発音
          </button>
          {!readOnly && (
            <button
              className={'btn-srs-skip' + (isSkip ? ' btn-srs-resume' : '')}
              onClick={() => onSkip(w.word, isSkip)}
            >
              {isSkip ? 'Resume' : 'Skip'}
            </button>
          )}
          {/* ★マイ単語帳に入れる/外す（紙の単語帳に付箋を貼る感覚・オーナー判断 2026-09-22） */}
          {onStar && (
            <button
              type="button"
              className={'btn-srs-skip btn-wordbook-star' + (starred ? ' is-on' : '')}
              title={starred ? '覚えたい語から外す（作品の単語リストには残ります）' : '覚えたい語として単語帳に入れる'}
              aria-pressed={!!starred}
              onClick={() => onStar(w.word, !!starred)}
            >
              {starred ? '★ 覚えたい' : '☆ 覚えたい'}
            </button>
          )}
          {/* 🗑完全削除＝視聴中に拾った語の誤保存/タイポ救済（単語帳から外すだけなら★） */}
          {onDelete && (
            <button className="btn-srs-skip btn-word-del" onClick={() => onDelete(w.word)}>
              🗑 削除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
