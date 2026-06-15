// 字幕パイプライン（検索候補選別・SRTパース・活用形・タイムスタンプ・LRU）。
// js/app.js から移植。localStorage キーは既存と完全同一。
import { searchSubtitles, downloadSubtitle } from './api';

// ── キャッシュキー ──────────────────────────────────────────
export function subtitleCacheKey(title, season, episode) {
  const safe = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `cl_sub_${safe}_s${season}e${episode}`;
}
export function subtitleRawCacheKey(title, season, episode) {
  const safe = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `cl_sub_raw_${safe}_s${season}e${episode}`;
}

// ── 字幕キャッシュ LRU 上限 ─────────────────────────────────
const SUB_LRU_KEY = 'cl_sub_lru';
const SUB_RAW_MAX = 10;
const SUB_PARSED_MAX = 20;

export function touchSubCache(...keys) {
  try {
    const lru = JSON.parse(localStorage.getItem(SUB_LRU_KEY) || '{}');
    keys.forEach((k) => {
      if (k) lru[k] = Date.now();
    });
    localStorage.setItem(SUB_LRU_KEY, JSON.stringify(lru));
  } catch {
    /* LRU記録の失敗は無視 */
  }
}

export function evictSubCaches() {
  try {
    const lru = JSON.parse(localStorage.getItem(SUB_LRU_KEY) || '{}');
    const rawKeys = [];
    const parsedKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k === SUB_LRU_KEY) continue;
      if (k.startsWith('cl_sub_raw_')) rawKeys.push(k);
      else if (k.startsWith('cl_sub_')) parsedKeys.push(k);
    }
    const evict = (keys, max) => {
      if (keys.length <= max) return;
      keys.sort((a, b) => (lru[a] || 0) - (lru[b] || 0));
      keys.slice(0, keys.length - max).forEach((k) => {
        localStorage.removeItem(k);
        delete lru[k];
      });
    };
    evict(rawKeys, SUB_RAW_MAX);
    evict(parsedKeys, SUB_PARSED_MAX);
    localStorage.setItem(SUB_LRU_KEY, JSON.stringify(lru));
  } catch {
    /* 失敗しても致命的ではない */
  }
}

// ── SRT パース ──────────────────────────────────────────────
export function parseSrt(srtText) {
  const lines = srtText.split('\n');
  const dialogues = [];
  let isDialogue = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      isDialogue = false;
    } else if (/-->/.test(trimmed)) {
      isDialogue = true;
    } else if (trimmed && isDialogue) {
      const clean = trimmed.replace(/<[^>]+>/g, '');
      if (clean) dialogues.push(clean);
    }
  }
  return dialogues.join(' ');
}

// ── 候補選別（全取得経路で共通） ────────────────────────────
export function selectSubtitleCandidates(subtitles, isMovie, season, episode) {
  if (!Array.isArray(subtitles) || !subtitles.length) return [];

  let candidates = subtitles;
  if (!isMovie) {
    const matched = subtitles.filter((s) => {
      const f = s.attributes.feature_details || {};
      return (
        Number(f.season_number) === Number(season) &&
        Number(f.episode_number) === Number(episode)
      );
    });
    if (matched.length) candidates = matched;
  }

  const rank = (sub) => {
    const attr = sub.attributes;
    const name = (attr.release || attr.files?.[0]?.file_name || '').toLowerCase();
    const featTitle = (
      attr.feature_details?.title ||
      attr.feature_details?.movie_name ||
      ''
    ).toLowerCase();
    if (
      /(making|behind.the.scenes|featurette|trailer|interview|documentary|deleted|bonus|extra|commentary|bloopers?|gag\s*reel|sample)/.test(
        name + ' ' + featTitle
      )
    )
      return 2;
    if (
      isMovie &&
      attr.feature_details?.feature_type &&
      attr.feature_details.feature_type !== 'Movie'
    )
      return 2;
    if (attr.hearing_impaired) return 1;
    if (/\b(hi|hearing|sdh|forced)\b/.test(name)) return 1;
    return 0;
  };
  return [...candidates].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.attributes.download_count || 0) - (a.attributes.download_count || 0)
  );
}

