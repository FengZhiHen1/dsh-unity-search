// Tavily 引擎（key）：POST /search，Bearer 认证。契约来源 = dsh-free-search v0.4.24 实测代码 + 设计文档。
// @ts-check

import { httpRequest } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { engineConfig, keyAvailable } from '../config.js'
import { parseTimeRange, approximateRange } from '../time.js'

const ENDPOINT = 'https://api.tavily.com/search'

/** @type {import('../types.js').SourceAdapter} */
export const tavily = {
  id: 'tavily',
  family: 'web',
  supportsTimeRange: true,
  available(runtime) {
    const cfg = engineConfig(runtime, 'tavily')
    return cfg.enabled && keyAvailable(cfg.apiKeyEnv, runtime)
  },
  async search(request, runtime) {
    const started = runtime.now()
    const cfg = engineConfig(runtime, 'tavily')
    const key = runtime.resolveCredential(cfg.apiKeyEnv ?? '')
    if (!key) {
      return { status: 'error', items: [], error: { code: 'unavailable', message: `Tavily credential (${cfg.apiKeyEnv ?? 'unset'}) not configured` }, latencyMs: 0 }
    }
    /** @type {Record<string, unknown>} */
    const body = {
      query: request.query,
      max_results: Math.min(request.maxResults ?? 5, 20),
      search_depth: 'basic',
    }
    if (request.timeRange) {
      const parsed = parseTimeRange(request.timeRange)
      if (parsed) body.time_range = approximateRange('days' in parsed ? parsed.days : 365)
    }
    const result = await httpRequest(runtime, ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` },
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      redirect: 'error',
      expect: 'json',
    })
    if (!result.ok) {
      const error = result.error.code === 'http_4xx' && result.error.message.includes('401')
        ? { code: /** @type {const} */ ('http_4xx'), message: 'Tavily API key is invalid (HTTP 401)' }
        : result.error
      return { status: 'error', items: [], error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ answer?: string, results?: Array<{ url?: unknown, title?: unknown, content?: unknown, published_date?: unknown }> }} */ (result.json)
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of data?.results ?? []) {
      if (typeof row.url !== 'string' || row.url.length === 0) continue
      items.push({
        title: typeof row.title === 'string' ? cleanSnippet(row.title, 200) : null,
        url: row.url,
        snippet: typeof row.content === 'string' ? cleanSnippet(row.content) : null,
        publishedAt: typeof row.published_date === 'string' ? row.published_date : null,
        sourceIds: {},
        extra: {},
      })
    }
    const answer = typeof data?.answer === 'string' && data.answer.length > 0 ? data.answer : undefined
    return { status: 'ok', items, answer, latencyMs: runtime.now() - started }
  },
}
