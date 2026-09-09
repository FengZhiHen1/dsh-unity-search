// DuckDuckGo HTML 引擎：解析锚点来源 = dsh-free-search v0.4.24 运行中代码（契约参考，代码不搬）。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet, extractRealUrl } from '../parse.js'
import { engineConfig } from '../config.js'
import { parseTimeRange, approximateRange } from '../time.js'

const ENDPOINT = 'https://html.duckduckgo.com/html/'

/** ddg df 参数取值（day|week|month|year → d|w|m|y，近似档映射）。 */
const DF = /** @type {const} */ ({ day: 'd', week: 'w', month: 'm', year: 'y' })

/**
 * @param {string} html
 * @returns {import('../types.js').SourceItem[]}
 */
function parseResults(html) {
  /** @type {import('../types.js').SourceItem[]} */
  const items = []
  for (const block of html.matchAll(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g)) {
    const chunk = block[0]
    const href = /<a[^>]*class="result__a"[^>]*href="([^"]*)"/.exec(chunk)
    const url = extractRealUrl(href?.[1])
    if (!url) continue
    const title = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)
    const snippet = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)
    const date = /<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/.exec(chunk)
    items.push({
      title: title && title[1] ? cleanSnippet(title[1], 200) : null,
      url,
      snippet: snippet && snippet[1] ? cleanSnippet(snippet[1]) : null,
      publishedAt: date && date[1] && /Y|M|d/.test(date[1]) ? date[1].trim() : null,
      sourceIds: {},
      extra: {},
    })
  }
  return items
}

/**
 * DDG 反爬判定（202 或页面含机器人校验关键词——free-search 已趟平的信号）。
 * @param {Response | null} _response 保留签名位（httpRequest 已归一状态码，故此处只看 body）。
 * @param {string} html
 * @returns {boolean}
 */
function isAntiBot(_response, html) {
  return /anomaly|captcha|unusual traffic|robot check/i.test(html.slice(0, 4000))
}

/** @type {import('../types.js').SourceAdapter} */
export const ddg = {
  id: 'ddg',
  family: 'web',
  supportsTimeRange: true,
  available(runtime) {
    return engineConfig(runtime, 'ddg').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({ q: request.query })
    if (request.timeRange) {
      const parsed = parseTimeRange(request.timeRange)
      if (parsed && 'days' in parsed) params.set('df', DF[approximateRange(parsed.days)])
      else if (parsed) params.set('df', DF.year)
    }
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    if (isAntiBot(null, result.body)) {
      return { status: 'error', items: [], error: { code: 'rate_limited', message: 'DuckDuckGo anti-bot challenge (usually temporary)' }, latencyMs: runtime.now() - started }
    }
    const items = parseResults(result.body).slice(0, request.maxResults ?? 10)
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
