// arXiv（Atom API）。条款要求约 3s 间隔 → throttleMs = ARXIV_MIN_INTERVAL_MS 落实于 http 层。
// 端点契约 = 设计文档「学术源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES, ARXIV_MIN_INTERVAL_MS } from '../http.js'
import { cleanSnippet, stripTags } from '../parse.js'
import { sourceConfig } from '../config.js'
import { normalizeArxiv } from '../dedup.js'
import { parseTimeRange } from '../time.js'

const ENDPOINT = 'http://export.arxiv.org/api/query'

/**
 * 把时间窗换算成 arXiv 查询语法 `AND submittedDate:[YYYYMMDDHHMM TO YYYYMMDDHHMM]`。
 * @param {string | undefined} timeRange
 * @param {() => number} now
 * @returns {string} 追加片段（无时间窗时为空串）。
 */
function submittedDateClause(timeRange, now) {
  if (!timeRange) return ''
  const parsed = parseTimeRange(timeRange)
  if (!parsed) return ''
  const to = new Date(now())
  let from
  if ('days' in parsed) from = new Date(to.getTime() - parsed.days * 86400000)
  else from = new Date(parsed.after)
  /** @param {Date} d */
  const stamp = (d) => d.toISOString().replace(/[-:T]|(?:\.\d{3})/g, '').replace(/Z$/, '').slice(0, 12)
  return ` AND submittedDate:[${stamp(from)} TO ${stamp(to)}]`
}

/**
 * @param {string} xml
 * @returns {import('../types.js').SourceItem[]}
 */
function parseEntries(xml) {
  /** @type {import('../types.js').SourceItem[]} */
  const items = []
  for (const block of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const chunk = block[0]
    const idUrl = /<id>([^<]*)<\/id>/.exec(chunk)?.[1] ?? ''
    const arxiv = normalizeArxiv(idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, ''))
    if (!arxiv) continue
    const title = /<title>([\s\S]*?)<\/title>/.exec(chunk)?.[1]
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(chunk)?.[1]
    const published = /<published>([^<]*)<\/published>/.exec(chunk)?.[1]
    const authors = [...chunk.matchAll(/<name>([^<]*)<\/name>/g)].map((m) => stripTags(m[1] ?? '').trim()).filter(Boolean)
    items.push({
      title: title ? cleanSnippet(title, 300) : null,
      url: `https://arxiv.org/abs/${arxiv}`,
      snippet: summary ? cleanSnippet(summary, 500) : null,
      publishedAt: published ?? null,
      sourceIds: { arxiv },
      extra: { authors },
    })
  }
  return items
}

/** @type {import('../types.js').SourceAdapter} */
export const arxiv = {
  id: 'arxiv',
  family: 'academic',
  supportsTimeRange: true,
  uncertainty: ['arXiv 结果仅含摘要级元数据'],
  available(runtime) {
    return sourceConfig(runtime, 'arxiv').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({
      search_query: `all:"${request.query.replace(/"/g, '')}"${submittedDateClause(request.timeRange, runtime.now)}`,
      start: '0',
      max_results: String(request.maxResults ?? 10),
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    })
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      throttleMs: ARXIV_MIN_INTERVAL_MS,
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    if (!result.body.includes('<entry>') && !result.body.includes('<feed')) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'arxiv response is not an Atom feed' }, latencyMs: runtime.now() - started }
    }
    return { status: 'ok', items: parseEntries(result.body), latencyMs: runtime.now() - started }
  },
}
