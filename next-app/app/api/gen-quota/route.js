// 新しい単語リストを作る前の確認用（2026-10-09 オーナー要望）:
//   「この話は共有の単語リストにあるか」と「今月の新規生成の残り回数」を返す。
//   ある＝枠を使わない（そのまま作る）／無い＝作る前に「今月の枠を1回使います・残り○回」と確認を出す。
//   ベータ中は止めない（beta:true）が、回数と正式版の上限は見せる＝後から「知らなかった」とならないように。
// GET /api/gen-quota?tmdbId=&type=tv|movie&season=&episode=
import { allowedOrigin } from '@/lib/server/origin';
import { resolveUserId } from '@/lib/server/auth';
import { redisGet, tryRedis } from '@/lib/server/upstash';
import { normalizeEpisode, vocabCacheKey, readVocabRow } from '@/lib/server/vocabCache';
import { resolvePlan } from '@/lib/server/plan';
import { GEN_MONTH_LIMITS, genMonthKey } from '@/lib/server/constants';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function GET(req) {
  if (!allowedOrigin(req)) return json({ ok: false, error: 'forbidden' }, 403);
  const u = new URL(req.url);
  const id = posInt(u.searchParams.get('tmdbId'));
  if (!id) return json({ ok: false, error: 'tmdbId is required' }, 400);
  const type = u.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
  const n = normalizeEpisode(type, u.searchParams.get('season'), u.searchParams.get('episode'));
  const cacheKey = vocabCacheKey(id, n.type, n.season, n.episode);
  if (!cacheKey) return json({ ok: false, error: 'bad request' }, 400);

  const cached = await readVocabRow(cacheKey);
  if (!cached.ok) return json({ ok: false, error: 'unavailable' }, 503);
  const { uid } = await resolveUserId(req);
  const plan = await resolvePlan(req);
  const limit = plan.isPro && !plan.beta ? GEN_MONTH_LIMITS.plus : GEN_MONTH_LIMITS.free;
  const used = uid ? Number(await tryRedis(() => redisGet(genMonthKey(uid)), null)) || 0 : 0;
  return json({
    ok: true,
    cached: !!cached.row,
    loggedIn: !!uid,
    beta: !!plan.beta,
    plus: !!plan.isPro && !plan.beta,
    used,
    limit, // ベータ中は「正式版の無料プランの上限」（表示用）
    remaining: Math.max(0, limit - used),
  });
}
