'use client';

// ホームの部品（2026-11-12 見直し・受付の見本 reports/home-ui-2026-11-12/mock.html・オーナー了承「いい。実装進めて」）。
//   並び（Dashboard）: 帯 → 今日の復習 → 記録（2枚） → 続きから学習 → 今日の語 → マイリスト → おすすめ → TMDB の表示。
//   札は単語リストと同じ白地・細い枠・角 12px（画面どうしのコントラストを出しすぎない）。
//   決まり（変えない）: 帯の順番と回数／今日の復習の上限／連続日数は出さない（累計の学習した日・強調しない・2026-11-13）／タイルの分母＝出会った語／
//   学習した日はプラス・押すとあゆみ／続きから学習は最近触った順・2枚＋すべて見る・✕の確認文／今日の語の法務条件／おすすめの理由は事実だけ。
import { useEffect, useState } from 'react';
import { tmdb } from '@/lib/api';
import { GENRE_LABELS, levelMark } from '@/lib/recommended';
import { WEEKDAYS } from '@/lib/journey';
import { studiedLine } from '@/lib/studiedDays';
import { IconSprout, IconClose, IconCheck, IconStar } from './icons/LineIcons';

const HOME_WEEKS = 8; // ホームの学習した日に出す直近の週の数（スマホ 390 の半分の札に収まる数）。記録が短い人は列をその週の数にし、マスの大きさは8週の時のまま（表の幅を CSS で週の数に合わせ、札の真ん中に置く・2026-11-13）

// 1行の細い帯（文＋リンク＋✕）。出す条件・順番・回数は Dashboard 側（今のまま）。
export function HomeBand({ text, linkLabel, onLink, onClose }) {
  return (
    <div className="hm-band">
      <span className="hm-band-t">{text}</span>
      {linkLabel && (
        <button type="button" className="hm-band-link" onClick={onLink}>
          {linkLabel} ›
        </button>
      )}
      {onClose && (
        <button type="button" className="hm-band-x" onClick={onClose} aria-label="閉じる">
          <IconClose />
        </button>
      )}
    </div>
  );
}

// 「もう一度：［知らなかった N語］［うろ覚え N語］」（復習・クイズの新機能・lib/againWords.js）。0語は出さない・両方0なら行ごと出さない。
function AgainRow({ again, onAgain }) {
  const kinds = [
    ['unknown', '知らなかった'],
    ['shaky', 'うろ覚え'],
  ].filter(([k]) => (again?.[k] || 0) > 0);
  if (!kinds.length) return null;
  return (
    <div className="hm-again">
      <span className="hm-again-l">もう一度：</span>
      {kinds.map(([k, label]) => (
        <button key={k} type="button" className="hm-again-btn" onClick={() => onAgain(k)}>
          <b>{label}</b> {again[k]}語
        </button>
      ))}
    </div>
  );
}

// 今日の復習の札（白い札・数の円・題・学習した日の小さな表示・主ボタン）。終えた後も同じ場所に「もう一度」を残す。
//   学習した日（累計・オーナー決定 2026-11-13）: 連続日数（🔥 N日連続）はやめた＝責める・急がせる表示にしない。
//   薄い緑の芽の線の絵＋「学習した日 N日」（1日目が今日の時だけ「今日が1日目」）。0日は今の文のまま。数え方は lib/studiedDays.js。
export function HomeTodayCard({ studied, todayCount, weekStats, onStart, again, onAgain }) {
  const line = studiedLine(studied);
  const daysNode = line ? (
    <span className="hm-days-line">
      <IconSprout />
      {line}
    </span>
  ) : null;
  const leadText = daysNode || '予習した語を、復習で覚えていきましょう';
  if (todayCount > 0) {
    return (
      <section className="hm-card hm-today" aria-labelledby="hm-today-h">
        <div className="hm-today-top">
          <div className="hm-today-num" aria-hidden="true">
            <b>{todayCount}</b>
            <small>語</small>
          </div>
          <div className="hm-today-tx">
            <h2 id="hm-today-h">今日の復習</h2>
            <p>{leadText}</p>
          </div>
        </div>
        <button type="button" className="btn-primary hm-today-btn" onClick={onStart} aria-label={`今日の復習 ${todayCount}語をはじめる`}>
          復習をはじめる
        </button>
        <AgainRow again={again} onAgain={onAgain} />
      </section>
    );
  }
  const week = weekStats?.reviewedThisWeek || 0;
  return (
    <section className="hm-card hm-today" aria-label="今日の復習">
      <div className="hm-done">
        今日の復習は完了 <IconCheck />
        <small>
          {daysNode}
          {daysNode && week > 0 ? '　' : ''}
          {week > 0 ? `今週 ${week}語 復習` : ''}
        </small>
      </div>
      <AgainRow again={again} onAgain={onAgain} />
    </section>
  );
}

