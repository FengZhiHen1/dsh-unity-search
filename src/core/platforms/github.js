// GitHub 仓库搜索 API（匿名 60 req/h；可选 token 提额）。端点契约 = 设计文档「平台源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig, keyAvailable } from '../config.js'

const ENDPOINT = 'https://api.github.com/search/repositories'

/** @type {import('../types.js').SourceAdapter} */
export const github = {
  id: 'github',
  family: 'platform',
  available(runtime) {
    return sourceConfig(runtime, 'github').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const cfg = sourceConfig(runtime, 'github')
    const token = cfg.apiKeyEnv ? runtime.resolveCredential(cfg.apiKeyEnv) : undefined
    const params = new URLSearchParams({ q: request.query, per_page: String(Math.min(request.maxResults ?? 10, 30)) })
    /** @type {Record<string,string>} */
    const headers = { accept: 'application/vnd.github+json' }
    if (typeof token === 'string' && token.length > 0) headers.authorization = `Bearer ${token}`
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers,
      expect: 'json',
    })
    if (!result.ok) {
      const error = result.error.code === 'rate_limited'
        ? { code: /** @type {const} */ ('rate_limited'), message: `${result.error.message}${keyAvailable(cfg.apiKeyEnv, runtime) ? '' : '（匿名配额 60 req/h，可配置 token 提额）'}` }
        : result.error
      return { status: 'error', items: [], error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ items?: unknown[] }} */ (result.json)
    if (!Array.isArray(data?.items)) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'GitHub response has no items array' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of data.items) {
      const r = /** @type {Record<string, unknown>} */ (row)
      const fullName = typeof r.full_name === 'string' ? r.full_name : null
      if (!fullName || typeof r.html_url !== 'string') continue
      const snippetParts = [typeof r.description === 'string' ? r.description : null]
      if (typeof r.stargazers_count === 'number') snippetParts.push(`⭐ ${r.stargazers_count}`)
      items.push({
        title: fullName,
        url: r.html_url,
        snippet: cleanSnippet(snippetParts.filter(Boolean).join(' · ')),
        publishedAt: typeof r.updated_at === 'string' ? r.updated_at : null,
        sourceIds: { repository: fullName.toLowerCase() },
        extra: {
          stars: typeof r.stargazers_count === 'number' ? r.stargazers_count : null,
          language: typeof r.language === 'string' ? r.language : null,
          updatedAt: typeof r.updated_at === 'string' ? r.updated_at : null,
        },
      })
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
