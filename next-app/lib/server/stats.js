// ベータ運用の日次カウンタ（2026-10-08）。OS 商用契約の判断材料＝利用者数・キャッシュ命中率・OS DL 消費を週次で見る。
//   * Upstash に stat:<name>:d:<UTC日> を INCR（120日 TTL）。利用者は stat:users:d:<日> の HyperLogLog（PFADD）で
//     ユニーク数だけを数える＝IP / uid は sha256(pepper+値) の先頭16hex で入れ、元の値は復元できない。
//   * 必ず await（Vercel は応答後に凍結）・失敗は握りつぶす（統計のために本処理を落とさない）。
//   * 読み出しは readStats(days)（/api/stats・合言葉ヘッダ必須）。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { hashId } from './hashId.js';
import { upstashConfigured, redisPipeline, tryRedis, utcDayKey } from './upstash.js';

const STAT_TTL_SEC = String(120 * 86400);
export const STAT_NAMES = [
  'vocab_hit', // /api/vocab 共有キャッシュ命中
  'vocab_miss', // 同・未命中（＝生成に進む候補）
  'vocab_blocked', // 同・カタログ外（未ログイン）
  'gen_ok', // /api/vocab-generate 生成して共有キャッシュへ保存
  'gen_uncontrib', // 生成したが品質ゲート不通過（共有されない）
  'gen_hit', // 生成ルートに来たが既に誰かが作っていた
  'gen_nosub', // 字幕なし
  'gen_os_quota', // OS 日次枠切れ（★契約判断の最重要シグナル）
  'gen_fail', // その他の上流失敗（llm / timeout / tmdb / os_search 等）
  'gen_rate_limited', // ユーザー/IP の生成上限に当たった
  'gen_month_limited', // 月の新規生成数の上限に当たった（正式版のみ・ベータは0）
  'os_dl', // OS ダウンロード実数（os:dl:d は 25h で消えるので長期用に別に数える）
];

// bumpStats(['vocab_hit'], { user: 'ip:1.2.3.4' | 'u:<uid>' })
export async function bumpStats(names, { user = null, now = Date.now(), env = process.env, log = console } = {}) {
  if (!upstashConfigured(env)) return;
  const day = utcDayKey(now);
  const cmds = [];
  for (const n of names) {
    const key = `stat:${n}:d:${day}`;
    cmds.push(['INCR', key], ['EXPIRE', key, STAT_TTL_SEC, 'NX']);
  }
  if (user) {
    const key = `stat:users:d:${day}`;
    cmds.push(['PFADD', key, hashId(user)], ['EXPIRE', key, STAT_TTL_SEC, 'NX']);
  }
  if (cmds.length) await tryRedis(() => redisPipeline(cmds, { env }), null, { env, log });
}

// 直近 days 日（今日を含む・新しい順）の { day, users, <name>... }。週ごとのユニーク利用者は PFCOUNT の和集合で正確に出す。
export async function readStats(days = 56, { now = Date.now(), env = process.env } = {}) {
  const dayKeys = Array.from({ length: days }, (_, i) => utcDayKey(now - i * 86400000));
  const cmds = [];
  for (const d of dayKeys) {
    for (const n of STAT_NAMES) cmds.push(['GET', `stat:${n}:d:${d}`]);
    cmds.push(['PFCOUNT', `stat:users:d:${d}`]);
  }
  // 週（直近7日ずつ）のユニーク利用者＝複数キーの PFCOUNT
  const weeks = [];
  for (let w = 0; w * 7 < days; w++) weeks.push(dayKeys.slice(w * 7, w * 7 + 7));
  for (const ks of weeks) cmds.push(['PFCOUNT', ...ks.map((d) => `stat:users:d:${d}`)]);
  const res = await redisPipeline(cmds, { env });
  const per = STAT_NAMES.length + 1;
  const daily = dayKeys.map((day, i) => {
    const row = { day };
    STAT_NAMES.forEach((n, j) => (row[n] = Number(res[i * per + j] || 0)));
    row.users = Number(res[i * per + STAT_NAMES.length] || 0);
    return row;
  });
  const weeklyUsers = weeks.map((ks, w) => ({ from: ks[ks.length - 1], to: ks[0], users: Number(res[dayKeys.length * per + w] || 0) }));
  return { daily, weeklyUsers };
}
