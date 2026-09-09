// DeepSeek 官方检索引擎：Anthropic 兼容端点 + 内置 web_search 工具（宿主现任 provider 的自包含复刻）。
// 请求/响应形状逐字段来源 = dsh-free-search v0.4.24 实测代码（FILE:1022-1075）与设计文档端点契约。
// @ts-check

import { httpRequest } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { engineConfig, keyAvailable } from '../config.js'

const ENDPOINT = 'https://api.deepseek.com/anthropic/v1/messages'

/** @type {import('../types.js').SourceAdapter} */
export const deepseekOfficial = {
  id: 'deepseek-official',
  family: 'web',
  supportsTimeRange: false,
  available(runtime) {
    const cfg = engineConfig(runtime, 'deepseek-official')
    return cfg.enabled && keyAvailable(cfg.apiKeyEnv, runtime)
  },
  async search(request, runtime) {
    const started = runtime.now()
    const cfg = engineConfig(runtime, 'deepseek-official')
    const key = runtime.resolveCredential(cfg.apiKeyEnv ?? '')
    if (!key) {
      return { status: 'error', items: [], error: { code: 'unavailable', message: `DeepSeek credential (${cfg.apiKeyEnv ?? 'DEEPSEEK_API_KEY'}) not configured` }, latencyMs: 0 }
    }
    const body = {
      model: 'deepseek-v4-flash',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Perform a web search for the query: ${request.query}` }],
        },
      ],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
    }
    const result = await httpRequest(runtime, ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'x-api-key': key,
        authorization: `Bearer ${key}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        accept: 'application/json',
      },
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      redirect: 'error',
      expect: 'json',
    })
    if (!result.ok) {
      const error = result.error.message.includes('401')
        ? { code: /** @type {const} */ ('http_4xx'), message: 'DeepSeek API key is invalid (HTTP 401)' }
        : result.error
      return { status: 'error', items: [], error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ content?: Array<Record<string, unknown>> }} */ (result.json)
    const blocks = Array.isArray(data?.content) ? data.content : []
    /** @type {Map<string, string>} */
    const citedTexts = new Map()
    for (const block of blocks) {
      if (block.type !== 'text') continue
      const citations = Array.isArray(block.citations) ? block.citations : []
      for (const cite of citations) {
        const c = /** @type {{ url?: unknown, cited_text?: unknown }} */ (cite)
        if (typeof c.url === 'string' && typeof c.cited_text === 'string' && !citedTexts.has(c.url)) {
          citedTexts.set(c.url, c.cited_text)
        }
      }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const block of blocks) {
      if (block.type !== 'web_search_tool_result') continue
      const rows = Array.isArray(block.content) ? block.content : []
      for (const row of rows) {
        const r = /** @type {{ type?: unknown, url?: unknown, title?: unknown, page_age?: unknown }} */ (row)
        if (r.type !== 'web_search_result' || typeof r.url !== 'string' || r.url.length === 0) continue
        items.push({
          title: typeof r.title === 'string' ? cleanSnippet(r.title, 200) : null,
          url: r.url,
          snippet: citedTexts.get(r.url) ? cleanSnippet(citedTexts.get(r.url)) : null,
          publishedAt: typeof r.page_age === 'string' ? r.page_age : null,
          sourceIds: {},
          extra: {},
        })
      }
    }
    // 答案文本透传（text 块拼接），seam 面按投影规则不消费。
    const answer = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => /** @type {{ text: string }} */ (b).text)
      .join('\n')
      .trim()
    if (items.length === 0 && answer.length === 0) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'deepseek response contained no web_search_result blocks' }, latencyMs: runtime.now() - started }
    }
    return { status: 'ok', items, answer: answer.length > 0 ? answer : undefined, latencyMs: runtime.now() - started }
  },
}
