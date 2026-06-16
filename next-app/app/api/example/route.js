// 経路②→①畳み込み（#3）増分2：クリック語に OpenSubtitles の例文1文を補完する読み取りルート。
// 拡張のクリック保存は「単語のみ」を即保存し、本ルートが非同期で例文を埋める（バックフィル）。
// 配信（Netflix/Amazon）の字幕テキストは一切受け取らない・保存しない。返すのは特定した1文のみ。
//
// 層1: vocab_cache（生成済みスーパーセット）の語一致 → その語の example を返す（OS ダウンロード0）。
// 層2: subtitle_raw_cache（生 SRT・30条の4・非配信・TTL）→ 無ければ OpenSubtitles から1回 DL して保存。
//       生 SRT から「クリック語を含む1文」を findExampleForWord で特定して返す（32条 引用）。
//
// 設計: docs/route-fold-in-design.md ／ 法的整合: public-launch-legal-posture。

export const dynamic = 'force-dynamic';

import { tmdb, searchSubtitles, downloadSubtitle } from '@/lib/api';
import {
  getWordVariants,
  exampleContainsWord,
  selectSubtitleCandidates,
  findExampleForWord,
} from '@/lib/subtitles';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';
// subtitle_raw_cache は非配信＝anon GRANT 無し。読み書きは service_role のみ（未設定なら層2はライブ DL で動くがキャッシュは効かない）。
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// 生成ロジックの版。/api/vocab・シードと一致させること（cache_key の v{n}）。
const CACHE_VERSION = Number(process.env.VOCAB_CACHE_VERSION || 1);

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

// タイトル文字列 → TMDB ID（拡張は ID を持たないためここで解決）。失敗・曖昧は null。
async function resolveTmdbId(title, isMovie) {
  try {
    const data = await tmdb(
      isMovie ? { action: 'search_movie', query: title } : { action: 'search', query: title }
    );
    return data?.results?.[0]?.id || null;
  } catch {
    return null;
  }
}

// vocab_cache を anon で読む（公開読み）。
async function readVocabWords(cacheKey) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/vocab_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=words&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    return Array.isArray(rows) && rows[0] && Array.isArray(rows[0].words) ? rows[0].words : null;
  } catch {
    return null;
  }
}

// subtitle_raw_cache（service_role 専用）。失効行は無視。
async function readRawCache(key) {
  if (!SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/subtitle_raw_cache?cache_key=eq.${encodeURIComponent(key)}&select=raw,expires_at&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }, cache: 'no-store' }
    );
    const rows = JSON.parse(await res.text());
    const row = Array.isArray(rows) && rows[0];
    if (!row || !row.raw) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null; // TTL 失効
    return row.raw;
  } catch {
    return null;
  }
}

function writeRawCache(key, id, s, e, raw) {
  if (!SUPABASE_SERVICE_KEY) return;
  // fire-and-forget（バックフィル経路なので待たない）
  fetch(`${SUPABASE_URL}/rest/v1/subtitle_raw_cache?on_conflict=cache_key`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    cache: 'no-store',
    body: JSON.stringify([
      {
        cache_key: key,
        tmdb_id: id,
        season: s,
        episode: e,
        raw,
        provider: 'opensubtitles',
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]),
  }).catch(() => {});
}

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ found: false, error: 'forbidden' }, 403);

  let body = {};
  try {
    body = await req.json();
  } catch {
    return json({ found: false });
  }

  const word = String(body.word || '').trim();
  const title = String(body.title || '').trim();
  if (!word || !title) return json({ found: false });

  // S/E がある＝TV、無い＝映画扱い（拡張の getEpisodeContext は映画/未検出で season=null）。
  const hasSE =
    body.season != null && body.season !== '' && body.episode != null && body.episode !== '';
  const isMovie = !hasSE;
  const type = isMovie ? 'movie' : 'tv';
  const s = hasSE ? Number(body.season) : 0;
  const e = hasSE ? Number(body.episode) : 0;

  const id = await resolveTmdbId(title, isMovie);
  if (!id) return json({ found: false }); // TMDB 未解決 → 拡張は bare のまま

  // ── 層1: vocab_cache の語一致（無料）──
  const cacheKey = `v${CACHE_VERSION}:tmdb${id}:s${s}e${e}`;
  const cached = await readVocabWords(cacheKey);
  if (cached) {
    const variants = getWordVariants(word);
    let pick = cached.find(
      (w) =>
        w &&
        w.word &&
        variants.has(String(w.word).toLowerCase()) &&
        w.example &&
        exampleContainsWord(w.example, word)
    );
    if (!pick) pick = cached.find((w) => w && w.example && exampleContainsWord(w.example, word));
    if (pick) {
      return json({
        found: true,
        sentence: pick.example,
        source: 'opensubtitles',
        tmdbId: id,
        season: s,
        episode: e,
        tsSec: pick.tsSec ?? null,
        tsLabel: pick.tsLabel ?? null,
        via: 'vocab_cache',
      });
    }
  }

  // ── 層2: 生 SRT（raw cache → 無ければ OS から1回 DL）──
  const rawKey = `tmdb${id}:s${s}e${e}`;
  let raw = await readRawCache(rawKey);
  if (!raw) {
    try {
      const results = await searchSubtitles(title, s, e, type, id);
      const sorted = selectSubtitleCandidates(results || [], isMovie, s, e);
      const fileId = sorted?.[0]?.attributes?.files?.[0]?.file_id;
      if (!fileId) return json({ found: false });
      raw = await downloadSubtitle(fileId);
      if (raw) writeRawCache(rawKey, id, s, e, raw);
    } catch {
      return json({ found: false }); // OS 不調・字幕なし → bare
    }
  }

  const near = Number(body.currentTimeSec);
  const hit = findExampleForWord(raw, word, isFinite(near) ? near : undefined);
  if (!hit) return json({ found: false }); // OS に該当行なし → bare

  return json({
    found: true,
    sentence: hit.sentence,
    source: 'opensubtitles',
    tmdbId: id,
    season: s,
    episode: e,
    tsSec: hit.sec,
    tsLabel: hit.label,
    via: 'raw',
  });
}
