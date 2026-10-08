// 【一時】単語生成のモデル比較（2026-10-08・段階2・比較後にこのファイルごと削除）。
//   本番と同じ generateEpisodeVocab を、モデル/思考設定だけ差し替えて1話ぶん走らせ、語リストとトークン使用量を返す。
//   vocab_cache には書かない（route 側の writeVocabRow を呼ばない）。字幕は通常どおり raw cache→OS。
//   合言葉ヘッダ x-cl-eval の sha256 一致時のみ動く（公開リポジトリにはハッシュのみ）。IP 日次20回の天井。

export const dynamic = 'force-dynamic';

import { createHash } from 'crypto';
import { checkRateLimit } from '@/lib/ratelimit';
import { allowedOrigin } from '@/lib/server/origin';
import { callHaiku } from '@/lib/server/anthropic';
import { generateEpisodeVocab } from '@/lib/server/vocabGen';
import { HAIKU_MODEL, TRANSLATE_MODEL } from '@/lib/server/constants';

const EVAL_TOKEN_SHA256 = 'cd8d9e58ed3db59f1189bceae0973682b6b840d8a11bcf32fdb3749532e99e4e';

const VARIANTS = {
  A_45: { model: HAIKU_MODEL },
  C_55_off: { model: TRANSLATE_MODEL, extra: { thinking: { type: 'disabled' } } },
  D_55_low: { model: TRANSLATE_MODEL, extra: { output_config: { effort: 'low' } }, thinkRoom: 8000 },
};

const json = (body, status = 200) => Response.json(body, { status });

export async function POST(req) {
  if (!allowedOrigin(req)) return json({ error: 'forbidden' }, 403);
  const tok = String(req.headers.get('x-cl-eval') || '');
  if (createHash('sha256').update(tok).digest('hex') !== EVAL_TOKEN_SHA256) return json({ error: 'forbidden' }, 403);
  if (!(await checkRateLimit(req, 'vocabeval', { perMin: 10, perHour: 20, perDay: 20 })).ok) {
    return json({ error: 'rate_limited' }, 429);
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const v = VARIANTS[body?.variant];
  if (!v) return json({ error: 'bad variant' }, 400);

  const calls = [];
  const raws = []; // 応答の冒頭（短い応答＝生成失敗の診断用）
  const callLlm = async (prompt, maxTokens, o = {}) => {
    const text = await callHaiku(prompt, Math.min(64000, maxTokens + (v.thinkRoom || 0)), {
      deadlineAt: o.deadlineAt,
      model: v.model,
      extra: v.extra,
      label: `eval ${body.variant} chunk ${o.chunk}/${o.nChunks}`,
      onUsage: (u, stop) => calls.push({ in: u?.input_tokens, out: u?.output_tokens, stop, maxTokens }),
    });
    raws.push(text.slice(0, 600));
    return text;
  };
  try {
    const r = await generateEpisodeVocab(
      { tmdbId: body.tmdbId, type: body.type, season: body.season, episode: body.episode, promptV: body.promptV === 2 ? 2 : 1 },
      { callLlm }
    );
    if (r.nosub) return json({ nosub: true });
    return json({
      variant: body.variant,
      promptV: body.promptV === 2 ? 2 : 1,
      model: v.model,
      title: r.englishTitle,
      reason: r.reason,
      wordCount: r.wordCount,
      clean: r.storeWords.length,
      dramaCount: r.dramaCount,
      chunks: r.chunks,
      elapsedMs: r.elapsedMs,
      calls,
      words: r.words.map((w) => ({ word: w.word, level: w.level, def: w.definition, ex: w.example, src: w.source })),
    });
  } catch (err) {
    return json({ error: String(err?.message || err).slice(0, 200), calls, raws }, 502);
  }
}
