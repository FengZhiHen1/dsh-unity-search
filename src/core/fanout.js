// 多源并行调用与结果归并（fanout）。契约 = 「检索核心与信封契约」节「多源 fanout 与去重」。
// @ts-check

import { assembleEnvelope } from './envelope.js'
import { unavailableReasonOf } from './config.js'
import { WEB_SOURCE_ID } from './chain.js'

/** 归并后条目上限的缺省值（「工具面与有界阅读」search_sources 参数语义）。 */
export const DEFAULT_MAX_RESULTS = 10

/**
 * @typedef {Object} FanoutRequest
 * @property {string} query
 * @property {string[]} [sources] 逻辑源 id 列表；缺省 ['web']。
 * @property {number} [maxResults] 归并后条目上限。
 * @property {string} [timeRange]
 */

/**
 * @typedef {Object} FanoutDeps
 * @property {{ get: (id: string) => import('./types.js').SourceAdapter | undefined }} registry
 * @property {{ search: (r: import('./types.js').SearchRequest, rt: import('./types.js').CoreRuntime) => Promise<{ outcome: import('./types.js').SourceOutcome, info: import('./envelope.js').ChainInfo, attempts: Array<{source: string, outcome: string, latencyMs: number}>, warnings: string[] }> }} chain
 * @property {import('./types.js').CoreRuntime} runtime
 */

/**
 * 多源并行检索 → 完整证据信封。
 * 各适配器业务失败自带在 outcome（不抛出）；抛出仅属编程错误 → 记 internal，信封仍完整收尾。
 * 归并顺序 = 请求顺序（对「同族取先返回者」的确定性化：以请求顺序取代并行完成顺序，见 dedup.js 注）。
 * @param {FanoutRequest} request
 * @param {FanoutDeps} deps
 * @returns {Promise<import('./types.js').SearchEnvelope>}
 */
export async function searchSources(request, deps) {
  const ids = normalizeSourceIds(request.sources)
  /** @type {string[]} */
  const callWarnings = []
  /** @type {import('./envelope.js').SourceResult[]} */
  const results = []

  await Promise.all(
    ids.map(async (id) => {
      const result = await dispatchSource(id, request, deps, callWarnings)
      results.push(result)
    }),
  )
  // 并行完成顺序不定：按请求顺序恢复（assembleEnvelope 依赖 results 顺序做同族优先）。
  results.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))

  return assembleEnvelope({
    query: request.query,
    results,
    maxItems: request.maxResults ?? DEFAULT_MAX_RESULTS,
    warnings: callWarnings,
  })
}

/**
 * 单源直调（诊断 RPC `test` 用）：绕过 enabled/凭据门与链序，直接跑一次目标适配器。
 * 目标不可用（disabled/缺凭据）不拦截，但结果附 warning 说明其当前状态。
 * @param {string} sourceId 'web'（走链）或任意适配器 id（含 web 族引擎）。
 * @param {FanoutRequest & { query: string }} request
 * @param {FanoutDeps} deps
 * @returns {Promise<import('./types.js').SearchEnvelope>}
 */
export async function searchSingleSource(sourceId, request, deps) {
  /** @type {string[]} */
  const callWarnings = []
  const result = await dispatchSource(sourceId, request, deps, callWarnings, { force: true })
  return assembleEnvelope({
    query: request.query,
    results: [result],
    maxItems: request.maxResults ?? DEFAULT_MAX_RESULTS,
    warnings: callWarnings,
  })
}

/**
 * 分发一个逻辑源：web → 链；适配器 → 可用性门 + 执行；未知 id → unknown。
 * @param {string} id
 * @param {FanoutRequest} request
 * @param {FanoutDeps} deps
 * @param {string[]} callWarnings 追加调用级警告（unknown_source 提示）。
 * @param {{ force?: boolean }} [opts] force=诊断直调（跳过可用性门）。
 * @returns {Promise<import('./envelope.js').SourceResult>}
 */
async function dispatchSource(id, request, deps, callWarnings, opts = {}) {
  const { runtime } = deps
  const searchRequest = { query: request.query, maxResults: request.maxResults, timeRange: request.timeRange }

  if (id === WEB_SOURCE_ID) {
    const r = await deps.chain.search(searchRequest, runtime)
    return {
      id,
      family: 'web',
      kind: r.outcome.status === 'ok' ? 'ok' : 'error',
      outcome: r.outcome.status === 'ok' ? r.outcome : undefined,
      error: r.outcome.status === 'error' ? r.outcome.error : undefined,
      attempts: r.attempts,
      warnings: r.warnings,
    }
  }

  const adapter = deps.registry.get(id)
  if (!adapter) {
    callWarnings.push(`未知源 id：${id}（已计入 sources.failed）`)
    return { id, kind: 'unknown', message: `unknown source: ${id}` }
  }

  if (!opts.force) {
    const reason = unavailableReasonOf(adapter, runtime)
    if (reason !== null) {
      return { id, family: adapter.family, kind: 'unavailable', message: reason }
    }
  }

  const warnings = []
  if (request.timeRange && !adapter.supportsTimeRange) {
    warnings.push(`源 ${id} 不支持 timeRange，已忽略`)
  }
  if (opts.force) {
    const reason = unavailableReasonOf(adapter, runtime)
    if (reason !== null) warnings.push(`直调诊断：该源当前不可用（${reason}）`)
  }
  return await runAdapter(adapter, searchRequest, runtime, warnings)
}

/**
 * 执行一个适配器并折算为 SourceResult（含尝试记录；抛出 → internal）。
 * @param {import('./types.js').SourceAdapter} adapter
 * @param {import('./types.js').SearchRequest} searchRequest
 * @param {import('./types.js').CoreRuntime} runtime
 * @param {string[]} warnings
 * @returns {Promise<import('./envelope.js').SourceResult>}
 */
async function runAdapter(adapter, searchRequest, runtime, warnings) {
  const started = runtime.now()
  try {
    const outcome = await adapter.search(searchRequest, runtime)
    const latencyMs = typeof outcome.latencyMs === 'number' ? outcome.latencyMs : runtime.now() - started
    const attempts = [{ source: adapter.id, outcome: outcome.status === 'ok' ? 'ok' : 'error', latencyMs }]
    if (outcome.status === 'ok') {
      return { id: adapter.id, family: adapter.family, kind: 'ok', outcome, warnings, attempts, uncertainty: adapter.uncertainty }
    }
    return {
      id: adapter.id,
      family: adapter.family,
      kind: 'error',
      error: outcome.error ?? { code: 'network', message: 'adapter reported error without detail' },
      warnings,
      attempts,
    }
  } catch (error) {
    // 适配器契约禁止业务异常外抛；到此说明编程错误——记录可见，不静默。
    runtime.logger.warn(`adapter ${adapter.id} threw (contract violation)`, error)
    return {
      id: adapter.id,
      family: adapter.family,
      kind: 'error',
      error: { code: 'internal', message: String(error && error.message ? error.message : error) },
      warnings,
      attempts: [{ source: adapter.id, outcome: 'error', latencyMs: runtime.now() - started }],
    }
  }
}

/**
 * 规范化 sources 入参：非空字符串、去重；空/缺省 → ['web']。
 * @param {string[] | undefined} sources
 * @returns {string[]}
 */
function normalizeSourceIds(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return [WEB_SOURCE_ID]
  return [...new Set(sources.filter((s) => typeof s === 'string' && s.length > 0))]
}
