// Hacker News（Algolia 镜像；search_by_date 变体承接 timeRange≈相对时长）。
// 端点契约 = 设计文档「平台源」节（timeRange 标不支持，但 Algolia 支持 numericFilters created_at_i——
// 按能力实现 supportsTimeRange=true，活体回填见 docs/ 待办清单）。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'
import { parseTimeRange } from '../time.js'

const ENDPOINT = 'https://hn.algolia.com/api/v1/search'

/** @type {import('../types.js').SourceAdapter} */
export const hn = {
  id: 'hn',
  family: 'platform',
  supportsTimeRange: true,
  uncertainty: ['HN 索引为 Algolia 镜像，略滞后于主站'],
  available(runtime) {
    return sourceConfig(runtime, 'hn').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({ query: request.query, hitsPerPage: String(Math.min(request.maxResults ?? 10, 30)) })
    if (request.timeRange) {
      const parsed = parseTimeRange(request.timeRange)
      if (parsed) {
        const fromSec = 'days' in parsed
          ? Math.floor((runtime.now() - parsed.days * 86400000) / 1000)
          : Math.floor(Date.parse(parsed.after) / 1000)
        params.set('numericFilters', `created_at_i>${fromSec}`)
      }
    }
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: { accept: 'application/json' },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ hits?: unknown[] }} */ (result.json)
    if (!Array.isArray(data?.hits)) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'HN Algolia response has no hits array' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of data.hits) {
      const h = /** @type {Record<string, unknown>} */ (row)
      const title = typeof h.title === 'string' ? h.title : typeof h.story_title === 'string' ? h.story_title : null
      if (!title || typeof h.objectID !== 'string') continue
      items.push({
        title: cleanSnippet(title, 200),
        url: typeof h.url === 'string' && h.url.length > 0 ? h.url : `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: cleanSnippet(`HN · ${String(h.points ?? 0)} points · ${String(h.num_comments ?? 0)} comments`),
        publishedAt: typeof h.created_at === 'string' ? h.created_at : null,
        sourceIds: {},
        extra: {
          itemId: h.objectID,
          points: typeof h.points === 'number' ? h.points : null,
          numComments: typeof h.num_comments === 'number' ? h.num_comments : null,
          discussionUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
        },
      })
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
