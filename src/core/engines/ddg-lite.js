// DuckDuckGo Lite 引擎：极简 HTML，解析容错优先。锚点来源 = dsh-free-search v0.4.24 实测代码。
// timeRange 注：设计文档总览标"不支持"，但 free-search 现行代码对 lite 同样发 df 参数（FILE:303-307）——
// 按代码证据实现为支持，活体实跑回填（docs/ 待办清单）。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet, extractRealUrl } from '../parse.js'
import { engineConfig } from '../config.js'
import { parseTimeRange, approximateRange } from '../time.js'

const ENDPOINT = 'https://lite.duckduckgo.com/lite/'
const DF = /** @type {const} */ ({ day: 'd', week: 'w', month: 'm', year: 'y' })

/** @type {import('../types.js').SourceAdapter} */
export const ddgLite = {
  id: 'ddg-lite',
  family: 'web',
  supportsTimeRange: true,
  available(runtime) {
    return engineConfig(runtime, 'ddg-lite').enabled
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
    // 链接与摘要两列分别抓取后按索引配对（lite 页布局），任一缺位则以 null 补。
    const links = [...result.body.matchAll(/<a[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)]
    const snippets = [...result.body.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)]
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    links.forEach((linkMatch, index) => {
      const inner = linkMatch[0]
      // href 必须按属性名取。DDG lite 现行标记是 `<a rel="nofollow" href="//duckduckgo.com/l/?uddg=…" class='result-link'>`；
      // 早前"取标记里第一个双引号串"的写法会取到 rel 值（nofollow），令全部结果被静默丢弃——2026-09-21 经代理活体暴露。
      const href = /\shref=["']([^"']*)["']/.exec(inner)
      const url = extractRealUrl(href?.[1])
      if (!url) return
      items.push({
        title: cleanSnippet(linkMatch[1] ?? '', 200),
        url,
        snippet: snippets[index]?.[1] ? cleanSnippet(snippets[index][1]) : null,
        publishedAt: null,
        sourceIds: {},
        extra: {},
      })
    })
    // 结构漂移显形：检出结果块却一条都提不出来，属"页面结构已变"而非"没有结果"（不得静默）。
    const drift = links.length > 0 && items.length === 0 ? ['ddg-lite 检出结果块但 URL 提取全失败，页面结构可能已变'] : undefined
    return {
      status: 'ok',
      items: items.slice(0, request.maxResults ?? 10),
      ...(drift ? { warnings: drift } : {}),
      latencyMs: runtime.now() - started,
    }
  },
}
