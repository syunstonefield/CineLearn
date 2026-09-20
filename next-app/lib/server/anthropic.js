// Anthropic Messages API の in-process クライアント（§1・A1）。api.anthropic.com 直（SDK 依存なし＝seed からも同じ経路）。
//   * model は constants.js の HAIKU_MODEL 1定数に集約（7箇所に散っていた直書きの同期漏れを断つ）。
//   * 時間予算: deadlineAt（route が now+240s で配る）を fetch の AbortSignal.timeout に写す。
//   * 再試行（429/529/5xx/ネットワーク）は固定待ちでなく「残予算が直前コール所要時間の1.2倍以上あるとき1回だけ」。
//     ＝Vercel の関数上限内で終わらない再試行はしない（A1）。
//   * 失敗は UpstreamError: 'timeout'（予算超過/中断）・'llm'（非2xx・応答不正）・'misconfigured'（鍵なし）。
//   * ログにプロンプト・応答本文を出さない（A20）。所要 ms・出力トークン数・stop_reason・文字数のみ。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

import { HAIKU_MODEL, GENERATE_DEADLINE_MS, UpstreamError } from './constants.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const RETRY_PAUSE_MAX_MS = 2000; // 再試行前の短い間（過負荷の回復待ち・残予算内に収める）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryableStatus(status) {
  return status === 429 || status === 529 || status >= 500;
}

// callHaiku(prompt, maxTokens, opts) → 応答テキスト（text ブロック連結）
//   opts.deadlineAt … ms epoch。無ければ now+GENERATE_DEADLINE_MS
//   opts.onRetry(attempt, waitSec) … 再試行時の通知（UI 文言用・任意）
//   opts.model / opts.apiKey / opts.fetchImpl / opts.log … 注入（テスト用）
export async function callHaiku(prompt, maxTokens, opts = {}) {
  const {
    deadlineAt,
    onRetry = null,
    model = HAIKU_MODEL,
    apiKey = process.env.ANTHROPIC_API_KEY,
    fetchImpl = fetch,
    log = console,
    label = '',
  } = opts;
  if (!apiKey) throw new UpstreamError('misconfigured');
  const deadline = Number.isFinite(deadlineAt) ? deadlineAt : Date.now() + GENERATE_DEADLINE_MS;
  const tag = label ? `[CL:LLM ${label}]` : '[CL:LLM]';

  let attempt = 0;
  for (;;) {
    const budget = deadline - Date.now();
    if (budget < 1000) throw new UpstreamError('timeout');
    const t0 = Date.now();
    let res = null;
    let netErr = null;
    try {
      res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        log.warn?.(`${tag} timeout after ${Date.now() - t0}ms (attempt ${attempt + 1})`);
        throw new UpstreamError('timeout', { cause: err });
      }
      netErr = err; // ネットワーク層の失敗＝5xx と同じ規則で1回だけ再試行
    }
    const took = Date.now() - t0;

    if (res && res.ok) {
      let data;
      try {
        data = await res.json();
      } catch (err) {
        throw new UpstreamError('llm', { status: res.status, cause: err });
      }
      const text = (Array.isArray(data?.content) ? data.content : [])
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');
      log.info?.(
        `${tag} ok ${took}ms in=${data?.usage?.input_tokens ?? '?'} out=${data?.usage?.output_tokens ?? '?'} stop=${data?.stop_reason ?? '?'} len=${text.length}`
      );
      return text;
    }

    const status = res ? res.status : 0;
    const remaining = deadline - Date.now();
    const retryable = !res || isRetryableStatus(status);
    // A1: 残予算が直前コール所要時間の 1.2 倍（＋再試行前の間）以上あるときだけ、1回だけ引き直す。
    const needed = Math.ceil(took * 1.2) + RETRY_PAUSE_MAX_MS;
    if (retryable && attempt === 0 && remaining >= needed) {
      attempt++;
      const pause = Math.min(RETRY_PAUSE_MAX_MS, Math.max(0, remaining - Math.ceil(took * 1.2)));
      log.warn?.(`${tag} status=${status || 'network'} took=${took}ms → retry once (remaining ${remaining}ms, pause ${pause}ms)`);
      onRetry?.(1, Math.round(pause / 1000));
      await sleep(pause);
      continue;
    }
    log.warn?.(`${tag} failed status=${status || 'network'} took=${took}ms attempt=${attempt + 1}${netErr ? ' (network)' : ''}`);
    throw new UpstreamError('llm', { status: status || undefined, cause: netErr || undefined });
  }
}
