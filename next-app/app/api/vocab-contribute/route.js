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
import { checkRateLimit } from '@/lib/ratelimit';
import { createHash } from 'crypto';

// 投稿元の記録（2026-09-12）。汚染行を見つけたときに「同じ投稿元の行だけ」消せるよう、IP のハッシュと
// 時刻を行に残す（生 IP は保存しない）。列は supabase_vocab_cache_provenance.sql で後付け。
// 列がまだ無い DB では PostgREST が PGRST204 で行ごと弾くため、1回だけ列を外して再送する
// （my_words.ts_sec と同じ流儀＝SQL 実行前後どちらの順でデプロイしても寄与が壊れない）。
let _provenanceUnsupported = false;
function contributorHash(req) {
  const xff = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  const ip = String(xff).split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(`cl-contrib:${ip}`).digest('hex').slice(0, 16);
}
function isMissingColumn(status, text) {
  return status === 400 && /PGRST204|contributed_(by|at)/.test(text || '');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// 正規アプリ（next-app / cine-learn / localhost / 拡張）からの呼び出しのみ許可。
//   このルートを叩くのは next-app ブラウザの同一オリジン POST（VocabScreen の contributeVocab）と
//   Node シード（CINELEARN_API_ORIGIN を明示付与）のみ。いずれも Origin か Referer が必ず付く＝
//   空 Origin の正規経路は無いので空は拒否する。Origin 詐称は可能なので主防御にはしない（決定3）。
const ALLOWED_HOSTS = ['cinelearn-next.vercel.app', 'cine-learn.vercel.app']; // 本番ホスト完全一致
function allowedOrigin(req) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return false; // 空 Origin の正規経路は無い（ブラウザ/シードは必ず付与する）
  if (s.startsWith('chrome-extension://')) return true; // 拡張（ID 限定は公開後 TODO）
  try {
    const u = new URL(s);
    const selfHost = req.headers.get('host') || '';
    if (selfHost && u.host === selfHost) return true; // 同一オリジン（LAN IP実機/各デプロイURL）
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true; // 開発
    return ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false; // パース不能な Origin/Referer は拒否
  }
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
  // 正規利用は「1話の生成につき1回」。人気話のキーを先取りして偽データを置く『土地取り』の速度を
  // 落とす（2026-09-12・台帳「/api/vocab-contribute が無認証・無レート制限」への対応①）。
  if (!(await checkRateLimit(req, 'contribute', { perMin: 3, perHour: 20, perDay: 50 })).ok) {
    return json({ skipped: 'rate_limited' }, 429);
  }

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
  // 映画は常に s0e0（/api/vocab と同じ正規化・シード/例文層1とキーを揃える）
  const s = type === 'movie' ? 0 : Number(body.season) || 1;
  const e = type === 'movie' ? 0 : Number(body.episode) || 1;
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
    // 弾いた生成は共有されず、次のユーザーがまた ¥7 払う。理由をログに残して多い順に潰す（費用対策③）
    console.warn('[vocab-contribute] gate rejected', cacheKey, { received: words.length, clean: clean.length, drama: dramaCount });
    return json({ skipped: 'gate', count: clean.length, drama: dramaCount });
  }

  // 時間カバレッジのゲート（2026-08-08）。分割生成の1チャンクが落ちると作品の前半/後半が
  // 丸ごと欠けたスーパーセットが出来る。既存行は上書きしない運用なので、一度入ると
  // その作品は全ユーザーに対して永久に壊れる（アイアンマン＝前半57分欠落の実害）。
  // クライアント側にも同じ検査を置いたが、旧版アプリ・別経路からの投稿を通さないため
  // サーバー側でも塞ぐ。📍が薄いデータは従来どおり通す（判定不能で止めない）。
  const ts = clean.map((w) => w.tsSec).filter((s) => typeof s === 'number' && isFinite(s));
  if (ts.length >= 10) {
    const sorted = [...ts].sort((a, b) => a - b);
    const span = sorted[sorted.length - 1] - sorted[0];
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
    // 尺は不明なので「最後の語」を尺の代理にする。序盤が総尺の25%以降からしか無い、
    // または30分の空白がある＝1チャンク分が欠けている疑いが濃い。
    if (span > 1200 && (sorted[0] > sorted[sorted.length - 1] * 0.25 || maxGap > 1800)) {
      console.warn('[vocab-contribute] coverage rejected', cacheKey, { first: sorted[0], last: sorted[sorted.length - 1], maxGap });
      return json({ skipped: 'coverage', first: sorted[0], last: sorted[sorted.length - 1], maxGap });
    }
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
    // カタログにも作品を登録（enabled:false＝手動昇格運用）。
    //   自動投稿はゲートを通る偽データが混入しうるため enabled:false で登録し、
    //   オーナーが内容を確認してから手動で enabled:true に昇格する。汚染データが
    //   全ユーザーへ配信される最悪ケースを断つ（3部討論の決定2）。
    await fetch(`${SUPABASE_URL}/rest/v1/catalog?on_conflict=tmdb_id`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify([
        { tmdb_id: id, display_title: body.displayTitle || null, type: type || 'tv', enabled: false },
      ]),
    });

    const row = {
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
    };
    if (!_provenanceUnsupported) {
      row.contributed_by = contributorHash(req);
      row.contributed_at = new Date().toISOString();
    }
    const post = () =>
      fetch(`${SUPABASE_URL}/rest/v1/vocab_cache?on_conflict=cache_key`, {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify([row]),
      });
    let res = await post();
    if (!res.ok && 'contributed_by' in row) {
      const text = await res.text().catch(() => '');
      if (isMissingColumn(res.status, text)) {
        // 列がまだ無い DB → 記録なしで再送（寄与そのものは止めない）
        _provenanceUnsupported = true;
        delete row.contributed_by;
        delete row.contributed_at;
        res = await post();
      }
    }
    // 内部（Supabase/service_role）の生ステータス・例外文はクライアントに返さない
    // （情報露出の遮断）。詳細はサーバーログにのみ残す。
    if (!res.ok) {
      console.error('[vocab-contribute] write failed', res.status);
      return json({ error: 'write-failed' }, 500);
    }
  } catch (err) {
    console.error('[vocab-contribute] exception', String(err));
    return json({ error: 'write-failed' }, 500);
  }

  return json({ written: true, count: store.length });
}
