// 作品リクエスト（厳選カタログ戦略 §3・docs/design-curated-catalog.md）。
// カタログ外の作品に対する「リクエスト受付中」の投票を受け付け、票数と対応予定を返す。
//   action:'status'  → { votes, requested, planned }
//   action:'request' → 1端末1票で upsert → { ok, votes, requested:true }
// 「対応予定」= catalog テーブルに enabled=false の行がある作品（スキーマ追加なしの規約。
// enabled=true になった時点でカタログ入り＝既存の /api/vocab ゲートが通すようになる）。
// catalog_requests は service_role 専用（SUPABASE_SERVICE_ROLE_KEY 未設定なら
// votes:null で degrade し、UI は票数なしでリクエスト導線だけ出す）。

export const dynamic = 'force-dynamic';

import { checkRateLimit } from '@/lib/ratelimit';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 正規アプリからの呼び出しのみ許可（/api/example と同じ・空 Origin は拒否）。
const ALLOWED_HOSTS = ['cinelearn-next.vercel.app', 'cine-learn.vercel.app'];
function allowedOrigin(req) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return false;
  if (s.startsWith('chrome-extension://')) return true;
  try {
    const u = new URL(s);
    const selfHost = req.headers.get('host') || '';
    if (selfHost && u.host === selfHost) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function svcHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...extra,
  };
}

// 票数（service key 無し・失敗は null＝UI は票数非表示で degrade）
async function countVotes(id) {
  if (!SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/catalog_requests?tmdb_id=eq.${id}&select=tmdb_id`,
      { headers: svcHeaders({ Prefer: 'count=exact', Range: '0-0' }), cache: 'no-store' }
    );
    const range = res.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

// 対応予定（catalog に enabled=false の行）。service key 無しなら false。
async function isPlanned(id) {
  if (!SUPABASE_SERVICE_KEY) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/catalog?tmdb_id=eq.${id}&select=enabled&limit=1`,
      { headers: svcHeaders(), cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    return Array.isArray(rows) && rows[0] ? rows[0].enabled === false : false;
  } catch {
    return false;
  }
}

async function hasRequested(id, userKey) {
  if (!SUPABASE_SERVICE_KEY || !userKey) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/catalog_requests?tmdb_id=eq.${id}&user_key=eq.${encodeURIComponent(userKey)}&select=tmdb_id&limit=1`,
      { headers: svcHeaders(), cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (!(await checkRateLimit(req, 'catalog', { perMin: 20, perHour: 120 })).ok) {
    return json({ error: 'rate_limited' }, 429);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const id = parseInt(body.tmdbId, 10);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad id' }, 400);
  const userKey = String(body.userKey || '').slice(0, 64);

  if (body.action === 'status') {
    const [votes, planned, requested] = await Promise.all([
      countVotes(id),
      isPlanned(id),
      hasRequested(id, userKey),
    ]);
    return json({ votes, planned, requested });
  }

  if (body.action === 'request') {
    if (!userKey) return json({ error: 'bad request' }, 400);
    if (!SUPABASE_SERVICE_KEY) return json({ ok: false, votes: null }); // 未設定環境は受付不可（UIは静かに諦める）
    const title = String(body.title || '').slice(0, 200);
    const type = body.type === 'movie' ? 'movie' : 'tv';
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/catalog_requests?on_conflict=tmdb_id,user_key`,
        {
          method: 'POST',
          headers: svcHeaders({
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          }),
          cache: 'no-store',
          body: JSON.stringify([{ tmdb_id: id, user_key: userKey, title, type }]),
        }
      );
      if (!res.ok) {
        console.error('[catalog-request] write failed', res.status);
        return json({ ok: false }, 500);
      }
      const votes = await countVotes(id);
      return json({ ok: true, votes, requested: true });
    } catch (err) {
      console.error('[catalog-request] exception', String(err));
      return json({ ok: false }, 500);
    }
  }

  return json({ error: 'invalid action' }, 400);
}
