// bing 引擎：HTML 抓取。解析锚点来源 = dsh-free-search v0.4.24 运行中代码（契约参考，代码不搬）。
// timeRange：活体实测（2026-09-09）`filters=ex1:"ezN"` 对 www.bing.com 结果集零影响
// （基线/day/week/month 同查询同结果，长尾查询复测一致）→ 判不支持，参数映射已删。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet, decodeEntities } from '../parse.js'
import { engineConfig } from '../config.js'

const ENDPOINT = 'https://www.bing.com/search'

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
  supportsTimeRange: false,
  available(runtime) {
    return engineConfig(runtime, 'bing').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({ q: request.query })
    if (typeof request.maxResults === 'number' && request.maxResults > 0) {
      params.set('count', String(Math.min(Math.round(request.maxResults), 50)))
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
