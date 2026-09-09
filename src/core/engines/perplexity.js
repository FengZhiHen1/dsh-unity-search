// Perplexity 引擎（key）：chat/completions（sonar），答案 + citations。契约来源 = dsh-free-search v0.4.24 实测代码。
// citations 可能仅 URL 数组：items 允许缺 title/snippet（设计文档明确）。
// @ts-check

import { httpRequest } from '../http.js'
import { engineConfig, keyAvailable } from '../config.js'

const ENDPOINT = 'https://api.perplexity.ai/chat/completions'

/** @type {import('../types.js').SourceAdapter} */
export const perplexity = {
  id: 'perplexity',
  family: 'web',
  supportsTimeRange: false,
  available(runtime) {
    const cfg = engineConfig(runtime, 'perplexity')
    return cfg.enabled && keyAvailable(cfg.apiKeyEnv, runtime)
  },
  async search(request, runtime) {
    const started = runtime.now()
    const cfg = engineConfig(runtime, 'perplexity')
    const key = runtime.resolveCredential(cfg.apiKeyEnv ?? '')
    if (!key) {
      return { status: 'error', items: [], error: { code: 'unavailable', message: `Perplexity credential (${cfg.apiKeyEnv ?? 'unset'}) not configured` }, latencyMs: 0 }
    }
    const body = {
      model: 'sonar',
      max_tokens: 1024,
      messages: [{ role: 'user', content: request.query }],
    }
    const result = await httpRequest(runtime, ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      redirect: 'error',
      expect: 'json',
    })
    if (!result.ok) {
      const error = result.error.message.includes('401')
        ? { code: /** @type {const} */ ('http_4xx'), message: 'Perplexity API key is invalid (HTTP 401)' }
        : result.error
      return { status: 'error', items: [], error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ choices?: Array<{ message?: { content?: string } }>, citations?: string[] }} */ (result.json)
    const answer = typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : ''
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const url of Array.isArray(data?.citations) ? data.citations : []) {
      if (typeof url !== 'string' || url.length === 0) continue
      items.push({
        title: null,
        url,
        // citations 无自带摘要：以答案开头作 snippet（同 free-search 契约），extra 标注来源形态。
        snippet: answer.length > 0 ? `${answer.slice(0, 200)}${answer.length > 200 ? '…' : ''}` : null,
        publishedAt: null,
        sourceIds: {},
        extra: { citationOnly: true },
      })
    }
    return { status: 'ok', items, answer: answer.length > 0 ? answer : undefined, latencyMs: runtime.now() - started }
  },
}
