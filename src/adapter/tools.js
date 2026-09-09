// tools — search_sources / read_source 常驻工具注册（预算 C-01：恰 2 个）。
//
// 边界：参数 DSL 用 dsh-tools 自有 JSON 语法；执行只做"取 runtime → 调 core → 回规范值"。
// 规范值 = 完整信封 / 完整阅读结果（模型读结构不读散文）；卡片方法是纯函数。
// 参考：docs/technical-details/工具面与有界阅读.md；知识库 agent/11。
// @ts-check

import { defineTool } from '@deepseek-ai/dsh-tools'
import { searchSources } from '../core/fanout.js'
import { readSource } from '../core/read/read.js'
import { TOOL_SOURCE_ENUM } from './settings.js'

/** 工具声明级超时预算（毫秒）。真实收口在 core 的链超时与阅读超时，此处为注册表面。 */
const TOOL_TIMEOUT_MS = 60_000

/**
 * @typedef {import('../core/types.js').SearchEnvelope} SearchEnvelope
 * @typedef {import('../core/read/read.js').ReadResult} ReadResult
 */

/**
 * 信封 → 模型面摘要行（output.render 消费；不进规范值）。
 * @param {SearchEnvelope} envelope
 * @returns {string}
 */
export function renderEnvelope(envelope) {
  const status = `status=${envelope.status}`
  const failed = envelope.sources.failed.map((f) => `${f.source}(${f.code})`).join(', ') || 'none'
  const head = `${status} | queried=${envelope.sources.queried.length} succeeded=${envelope.sources.succeeded.join(',') || 'none'} failed=${failed} | items=${envelope.items.length}（去重 ${envelope.duplicatesRemoved}）`
  const titles = envelope.items.slice(0, 5).map((item, i) => `${i + 1}. ${item.title ?? item.url}`)
  return [head, ...titles].join('\n')
}

/**
 * 信封 → 可回放呈现载荷（presentationMeta 落会话日志；presentResult 从这里读回，
 * 与 tool-web 的 searchMetaFromValue 同构——卡片所需的一切都在 meta 内）。
 * @param {SearchEnvelope} envelope
 * @returns {Record<string, unknown>}
 */
export function envelopePresentationMeta(envelope) {
  return {
    status: envelope.status,
    sources: cardSources(envelope),
    truncated: false,
    ...(envelope.answer ? { answer: envelope.answer } : {}),
    succeeded: envelope.sources.succeeded,
    failed: envelope.sources.failed.map((f) => ({ source: f.source, code: f.code })),
    items: envelope.items.length,
    duplicatesRemoved: envelope.duplicatesRemoved,
    attempts: envelope.attempts,
  }
}

/**
 * 信封 → web 结果卡的 sources 行（纯函数；无 url 的条目卡片无法呈现，跳过）。
 * @param {SearchEnvelope} envelope
 * @returns {Array<{url: string, title?: string, snippet?: string, publishedAt?: string}>}
 */
function cardSources(envelope) {
  /** @type {Array<{url: string, title?: string, snippet?: string, publishedAt?: string}>} */
  const out = []
  for (const item of envelope.items) {
    if (typeof item.url !== 'string' || item.url.length === 0) continue
    out.push({
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.snippet ? { snippet: item.snippet } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    })
  }
  return out
}

/**
 * 注册两个常驻工具（注册随本插件 fiber 生命周期）。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{
 *   registry: import('../core/registry.js').Registry,
 *   chain: import('../core/chain.js').WebChain,
 *   makeRuntime: (signal: AbortSignal) => import('../core/types.js').CoreRuntime,
 * }} deps
 * @returns {void}
 */
