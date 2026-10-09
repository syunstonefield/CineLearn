// ベータの利用データ（2026-10-09 オーナーと設計・docs/design-usage-stats-2026-10-09.md）。
//   * 保存: Upstash の HASH `usage:d:<端末の日付 YYYYMMDD>`・フィールド `<人の番号>.<端末の番号>`・値は JSON
//     { L:ログイン中か(1/0), c:{項目:回数}, r:{n:初めて復習した語, c:継続の復習, l:期日が来て残った語} }。
//     アプリは「その日の合計」を送る＝上書き（二重に数えない）。120日で自動で消える。
//   * 人の番号＝hashId('u:'+uid)（ログイン中）／hashId('d:'+端末キー)（未ログイン）。端末の番号＝hashId('d:'+端末キー)。
//     生の ID・IP は保存しない。
//   * 月の生成数の分布: gen:month:<YYYYMM>:<番号>（vocab-generate が数える・40日）を読み、
//     人数の分布だけ（誰かは残さない）を stat:genmonth:<YYYYMM> に保存して月ごとの推移を残す。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { hashId } from './hashId.js';
import { redisPipeline, redisCommand } from './upstash.js';
import { genMonthOf } from './constants.js';

export const USAGE_TTL_SEC = 120 * 86400;
const GENMONTH_SNAPSHOT_TTL_SEC = 400 * 86400;

export const usageDayKey = (day) => `usage:d:${String(day).replace(/-/g, '')}`;

export function usageIds({ uid = null, device }, env = process.env) {
  const d = hashId(`d:${device}`, env);
  return { person: uid ? hashId(`u:${uid}`, env) : d, device: d };
}

// 端末の日付が「今日（UTC）の前後2日」に収まるか（古い日・未来の日への書き込みを弾く）。
export function usageDayAllowed(day, now = Date.now()) {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  return Math.abs(t - now) <= 3 * 86400000;
}

// sanitizeUsage 済みの値を書く。ログイン中は、同じ端末の未ログインの行（その日の分）を消す
// ＝端末の合計は1日を通して積み上がる値なので、ログイン後の行がそれを含む。
export async function writeUsage(u, { uid = null, env = process.env } = {}) {
  const ids = usageIds({ uid, device: u.device }, env);
  const key = usageDayKey(u.day);
  const val = JSON.stringify({ L: uid ? 1 : 0, c: u.c, ...(u.r ? { r: u.r } : {}) });
  const cmds = [
    ['HSET', key, `${ids.person}.${ids.device}`, val],
    ['EXPIRE', key, String(USAGE_TTL_SEC), 'NX'],
  ];
  if (uid) cmds.push(['HDEL', key, `${ids.device}.${ids.device}`]);
  await redisPipeline(cmds, { env });
}

const parseRow = (day, field, raw) => {
  const [p, d] = String(field).split('.');
  try {
    const v = JSON.parse(raw);
    return { day, p, d, L: v.L ? 1 : 0, c: v.c || {}, r: v.r || null };
  } catch {
    return null;
  }
};

// 直近 days 日（端末の日付・新しい順）の行。週次の表と CSV の元。
export async function readUsageRows(days = 56, { now = Date.now(), env = process.env } = {}) {
  // 端末の日付は JST がほとんど＝JST の今日から数える（+1日ぶん余裕）。
  const dayList = Array.from({ length: days + 1 }, (_, i) => new Date(now + 9 * 3600000 - (i - 1) * 86400000).toISOString().slice(0, 10));
  const res = await redisPipeline(
    dayList.map((d) => ['HGETALL', usageDayKey(d)]),
    { env }
  );
  const rows = [];
  dayList.forEach((day, i) => {
    const flat = Array.isArray(res[i]) ? res[i] : [];
    for (let j = 0; j + 1 < flat.length; j += 2) {
      const row = parseRow(day, flat[j], flat[j + 1]);
      if (row) rows.push(row);
    }
  });
  return rows;
}

// 削除の依頼（法35条）: その利用者の統計の行（直近121日）と月の生成数（今月・先月）を消す。
export async function deleteUsageFor(uid, { now = Date.now(), env = process.env } = {}) {
  const p = hashId(`u:${uid}`, env);
  const dayList = Array.from({ length: 123 }, (_, i) => new Date(now + 9 * 3600000 - (i - 1) * 86400000).toISOString().slice(0, 10));
  const res = await redisPipeline(dayList.map((d) => ['HKEYS', usageDayKey(d)]), { env });
  const cmds = [];
  dayList.forEach((d, i) => {
    const mine = (Array.isArray(res[i]) ? res[i] : []).filter((f) => String(f).startsWith(`${p}.`));
    if (mine.length) cmds.push(['HDEL', usageDayKey(d), ...mine]);
  });
  const months = [genMonthOf(now), genMonthOf(now - 32 * 86400000)];
  for (const m of months) cmds.push(['DEL', `gen:month:${m}:${p}`, `gen:month:${m}:${uid}`]);
  await redisPipeline(cmds, { env });
  return { rowsDeleted: cmds.length - months.length };
}

// gen:month:<YYYYMM>:* の値（1人の月の生成数）を全部読む。番号が16hex のキーだけ
// （切り替え前の生の uid のキーは数えない＝同じ人を二重に数えない）。
async function scanGenMonth(month, env) {
  const keys = [];
  let cursor = '0';
  for (let i = 0; i < 50; i++) {
    const [next, batch] = await redisCommand(['SCAN', cursor, 'MATCH', `gen:month:${month}:*`, 'COUNT', '500'], { env });
    for (const k of batch || []) if (/:[0-9a-f]{16}$/.test(k)) keys.push(k);
    cursor = String(next);
    if (cursor === '0') break;
  }
  if (!keys.length) return [];
  const vals = await redisCommand(['MGET', ...keys], { env });
  return (vals || []).map((v) => Number(v) || 0).filter((n) => n > 0);
}

// 今月と先月は生きているキーから数えて保存し、それより前は保存しておいた分布を返す。
//   戻り値 [{ month:'202610', counts:[1人ごとの生成数（多い順）] }]（新しい月が先）
export async function readGenMonthDist(monthsBack = 4, { now = Date.now(), env = process.env } = {}) {
  const months = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now + 9 * 3600000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const out = [];
  for (const [i, month] of months.entries()) {
    const snapKey = `stat:genmonth:${month}`;
    let saved = [];
    try {
      saved = JSON.parse((await redisCommand(['GET', snapKey], { env })) || '[]');
    } catch {}
    if (!Array.isArray(saved)) saved = [];
    if (i < 2) {
      // 先月のキーは月初の分から順に40日で消えていく＝生きているキーの方が人数が少なければ保存済みを使う。
      const live = (await scanGenMonth(month, env)).sort((a, b) => b - a);
      if (live.length && (i === 0 || live.length >= saved.length)) {
        await redisCommand(['SET', snapKey, JSON.stringify(live), 'EX', String(GENMONTH_SNAPSHOT_TTL_SEC)], { env });
        out.push({ month, counts: live });
        continue;
      }
    }
    out.push({ month, counts: saved });
  }
  return out;
}
