// OpenAlex works API（mailto 礼貌池）。端点契约 = 设计文档「学术源」节。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet } from '../parse.js'
import { sourceConfig } from '../config.js'
import { normalizeDoi } from '../dedup.js'
import { timeRangeToSince } from '../time.js'

const ENDPOINT = 'https://api.openalex.org/works'

/**
 * @param {Record<string, unknown>} row
 * @returns {import('../types.js').SourceItem | null}
 */
function mapWork(row) {
  const id = typeof row.id === 'string' ? row.id : null
  if (!id) return null
  const doi = normalizeDoi(typeof row.doi === 'string' ? row.doi : undefined)
  /** @type {string[]} */
  const authors = []
  if (Array.isArray(row.authorships)) {
    for (const a of row.authorships) {
      const name = /** @type {{ author?: { display_name?: unknown } }} */ (a).author?.display_name
      if (typeof name === 'string') authors.push(name)
    }
  }
  const primaryLocation = /** @type {{ source?: { display_name?: unknown } } | undefined} */ (row.primary_location)
  const venue = typeof primaryLocation?.source?.display_name === 'string' ? primaryLocation.source.display_name : null
  const abstract = typeof row.abstract_inverted_index === 'object' && row.abstract_inverted_index ? rebuildAbstract(/** @type {Record<string, number[]>} */ (row.abstract_inverted_index)) : null
  return {
    title: typeof row.display_name === 'string' ? cleanSnippet(row.display_name, 300) : null,
    url: doi ? `https://doi.org/${doi}` : id,
    snippet: abstract ? cleanSnippet(abstract, 500) : cleanSnippet(typeof row.title === 'string' ? row.title : null, 500),
    publishedAt: typeof row.publication_date === 'string' ? `${row.publication_date}T00:00:00Z` : null,
    sourceIds: doi ? { doi } : {},
    extra: { authors, venue, citationCount: typeof row.cited_by_count === 'number' ? row.cited_by_count : null },
  }
}

/**
 * OpenAlex 的倒排摘要还原为文本（词 → 位置数组）。
 * @param {Record<string, number[]>} inverted
 * @returns {string | null}
 */
function rebuildAbstract(inverted) {
  /** @type {Array<{ pos: number, word: string }>} */
  const parts = []
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue
    for (const pos of positions) parts.push({ pos, word })
  }
  if (parts.length === 0) return null
  parts.sort((a, b) => a.pos - b.pos)
  return parts.map((p) => p.word).join(' ')
}

/** @type {import('../types.js').SourceAdapter} */
export const openalex = {
  id: 'openalex',
  family: 'academic',
  supportsTimeRange: true,
  uncertainty: ['OpenAlex 结果仅含摘要级元数据'],
  available(runtime) {
    return sourceConfig(runtime, 'openalex').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({
      search: request.query,
      'per-page': String(Math.min(request.maxResults ?? 10, 50)),
    })
    if (runtime.contact) params.set('mailto', runtime.contact)
    const since = timeRangeToSince(request.timeRange, runtime.now)
    if (since) params.set('filter', `from_publication_date:${since.fromIso.slice(0, 10)}`)
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: { accept: 'application/json' },
      expect: 'json',
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const data = /** @type {{ results?: unknown[] }} */ (result.json)
    if (!Array.isArray(data?.results)) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'OpenAlex response has no results array' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of data.results) {
      const item = mapWork(/** @type {Record<string, unknown>} */ (row))
      if (item) items.push(item)
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
