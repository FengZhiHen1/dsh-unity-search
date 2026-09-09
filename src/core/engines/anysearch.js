// AnySearch 引擎：免 key AI 搜索（JSON 问答式）。端点契约来源 = dsh-free-search v0.4.24 实测代码。
// 响应字段级契约（answer 位置）为文档 missing-evidence 项，活体实跑回填（docs/ 待办清单）。
// @ts-check

import { httpRequest } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { engineConfig } from '../config.js'

const ENDPOINT = 'https://api.anysearch.com/v1/search'

/** @type {import('../types.js').SourceAdapter} */
export const anysearch = {
  id: 'anysearch',
  family: 'web',
  available(runtime) {
    return engineConfig(runtime, 'anysearch').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const body = JSON.stringify({ query: request.query, max_results: request.maxResults ?? 5 })
    const result = await httpRequest(runtime, ENDPOINT, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const payload = /** @type {{ code?: number, message?: string, data?: { answer?: string, results?: unknown } }} */ (result.json)
    if (typeof payload?.code === 'number' && payload.code !== 0) {
      return { status: 'error', items: [], error: { code: 'http_4xx', message: `AnySearch business error: ${payload.message ?? `code ${payload.code}`}` }, latencyMs: runtime.now() - started }
    }
    const rows = Array.isArray(payload?.data?.results) ? payload.data.results : []
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of rows) {
      const r = /** @type {{ url?: unknown, title?: unknown, snippet?: unknown }} */ (row)
      if (typeof r.url !== 'string' || r.url.length === 0) continue
      items.push({
        title: typeof r.title === 'string' ? cleanSnippet(r.title, 200) : null,
        url: r.url,
        snippet: typeof r.snippet === 'string' ? cleanSnippet(r.snippet) : null,
        publishedAt: null,
        sourceIds: {},
        extra: {},
      })
    }
    const answer = typeof payload?.data?.answer === 'string' && payload.data.answer.length > 0 ? payload.data.answer : undefined
    return { status: 'ok', items, answer, latencyMs: runtime.now() - started }
  },
}
