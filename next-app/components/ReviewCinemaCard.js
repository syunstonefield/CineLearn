'use client';

// 復習カード（夕焼けシネマ・オーナー決定 2026-11-07）。復習タブのページ表示（ReviewModal asPage）だけで使う。
//   予習の「じっくり覚える」（同じ ReviewModal の重ね表示）は従来の ReviewCard のまま＝見た目を分ける（オーナー「分けたい」）。
//   変えない: 表→タップで裏→3択の流れ・3択の文言と意味・採点（SRS）・スワイプとキー操作・押し間違いの「戻る」。
//   中身の改善（オーナー資料 2026-11-07）: 裏の読む順＝意味→例文と和訳（紙の上・対象語を強調）→作品情報／3択は同じ大きさで
//   淡い色の地＋文字で区別（押す前に1つだけ光らせない）／表の下に「思い出してから開く」誘導／意味を確認するボタンは
//   3択と同じ位置・同じ高さ。場面の画像は出さない（法務の線）＝場面は実際のセリフと作品・話で見せる。
//   2026-11-07 オーナー実機: 例文の黒い字幕の帯は浮いて見えるのでやめ、カードの紙の上に置く。
//   見た目は CSS だけ（画像ゼロ・app/style.css「復習カード（夕焼けシネマ）」）。動き・10枚の区切りの演出は後の段。

import { useLayoutEffect, useRef } from 'react';
import { aiExampleOf, isOtherSceneExample } from '@/lib/exampleBackfill';
import { surfaceFormInExample, wordMatchRegex, normApostrophes } from '@/lib/subtitles';
import { speak } from '@/lib/speak';
import { chunkParts } from '@/lib/chunk';
import { subtitleCredit } from '@/lib/storage';
import { fitFontSize, FIT_MIN_PX } from '@/lib/fitWord';

const FILM_FRAMES = 10; // 進み具合のフィルム＝1コマ1枚・10枚で次の10コマへ

// 大きな語は折り返さず、1行に入るまで文字を縮める（オーナー 2026-11-07「長い単語が次の行にいっちゃうのはやめたい」）。
//   CSS の大きさ（表48px・裏34px・画面幅で変わる）を最大に、実際の幅を測って縮める（計算は lib/fitWord.js）。
//   下限（表22px・裏20px）でも入らない極端に長い句だけ、単語の切れ目で折り返す（1語だけで入らない時は語の途中で折る）。
function useFitWord(ref, minPx, deps) {
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return undefined;
    const fit = () => {
      el.style.fontSize = '';
      el.classList.remove('is-wrap');
      const max = parseFloat(getComputedStyle(el).fontSize);
      const pcs = getComputedStyle(parent);
      const avail = parent.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
      const { size, wrap } = fitFontSize(max, el.scrollWidth, avail, minPx);
      if (size !== max) el.style.fontSize = `${size}px`;
      if (wrap) el.classList.add('is-wrap');
    };
    fit();
    // 書体（Playfair）の読み込みが後から終わると幅が変わる／画面の回転・幅の変化
    let alive = true;
    document.fonts?.ready?.then(() => alive && fit());
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fit()) : null;
    ro?.observe(parent);
    return () => {
      alive = false;
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// 表に出す「どの作品・話で出会ったか」。出所表示（subtitleCredit）と同じ規則（別の話数の字幕なら話数を外す・plus 語は出さない）。
function workLabelOf(w) {
  const c = subtitleCredit(w);
  return c ? c.replace(/^📺\s*/, '').replace(/（字幕：[^）]*）$/, '') : '';
}

// 例文の中の対象語（活用形・分離込み）を強調する。見つからなければ全文をそのまま。
export function highlightExample(example, word) {
  const text = String(example || '');
  const re = word ? wordMatchRegex(word, 'i') : null;
  const m = re && normApostrophes(text).match(re);
  if (!m || m.index == null) return { before: text, hit: '', after: '' };
  return { before: text.slice(0, m.index), hit: text.slice(m.index, m.index + m[0].length), after: text.slice(m.index + m[0].length) };
}

// 「12 / 125」＋フィルム10コマ（今の10枚のうち答えた枚数が点く）＋全体の細い線。見出しは「今日の復習」（チケット形の横で上映の券と紛れないよう「上映」は使わない・法務 2026-11-07）。
export function CinemaProgress({ idx, total }) {
  const blockStart = Math.floor(idx / FILM_FRAMES) * FILM_FRAMES;
  const frames = Math.max(1, Math.min(FILM_FRAMES, total - blockStart));
  const lit = idx - blockStart;
  const overall = total ? Math.min(100, (idx / total) * 100) : 0;
  return (
    <div className="rc-progress">
      <div className="rc-progress-row">
        <span className="rc-count">
          {Math.min(idx + 1, total)} <span className="rc-count-total">/ {total}</span>
        </span>
        <span className="rc-film" aria-hidden="true">
          {Array.from({ length: frames }, (_, i) => (
            <span key={i} className={'rc-frame' + (i < lit ? ' is-lit' : '')} />
          ))}
        </span>
        <span className="rc-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 10h18v10H3z" />
            <path d="M3 10l2-5 16-1-1 5" />
            <path d="M8 5l2 4.5M13 4.6l2 4.5" />
          </svg>
          今日の復習
        </span>
      </div>
      <div className="rc-overall" aria-hidden="true">
        <span style={{ width: `${overall}%` }} />
      </div>
    </div>
  );
}

const SpeakIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
  </svg>
);
const FilmIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
  </svg>
);