// ── 活用形バリアント ────────────────────────────────────────
const IRREGULAR_VERBS = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  say: ['says', 'said', 'saying'],
  get: ['gets', 'got', 'gotten', 'getting'],
  make: ['makes', 'made', 'making'],
  know: ['knows', 'knew', 'known', 'knowing'],
  think: ['thinks', 'thought', 'thinking'],
  take: ['takes', 'took', 'taken', 'taking'],
  see: ['sees', 'saw', 'seen', 'seeing'],
  come: ['comes', 'came', 'coming'],
  give: ['gives', 'gave', 'given', 'giving'],
  find: ['finds', 'found', 'finding'],
  tell: ['tells', 'told', 'telling'],
  feel: ['feels', 'felt', 'feeling'],
  keep: ['keeps', 'kept', 'keeping'],
  run: ['runs', 'ran', 'running'],
  leave: ['leaves', 'left', 'leaving'],
  hear: ['hears', 'heard', 'hearing'],
  let: ['lets', 'letting'],
  begin: ['begins', 'began', 'begun', 'beginning'],
  show: ['shows', 'showed', 'shown', 'showing'],
  lead: ['leads', 'led', 'leading'],
  mean: ['means', 'meant', 'meaning'],
  meet: ['meets', 'met', 'meeting'],
  lose: ['loses', 'lost', 'losing'],
  pay: ['pays', 'paid', 'paying'],
  sit: ['sits', 'sat', 'sitting'],
  stand: ['stands', 'stood', 'standing'],
  understand: ['understands', 'understood', 'understanding'],
  speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  write: ['writes', 'wrote', 'written', 'writing'],
  read: ['reads', 'reading'],
  bring: ['brings', 'brought', 'bringing'],
  buy: ['buys', 'bought', 'buying'],
  send: ['sends', 'sent', 'sending'],
  build: ['builds', 'built', 'building'],
  fall: ['falls', 'fell', 'fallen', 'falling'],
  hold: ['holds', 'held', 'holding'],
  spend: ['spends', 'spent', 'spending'],
  cut: ['cuts', 'cutting'],
  put: ['puts', 'putting'],
  set: ['sets', 'setting'],
  try: ['tries', 'tried', 'trying'],
  become: ['becomes', 'became', 'becoming'],
  happen: ['happens', 'happened', 'happening'],
  suppose: ['supposes', 'supposed', 'supposing'],
};

const IRREGULAR_REVERSE = {};
for (const [base, forms] of Object.entries(IRREGULAR_VERBS)) {
  for (const f of forms) IRREGULAR_REVERSE[f] = base;
}

export function getWordVariants(word) {
  const w = word.toLowerCase();
  const v = new Set([w]);

  if (IRREGULAR_VERBS[w]) IRREGULAR_VERBS[w].forEach((f) => v.add(f));
  if (IRREGULAR_REVERSE[w]) {
    const base = IRREGULAR_REVERSE[w];
    v.add(base);
    IRREGULAR_VERBS[base]?.forEach((f) => v.add(f));
  }

  function expandBase(base) {
    if (!base || base.length < 2) return;
    v.add(base);
    if (base.endsWith('e')) {
      v.add(base + 's');
      v.add(base.slice(0, -1) + 'ing');
      v.add(base.slice(0, -1) + 'ed');
    } else if (base.endsWith('y') && !/[aeiou]y$/.test(base)) {
      v.add(base.slice(0, -1) + 'ies');
      v.add(base.slice(0, -1) + 'ied');
      v.add(base + 'ing');
    } else {
      v.add(base + 's');
      v.add(base + 'ing');
      v.add(base + 'ed');
      v.add(base + 'd');
      if (/[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(base)) {
        v.add(base + base.slice(-1) + 'ing');
        v.add(base + base.slice(-1) + 'ed');
      }
    }
  }

  expandBase(w);

  if (w.endsWith('ing') && w.length > 5) {
    const stem = w.slice(0, -3);
    expandBase(stem + 'e');
    expandBase(stem);
    if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) {
      expandBase(stem.slice(0, -1));
    }
  }
  if (w.endsWith('ed') && w.length > 4) {
    const stem = w.slice(0, -2);
    expandBase(stem + 'e');
    expandBase(stem);
    if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) {
      expandBase(stem.slice(0, -1));
    }
  }
  if (w.endsWith('ies') && w.length > 4) expandBase(w.slice(0, -3) + 'y');
  if (w.endsWith('ied') && w.length > 4) expandBase(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 4) expandBase(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) expandBase(w.slice(0, -1));

  return v;
}

