// ログイン JWT の検証（ユーザー/日のレート制限の主体を決める）と、seed / 管理者の判定（A28）。
//   * resolveUserId: Authorization: Bearer <jwt> を Supabase Auth（GET /auth/v1/user・apikey=anon）で検証し uid を返す。
//     - 通信失敗は uid=null（匿名扱い・権限は付与しない）。invalid / unavailable はキャッシュしない。
//     - 成功だけを sha256(token)→{uid, expiresAt} でモジュール Map にキャッシュ（TTL は min(5分, JWT exp)・500件で最古削除）。
//       同じユーザーの連打で毎回 Auth を叩かないため。トークンそのものは Map に持たない（ハッシュのみ）。
//   * isAdmin: env CL_ADMIN_USER_IDS（カンマ区切り）に uid が含まれるか。
//   * isSeedRequest: ヘッダ x-cinelearn-seed が env CL_SEED_SECRET と一致するか。両辺を sha256 ダイジェスト化してから
//     timingSafeEqual（常に32バイト同士＝長さ差で落ちない）。env 未設定・ヘッダ欠落・非文字列は比較せず false。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { createHash, timingSafeEqual } from 'node:crypto';
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_TOKEN_CACHE_MAX, AUTH_TOKEN_TTL_MS } from './constants.js';

const tokenCache = new Map(); // sha256(token) → { uid, expiresAt(ms) }

function sha256Hex(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

// JWT の exp（秒）を ms で読む（署名検証はしない＝TTL の上限に使うだけ。検証は Supabase 側）。
function jwtExpMs(token) {
  try {
    const payload = String(token).split('.')[1] || '';
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const exp = Number(json?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

// Authorization ヘッダから Bearer トークンを取り出す（無ければ ''）。
export function bearerToken(req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(h).trim());
  return m ? m[1] : '';
}

// 戻り値: { uid: string|null, reason: 'ok'|'none'|'invalid'|'unavailable', cached?: true }
//   none        … Authorization 無し（匿名）
//   invalid     … Supabase が 400/401/403（失効・改竄）＝匿名扱い
//   unavailable … 通信失敗・5xx・応答不正＝匿名扱い（権限は付与しない。route は loginHint:false にする＝A28）
export async function resolveUserId(req, { fetchImpl = fetch, now = Date.now } = {}) {
  const token = bearerToken(req);
  if (!token) return { uid: null, reason: 'none' };
  const key = sha256Hex(token);
  const t = now();
  const hit = tokenCache.get(key);
  if (hit) {
    if (hit.expiresAt > t) return { uid: hit.uid, reason: 'ok', cached: true };
    tokenCache.delete(key);
  }
  let res;
  try {
    res = await fetchImpl(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { uid: null, reason: 'unavailable' };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) return { uid: null, reason: 'invalid' };
  if (!res.ok) return { uid: null, reason: 'unavailable' };
  let data;
  try {
    data = await res.json();
  } catch {
    return { uid: null, reason: 'unavailable' };
  }
  const uid = typeof data?.id === 'string' && data.id ? data.id : null;
  if (!uid) return { uid: null, reason: 'invalid' };

  // 成功応答のみキャッシュ。TTL は min(now+5分, JWT exp)。
  const exp = jwtExpMs(token);
  const expiresAt = Math.min(t + AUTH_TOKEN_TTL_MS, exp ?? Infinity);
  if (expiresAt > t) {
    if (tokenCache.size >= AUTH_TOKEN_CACHE_MAX) {
      const oldest = tokenCache.keys().next().value; // Map は挿入順＝先頭が最古
      tokenCache.delete(oldest);
    }
    tokenCache.set(key, { uid, expiresAt });
  }
  return { uid, reason: 'ok' };
}

// 管理者か（CL_ADMIN_USER_IDS にある uid）。カタログゲート・レート制限をスキップする用途。
export function isAdmin(uid, env = process.env) {
  if (!uid) return false;
  return String(env.CL_ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(uid);
}

// seed スクリプトからの呼び出しか（x-cinelearn-seed が CL_SEED_SECRET と一致）。
export function isSeedRequest(req, env = process.env) {
  const secret = env.CL_SEED_SECRET;
  const given = req.headers.get('x-cinelearn-seed');
  if (typeof secret !== 'string' || !secret || typeof given !== 'string' || !given) return false;
  // 両辺を sha256 で 32 バイトに揃えてから定数時間比較（長さが違っても timingSafeEqual が投げない）。
  const a = createHash('sha256').update(secret).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}

// テスト用（キャッシュの状態を跨がせない）。
export function _clearAuthCacheForTests() {
  tokenCache.clear();
}
