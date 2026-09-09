// Crossref works API（mailto 礼貌池：UA 尾注 + mailto 参数）。端点契约 = 设计文档「学术源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES, USER_AGENT } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'
import { normalizeDoi } from '../dedup.js'
import { timeRangeToSince } from '../time.js'

const ENDPOINT = 'https://api.crossref.org/works'

/**
 * @param {Record<string, unknown>} row message 条目
 * @returns {import('../types.js').SourceItem | null}
 */
function mapWork(row) {
  const doi = normalizeDoi(typeof row.DOI === 'string' ? row.DOI : undefined)
  if (!doi) return null
  /** @type {string[]} */
  const authors = []
  if (Array.isArray(row.author)) {
    for (const a of row.author) {
      const person = /** @type {{ given?: unknown, family?: unknown, name?: unknown }} */ (a)
      const name = typeof person.name === 'string' ? person.name : [person.given, person.family].filter((x) => typeof x === 'string').join(' ')
      if (name) authors.push(name)
    }
  }
  const container = Array.isArray(row['container-title']) ? row['container-title'][0] : null
  const title = Array.isArray(row.title) ? row.title[0] : null
  const dateParts = extractDate(row['published-print'] ?? row['published-online'] ?? row.issued)
  return {
    title: typeof title === 'string' ? cleanSnippet(title, 300) : null,
    url: typeof row.URL === 'string' ? row.URL : `https://doi.org/${doi}`,
    snippet: typeof row.abstract === 'string' ? cleanSnippet(stripXml(row.abstract), 500) : (typeof container === 'string' ? cleanSnippet(container, 500) : null),
    publishedAt: dateParts,
    sourceIds: { doi },
    extra: {
      authors,
      venue: typeof container === 'string' ? container : null,
      citationCount: typeof row['is-referenced-by-count'] === 'number' ? row['is-referenced-by-count'] : null,
    },
  }
}

/**
 * Crossref DateParts → ISO 串（精度到日；仅年月日字段可用时）。
 * @param {unknown} date
 * @returns {string | null}
 */
function extractDate(date) {
  const parts = /** @type {{ 'date-parts'?: number[][] } | undefined} */ (date)?.['date-parts']?.[0]
  if (!Array.isArray(parts) || parts.length === 0 || typeof parts[0] !== 'number') return null
  const [y, m = 1, d = 1] = parts
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00Z`
}

/**
 * JATS abstract 的轻量标签剥除（不引外部 XML 库）。
 * @param {string} xml
 * @returns {string}
 */
function stripXml(xml) {
  return xml.replace(/<[^>]+>/g, ' ')
}

/** @type {import('../types.js').SourceAdapter} */
export const crossref = {
  id: 'crossref',
  family: 'academic',
  supportsTimeRange: true,
  uncertainty: ['Crossref 结果仅含摘要级元数据'],
  available(runtime) {
    return sourceConfig(runtime, 'crossref').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({
      query: request.query,
      rows: String(Math.min(request.maxResults ?? 10, 40)),
      select: 'DOI,title,author,container-title,abstract,URL,is-referenced-by-count,published-print,published-online,issued',
    })
    if (runtime.contact) params.set('mailto', runtime.contact)
    const since = timeRangeToSince(request.timeRange, runtime.now)
    if (since) params.set('filter', `from-created-date:${since.fromIso.slice(0, 10)}`)
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      // UA 带 mailto 进礼貌池（Crossref 建议；contact 未配置则保持诚实产品 UA）。
      headers: {
        accept: 'application/json',
        'user-agent': runtime.contact ? `${USER_AGENT} (mailto:${runtime.contact})` : USER_AGENT,
      },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const message = /** @type {{ message?: { items?: unknown[] } }} */ (result.json).message
    if (!Array.isArray(message?.items)) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'Crossref response has no message.items array' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of message.items) {
      const item = mapWork(/** @type {Record<string, unknown>} */ (row))
      if (item) items.push(item)
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
