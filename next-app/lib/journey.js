// あゆみタブ（下のタブ・3重の円＋草＋週ごとの推移）の数え方。docs/design-paid-features-2026-10-08.md
// 「実装メモ 4. 語彙のあゆみ」「統計の詳細の方針転換」・モック https://claude.ai/artifact/NYPowDEgA8ceU7vM7YCfem 。
//   草（学習した日・無料）＝ cl_exp_ledger を日ごとに合計し、自分の学習日の中で四分位の段階に分ける。
//     EXP の数字そのものは画面に出さない（数字を主役にしない方針・lib/exp.js）。
//   週ごとの推移（プラス）＝ cl_stats_daily（storage.js statsByDay）を日曜はじまりの週にまとめる。
//     覚えた・マスターは「その週の終わりまでの最高値」＝下がらない。思い出せた数はその週の合計。
// 画面の部品（components/VocabJourneyScreen.js）は描くだけ。ここは純粋関数（テスト: scripts/journey.test.mjs）。
//
// ★後から変えられるもの（オーナー 2026-10-08「後から変更可能な形で」）はすべて JOURNEY に集める。

export const JOURNEY = {
  // 草の濃さの段階の名前（自分の学習日の中で等分＝4つなら四分位）。段階数＝この長さ。
  grassLevels: ['少し', 'ふつう', 'しっかり', 'たっぷり'],
  // 草の上に出す数字（'studied'＝学習した日数（○/○から）／'month'＝今月の日数）。
  // 連続日数・休んだ日数は出さない（罪悪感 UI を作らない）。
  grassSummary: ['studied', 'month'],
  // 推移を出し始める記録の週数／表示する週数。
  trendMinWeeks: 4,
  trendWeeks: 12,
  text: {
    grassTitle: '学習した日',
    grassHint: (n) => `濃さは、その日の学習量（自分の学習日の中で比べた${n}段階）です。`,
    grassPick: 'マスを押すと、その日の中身が出ます。',
    grassNone: '学習の記録はありません。',
    grassBeforeDaily: '（この日より前は、詳しい内訳の記録がありません）',
    trendTitle: '週ごとの推移',
    trendWait: '記録をためています',
    trendWaitSub: (weeks, from) => `週ごとの推移は、記録が${weeks}週分たまると表示されます（${from}から記録中）。`,
    trendSummary: (weeks, learned, mastered) => {
      const parts = [];
      if (learned > 0) parts.push(`覚えた語は ${learned}語`);
      if (mastered > 0) parts.push(`マスターは ${mastered}語`);
      return parts.length ? `この${weeks}週で、${parts.join('、')}ふえました。` : '';
    },
    trendLocked:
      '覚えた語・マスターした語が週ごとにどう増えたかと、その週に思い出せた数をグラフで見られます。学習の記録はこれまで通り残り続けます。',
  },
};

const DAY = 86400000;
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
export function md(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x;
}
function sundayOf(d) {
  return addDays(d, -d.getDay());
}
function dayDiff(a, b) {
  // 夏時間をまたいでも1日＝1になるよう正午どうしで比べる
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12) - new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12)) / DAY);
}

// cl_exp_ledger（{ "YYYY-MM-DD|端末キー": EXP }）→ { "YYYY-MM-DD": 合計 }。端末をまたいで合計する。
export function expByDay(ledger = {}) {
  const out = {};
  Object.entries(ledger || {}).forEach(([k, v]) => {
    const date = String(k).split('|')[0];
    if (!parseYmd(date)) return;
    const n = Number(v) || 0;
    out[date] = (out[date] || 0) + Math.max(0, n);
  });
  return out;
}

// 学習日（EXP>0）の値から段階の境目を作る。levels 段階なら境目は levels-1 個（四分位なら 25/50/75%）。
export function grassThresholds(values, levels = JOURNEY.grassLevels.length) {
  const v = (values || []).filter((n) => n > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return Array.from({ length: Math.max(0, levels - 1) }, (_, i) => q((i + 1) / levels));
}
// 0＝学習なし／1..levels。
export function grassLevel(n, thresholds) {
  if (!(n > 0)) return 0;
  let lv = 1;
  thresholds.forEach((t) => {
    if (n > t) lv++;
  });
  return lv;
}

// 草の全体。記録の始まった週（日曜）から今日の週まで・それより前の空マスは並べない。
//   weeks: [{ month: '8月'|'' , days: [{ date, ymd, level, out, today }] ×7 }]
export function buildGrass(ledger, today = new Date()) {
  const byDay = expByDay(ledger);
  const todayKey = ymd(today);
  const dates = Object.keys(byDay).filter((k) => k <= todayKey).sort();
  const start = parseYmd(dates[0]) || parseYmd(todayKey);
  const thresholds = grassThresholds(Object.values(byDay));
  const weeks = [];
  for (let w = sundayOf(start); w <= today; w = addDays(w, 7)) {
    const days = [];
    let month = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(w, i);
      const k = ymd(d);
      if (d.getDate() === 1) month = `${d.getMonth() + 1}月`;
      const out = d < start || k > todayKey;
      days.push({ date: d, ymd: k, out, today: k === todayKey, level: out ? 0 : grassLevel(byDay[k] || 0, thresholds) });
    }
    if (!weeks.length) month = `${start.getMonth() + 1}月`;
    weeks.push({ month, days });
  }
  const studiedKeys = dates.filter((k) => byDay[k] > 0);
  const monthPrefix = todayKey.slice(0, 7);
  return {
    weeks,
    byDay,
    thresholds,
    start,
    studied: studiedKeys.length,
    thisMonth: studiedKeys.filter((k) => k.startsWith(monthPrefix)).length,
  };
}