// 例文に単語（活用形含む）が含まれるか
export function exampleContainsWord(example, word) {
  const variants = getWordVariants(word);
  const exLower = example.toLowerCase();
  return [...variants].some((vv) => {
    const re = new RegExp(`\\b${vv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return re.test(exLower);
  });
}

function secToTimeLabel(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 生SRTを {sec, text} のキュー配列にして時刻昇順で返す（同一署名はキャッシュ）
let _cueCacheSig = '';
let _cueCacheArr = [];
function parseCues(raw, sig) {
  if (_cueCacheSig === sig) return _cueCacheArr;
  const cues = [];
  raw.split(/\r?\n\r?\n/).forEach((block) => {
    const lines = block.split(/\r?\n/);
    const tIdx = lines.findIndex((l) => /-->/.test(l));
    if (tIdx === -1) return;
    const mt = lines[tIdx].match(/(\d{2}):(\d{2}):(\d{2})/);
    if (!mt) return;
    const sec = +mt[1] * 3600 + +mt[2] * 60 + +mt[3];
    const text = lines
      .slice(tIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/[♪♫]/g, '')
      .replace(/[’'`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (text) cues.push({ sec, text });
  });
  cues.sort((a, b) => a.sec - b.sec);
  _cueCacheSig = sig;
  _cueCacheArr = cues;
  return cues;
}

// ── VOD実時刻補正（cl_vodsync_* アンカー）──────────────────
function fitVodSync(pairs) {
  if (!pairs.length) return null;
  const offsets = pairs.map((p) => p.vod - p.os).sort((x, y) => x - y);
  const medianOffset = { a: 1, b: offsets[Math.floor(offsets.length / 2)] };
  if (pairs.length < 2) return medianOffset;

  const xs = pairs.map((p) => p.os);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < 120) return medianOffset;

  const n = pairs.length;
  const sx = xs.reduce((s, x) => s + x, 0);
  const sy = pairs.reduce((s, p) => s + p.vod, 0);
  const sxx = pairs.reduce((s, p) => s + p.os * p.os, 0);
  const sxy = pairs.reduce((s, p) => s + p.os * p.vod, 0);
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - a * sx) / n;
  if (!isFinite(a) || a < 0.8 || a > 1.25) return medianOffset;
  return { a, b };
}

function computeVodSyncFit(cues, season, episode) {
  if (typeof localStorage === 'undefined') return null; // サーバー/Node には VOD アンカーが無い
  if (!cues.length) return null;
  const suffix = `_s${season}e${episode}`;
  const anchors = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('cl_vodsync_') || !k.endsWith(suffix)) continue;
    try {
      (JSON.parse(localStorage.getItem(k)) || []).forEach((a) => anchors.push(a));
    } catch {
      /* skip */
    }
  }
  if (!anchors.length) return null;

  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[’'`]/g, "'")
      .replace(/[^a-z0-9' ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const pairs = [];
  for (const a of anchors) {
    const words = norm(a.text).split(' ').filter((w) => w.length > 1);
    if (words.length < 3) continue;
    const key5 = words.slice(0, 5).join(' ');
    const key3 = words.slice(0, 3).join(' ');
    const c =
      cues.find((cc) => norm(cc.text).includes(key5)) ||
      cues.find((cc) => norm(cc.text).includes(key3));
    if (c) pairs.push({ os: c.sec, vod: a.t });
  }
  if (pairs.length) {
    const total = cues[cues.length - 1].sec || 1;
    const osv = pairs.map((p) => p.os);
    const minOs = Math.min(...osv);
    const maxOs = Math.max(...osv);
    const spread = (maxOs - minOs) / total;
    const trustworthy =
      (minOs < total * 0.35 && maxOs > total * 0.65) || spread > 0.5;
    if (!trustworthy) return null;
  }
  return fitVodSync(pairs);
}

// ── タイムスタンプ計算（公開API）────────────────────────────
// ctx = { title, season, episode, rawSrt }
// VOD同期フィットのキャッシュ（computeVodSyncFit は localStorage 全走査するため、
// 同一エピソード・同一字幕の間は再計算しない。既存 app.js の _syncFitSig 相当）。
let _fitCacheSig = '';
let _fitCache = null;
function buildTsContext(ctx) {
  const sig = subtitleRawCacheKey(ctx.title, ctx.season, ctx.episode) + ':' + (ctx.rawSrt || '').length;
  const cues = parseCues(ctx.rawSrt || '', sig);
  let fit;
  if (ctx.noVodSync) {
    fit = null; // ベース時刻のみ（保存用・サーバー用）
  } else if (_fitCacheSig === sig) {
    fit = _fitCache;
  } else {
    fit = cues.length ? computeVodSyncFit(cues, ctx.season, ctx.episode) : null;
    _fitCacheSig = sig;
    _fitCache = fit;
  }
  return { cues, fit };
}

function applyVodSync(fit, sec) {
  return fit ? Math.max(0, Math.round(fit.a * sec + fit.b)) : sec;
}

function findWordCueSec(cues, word) {
  if (!cues.length) return null;
  const res = word
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const variants = [...getWordVariants(tok)].map((v) =>
        v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      );
      return new RegExp(`\\b(${variants.join('|')})\\b`, 'i');
    });
  for (const c of cues) if (res.every((re) => re.test(c.text))) return c.sec;
  return null;
}

