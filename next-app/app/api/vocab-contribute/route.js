// フェーズ1：ユーザーの都度生成（スーパーセット）を共有キャッシュへ自動追加する書き込みルート。
// クライアント（VocabScreen）が cache miss 時に生成したスーパーセットを POST する。
// サーバー側で品質ゲート（決定E：語数・drama例文に単語が含まれる・定義あり）を通してから
// service_role で upsert する。サーバー生成はタイムアウトの都合で行わず、ゲート＋書込のみ。
//
// セキュリティの割り切り（公開前）：クライアント提供データを信用するため、悪意ある投稿で
// ゲートを通る偽データは混入しうる。Origin制限＋品質ゲートで軽減し、汚染時は cache_version を
// 上げて再シードで復旧する。完全な汚染対策はサーバー生成（将来）が必要。

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';
// 書き込みは service_role（Vercel の next-app プロジェクト env に設定）。未設定なら no-op。
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1);
const MODEL = 'claude-haiku-4-5-20251001';
const MIN_WORDS = 20; // 品質ゲート下限
const MAX_WORDS = 300; // 異常データ防止

// next-app/lib の純粋関数を再利用（Next バンドラが解決・localStorage 非依存）。
import { exampleContainsWord } from '@/lib/subtitles';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 正規アプリ（next-app / cine-learn / localhost / 拡張）からの呼び出しのみ許可。
function allowedOrigin(req) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return true; // 同一オリジン fetch で origin 無しのことがある
  return (
    s.includes('cinelearn') ||
    s.includes('cine-learn') ||
    s.startsWith('http://localhost') ||
    s.startsWith('chrome-extension://')
  );
}

function coverageRange(words) {
  const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const idxs = words.map((w) => order.indexOf(String(w.level || '').toUpperCase())).filter((i) => i >= 0);
  if (!idxs.length) return { min: null, max: null };
  return { min: order[Math.min(...idxs)], max: order[Math.max(...idxs)] };
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (!SUPABASE_SERVICE_KEY) return json({ skipped: 'no-service-key' }); // 書込キー未設定＝no-op

  let body = {};
  try {
    body = await req.json();
  } catch {
    return json({ skipped: 'bad-json' });
  }

  const id = parseInt(body.tmdbId, 10);
  const words = Array.isArray(body.words) ? body.words : [];
  if (!id || !words.length || words.length > MAX_WORDS) return json({ skipped: 'bad-input' });

  const type = body.type;
  const s = Number(body.season) || (type === 'movie' ? 0 : 1);
  const e = Number(body.episode) || (type === 'movie' ? 0 : 1);
  const cacheKey = `v${CACHE_VERSION}:tmdb${id}:s${s}e${e}`;

  // 冪等：既に在れば上書きしない（良いキャッシュ／シードを守る）
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=cache_key&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, cache: 'no-store' }
    );
    const rows = JSON.parse(await r.text());
    if (Array.isArray(rows) && rows.length) return json({ skipped: 'exists' });
  } catch {
    /* 確認失敗時は続行（upsert は merge-duplicates なので安全） */
  }

  // 品質ゲート（決定E）：定義あり／drama は例文に単語が含まれる／plus は許容
  const clean = words.filter(
    (w) =>
      w &&
      typeof w.word === 'string' &&
      w.word.trim() &&
      w.definition &&
      (w.source === 'plus' || (w.example && exampleContainsWord(w.example, w.word)))
  );
  const dramaCount = clean.filter((w) => w.source === 'drama').length;
  if (clean.length < MIN_WORDS || dramaCount < 5) {
    return json({ skipped: 'gate', count: clean.length, drama: dramaCount });
  }

  // transient フラグ除去（example_ja_ok 等）
  const store = clean.map(({ example_ja_ok, ...w }) => w);
  const cov = coverageRange(store);

  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };

  try {
    // カタログにも作品を登録（ゲートoffでも将来のため）
    await fetch(`${SUPABASE_URL}/rest/v1/catalog?on_conflict=tmdb_id`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify([
        { tmdb_id: id, display_title: body.displayTitle || null, type: type || 'tv', enabled: true },
      ]),
    });

    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocab_cache?on_conflict=cache_key`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify([
        {
          cache_key: cacheKey,
          cache_version: CACHE_VERSION,
          tmdb_id: id,
          season: s,
          episode: e,
          display_title: body.displayTitle || null,
          words: store,
          word_count: store.length,
          coverage_min: cov.min,
          coverage_max: cov.max,
          subtitle_provider: 'opensubtitles(auto)',
          model: MODEL,
          updated_at: new Date().toISOString(),
        },
      ]),
    });
    if (!res.ok) return json({ error: 'write-failed', status: res.status });
  } catch (err) {
    return json({ error: 'exception', message: String(err) });
  }

  return json({ written: true, count: store.length });
}
