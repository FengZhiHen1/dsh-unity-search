// Exa 引擎（key）：REST /search（auto 类型 + highlights）。契约来源 = dsh-free-search v0.4.24 实测代码。
// 设计文档标注 exa 仅 key 认证；keyless MCP 通道（mcp.exa.ai）不是一期契约面（DSR-002 修订记录未含）。
// @ts-check

import { httpRequest } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { engineConfig, keyAvailable } from '../config.js'
import { parseTimeRange, isoDaysAgo } from '../time.js'

const ENDPOINT = 'https://api.exa.ai/search'

/** @type {import('../types.js').SourceAdapter} */
export const exa = {
  id: 'exa',
  family: 'web',
  supportsTimeRange: true,
  available(runtime) {
    const cfg = engineConfig(runtime, 'exa')
    return cfg.enabled && keyAvailable(cfg.apiKeyEnv, runtime)
  },
  async search(request, runtime) {
    const started = runtime.now()
    const cfg = engineConfig(runtime, 'exa')
    const key = runtime.resolveCredential(cfg.apiKeyEnv ?? '')
    if (!key) {
      return { status: 'error', items: [], error: { code: 'unavailable', message: `Exa credential (${cfg.apiKeyEnv ?? 'unset'}) not configured` }, latencyMs: 0 }
    }
    /** @type {Record<string, unknown>} */
    const body = {
      query: request.query,
      type: 'auto',
      contents: { highlights: { highlightsPerUrl: 1 } },
    }
    if (typeof request.maxResults === 'number' && request.maxResults > 0) body.numResults = request.maxResults
    if (request.timeRange) {
      const parsed = parseTimeRange(request.timeRange)
      if (parsed) body.startPublishedDate = 'after' in parsed ? parsed.after : isoDaysAgo(parsed.days, runtime.now)
    }
    const result = await httpRequest(runtime, ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      redirect: 'error',
      expect: 'json',
    })
    if (!result.ok) {
      const error = result.error.message.includes('401')
        ? { code: /** @type {const} */ ('http_4xx'), message: 'Exa API key is invalid (HTTP 401)' }
        : result.error
      return { status: 'error', items: [], error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ results?: Array<{ url?: unknown, title?: unknown, highlights?: string[], publishedDate?: unknown }> }} */ (result.json)
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of data?.results ?? []) {
      if (typeof row.url !== 'string' || row.url.length === 0) continue
      const highlight = Array.isArray(row.highlights) ? row.highlights.find((h) => typeof h === 'string' && h.trim().length > 0) : undefined
      items.push({
        title: typeof row.title === 'string' ? cleanSnippet(row.title, 200) : null,
        url: row.url,
        snippet: highlight ? cleanSnippet(highlight) : null,
        publishedAt: typeof row.publishedDate === 'string' ? row.publishedDate : null,
        sourceIds: {},
        extra: {},
      })
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
