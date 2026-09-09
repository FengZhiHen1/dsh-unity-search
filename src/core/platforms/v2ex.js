// V2EX 非真搜索：拉当期热榜本地过滤（覆盖面有限，条目 uncertainty 恒定标注——设计文档硬约束）。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'

const ENDPOINT = 'https://www.v2ex.com/api/topics/hot.json'

/**
 * 热榜条目本地过滤（title/content 含 query，大小写不敏感）。
 * @param {unknown[]} topics
 * @param {string} query
 * @param {number} maxResults
 * @returns {import('../types.js').SourceItem[]}
 */
export function filterHotTopics(topics, query, maxResults) {
  const q = query.toLowerCase()
  /** @type {import('../types.js').SourceItem[]} */
  const items = []
  for (const row of topics) {
    const t = /** @type {Record<string, unknown>} */ (row)
    const title = typeof t.title === 'string' ? t.title : null
    const content = typeof t.content === 'string' ? t.content : ''
    if (!title) continue
    if (!title.toLowerCase().includes(q) && !content.toLowerCase().includes(q)) continue
    const id = typeof t.id === 'number' || typeof t.id === 'string' ? String(t.id) : null
    if (!id) continue
    items.push({
      title: cleanSnippet(title, 200),
      url: `https://www.v2ex.com/t/${id}`,
      snippet: content ? cleanSnippet(content, 300) : null,
      publishedAt: typeof t.created === 'number' ? new Date(t.created * 1000).toISOString() : null,
      sourceIds: {},
      extra: { replies: typeof t.replies === 'number' ? t.replies : null, member: typeof t.member === 'object' && t.member ? /** @type {{username?: string}} */ (t.member).username ?? null : null },
    })
    if (items.length >= maxResults) break
  }
  return items
}

/** @type {import('../types.js').SourceAdapter} */
export const v2ex = {
  id: 'v2ex',
  family: 'platform',
  uncertainty: ['V2EX 仅当期热榜本地过滤，非真搜索，覆盖面有限'],
  available(runtime) {
    return sourceConfig(runtime, 'v2ex').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const result = await httpRequest(runtime, ENDPOINT, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: { accept: 'application/json' },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    if (!Array.isArray(result.json)) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'V2EX hot.json response is not an array' }, latencyMs: runtime.now() - started }
    }
    return { status: 'ok', items: filterHotTopics(result.json, request.query, request.maxResults ?? 10), latencyMs: runtime.now() - started }
  },
}