export function registerTools(ctx, deps) {
  const { registry, chain, makeRuntime } = deps

  ctx.tools.register(defineTool({
    name: 'search_sources',
    description: '统一多源检索：走网页引擎链（sources=["web"]）或指定学术/平台源并行查询，返回带 sources.failed、attempts、alsoIn 去重溯源与 uncertainty 的证据信封。默认网页检索请优先用 web_search；需要多源并行、学术/平台源或证据面时用本工具。timeRange 支持 day/week/month/year 或相对时长（如 3d），不支持的源忽略并记 warning。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词' },
      sources: {
        type: 'array',
        items: { type: 'string', enum: [...TOOL_SOURCE_ENUM] },
        description: '源 id 列表；缺省 ["web"]（网页引擎链）。可选：' + TOOL_SOURCE_ENUM.join(', '),
      },
      maxResults: { type: 'number', description: '归并后条目上限，默认 10' },
      timeRange: { type: 'string', description: 'day|week|month|year 或相对时长如 3d；不支持的源忽略并记 warning' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: renderEnvelope(/** @type {SearchEnvelope} */ (value)) }],
      presentationMeta: (_args, value) => envelopePresentationMeta(/** @type {SearchEnvelope} */ (value)),
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const a = /** @type {{ query: string, sources?: string[], maxResults?: number, timeRange?: string }} */ (args)
      const runtime = makeRuntime(exec.signal)
      return await searchSources(
        { query: a.query, sources: a.sources, maxResults: a.maxResults, timeRange: a.timeRange },
        { registry, chain, runtime },
      )
    },
    presentCall: (args) => {
      const a = /** @type {{ query?: string, sources?: string[] }} */ (args)
      return { card: 'generic', kind: 'search', title: `search_sources: ${a?.query ?? ''}${a?.sources?.length ? ` [${a.sources.join(',')}]` : ''}` }
    },
    presentResult: (args, result) => {
      if (result?.isError) return undefined
      const meta = /** @type {Record<string, unknown> | undefined} */ (
        result && typeof result.meta === 'object' && result.meta !== null && !Array.isArray(result.meta) ? result.meta : undefined
      )
      if (!meta) return undefined
      const sources = Array.isArray(meta.sources) ? /** @type {Array<{url: string}>} */ (meta.sources) : null
      if (!sources || !sources.every((s) => s && typeof s.url === 'string')) return undefined
      const a = /** @type {{ query?: string }} */ (args)
      return {
        card: 'web',
        kind: 'search',
        title: `统一检索：${a?.query ?? ''}`,
        sources,
        ...(typeof meta.answer === 'string' ? { answer: meta.answer } : {}),
        truncated: meta.truncated === true,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'read_source',
    description: '有界阅读单个 URL：SSRF 校验（默认拒绝私网/环回）→ 受界取回 → 正文抽取 → 聚焦重排 → 字符分页（默认 8000，硬上限 20000），并把本次取回的全量内容落盘返回 artifactPath。续读用 offset 翻页；返回不足或疑似抽取失真时直接 read/grep artifactPath 副本，不要重抓。原始取回请用 web_fetch。',
    parameters: {
      url: { type: 'string', required: true, description: '目标 URL（http/https）' },
      focus: { type: 'string', description: '聚焦问题或关键词，相关段落优先' },
      offset: { type: 'number', description: '字符偏移，默认 0' },
      limit: { type: 'number', description: '本次返回字符上限，默认 8000，硬上限 20000' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const r = /** @type {ReadResult} */ (value)
        if (r.status === 'error') return [{ type: 'text', text: `read_source 失败（${r.error?.code ?? 'error'}）：${r.error?.message ?? ''} [${r.url}]` }]
        const head = `HTTP ${r.statusCode} | ${r.url} | 共 ${r.totalChars} 字符，返回 offset=${r.offset} limit=${r.limit} truncated=${r.truncated} | artifact=${r.artifactPath ?? '(未落盘)'}`
        return [{ type: 'text', text: `${head}\n${r.content}` }]
      },
      presentationMeta: (_args, value) => {
        const r = /** @type {ReadResult} */ (value)
        return {
          status: r.status,
          url: r.url,
          statusCode: r.statusCode,
          totalChars: r.totalChars,
          truncated: r.truncated,
          artifactPath: r.artifactPath,
          artifactKind: r.artifactKind,
        }
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const a = /** @type {{ url: string, focus?: string, offset?: number, limit?: number }} */ (args)
      const runtime = makeRuntime(exec.signal)
      return await readSource({ url: a.url, focus: a.focus, offset: a.offset, limit: a.limit }, { runtime })
    },
    presentCall: (args) => {
      const a = /** @type {{ url?: string }} */ (args)
      return { card: 'generic', kind: 'fetch', title: `read_source: ${a?.url ?? ''}` }
    },
  }))
}