export default function ReviewCinemaCard({ word: w, flipped, retryMode, onFlip, onRate, onUndo }) {
  // スワイプ採点：右=知ってた(5) / 左=知らなかった(0)。意味を開いてから有効（従来の ReviewCard と同じ）。
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

  const cp = chunkParts(w.chunk, w.word);
  const label = cp ? w.chunk : w.word;
  const work = workLabelOf(w);
  const credit = subtitleCredit(w);
  const ai = !w.example ? aiExampleOf(w) : null;
  // “…” と出所（作品・話・字幕元）を付けるのは出所を出せる例文だけ＝字幕の引用。出所の無い例文（plus 語の生成例文など）は
  // セリフに見せないよう、AI 作例と同じく “…” も出所も付けない。
  const ex = w.example && credit ? highlightExample(w.example, w.word) : null;
  const plain = w.example && !credit ? highlightExample(w.example, w.word) : null;
  const sf = w.pos ? surfaceFormInExample(w.example, w.word) : null;
  const wordRef = useRef(null);
  useFitWord(wordRef, flipped ? FIT_MIN_PX.back : FIT_MIN_PX.front, [w.word, w.chunk, flipped]);

  const wordEl = (
    <span ref={wordRef} className={'rc-word' + (flipped ? ' is-small' : '')}>
      {cp && cp.hit ? (
        <>
          <span className="rc-word-side">{cp.before}</span>
          {cp.hit}
          <span className="rc-word-side">{cp.after}</span>
        </>
      ) : (
        w.word
      )}
    </span>
  );
  const speakBtn = (
    <button
      type="button"
      className="rc-speak"
      aria-label="発音を聞く"
      onClick={(ev) => {
        ev.stopPropagation();
        speak(label);
      }}
    >
      <SpeakIcon />
      聞く
    </button>
  );

  return (
    <div className="rc-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="rc-deck">
        <div
          className={'rc-ticket' + (flipped ? ' is-back' : ' is-front')}
          onClick={(e) => {
            if (flipped || e.target.closest('button')) return;
            onFlip();
          }}
        >
          <div className="rc-ticket-head">
            {onUndo ? (
              <button type="button" className="rc-undo" onClick={onUndo}>
                ↩ 前のカードに戻る
              </button>
            ) : (
              <span />
            )}
            {!flipped && work && (
              <span className="rc-work">
                <FilmIcon />
                {work} で出会った表現
              </span>
            )}
          </div>

          {!flipped ? (
            <>
              <div className="rc-front-main">
                {wordEl}
                <div className="rc-word-meta">
                  {w.pos && <span className="rc-pos">{w.pos}</span>}
                  {speakBtn}
                </div>
              </div>
              <div className="rc-perf" aria-hidden="true" />
              <div className="rc-front-hint">
                <span className="rc-hint-main">意味を思い浮かべてから</span>
                <span className="rc-hint-sub">カードのどこを押しても開きます</span>
              </div>
            </>
          ) : (
            <>
              <div className="rc-back-word">
                {wordEl}
                <div className="rc-word-meta">
                  {w.pos && (
                    <span className="rc-pos">
                      {w.pos}
                      {sf && <span className="rc-pos-surface">例文では {sf}</span>}
                    </span>
                  )}
                  {speakBtn}
                </div>
              </div>
              <div className="rc-perf" aria-hidden="true" />
              <div className="rc-back-body">
                <div className="rc-def">{w.definition || ''}</div>
                {ex && (
                  <div className="rc-sub">
                    <div className="rc-sub-en">
                      “{ex.before}
                      {ex.hit && <span className="rc-sub-hit">{ex.hit}</span>}
                      {ex.after}”
                    </div>
                    {w.example_ja && <div className="rc-sub-ja">{w.example_ja}</div>}
                  </div>
                )}
                {plain && (
                  <div className="rc-ai">
                    <div className="rc-ai-en">
                      {plain.before}
                      {plain.hit && <span className="rc-ai-hit">{plain.hit}</span>}
                      {plain.after}
                    </div>
                    {w.example_ja && <div className="rc-ai-ja">{w.example_ja}</div>}
                  </div>
                )}
                {ai && (
                  <div className="rc-ai">
                    <div className="rc-ai-en">{ai.en}</div>
                    {ai.ja && <div className="rc-ai-ja">{ai.ja}</div>}
                  </div>
                )}
                {(ex || plain || ai) && (
                  <div className="rc-src-row">
                    <span className="rc-src">
                      {ex && credit && (
                        <span className="rc-src-line">
                          <FilmIcon />
                          {/* 出所明示（著作権法48条）：例文を引いた作品・話・字幕元 */}
                          <span>{credit.replace(/^📺\s*/, '')}</span>
                        </span>
                      )}
                      {ex && isOtherSceneExample(w) && <span className="rc-src-note">この回の別の場面のセリフです</span>}
                      {/* AI 作例（2026-10-31）: 字幕の引用ではないので “…” と出所を付けず、注記で明示する */}
                      {ai && <span className="rc-src-note">AI 作例（ドラマのセリフではありません）</span>}
                    </span>
                    <button
                      type="button"
                      className="rc-speak-sm"
                      aria-label="例文を聞く"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        speak(ex || plain ? w.example : ai.en);
                      }}
                    >
                      <SpeakIcon />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rc-actions">
        {!flipped ? (
          <>
            <button type="button" className="rc-flip" onClick={onFlip}>
              意味を確認する
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {/* 裏の3択の下に出るスワイプの案内と同じ高さを空けておく＝表のボタンと3択が同じ位置（親指を動かさない） */}
            <div className="review-swipe-hint rc-swipe-hint rc-hint-spacer" aria-hidden="true">
              ← 知らなかった　｜　知ってた →
            </div>
            <div className="review-key-hint" aria-hidden="true">
              <kbd>Shift</kbd> / <kbd>Space</kbd> で意味を確認
            </div>
          </>
        ) : retryMode ? (
          <>
            <button type="button" className="rc-flip" onClick={() => onRate(null)}>
              次へ →
            </button>
            <div className="review-key-hint" aria-hidden="true">
              <kbd>Shift</kbd> / <kbd>Space</kbd> / <kbd>→</kbd> 次へ　<kbd>↑</kbd> 戻る
            </div>
          </>
        ) : (
          <>
            <div className="rc-rates">
              <button type="button" className="rc-rate rc-rate-fail" onClick={() => onRate(0)}>
                <span className="rc-rate-emoji" aria-hidden="true">😟</span>
                <span className="rc-rate-label">知らなかった</span>
                <span className="rc-rate-sub">覚え直す</span>
              </button>
              <button type="button" className="rc-rate rc-rate-hard" onClick={() => onRate(3)}>
                <span className="rc-rate-emoji" aria-hidden="true">🙂</span>
                <span className="rc-rate-label">うろ覚え</span>
                <span className="rc-rate-sub">あとで復習</span>
              </button>
              <button type="button" className="rc-rate rc-rate-easy" onClick={() => onRate(5)}>
                <span className="rc-rate-emoji" aria-hidden="true">🔥</span>
                <span className="rc-rate-label">知ってた！</span>
                <span className="rc-rate-sub">次へ進む</span>
              </button>
            </div>
            <div className="review-swipe-hint rc-swipe-hint" aria-hidden="true">
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
