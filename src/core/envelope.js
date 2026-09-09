// 证据信封：构造、状态归并、seam 形状投影。契约 = docs/technical-details/检索核心与信封契约.md。
// 本模块是纯函数层：不做 I/O、不摸时钟（latencyMs 由各来源自带）。
// @ts-check

import { dedupeItems } from './dedup.js'

/**
 * 单源一次调用对信封的输入形状。fanout / chain 产出它，assembleEnvelope 消费它。
 * @typedef {Object} SourceResult
 * @property {string} id 逻辑源 id（'web' 或适配器 id）。
 * @property {import('./types.js').SourceFamily} [family] 缺省按适配器族；'web' 逻辑源记 'web'。
 * @property {'ok' | 'error' | 'unavailable' | 'unknown'} kind
 *   ok=执行成功（含空结果）；error=执行失败；unavailable=被禁用/凭据缺席/不可达而跳过；unknown=未知源 id。
 * @property {import('./types.js').SourceOutcome} [outcome] kind==='ok' 时必带。
 * @property {import('./types.js').SourceError} [error] kind==='error' 时必带。
 * @property {string} [message] kind==='unavailable'|'unknown' 的说明。
 * @property {Array<{source: string, outcome: string, latencyMs: number}>} [attempts] 链级尝试（web 源用）。
 * @property {string[]} [uncertainty] 适配器静态声明（成功时才并入）。
 * @property {string[]} [warnings] 源级警告（如 timeRange 被忽略）。
 */

/**
 * 状态归并真值表（契约「证据信封」节）：全部成功→ok；有成功但也有失败/跳过→degraded；全部失败→unavailable。
 * @param {SourceResult[]} results
 * @returns {import('./types.js').EnvelopeStatus}
 */
export function mergeStatus(results) {
  const succeeded = results.filter((r) => r.kind === 'ok').length
  if (succeeded === results.length && succeeded > 0) return 'ok'
  if (succeeded > 0) return 'degraded'
  return 'unavailable'
}

/**
 * 组装证据信封：归并各源结果 → 跨源去重 → 恒定完整的信封（结构不缺省）。
 * 不变量（assertEnvelope 校验）：queried = succeeded ∪ failed；unavailable 时 items 为空；items 键唯一。
 * @param {object} input
 * @param {string} input.query 原始查询。
 * @param {SourceResult[]} input.results 各逻辑源结果（顺序 = 请求顺序；同族去重时先列者优先）。
 * @param {number} [input.maxItems] 归并后条目上限（超出截断，不计入 duplicatesRemoved）。
 * @param {string[]} [input.warnings] 调用级警告（fanout 传入，如 unknown_source 提示）。
 * @param {string[]} [input.uncertainty] 调用级不确定声明（如 timeRange 全局提示）。
 * @returns {import('./types.js').SearchEnvelope}
 * @throws {TypeError} 未知 SourceResult.kind（装配编程错误）或组装产物违反不变量
 */