// 記録の札2枚: 左＝覚えた／マスター（分母＝出会った語）、右＝学習した日（誰でも使える・押すとあゆみの学習した日の欄へ）。
//   onOpen が無い時（正式版の無料＝あゆみはプラス）は押せない札にする。grass が無い時（学習の記録がまだ無い）は左だけ全幅。
export function HomeRecord({ learned, mastered, total, grass, onOpenJourney, onOpenGrass }) {
  if (!(total > 0)) return null;
  const Left = onOpenJourney ? 'button' : 'div';
  const Days = onOpenGrass ? 'button' : 'div';
  const weeks = grass ? grass.weeks.slice(-HOME_WEEKS) : [];
  // 月の見出し＝その週に1日があれば「N月」。先頭の列は、見えている最初の日の月（GrassCard の compact と同じ考え方）
  //   ただし2列目にすぐ月の見出しがある時は、先頭の列には出さない（文字が重ならないように）。
  const monthOf = (w, i) => {
    if (w.month) return w.month;
    if (i !== 0 || weeks[1]?.month) return '';
    const first = w.days.find((d) => !d.out);
    return first ? `${first.date.getMonth() + 1}月` : '';
  };
  return (
    <div className={`hm-duo${grass ? '' : ' is-single'}`}>
      <Left
        {...(onOpenJourney ? { type: 'button', onClick: onOpenJourney, 'aria-label': `覚えた ${learned}語、マスター ${mastered}語。あゆみを開く` } : {})}
        className="hm-card hm-nums"
      >
        <span className="hm-num hm-num-l">
          <small>
            <IconCheck /> 覚えた
          </small>
          <b>{learned}</b>
          <i>語</i>
        </span>
        <span className="hm-num hm-num-m">
          <small>
            <IconStar /> マスター
          </small>
          <b>{mastered}</b>
          <i>語</i>
        </span>
      </Left>
      {grass && (
        <Days
          {...(onOpenGrass
            ? { type: 'button', onClick: onOpenGrass, 'aria-label': `学習した日（${grass.studied}日・今月 ${grass.thisMonth}日）。押すとあゆみで詳しく` }
            : { role: 'img', 'aria-label': `学習した日（${grass.studied}日・今月 ${grass.thisMonth}日）` })}
          className={`hm-card hm-days${onOpenGrass ? ' is-link' : ''}`}
        >
          {/* 題は出さず、今までのホームと同じく月と曜日（月・水・金）を添えたマス目だけ（オーナー 2026-11-12）。押せる時は右上に小さな › */}
          {onOpenGrass && (
            <span className="hm-days-go" aria-hidden="true">
              ›
            </span>
          )}
          <span className="hm-days-cal" aria-hidden="true" style={{ '--hm-weeks': weeks.length || HOME_WEEKS }}>
            <span />
            <span className="hm-days-mo">
              {weeks.map((w, i) => (
                <span key={i}>{monthOf(w, i)}</span>
              ))}
            </span>
            <span className="hm-days-wd">
              {WEEKDAYS.map((d, i) => (
                <span key={d}>{i % 2 ? d : ''}</span>
              ))}
            </span>
            <span className="hm-days-g">
              {weeks.flatMap((w) =>
                w.days.map((d) => (
                  <i key={d.ymd} className={`${d.out ? 'is-out' : d.level ? `l${d.level}` : ''}${d.today ? ' is-today' : ''}`} />
                ))
              )}
            </span>
          </span>
        </Days>
      )}
    </div>
  );
}

// 「はじめての人（作品なし）」: することを1つに（作品を探す）＋あなたのレベルに合う作品を検索画面と同じ行の形で3つ（理由の1行つき）。
export function HomeStart({ items, userLevel, onFind, onPick }) {
  return (
    <>
      <section className="hm-card hm-hello" aria-labelledby="hm-hello-h">
        <h2 id="hm-hello-h">観たい作品を、1つ選びましょう</h2>
        <p>選んだ話の字幕から、単語リストを作ります。</p>
        <button type="button" className="btn-primary hm-today-btn" onClick={onFind}>
          作品を探す
        </button>
      </section>
      {items.length > 0 && (
        <>
          <div className="hm-sec">
            <h3>あなたのレベルに合う作品</h3>
          </div>
          <div className="hm-rows">
            {items.slice(0, 3).map((item, i) => (
              <StartRow key={item.title} item={item} n={i} userLevel={userLevel} onPick={() => onPick(item)} />
            ))}
          </div>
          <p className="hm-fine">レベルは CineLearn が作品に付けた目安です。作品の権利者・配信サービスとは提携していません。</p>
        </>
      )}
    </>
  );
}

// 検索画面の厳選の行（components/SearchScreen.js PoolRow）と同じ形・同じ class。ポスターは TMDB の縦のポスターだけ（無ければ頭文字の札）。
const startPosterCache = new Map();
function StartRow({ item, n, userLevel, onPick }) {
  const [src, setSrc] = useState(() => startPosterCache.get(item.tmdbId) ?? item.posterPath ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (src !== null || !item.tmdbId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const d = await tmdb({ action: 'seasons', tvId: item.tmdbId });
        const url = d?.poster_path ? `https://image.tmdb.org/t/p/w185${d.poster_path}` : '';
        startPosterCache.set(item.tmdbId, url);
        if (!cancelled) setSrc(url);
      } catch {
        if (!cancelled) setSrc('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.tmdbId, src]);
  return (
    <button type="button" className="srch-row" style={{ animationDelay: `${Math.min(n, 8) * 35}ms` }} onClick={onPick}>
      {src && !failed ? (
        <span className="srch-ps" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
        </span>
      ) : (
        <span className="srch-ps srch-ps-letter" aria-hidden="true">
          {(item.title || '?').replace(/^The /, '').charAt(0)}
        </span>
      )}
      <span className="srch-row-tx">
        <span className="srch-row-t">
          {item.title}
          <em className="srch-lv">{levelMark(item, userLevel)}</em>
        </span>
        <span className="srch-row-m">
          {GENRE_LABELS[item.genre] || ''}　{item.ja}
        </span>
        <span className="srch-row-r">{item.reason}</span>
      </span>
      <span className="srch-row-ch" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
