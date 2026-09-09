// Bilibili 综合搜索（Web 端 JSON 接口，需 Referer 绕 -412）。结果取各 type 分组内嵌条目。
// 端点契约 = 设计文档「平台源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'

const ENDPOINT = 'https://api.bilibili.com/x/web-interface/search/all/v2'

/** @type {import('../types.js').SourceAdapter} */
export const bilibili = {
  id: 'bilibili',
  family: 'platform',
  available(runtime) {
    return sourceConfig(runtime, 'bilibili').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({ keyword: request.query, page: '1' })
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: {
        // Referer 缺省会触发风控 -412（设计文档标注）。
        referer: 'https://www.bilibili.com/',
        accept: 'application/json',
      },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ code?: number, message?: string, data?: { result?: unknown[] } }} */ (result.json)
    if (typeof data?.code === 'number' && data.code !== 0) {
      const error = data.code === -412
        ? { code: /** @type {const} */ ('rate_limited'), message: `Bilibili risk control (code -412): ${data.message ?? ''}` }
        : { code: /** @type {const} */ ('http_4xx'), message: `Bilibili business error (code ${data.code}): ${data.message ?? 'unknown'}` }
      return { status: 'error', items: [], error, latencyMs: runtime.now() - started }
    }
    // 响应按 type 分组：[{type:'video', data:[...]}, ...]——展平取条目。
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    const groups = Array.isArray(data?.data?.result) ? data.data.result : []
    for (const group of groups) {
      const g = /** @type {{ type?: unknown, data?: unknown }} */ (group)
      const rows = Array.isArray(g.data) ? g.data : []
      for (const row of rows) {
        const v = /** @type {Record<string, unknown>} */ (row)
        const bvid = typeof v.bvid === 'string' ? v.bvid : null
        const url = typeof v.arcurl === 'string' && v.arcurl.length > 0
          ? v.arcurl
          : bvid ? `https://www.bilibili.com/video/${bvid}` : null
        if (!url) continue
        // title 带 <em class="keyword"> 高亮标签，cleanSnippet 剥除。
        items.push({
          title: typeof v.title === 'string' ? cleanSnippet(v.title, 200) : null,
          url,
          snippet: typeof v.desc === 'string' ? cleanSnippet(v.desc) : null,
          publishedAt: typeof v.pubdate === 'number' ? new Date(v.pubdate * 1000).toISOString() : null,
          sourceIds: {},
          extra: {
            bvid,
            author: typeof v.author === 'string' ? v.author : null,
            play: typeof v.play === 'number' ? v.play : null,
            type: typeof g.type === 'string' ? g.type : null,
          },
        })
      }
    }
    return { status: 'ok', items: items.slice(0, request.maxResults ?? 10), latencyMs: runtime.now() - started }
  },
}