// 各単語に「ベース字幕時刻」を tsSec(数値|null)/tsLabel(文字列|null) として付与する（in-place）。
// VOD補正は per-user なので付けない（保存・サーバー用）。シード／フェーズ1寄与で使う。
export function attachBaseTimestamps(words, ctx) {
  const map = computeTimestamps(words, { ...ctx, noVodSync: true });
  for (const w of words) {
    const t = map.get(w.word);
    w.tsSec = t && t.sec !== Infinity ? t.sec : null;
    w.tsLabel = t ? t.label : null;
  }
  return words;
}

// 単語ごとの { sec(ソート用・補正済), label(📍表示) } を一括計算して Map で返す
export function computeTimestamps(words, ctx) {
  const map = new Map();
  if (!ctx?.rawSrt) {
    words.forEach((w) => map.set(w.word, { sec: Infinity, label: null }));
    return map;
  }
  const { cues, fit } = buildTsContext(ctx);
  words.forEach((w) => {
    if (map.has(w.word)) return;
    const raw = findWordCueSec(cues, w.word);
    if (raw == null) {
      map.set(w.word, { sec: Infinity, label: null });
    } else {
      const adj = applyVodSync(fit, raw);
      map.set(w.word, { sec: adj, label: secToTimeLabel(adj) });
    }
  });
  return map;
}

// ── 字幕取得（preloadSubtitle 相当・データのみ返す）─────────
// 戻り値: { parsed, raw, source } | null（字幕なし）
export async function fetchEpisodeSubtitle(drama, season, episode) {
  const searchTitle = drama.englishTitle || drama.title;
  const isMovie = drama.type === 'movie';
  const subtitles = await searchSubtitles(
    searchTitle,
    season,
    episode,
    isMovie ? 'movie' : 'tv',
    isMovie ? drama.tmdbId : null
  );
  const sorted = selectSubtitleCandidates(subtitles, isMovie, season, episode);
  if (!sorted.length) return null;

  let fileId = null;
  let srtText = null;
  for (const cand of sorted.slice(0, 3)) {
    const fid = cand.attributes.files[0].file_id;
    const text = await downloadSubtitle(fid);
    if (!text) continue;
    const musicRatio = (text.match(/♪/g) || []).length / (text.length / 100);
    if (musicRatio > 5) continue;
    fileId = fid;
    srtText = text;
    break;
  }
  if (!fileId) {
    fileId = sorted[0].attributes.files[0].file_id;
    srtText = await downloadSubtitle(fileId);
  }
  const parsed = parseSrt(srtText);

  // 永続キャッシュに保存（未割当単語のエピソード解決に使用）
  try {
    const title = drama.englishTitle || drama.title;
    const key = subtitleCacheKey(title, season, episode);
    const rawKey = subtitleRawCacheKey(title, season, episode);
    localStorage.setItem(key, parsed);
    localStorage.setItem(rawKey, srtText);
    touchSubCache(key, rawKey);
    evictSubCaches();
  } catch {
    /* QuotaExceeded は無視 */
  }
  return { parsed, raw: srtText, source: '実際の字幕データから' };
}

// 現在のエピソードの生SRTを localStorage から取得（タイムスタンプ用）
export function getCachedRawSrt(drama, season, episode) {
  const title = drama?.englishTitle || drama?.title;
  const rawKey = subtitleRawCacheKey(title, season, episode);
  const raw = localStorage.getItem(rawKey) || '';
  if (raw) touchSubCache(rawKey);
  return raw;
}

// 生SRTが未保存ならバックグラウンドで取得して保存する（既存 fetchRawSrtIfMissing）。
// 保存済み単語リストのタイムスタンプ（📍）補完に使う。戻り値: 取得した生SRT or null。
export async function fetchRawSrtIfMissing(drama, season, episode) {
  if (!drama || !season || !episode) return null;
  const title = drama.englishTitle || drama.title;
  const rawKey = subtitleRawCacheKey(title, season, episode);
  if (localStorage.getItem(rawKey)) return null; // すでにキャッシュ済み

  try {
    // 映画/TVの区別と候補選別を本取得（fetchEpisodeSubtitle）と同一にする
    const isMovie = drama.type === 'movie';
    const subtitles = await searchSubtitles(
      title,
      season,
      episode,
      isMovie ? 'movie' : 'tv',
      isMovie ? drama.tmdbId : null
    );
    const sorted = selectSubtitleCandidates(subtitles, isMovie, season, episode);
    if (!sorted.length) return null;
    const srtText = await downloadSubtitle(sorted[0].attributes.files[0].file_id);
    if (!srtText) return null;

    try {
      localStorage.setItem(rawKey, srtText);
      touchSubCache(rawKey);
      evictSubCaches();
    } catch {
      /* QuotaExceeded は無視 */
    }
    return srtText;
  } catch {
    return null;
  }
}