// cl_stats_daily の記録開始日（statsByDay のいちばん古い日）。無ければ null。
export function statsStart(days = {}) {
  const k = Object.keys(days || {}).filter(parseYmd).sort()[0];
  return k ? parseYmd(k) : null;
}

// マスを押した日の中身（cl_stats_daily の開始日以降だけ）。
//   ok＝思い出せた語数／min＝学習分（秒があれば最低1分）／
//   gain＝その日に新しく覚えた語数・masteredGain＝その日にマスターになった語数
//   （どちらも前日までの最高値との差。前の記録が無い日や、その日に円を描いていない日は null＝出さない・
//   0 も画面には出さない＝オーナー 2026-10-08「なければ表示しない」）。
//   覚えた数はマスターを含むので、覚えた→マスターの昇格は gain に入らず masteredGain だけに入る。
export function dayDetail(days = {}, key) {
  const row = days[key];
  if (!row) return null;
  const drawn = (r) => (Number(r.learned) || 0) > 0 || (Number(r.mastered) || 0) > 0 || (Number(r.met) || 0) > 0;
  let prevL = null;
  let prevM = null;
  Object.entries(days).forEach(([k, r]) => {
    if (k < key && r && drawn(r)) {
      prevL = Math.max(prevL ?? 0, Number(r.learned) || 0);
      prevM = Math.max(prevM ?? 0, Number(r.mastered) || 0);
    }
  });
  const sec = Number(row.sec) || 0;
  const today = drawn(row);
  return {
    ok: Number(row.ok) || 0,
    min: sec > 0 ? Math.max(1, Math.round(sec / 60)) : 0,
    gain: prevL != null && today ? Math.max(0, (Number(row.learned) || 0) - prevL) : null,
    masteredGain: prevM != null && today ? Math.max(0, (Number(row.mastered) || 0) - prevM) : null,
  };
}

// 週ごとの推移。日曜はじまりの週で、記録の始まった週から今週まで。
//   recorded＝記録した週数（開始日から経った日数÷7・切り捨て）＝「4つの目盛り」の埋まり具合。
//   ready＝recorded が minWeeks 以上。series は直近 weeks 週（それより記録が短ければその分だけ）。
//   learned/mastered＝その週の終わりまでの最高値（下がらない）・ok＝その週に思い出せた数の合計。
export function buildTrend(days = {}, today = new Date(), { minWeeks = JOURNEY.trendMinWeeks, weeks = JOURNEY.trendWeeks } = {}) {
  const start = statsStart(days);
  if (!start) return { start: null, recorded: 0, ready: false, series: [] };
  const recorded = Math.max(0, Math.floor((dayDiff(start, today) + 1) / 7));
  const ready = recorded >= minWeeks;
  const firstSun = sundayOf(start);
  const thisSun = sundayOf(today);
  const total = Math.floor(dayDiff(firstSun, thisSun) / 7) + 1;
  const keys = Object.keys(days).filter(parseYmd).sort();
  const all = [];
  let hwL = 0;
  let hwM = 0;
  let ki = 0;
  for (let i = 0; i < total; i++) {
    const ws = addDays(firstSun, i * 7);
    const endKey = ymd(addDays(ws, 6));
    let ok = 0;
    while (ki < keys.length && keys[ki] <= endKey) {
      const r = days[keys[ki]] || {};
      hwL = Math.max(hwL, Number(r.learned) || 0);
      hwM = Math.max(hwM, Number(r.mastered) || 0);
      ok += Number(r.ok) || 0;
      ki++;
    }
    all.push({ weekStart: ws, learned: hwL, mastered: hwM, ok });
  }
  return { start, recorded, ready, series: all.slice(-weeks) };
}

// 目盛りの上限（見やすい切りのよい数）。
export function niceMax(n, step) {
  if (!(n > 0)) return step;
  return Math.ceil(n / step) * step;
}
