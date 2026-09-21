// 保存語の和訳（単語の意味・例文の訳）を並列で後埋めする（2026-09-22・pending-fixes 🔴「直列翻訳ループ並列化」）。
//
// 旧実装（WordbookScreen の for ループ／words.js fillExtWordJa）は1語ずつ await で直列に叩いていた:
//   1語あたり最悪2往復（語義＋例文訳）× 1000語 ＝ 2000 直列 RTT ＝ 新端末での初回ログインが数分。
// ★で生成語も単語帳に入るようになり（オーナー判断 2026-09-22）語数が桁で増えるため、次の3点で解く:
//   ① 語義（ja 無しの語だけ）: fetchCtxJa → fetchJa を並列 CONCURRENCY_WORD 本。★で入れた語は
//      ja を持ち込むので、ここはほぼ走らない。
//   ② 例文訳（example_ja 無し）: /api/claude mode:'sentences' に10文ずつまとめて投げる
//      （サーバは共有キャッシュ命中分を無償で返し、tmdbId があれば vocab_cache の空欄も埋める）。
//      Azure 死亡中の /api/translate（毎回 null）はこの経路では叩かない。
//   ③ 順序は表示順＝先頭の語から結果が届く。①と②は独立した枠なので同時に走らせる。
// 結果は語ごとに save(word, patch) へ渡す（呼び出し側が saveWordTranslation で my_words に永続化）。
import { fetchCtxJa } from './ctxtranslate';
import { fetchJa, readSentenceCache, writeSentenceCacheMany } from './jatranslate';

const CONCURRENCY_WORD = 3; // 語義（wordsense・日次300の枠を1人で使い切らない範囲）
const CONCURRENCY_BATCH = 2; // 例文一括訳（10文/リクエスト）
const BATCH_SIZE = 10; // サーバ側上限（mode:'sentences' は ≤10）
const SENTENCE_MAX = 300; // サーバ側 SENT_MAX_CHARS と同じ

const hasJa = (w) => !!w.ja || (!!w.definition && /[぀-ヿ一-鿿]/.test(w.definition));
const sentenceOf = (w) => String(w.example || w.sentence || '').trim();

// 単純な並列ランナー（依存パッケージ無し）。順序どおりに取り出し、同時 n 本まで。
async function runPool(items, n, worker, isCancelled) {
  let i = 0;
  const lanes = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      if (isCancelled()) return;
      const item = items[i++];
      try {
        await worker(item);
      } catch {
        /* 1件の失敗は他に波及させない */
      }
    }
  });
  await Promise.all(lanes);
}

// 10文をまとめて訳す。戻り値: Map(原文 → 訳|null)。429 でも命中分は返る。
async function translateSentencesBatch(sentences, ctx) {
  const body = { mode: 'sentences', sentences };
  if (ctx?.tmdbId) Object.assign(body, { tmdbId: ctx.tmdbId, season: ctx.season, episode: ctx.episode, type: ctx.type });
  const out = new Map();
  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    const list = Array.isArray(data?.ja) ? data.ja : [];
    sentences.forEach((s, i) => out.set(s, list[i] || null));
    // 429（枠切れ）の未命中は端末に null を焼かない＝次に開いた時にまた試せる
    const rateLimited = res.status === 429;
    writeSentenceCacheMany(sentences.filter((s) => !rateLimited || out.get(s)).map((s) => [s, out.get(s)]));
  } catch {
    sentences.forEach((s) => out.set(s, null));
  }
  return out;
}

/**
 * @param words   表示順の保存語配列（word/ja/definition/example|sentence/example_ja …）
 * @param opts.save(word, patch)   永続化（saveWordTranslation）。patch は {ja?, example_ja?}
 * @param opts.onPatch(w, patch)   画面反映（任意）。呼ばれるのは値が取れた時だけ
 * @param opts.ctxFor(w)           例文一括訳に添える作品座標 {tmdbId, season, episode, type}|null（任意）
 * @param opts.isCancelled()       画面を離れた等で打ち切り（任意）
 * @returns 何か1つでも訳が付いたか
 */
export async function fillTranslations(words, opts = {}) {
  const save = opts.save || (async () => {});
  const onPatch = opts.onPatch || (() => {});
  const ctxFor = opts.ctxFor || (() => null);
  const isCancelled = opts.isCancelled || (() => false);
  const list = (words || []).filter((w) => w?.word);
  let changed = false;
  const apply = async (w, patch) => {
    if (isCancelled() || !Object.keys(patch).length) return;
    changed = true;
    onPatch(w, patch);
    await save(w.word, patch);
  };

  // ① 語義
  const needJa = list.filter((w) => !hasJa(w));
  const wordTask = runPool(
    needJa,
    CONCURRENCY_WORD,
    async (w) => {
      const sent = sentenceOf(w);
      const ja = (sent ? await fetchCtxJa(w.word, sent) : null) ?? (await fetchJa(w.word));
      if (ja) await apply(w, { ja });
    },
    isCancelled
  );

  // ② 例文訳（端末キャッシュ命中は即時・残りを作品ごとに10文ずつ）
  const needEx = list.filter((w) => !w.example_ja && sentenceOf(w) && sentenceOf(w).length <= SENTENCE_MAX);
  const pending = [];
  for (const w of needEx) {
    const s = sentenceOf(w);
    const hit = readSentenceCache(s);
    if (hit) await apply(w, { example_ja: hit });
    else if (hit === undefined) pending.push(w); // null(TTL内の失敗)は今回は触らない
  }
  const groups = new Map(); // ctxKey → [{w, s}]
  for (const w of pending) {
    const ctx = ctxFor(w);
    const key = ctx?.tmdbId ? `${ctx.tmdbId}|${ctx.season ?? ''}|${ctx.episode ?? ''}` : '';
    if (!groups.has(key)) groups.set(key, { ctx, items: [] });
    groups.get(key).items.push(w);
  }
  const batches = [];
  for (const { ctx, items } of groups.values()) {
    for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push({ ctx, items: items.slice(i, i + BATCH_SIZE) });
  }
  const batchTask = runPool(
    batches,
    CONCURRENCY_BATCH,
    async ({ ctx, items }) => {
      const sentences = [...new Set(items.map(sentenceOf))];
      const got = await translateSentencesBatch(sentences, ctx);
      for (const w of items) {
        const ja = got.get(sentenceOf(w));
        if (ja) await apply(w, { example_ja: ja });
      }
    },
    isCancelled
  );

  await Promise.all([wordTask, batchTask]);
  return changed;
}