export function assembleEnvelope({ query, results, maxItems, warnings = [], uncertainty = [] }) {
  const queried = results.map((r) => r.id)
  const succeeded = []
  /** @type {Array<{source: string, code: string, message: string}>} */
  const failed = []
  /** @type {Array<{source: string, outcome: string, latencyMs: number}>} */
  const attempts = []
  /** @type {SourceResult[]} */
  const okResults = []
  /** @type {string[]} */
  const mergedWarnings = [...warnings]
  /** @type {string[]} */
  const mergedUncertainty = [...uncertainty]

  for (const r of results) {
    if (r.attempts) attempts.push(...r.attempts)
    for (const w of r.warnings ?? []) pushUnique(mergedWarnings, w)
    switch (r.kind) {
      case 'ok': {
        succeeded.push(r.id)
        okResults.push(r)
        if (r.outcome) for (const u of r.outcome.uncertainty ?? []) pushUnique(mergedUncertainty, u)
        for (const u of r.uncertainty ?? []) pushUnique(mergedUncertainty, u)
        break
      }
      case 'error': {
        const err = r.error ?? { code: 'internal', message: 'unknown error' }
        failed.push({ source: r.id, code: err.code, message: err.message })
        break
      }
      case 'unavailable': {
        failed.push({ source: r.id, code: 'unavailable', message: r.message ?? 'source unavailable' })
        break
      }
      case 'unknown': {
        failed.push({ source: r.id, code: 'unknown_source', message: r.message ?? `unknown source: ${r.id}` })
        break
      }
      default: {
        // 判别联合穷尽：出现未知 kind 属编程错误，立即抛（不静默吞）。
        throw new TypeError(`assembleEnvelope: unexpected result kind ${String(r.kind)} for source ${r.id}`)
      }
    }
  }

  // 条目归并：按源顺序展平（每项带来源 id 与族），dedup 负责键合并与首选来源判定。
  /** @type {Array<import('./types.js').SourceItem & { _from: string, _family: import('./types.js').SourceFamily }>} */
  const flat = []
  for (const r of okResults) {
    const family = r.family ?? 'web'
    for (const item of r.outcome?.items ?? []) flat.push({ ...item, _from: r.id, _family: family })
  }
  const { items, duplicatesRemoved } = dedupeItems(flat, maxItems)

  // answer 透传规则：单源且有 answer 时透传；多源时取第一个有 answer 的成功源并在 warnings 说明。
  let answer = null
  const withAnswer = okResults.filter((r) => typeof r.outcome?.answer === 'string' && r.outcome.answer.length > 0)
  if (withAnswer.length === 1) {
    answer = withAnswer[0].outcome.answer ?? null
  } else if (withAnswer.length > 1) {
    answer = withAnswer[0].outcome?.answer ?? null
    pushUnique(mergedWarnings, `多个源返回了 answer，仅透传 ${withAnswer[0].id} 的 answer`)
  }

  /** @type {import('./types.js').SearchEnvelope} */
  const envelope = {
    status: mergeStatus(results),
    query,
    sources: { queried, succeeded, failed },
    items,
    duplicatesRemoved,
    answer,
    uncertainty: mergedUncertainty,
    warnings: mergedWarnings,
    attempts,
  }
  assertEnvelope(envelope)
  return envelope
}

/**
 * 信封不变量断言（违反 = 组装逻辑的编程错误，抛出而非静默降级）。
 * @param {import('./types.js').SearchEnvelope} envelope
 * @returns {void}
 * @throws {TypeError} 任一不变量被违反
 */
export function assertEnvelope(envelope) {
  const failedIds = envelope.sources.failed.map((f) => f.source)
  const union = new Set([...envelope.sources.succeeded, ...failedIds])
  if (union.size !== envelope.sources.succeeded.length + failedIds.length) {
    throw new TypeError('envelope invariant violated: succeeded/failed overlap')
  }
  const queriedSet = new Set(envelope.sources.queried)
  if (queriedSet.size !== envelope.sources.queried.length || queriedSet.size !== union.size) {
    throw new TypeError('envelope invariant violated: queried != succeeded ∪ failed')
  }
  for (const id of union) {
    if (!queriedSet.has(id)) throw new TypeError(`envelope invariant violated: ${id} in succeeded/failed but not queried`)
  }
  if (envelope.status === 'unavailable' && envelope.items.length > 0) {
    throw new TypeError('envelope invariant violated: unavailable status with non-empty items')
  }
  // items 去重键唯一性由 dedup 保证；此处复核也In/source 字段完整。
  for (const item of envelope.items) {
    if (typeof item.source !== 'string' || !Array.isArray(item.alsoIn)) {
      throw new TypeError('envelope invariant violated: item missing source/alsoIn')
    }
  }
}

