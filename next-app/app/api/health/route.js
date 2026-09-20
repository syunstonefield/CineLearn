// 死活確認（§3・A8）。外部の監視サービス（UptimeRobot 等の keyword 監視 "ok":true）から叩く前提。
//   無認証応答は { ok:true, at } だけ＝Supabase/Upstash を叩かない（Upstash のコマンド枠を監視で消費しない・
//   env の有無や OS 残枠を偵察させない）。
//   x-cinelearn-seed が一致するときだけ詳細（env の真偽値・Supabase 到達・OS 残枠・キャッシュ版）を返す。
//   詳細は 60 秒モジュールキャッシュ（温かいインスタンス内）。秘密値は絶対に返さない。

export const dynamic = 'force-dynamic';

import { isSeedRequest } from '@/lib/server/auth';
import { readOsQuotaLast } from '@/lib/server/opensubtitles';
import { sbSelect } from '@/lib/server/vocabCache';
import { VOCAB_CACHE_VERSION } from '@/lib/server/constants';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 「設定されているか」だけを返す env 名（値は返さない）。
const ENV_NAMES = [
  'ANTHROPIC_API_KEY',
  'OPENSUBTITLES_API_KEY',
  'OPENSUBTITLES_USERNAME',
  'OPENSUBTITLES_PASSWORD',
  'TMDB_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'CRON_SECRET',
  'CL_SEED_SECRET',
  'CL_HASH_PEPPER',
  'CL_EXTENSION_IDS',
  'CL_EXTENSION_ID_ENFORCE',
  'CATALOG_GATE_ENABLED',
  'AZURE_TRANSLATOR_KEY',
];

let detailCache = { at: 0, value: null };
const DETAIL_TTL_MS = 60_000;

async function buildDetail() {
  const env = {};
  for (const k of ENV_NAMES) env[k] = !!process.env[k];
  // anon で catalog を1行だけ読む（GRANT SELECT 済みの公開テーブル・個人データではない）
  const cat = await sbSelect('catalog?select=tmdb_id&limit=1');
  const osQuota = await readOsQuotaLast();
  return { env, supabase: cat.ok, osQuota, vocabCacheVersion: VOCAB_CACHE_VERSION };
}

export async function GET(req) {
  const base = { ok: true, at: new Date().toISOString() };
  if (!isSeedRequest(req)) return json(base);
  const now = Date.now();
  if (!detailCache.value || now - detailCache.at > DETAIL_TTL_MS) {
    try {
      detailCache = { at: now, value: await buildDetail() };
    } catch (err) {
      console.warn('[CL:HEALTH] detail failed', String(err?.message || err));
      return json({ ...base, detail: null });
    }
  }
  return json({ ...base, ...detailCache.value });
}
