// PubMed（NCBI eutils 两步：esearch → efetch）。端点契约 = 设计文档「学术源」节。
// NCBI 匿名约 3 req/s：默认 1000ms host 节流满足（两步请求同 host 自动串行化）。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'
import { parseTimeRange } from '../time.js'

const ESEARCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
const EFETCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'

/**
 * @param {import('../types.js').SearchRequest} request
 * @param {import('../types.js').CoreRuntime} runtime
 * @returns {Promise<import('../types.js').SourceOutcome>}
 */
async function fetchOutcome(request, runtime) {
  const started = runtime.now()
  const maxResults = request.maxResults ?? 10
  const params = new URLSearchParams({ db: 'pubmed', term: request.query, retmode: 'json', retmax: String(maxResults) })
  if (runtime.contact) {
    params.set('tool', 'dsh-unity-search')
    params.set('email', runtime.contact)
  }
  const range = request.timeRange ? parseTimeRange(request.timeRange) : null
  if (range && 'days' in range) {
    params.set('datetype', 'mindate')
    params.set('reldate', String(Math.max(1, Math.ceil(range.days))))
  } else if (range) {
    params.set('datetype', 'mindate')
    params.set('mindate', range.after.slice(0, 10).replace(/-/g, '/') + '/2000[Date]')
    params.set('maxdate', new Date(runtime.now()).toISOString().slice(0, 10).replace(/-/g, '/') + '/2000[Date]')
  }
  const searchResult = await httpRequest(runtime, `${ESEARCH}?${params.toString()}`, {
    timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
    maxBytes: MAX_SEARCH_BYTES,
    headers: { accept: 'application/json' },
    expect: 'json',
  })
  if (!searchResult.ok) {
    return { status: 'error', items: [], error: searchResult.error, latencyMs: runtime.now() - started }
  }
  const payload = /** @type {{ esearchresult?: { idlist?: string[], retcount?: string } }} */ (searchResult.json)
  const idlist = Array.isArray(payload?.esearchresult?.idlist) ? payload.esearchresult.idlist : null
  if (!idlist) {
    return { status: 'error', items: [], error: { code: 'parse_failed', message: 'esearch response missing esearchresult.idlist' }, latencyMs: runtime.now() - started }
  }
  if (idlist.length === 0) {
    return { status: 'ok', items: [], latencyMs: runtime.now() - started }
  }
  const fetchParams = new URLSearchParams({ db: 'pubmed', id: idlist.join(','), retmode: 'xml' })
  const xmlResult = await httpRequest(runtime, `${EFETCH}?${fetchParams.toString()}`, {
    timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
    maxBytes: MAX_SEARCH_BYTES,
  })
  if (!xmlResult.ok) {
    return { status: 'error', items: [], error: xmlResult.error, latencyMs: runtime.now() - started }
  }
  return { status: 'ok', items: parseArticles(xmlResult.body), latencyMs: runtime.now() - started }
}

/**
 * PubmedArticleSet XML → items（题录级：标题/摘要/作者/日期/DOI）。
 * @param {string} xml
 * @returns {import('../types.js').SourceItem[]}
 */
export function parseArticles(xml) {
  /** @type {import('../types.js').SourceItem[]} */
  const items = []
  for (const block of xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)) {
    const chunk = block[0]
    const pmid = /<PMID[^>]*>([^<]+)<\/PMID>/.exec(chunk)?.[1]?.trim()
    if (!pmid) continue
    const title = /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/.exec(chunk)?.[1]
    const abstract = [...chunk.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => m[1])
      .filter((s) => typeof s === 'string')
      .join(' ')
    const authors = []
    for (const authorBlock of chunk.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g)) {
      const inner = authorBlock[1] ?? ''
      const lastName = /<LastName>([^<]*)<\/LastName>/.exec(inner)?.[1]
      const initials = /<Initials>([^<]*)<\/Initials>/.exec(inner)?.[1]
      const collective = /<CollectiveName>([^<]*)<\/CollectiveName>/.exec(inner)?.[1]
      if (lastName) authors.push(initials ? `${lastName} ${initials}` : lastName)
      else if (collective) authors.push(collective)
    }
    const year = /<Year>([^<]+)<\/Year>/.exec(chunk)?.[1]
    const month = /<Month>([^<]+)<\/Month>/.exec(chunk)?.[1]
    const doi = /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/.exec(chunk)?.[1]
    const journal = /<Title>([^<]+)<\/Title>/.exec(chunk)?.[1]
    items.push({
      title: title ? cleanSnippet(title, 300) : null,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      snippet: abstract ? cleanSnippet(abstract, 500) : null,
      publishedAt: year ? `${year}-${monthNum(month)}-01T00:00:00Z` : null,
      sourceIds: { pmid, ...(doi ? { doi: doi.toLowerCase() } : {}) },
      extra: { authors: authors.slice(0, 8), venue: journal ?? null },
    })
  }
  return items
}

/**
 * PubMed 月名/数字 → 两位月份（未知回退 01）。
 * @param {string | undefined} month
 * @returns {string}
 */
function monthNum(month) {
  if (!month) return '01'
  const asNumber = Number.parseInt(month, 10)
  if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= 12) return String(asNumber).padStart(2, '0')
  const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].findIndex((m) => month.toLowerCase().startsWith(m))
  return idx >= 0 ? String(idx + 1).padStart(2, '0') : '01'
}

/** @type {import('../types.js').SourceAdapter} */
export const pubmed = {
  id: 'pubmed',
  family: 'academic',
  supportsTimeRange: true,
  uncertainty: ['PubMed 结果仅含题录/摘要级'],
  available(runtime) {
    return sourceConfig(runtime, 'pubmed').enabled
  },
  search: fetchOutcome,
}
