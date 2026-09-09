// bing 引擎：HTML 抓取。解析锚点来源 = dsh-free-search v0.4.24 运行中代码（契约参考，代码不搬）。
// timeRange 注：设计文档标注 filters=ex1:"ezN" 且登记为 missing evidence；本实现按 Bing 公开参数约定映射，
// 活体实跑回填前不视为已验证（docs/ 待办清单登记项）。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet, stripTags, decodeEntities } from '../parse.js'
import { engineConfig } from '../config.js'
import { parseTimeRange } from '../time.js'

const ENDPOINT = 'https://www.bing.com/search'

/** bing 日期档参数（ez1=24h / ez2=week / ez3=month；year 无对应档 → 不发参数）。 */
const BING_EZ = new Map([
  ['day', 'ez1'],
  ['week', 'ez2'],
  ['month', 'ez3'],
])

/**
 * @param {string} html
 * @returns {import('../types.js').SourceItem[]}
 */
function parseResults(html) {
  /** @type {import('../types.js').SourceItem[]} */
  const items = []
  for (const block of html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)) {
    const chunk = block[0]
    const href = /<a[^>]*href="(https?:\/\/[^"]+)"/.exec(chunk)
    if (!href || !href[1]) continue
    const titleMatch = /<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/.exec(chunk)
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/.exec(chunk)
    items.push({
      title: titleMatch && titleMatch[1] ? cleanSnippet(titleMatch[1], 200) : null,
      url: decodeEntities(href[1]),
      snippet: snippetMatch && snippetMatch[1] ? cleanSnippet(snippetMatch[1]) : null,
      publishedAt: null,
      sourceIds: {},
      extra: {},
    })
  }
  return items
}

/** @type {import('../types.js').SourceAdapter} */
export const bing = {
  id: 'bing',
  family: 'web',
  supportsTimeRange: true,
  available(runtime) {
    return engineConfig(runtime, 'bing').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({ q: request.query })
    if (typeof request.maxResults === 'number' && request.maxResults > 0) {
      params.set('count', String(Math.min(Math.round(request.maxResults), 50)))
    }
    if (request.timeRange) {
      const parsed = parseTimeRange(request.timeRange)
      const days = parsed && 'days' in parsed ? parsed.days : null
      const bucket = days === null ? null : days <= 2 ? 'day' : days <= 14 ? 'week' : days <= 90 ? 'month' : null
      const ez = bucket ? BING_EZ.get(bucket) : undefined
      if (ez) params.set('filters', `ex1:"${ez}"`)
    }
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const items = parseResults(result.body)
    if (items.length === 0) {
      // 结构探测：非空页但零 b_algo 块且含登录/反爬特征 → 解析失败而非空结果（区分上游改版与真无结果）。
      const antiBot = /Anomaly|captcha|unusual traffic/i.test(result.body.slice(0, 4000))
      if (antiBot) {
        return { status: 'error', items: [], error: { code: 'rate_limited', message: 'bing anti-bot challenge' }, latencyMs: runtime.now() - started }
      }
      if (result.body.includes('b_algo')) {
        // 有结果块标记却解析为空：锚点漂移信号。
        return { status: 'error', items: [], error: { code: 'parse_failed', message: 'bing layout matched but no b_algo item parsed' }, latencyMs: runtime.now() - started }
      }
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
