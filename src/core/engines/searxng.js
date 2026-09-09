// SearXNG 引擎：公共实例列表逐实例 failover。端点契约来源 = dsh-free-search v0.4.24 实测代码。
// 实例列表来自 settings（engines.searxng.instances）；空列表 = 不启用（设计文档明确默认空）。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { engineConfig } from '../config.js'
import { parseTimeRange, approximateRange } from '../time.js'

/** 单实例请求预算（毫秒）：公共实例稳定性不一，短预算 + 逐实例轮换优于单点死等。 */
const PER_INSTANCE_MS = 8000

/**
 * @param {import('../types.js').CoreRuntime} runtime
 * @returns {{ id: 'searxng', family: 'web', supportsTimeRange: true, available, search }}
 */
export function createSearxng() {
  return {
    id: 'searxng',
    family: 'web',
    supportsTimeRange: true,
    available(runtime) {
      const cfg = engineConfig(runtime, 'searxng')
      return cfg.enabled && Array.isArray(cfg.instances) && cfg.instances.length > 0
    },
    async search(request, runtime) {
      const started = runtime.now()
      const cfg = engineConfig(runtime, 'searxng')
      const instances = Array.isArray(cfg.instances) ? cfg.instances.filter((u) => typeof u === 'string' && u.length > 0) : []
      if (instances.length === 0) {
        return { status: 'error', items: [], error: { code: 'unavailable', message: 'searxng: no instances configured' }, latencyMs: 0 }
      }
      /** @type {string[]} */
      const errors = []
      for (const instance of instances) {
        const params = new URLSearchParams({ q: request.query, format: 'json' })
        if (request.timeRange) {
          const parsed = parseTimeRange(request.timeRange)
          if (parsed) {
            const days = 'days' in parsed ? parsed.days : Math.max(1, Math.round((runtime.now() - Date.parse(parsed.after)) / 86400000))
            params.set('time_range', approximateRange(days))
          }
        }
        let url
        try {
          url = new URL(`search?${params.toString()}`, instance.endsWith('/') ? instance : `${instance}/`).toString()
        } catch {
          errors.push(`${instance}: invalid instance URL`)
          continue
        }
        const result = await httpRequest(runtime, url, {
          timeoutMs: Math.min(PER_INSTANCE_MS, runtime.config.chain?.timeoutMs ?? 15000),
          maxBytes: MAX_SEARCH_BYTES,
          headers: { accept: 'application/json' },
          expect: 'json',
        })
        if (!result.ok) {
          errors.push(`${new URL(instance).host}: ${result.error.code} ${result.error.message}`)
          continue
        }
        const data = /** @type {{ results?: Array<{ url?: unknown, title?: unknown, content?: unknown, publishedDate?: unknown }> }} */ (result.json)
        const rows = Array.isArray(data?.results) ? data.results : []
        /** @type {import('../types.js').SourceItem[]} */
        const items = []
        for (const row of rows) {
          if (typeof row.url !== 'string' || row.url.length === 0) continue
          items.push({
            title: typeof row.title === 'string' ? cleanSnippet(row.title, 200) : null,
            url: row.url,
            snippet: typeof row.content === 'string' ? cleanSnippet(row.content) : null,
            publishedAt: typeof row.publishedDate === 'string' ? row.publishedDate : null,
            sourceIds: {},
            extra: {},
          })
        }
        if (items.length === 0) {
          errors.push(`${new URL(instance).host}: 0 results`)
          continue
        }
        return { status: 'ok', items: items.slice(0, request.maxResults ?? 10), latencyMs: runtime.now() - started }
      }
      return { status: 'error', items: [], error: { code: 'network', message: `all SearXNG instances failed: ${errors.join(' | ').slice(0, 300)}` }, latencyMs: runtime.now() - started }
    },
  }
}

/** 缺省单例（无状态，配置经 runtime 注入，工厂形态仅为与其他适配器一致的可测性）。 */
export const searxng = createSearxng()
