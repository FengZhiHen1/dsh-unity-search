// Reddit 搜索（old.reddit JSON 接口，无需登录）。UA 按 Reddit API 规范附联系方式占位。
// 端点契约 = 设计文档「平台源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES, USER_AGENT } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'
import { parseTimeRange } from '../time.js'

const ENDPOINT = 'https://old.reddit.com/search.json'

/** @type {import('../types.js').SourceAdapter} */
export const reddit = {
  id: 'reddit',
  family: 'platform',
  supportsTimeRange: true,
  available(runtime) {
    return sourceConfig(runtime, 'reddit').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({ q: request.query, limit: String(Math.min(request.maxResults ?? 10, 50)), sort: 'relevance' })
    if (request.timeRange) {
      const parsed = parseTimeRange(request.timeRange)
      if (parsed) params.set('t', 'day') // 粗粒度兜底（t 仅支持固定窗口，无法精确对齐 timeRange）。
      // 注：t=day 与 timeRange 语义偏差记入 uncertainty。
    }
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: {
        accept: 'application/json',
        'user-agent': runtime.contact ? `${USER_AGENT} (contact: ${runtime.contact})` : USER_AGENT,
      },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ data?: { children?: unknown[] } } | { error?: number, message?: string }} */ (result.json)
    if (!Array.isArray(data?.data?.children)) {
      const message = /** @type {{ error?: unknown, message?: unknown }} */ (data)
      return { status: 'error', items: [], error: { code: 'parse_failed', message: typeof message?.message === 'string' ? `Reddit: ${message.message}` : 'Reddit response has no data.children' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const child of data.data.children) {
      const post = /** @type {{ data?: Record<string, unknown> }} */ (child).data
      if (!post || typeof post.permalink !== 'string') continue
      items.push({
        title: typeof post.title === 'string' ? cleanSnippet(post.title, 200) : null,
        url: `https://old.reddit.com${post.permalink}`,
        snippet: typeof post.selftext === 'string' && post.selftext.trim().length > 0 ? cleanSnippet(post.selftext) : null,
        publishedAt: typeof post.created_utc === 'number' ? new Date(post.created_utc * 1000).toISOString() : null,
        sourceIds: {},
        extra: {
          subreddit: typeof post.subreddit === 'string' ? post.subreddit : null,
          score: typeof post.score === 'number' ? post.score : null,
          numComments: typeof post.num_comments === 'number' ? post.num_comments : null,
        },
      })
    }
    const uncertainty = request.timeRange ? ['Reddit t=day 粗粒度窗口，与 timeRange 请求语义不精确对齐'] : []
    return { status: 'ok', items: items.slice(0, request.maxResults ?? 10), uncertainty, latencyMs: runtime.now() - started }
  },
}
