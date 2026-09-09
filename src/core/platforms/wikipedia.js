// Wikipedia MediaWiki search API（language 来自 settings，默认 zh）。端点契约 = 设计文档「平台源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'

/** 语言码白名单式校验：仅小写字母/数字/连字符（防 host 注入）。 */
const LANG_RE = /^[a-z][a-z0-9-]{0,10}$/

/** @type {import('../types.js').SourceAdapter} */
export const wikipedia = {
  id: 'wikipedia',
  family: 'platform',
  available(runtime) {
    return sourceConfig(runtime, 'wikipedia').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const cfg = sourceConfig(runtime, 'wikipedia')
    const lang = typeof cfg.language === 'string' && LANG_RE.test(cfg.language) ? cfg.language : 'zh'
    const endpoint = `https://${lang}.wikipedia.org/w/api.php`
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: request.query,
      format: 'json',
      srlimit: String(Math.min(request.maxResults ?? 10, 50)),
    })
    const result = await httpRequest(runtime, `${endpoint}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: { accept: 'application/json' },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ query?: { search?: unknown[] } }} */ (result.json)
    if (!Array.isArray(data?.query?.search)) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'Wikipedia response has no query.search array' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of data.query.search) {
      const page = /** @type {Record<string, unknown>} */ (row)
      if (typeof page.title !== 'string') continue
      items.push({
        title: cleanSnippet(page.title, 200),
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        // srsnippet 含 <span class="searchmatch"> 高亮标记，cleanSnippet 剥除。
        snippet: typeof page.snippet === 'string' ? cleanSnippet(page.snippet, 300) : null,
        publishedAt: typeof page.timestamp === 'string' ? page.timestamp : null,
        sourceIds: {},
        extra: { pageid: typeof page.pageid === 'number' ? page.pageid : null, language: lang },
      })
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
