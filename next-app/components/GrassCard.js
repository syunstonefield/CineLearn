'use client';

// 「学習した日」（GitHub の草風・EXP 台帳 cl_exp_ledger から描く）。あゆみタブとホームで共用（2026-10-08）。
// 濃さ＝その日の EXP を自分の学習日の中で4段階。EXP の数字は出さない。空いた日は薄い色（罪悪感 UI にしない）。

import { useEffect, useRef, useState } from 'react';
import { JOURNEY, WEEKDAYS, dayDetail, md, parseYmd } from '@/lib/journey';

const T = JOURNEY.text;

export default function GrassCard({ grass, days, dailyStart, compact = false, mini = false, onOpen, note = null }) {
  // mini＝ホーム用の簡易版（オーナー 2026-10-08）: カレンダーの部分だけ。押すとあゆみタブ（onOpen）。
  if (mini) compact = true; // eslint-disable-line no-param-reassign
  // compact＝ホーム用: 表示幅に収まる直近の週だけ・マスを少し小さく・凡例と説明は出さず、中身はマスを押した時だけ。
  const wrapRef = useRef(null);
  const [maxWeeks, setMaxWeeks] = useState(null);
  useEffect(() => {
    if (!compact) return undefined;
    const el = wrapRef.current;
    if (!el) return undefined;
    const fit = () => {
      const w = el.getBoundingClientRect().width;
      // マスの大きさは CSS の --vj-cell（幅によって 12px／19px）。隙間 3〜4px を足した1列ぶんで割る
      const cell = parseFloat(getComputedStyle(el).getPropertyValue('--vj-cell')) || 12;
      const wide = cell >= 16; // 広い幅は隙間 4px・曜日欄 22px、狭い幅は 3px・18px（style.css と同じ）
      setMaxWeeks(Math.max(4, Math.floor((w - (wide ? 30 : 26)) / (cell + (wide ? 4 : 3)))));
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [compact]);
  const weeks = compact && maxWeeks ? grass.weeks.slice(-maxWeeks) : grass.weeks;
  const monthOf = (w, i) => w.month || (i === 0 && compact ? `${w.days.find((d) => !d.out)?.date.getMonth() + 1 || ''}月` : '');
  const [sel, setSel] = useState(null);
  const L = JOURNEY.grassLevels;
  const label = (d) => `${md(d.date)}（${WEEKDAYS[d.date.getDay()]}）`;

  let detail = T.grassPick;
  if (sel) {
    const d = parseYmd(sel);
    const lv = grass.weeks.flatMap((w) => w.days).find((x) => x.ymd === sel)?.level || 0;
    const head = <b>{`${md(d)}（${WEEKDAYS[d.getDay()]}）`}</b>;
    if (!lv) {
      detail = (
        <>
          {head}　{T.grassNone}
        </>
      );
    } else if (dailyStart && d >= dailyStart) {
      const x = dayDetail(days, sel);
      const parts = [`学習量 ${L[lv - 1]}`];
      if (x) {
        parts.push(`思い出せた ${x.ok}語`);
        if (x.min) parts.push(`学習 ${x.min}分`);
        if (x.gain) parts.push(`新しく覚えた ${x.gain}語`);
        if (x.masteredGain) parts.push(`マスターになった ${x.masteredGain}語`);
      }
      detail = (
        <>
          {head}　{parts.join('・')}
        </>
      );
    } else {
      detail = (
        <>
          {head}　学習量 {L[lv - 1]}
          {T.grassBeforeDaily}
        </>
      );
    }
  }

  if (mini) {
    return (
      <button
        type="button"
        className="vj-card vj-card-compact vj-card-mini"
        onClick={onOpen}
        aria-label={`学習した日（${grass.studied}日・今月 ${grass.thisMonth}日）。押すとあゆみで詳しく`}
      >
        <span className="vj-mini-title">{T.grassTitle}</span>
        {note}
        <div className="vj-grasswrap" ref={wrapRef}>
          <div className="vj-grass">
            <span />
            <div className="vj-months" aria-hidden="true">
              {weeks.map((w, i) => (
                <span key={i}>{monthOf(w, i)}</span>
              ))}
            </div>
            <div className="vj-wdays" aria-hidden="true">
              {WEEKDAYS.map((w, i) => (
                <span key={w}>{i % 2 ? w : ''}</span>
              ))}
            </div>
            <div className="vj-cells" aria-hidden="true">
              {weeks.flatMap((w) =>
                w.days.map((d) => (
                  <span
                    key={d.ymd}
                    className={`vj-cell${d.out ? ' is-out' : d.level ? ` l${d.level}` : ''}${d.today ? ' is-today' : ''}`}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <section className={`vj-card${compact ? ' vj-card-compact' : ''}`} aria-labelledby={compact ? 'vj-grass-h-home' : 'vj-grass-h'}>
      <div className="vj-ch">
        <h3 id={compact ? 'vj-grass-h-home' : 'vj-grass-h'}>{T.grassTitle}</h3>
      </div>
      <div className="vj-sum">
        {JOURNEY.grassSummary.includes('studied') && (
          <span>
            <b>{grass.studied}</b>日 学習した（{md(grass.start)}から）
          </span>
        )}
        {JOURNEY.grassSummary.includes('month') && (
          <span>
            <b>{grass.thisMonth}</b>日 今月
          </span>
        )}
      </div>
      <div className="vj-grasswrap" ref={wrapRef}>
        <div className="vj-grass">
          <span />
          <div className="vj-months" aria-hidden="true">
            {weeks.map((w, i) => (
              <span key={i}>{monthOf(w, i)}</span>
            ))}
          </div>
          <div className="vj-wdays" aria-hidden="true">
            {WEEKDAYS.map((w, i) => (
              <span key={w}>{i % 2 ? w : ''}</span>
            ))}
          </div>
          <div className="vj-cells">
            {weeks.flatMap((w) =>
              w.days.map((d) =>
                d.out ? (
                  <span key={d.ymd} className="vj-cell is-out" aria-hidden="true" />
                ) : (
                  <button
                    key={d.ymd}
                    type="button"
                    className={`vj-cell${d.level ? ` l${d.level}` : ''}${d.today ? ' is-today' : ''}`}
                    aria-pressed={sel === d.ymd}
                    aria-label={`${label(d)}${d.level ? `学習量 ${L[d.level - 1]}` : '学習なし'}${d.today ? '・今日' : ''}`}
                    onClick={() => setSel((s) => (s === d.ymd ? null : d.ymd))}
                  />
                )
              )
            )}
          </div>
        </div>
      </div>
      {!compact && (
      <div className="vj-gfoot">
        <div className="vj-scale" aria-hidden="true">
          少ない <i className="vj-cell" />
          {L.map((_, i) => (
            <i key={i} className={`vj-cell l${i + 1}`} />
          ))}{' '}
          多い
        </div>
        <p className="vj-hint">{T.grassHint(L.length)}</p>
      </div>
      )}
      {(!compact || sel) && (
        <div className="vj-detail" aria-live="polite">
          {detail}
        </div>
      )}
    </section>
  );
}

