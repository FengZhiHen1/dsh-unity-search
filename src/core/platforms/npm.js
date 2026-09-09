// npm registry 搜索（官方 /-/v1/search）。端点契约 = 设计文档「平台源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'

const ENDPOINT = 'https://registry.npmjs.com/-/v1/search'

/** @type {import('../types.js').SourceAdapter} */
export const npm = {
  id: 'npm',
  family: 'platform',
  available(runtime) {
    return sourceConfig(runtime, 'npm').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({ text: request.query, size: String(Math.min(request.maxResults ?? 10, 50)) })
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: { accept: 'application/json' },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ objects?: unknown[] }} */ (result.json)
    if (!Array.isArray(data?.objects)) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'npm search response has no objects array' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of data.objects) {
      const pkg = /** @type {Record<string, unknown>} */ (/** @type {{ package?: unknown }} */ (row).package ?? row)
      if (typeof pkg.name !== 'string') continue
      const links = /** @type {{ npm?: unknown } | undefined} */ (pkg.links)
      const description = typeof pkg.description === 'string' ? pkg.description : ''
      items.push({
        title: pkg.name,
        url: typeof links?.npm === 'string' ? links.npm : `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`,
        snippet: cleanSnippet(`v${String(pkg.version ?? '?')} — ${description}`),
        publishedAt: typeof pkg.date === 'string' ? pkg.date : null,
        sourceIds: {},
        extra: {
          version: typeof pkg.version === 'string' ? pkg.version : null,
          date: typeof pkg.date === 'string' ? pkg.date : null,
          scope: pkg.name.startsWith('@') ? pkg.name.slice(1).split('/')[0] : null,
        },
      })
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
