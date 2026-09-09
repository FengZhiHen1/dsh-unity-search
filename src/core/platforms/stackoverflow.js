// StackOverflow（StackExchange 2.3 advanced search；固定 filter 串保留上游已验形状）。
// 端点契约 = 设计文档「平台源」节 + dsh-free-search 实测 filter。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet, decodeEntities } from '../parse.js'
import { sourceConfig } from '../config.js'

const ENDPOINT = 'https://api.stackexchange.com/2.3/search/advanced'

/** @type {import('../types.js').SourceAdapter} */
export const stackoverflow = {
  id: 'stackoverflow',
  family: 'platform',
  available(runtime) {
    return sourceConfig(runtime, 'stackoverflow').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    const params = new URLSearchParams({
      order: 'desc',
      sort: 'relevance',
      q: request.query,
      site: 'stackoverflow',
      pagesize: String(Math.min(request.maxResults ?? 10, 30)),
      filter: '!nNPvSNVZJS',
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
    const data = /** @type {{ error_message?: string, items?: unknown[] }} */ (result.json)
    if (data?.error_message) {
      return { status: 'error', items: [], error: { code: 'http_4xx', message: `StackExchange error: ${data.error_message}` }, latencyMs: runtime.now() - started }
    }
    if (!Array.isArray(data?.items)) {
      return { status: 'error', items: [], error: { code: 'parse_failed', message: 'StackExchange response has no items array' }, latencyMs: runtime.now() - started }
    }
    /** @type {import('../types.js').SourceItem[]} */
    const items = []
    for (const row of data.items) {
      const q = /** @type {Record<string, unknown>} */ (row)
      if (typeof q.link !== 'string' || typeof q.question_id !== 'number') continue
      items.push({
        title: typeof q.title === 'string' ? decodeEntities(q.title) : null,
        url: q.link,
        snippet: cleanSnippet(`${q.is_answered ? '✓ answered' : 'unanswered'} · score ${String(q.score ?? 0)} · ${String(q.answer_count ?? 0)} answers`),
        publishedAt: typeof q.creation_date === 'number' ? new Date(q.creation_date * 1000).toISOString() : null,
        sourceIds: { questionId: String(q.question_id) },
        extra: {
          score: typeof q.score === 'number' ? q.score : null,
          answerCount: typeof q.answer_count === 'number' ? q.answer_count : null,
          isAnswered: q.is_answered === true,
        },
      })
    }
    return { status: 'ok', items, latencyMs: runtime.now() - started }
  },
}