/**
 * 信封 → web seam 的 WebSearchResult 投影（规则权威 = docs/technical-details/L0-Seam接入.md）。
 * 返回判别联合，由 adapter 层决定抛 WebError（core 不 import DSH）：
 * - `{ kind: 'result', value: { sources, content, truncated } }`（ok / degraded）
 * - `{ kind: 'unavailable', failed }`（全部失败，seam 层据此抛 WebError）
 * @param {import('./types.js').SearchEnvelope} envelope
 * @param {ChainInfo} [chainInfo] 引擎链尝试明细（degraded 注记的措辞来源）。
 * @returns {{ kind: 'result', value: { sources: Array<{url: string, title?: string, snippet?: string, publishedAt?: string}>, content?: string, truncated: boolean } } | { kind: 'unavailable', failed: Array<{source: string, code: string, message: string}> }}
 */
export function projectToSeam(envelope, chainInfo) {
  if (envelope.status === 'unavailable') {
    return { kind: 'unavailable', failed: envelope.sources.failed }
  }
  /** @type {Array<{url: string, title?: string, snippet?: string, publishedAt?: string}>} */
  const sources = []
  for (const item of envelope.items) {
    // seam 条目必须有 url；答案型源的纯文本回答无 url 时无法投影为来源（url 缺失的条目丢弃但记 warning 由投影方自理）。
    if (typeof item.url !== 'string' || item.url.length === 0) continue
    /** @type {{url: string, title?: string, snippet?: string, publishedAt?: string}} */
    const s = { url: item.url }
    if (item.title) s.title = item.title
    if (item.snippet) s.snippet = item.snippet
    if (item.publishedAt) s.publishedAt = item.publishedAt
    sources.push(s)
  }
  /** @type {{ sources: typeof sources, content?: string, truncated: boolean }} */
  const value = { sources, truncated: false }
  if (envelope.status === 'degraded') {
    value.content = degradedNote(envelope, chainInfo)
  } else if (chainInfo) {
    // 单 web 源信封恒为 ok，但链内可能带过失败/空结果引擎：降级注记按链明细补（L0-Seam接入 投影规则例）。
    const skipped = chainInfo.tried.filter((t) => t.outcome === 'error' || t.outcome === 'ok-empty')
    if (chainInfo.winner && skipped.length > 0) {
      value.content = `引擎链降级：${skipped.map((t) => `${t.id}(${t.code ?? t.reason ?? 'n/a'})`).join(', ')} 未产出可用结果，结果来自备选引擎 ${chainInfo.winner}`
    }
  }
  return { kind: 'result', value }
}

/**
 * @typedef {Object} ChainInfo 引擎链一次调用的明细（chain.js 产出，仅供 seam 注记措辞）。
 * @property {string | null} winner 胜出引擎 id；无胜出为 null。
 * @property {Array<{id: string, outcome: 'ok' | 'ok-empty' | 'error' | 'skipped', code?: string, reason?: string}>} tried 顺序尝试记录。
 */

/**
 * degraded 时的一行降级注记（RQ-03「证据可信度进结构」在 seam 面的最小投影）。
 * @param {import('./types.js').SearchEnvelope} envelope
 * @param {ChainInfo} [chainInfo]
 * @returns {string}
 */
export function degradedNote(envelope, chainInfo) {
  const failedDesc = envelope.sources.failed.map((f) => `${f.source}(${f.code})`).join(', ')
  const winners = envelope.sources.succeeded.join(', ')
  if (chainInfo?.winner) {
    const skipped = chainInfo.tried.filter((t) => t.outcome === 'error').map((t) => `${t.id}(${t.code ?? 'error'})`)
    if (skipped.length > 0) {
      return `引擎链降级：${skipped.join(', ')} 失败，结果来自备选引擎 ${chainInfo.winner}`
    }
  }
  return `部分源不可用（${failedDesc}），结果来自：${winners}`
}

/**
 * 向列表追加上尚未存在的项（保序去重）。
 * @param {string[]} list
 * @param {string} item
 * @returns {void}
 */
function pushUnique(list, item) {
  if (!list.includes(item)) list.push(item)
}
