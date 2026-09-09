// EuropePMC REST search（题录 + OA 标识；OA 全文/PDF 存在性入 extra，不自动抓取——有界原则）。
// 端点契约 = 设计文档「学术源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'
import { normalizeDoi } from '../dedup.js'
import { parseTimeRange } from '../time.js'

const ENDPOINT = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'

/**
 * landing url 优先级：DOI > PMC > PMID（设计文档）。
 * @param {{ doi: string | null, pmcid: string | null, pmid: string | null }} ids
 * @returns {string | null}
 */
export function europepmcLandingUrl({ doi, pmcid, pmid }) {
  if (doi) return `https://doi.org/${doi}`
  if (pmcid) return `https://europepmc.org/articles/${pmcid}`
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
  return null
}

/** @type {import('../types.js').SourceAdapter} */
export const europepmc = {
  id: 'europepmc',
  family: 'academic',
  supportsTimeRange: true,
  uncertainty: ['EuropePMC 结果仅含题录/摘要级（OA 标记见 extra）'],
  available(runtime) {
    return sourceConfig(runtime, 'europepmc').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    let query = request.query
    if (request.timeRange) {
      const parsed = parseTimeRange(request.timeRange)
      if (parsed) {
        const from = 'days' in parsed ? new Date(runtime.now() - parsed.days * 86400000) : new Date(parsed.after)
        const stamp = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')
        query = `(${query}) AND FIRST_SUB_DATE:[${stamp(from)} TO ${stamp(new Date(runtime.now()))}]`
      }
    }
    const params = new URLSearchParams({
      query,
      format: 'json',
      pageSize: String(Math.min(request.maxResults ?? 10, 50)),
      resultType: 'core',
    })
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: { accept: 'application/json' },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ hits?: { hitList?: unknown[] }, error?: string }} */ (result.json)
    if (data?.error) {
      return { status: 'error', items: [], error: { code: 'http_4xx', message: `EuropePMC error: ${data.error}` }, latencyMs: runtime.now() - started }
    }
    const list = Array.isArray(data?.hits?.hitList) ? data.hits.hitList : null
    if (!list) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'EuropePMC response has no hits.hitList' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const hit of list) {
      const h = /** @type {Record<string, unknown>} */ (hit)
      const doi = normalizeDoi(typeof h.doi === 'string' ? h.doi : undefined)
      const pmid = typeof h.pmid === 'string' ? h.pmid : null
      const pmcid = typeof h.pmcid === 'string' ? h.pmcid : null
      const url = europepmcLandingUrl({ doi, pmcid, pmid })
      if (!url && typeof h.id !== 'string') continue
      const journalInfo = /** @type {{ journal?: { title?: unknown } } | undefined} */ (h.journalInfo)
      items.push({
        title: typeof h.title === 'string' ? cleanSnippet(h.title, 300) : null,
        url: url ?? `https://europepmc.org/article/${typeof h.source === 'string' ? h.source.toLowerCase() : 'med'}/${String(h.id ?? '')}`,
        snippet: typeof h.abstractText === 'string' ? cleanSnippet(h.abstractText, 500) : null,
        publishedAt: typeof h.pubDate === 'string' ? `${h.pubDate}T00:00:00Z` : null,
        sourceIds: { ...(doi ? { doi } : {}), ...(pmid ? { pmid } : {}) },
        extra: {
          authors: typeof h.authorString === 'string' ? h.authorString.split(', ').slice(0, 8) : [],
          venue: typeof journalInfo?.journal?.title === 'string' ? journalInfo.journal.title : null,
          isOpenAccess: h.isOpenAccess === 'Y',
          pmcid,
        },
      })
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
