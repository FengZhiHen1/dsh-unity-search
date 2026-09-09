// Keenable 引擎（双形态）：无 key 走公共 MCP 端点（JSON-RPC tools/call），有 key 走 REST /v1/search。
// 端点与抽取锚点来源 = dsh-free-search v0.4.24 实测代码 + 设计文档端点契约。
// @ts-check

import { httpRequest } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { engineConfig } from '../config.js'
import { parseTimeRange } from '../time.js'

const MCP_ENDPOINT = 'https://api.keenable.ai/mcp'
const REST_ENDPOINT = 'https://api.keenable.ai/v1/search'

/**
 * days → keenable 相对时长词汇（12h/Nh/Nd/Nmo/Ny）。
 * @param {number} days
 * @returns {string}
 */
export function formatKeenableRelative(days) {
  if (days <= 0.5) return '12h'
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.max(1, Math.round(days / 30))}mo`
  return `${Math.max(1, Math.round(days / 365))}y`
}

/**
 * 从 keenable MCP 文本抽取里解析 Title/URL/Published/Snippets 块。
 * @param {string} text
 * @returns {import('../types.js').SourceItem[]}
 */
export function extractKeenableSources(text) {
  /** @type {import('../types.js').SourceItem[]} */
  const items = []
  for (const block of text.split(/\n(?=Title:)/)) {
    const title = /^Title: (.+)$/m.exec(block)?.[1]
    const url = /^URL: (\S+)$/m.exec(block)?.[1]
    if (!url) continue
    const published = /^Published: (.+)$/m.exec(block)?.[1] ?? /^Acquired: (.+)$/m.exec(block)?.[1]
    const snippetLines = []
    const marker = block.indexOf('Snippets:')
    if (marker >= 0) {
      for (const line of block.slice(marker + 9).split('\n').slice(0, 6)) {
        const t = line.trim()
        if (t.length === 0 || t === '...') continue
        snippetLines.push(t)
        if (snippetLines.length >= 3) break
      }
    }
    items.push({
      title: title ? cleanSnippet(title, 200) : null,
      url: url.trim(),
      snippet: snippetLines.length > 0 ? cleanSnippet(snippetLines.join(' ')) : null,
      publishedAt: published && /^\d{4}-\d{2}-\d{2}/.test(published) ? published.trim() : null,
      sourceIds: {},
      extra: { textExtract: true },
    })
  }
  return items
}

/**
 * timeRange → keenable published_after 值（绝对 ISO 日期截断 / 相对词汇 / undefined）。
 * @param {import('../types.js').SearchRequest} request
 * @returns {string | undefined}
 */
function publishedAfter(request) {
  if (!request.timeRange) return undefined
  const parsed = parseTimeRange(request.timeRange)
  if (!parsed) return undefined
  if ('after' in parsed) return parsed.after.slice(0, 10)
  return formatKeenableRelative(parsed.days)
}

/** @type {import('../types.js').SourceAdapter} */
export const keenable = {
  id: 'keenable',
  family: 'web',
  supportsTimeRange: true,
  available(runtime) {
    // 双形态：无 key 也可用（公共 MCP 端点），enabled 即在线。
    return engineConfig(runtime, 'keenable').enabled
  },
  async search(request, runtime) {
    const cfg = engineConfig(runtime, 'keenable')
    const key = typeof cfg.apiKeyEnv === 'string' && cfg.apiKeyEnv.length > 0 ? runtime.resolveCredential(cfg.apiKeyEnv) : undefined
    return typeof key === 'string' && key.length > 0
      ? searchRest(request, runtime, key)
      : searchMcp(request, runtime)
  },
}

/**
 * 有 key：REST /v1/search。
 * @param {import('../types.js').SearchRequest} request
 * @param {import('../types.js').CoreRuntime} runtime
 * @param {string} key
 */
async function searchRest(request, runtime, key) {
  const started = runtime.now()
  /** @type {Record<string, unknown>} */
  const body = { query: request.query, mode: 'realtime' }
  const after = publishedAfter(request)
  if (after) body.published_after = after
  const result = await httpRequest(runtime, REST_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
    expect: 'json',
  })
  if (!result.ok) {
    const error = result.error.message.includes('401')
      ? { code: /** @type {const} */ ('http_4xx'), message: 'Keenable API key is invalid (HTTP 401)' }
      : result.error
    return { status: 'error', items: [], error, latencyMs: runtime.now() - started }
  }
  const data = /** @type {{ results?: Array<{ url?: unknown, title?: unknown, snippet?: unknown, description?: unknown, published_at?: unknown }> }} */ (result.json)
  /** @type {import('../types.js').SourceItem[]} */
  const items = []
  for (const row of data?.results ?? []) {
    if (typeof row.url !== 'string' || row.url.length === 0) continue
    const snippet = typeof row.snippet === 'string' ? row.snippet : typeof row.description === 'string' ? row.description : null
    items.push({
      title: typeof row.title === 'string' ? cleanSnippet(row.title, 200) : null,
      url: row.url,
      snippet: snippet ? cleanSnippet(snippet) : null,
      publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
      sourceIds: {},
      extra: {},
    })
  }
  return { status: 'ok', items: items.slice(0, request.maxResults ?? 10), latencyMs: runtime.now() - started }
}

/**
 * 无 key：公共 MCP JSON-RPC `tools/call → search_web_pages`；`result.isError` 为业务失败。
 * @param {import('../types.js').SearchRequest} request
 * @param {import('../types.js').CoreRuntime} runtime
 */
async function searchMcp(request, runtime) {
  const started = runtime.now()
  /** @type {Record<string, unknown>} */
  const args = { query: request.query }
  const after = publishedAfter(request)
  if (after) args.published_after = after
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: runtime.now(),
    method: 'tools/call',
    params: { name: 'search_web_pages', arguments: args },
  })
  const result = await httpRequest(runtime, MCP_ENDPOINT, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
    expect: 'json',
  })
  if (!result.ok) {
    return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
  }
  const data = /** @type {{ error?: { message?: string }, result?: { isError?: boolean, content?: Array<{ type?: string, text?: string }> } }} */ (result.json)
  if (data?.error) {
    return { status: 'error', items: [], error: { code: 'http_4xx', message: `Keenable MCP error: ${data.error.message ?? 'unknown'}` }, latencyMs: runtime.now() - started }
  }
  const texts = (Array.isArray(data?.result?.content) ? data.result.content : [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => /** @type {{ text: string }} */ (b).text)
    .join('\n')
  if (data?.result?.isError === true) {
    return { status: 'error', items: [], error: { code: 'http_4xx', message: `Keenable MCP business failure: ${texts.slice(0, 200) || 'no detail'}` }, latencyMs: runtime.now() - started }
  }
  const items = extractKeenableSources(texts)
  // 文本抽取较脆弱（设计文档标注）：零条目但确有文本时判 parse_failed，让链兜底走下一引擎。
  if (items.length === 0 && texts.trim().length > 0) {
    return { status: 'error', items: [], error: { code: 'parse_failed', message: 'Keenable MCP text did not contain parseable Title/URL blocks' }, latencyMs: runtime.now() - started }
  }
  return { status: 'ok', items: items.slice(0, request.maxResults ?? 10), latencyMs: runtime.now() - started }
}
