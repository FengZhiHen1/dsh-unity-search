// api — Client→Host 传输门面：`/unity-search` 通道调用与错误/形状归一（skill-manager api.js 同构）。
//
// 边界：本层只管超时、Result 信封拆解与 state 载荷的防御性收窄；调度语义全在 Host。
// 渲染层只认归一后的形状与 RpcError——投影字段漂移不会让设置节崩溃。
// @ts-check

/** RPC 通道名（Host 侧 rpc.js 用同名）。 */
export const CHANNEL = '/unity-search'

/** 超时两档：state 15s（对齐文档契约）、test 35s（Host 预算 30s + 传输余量）。 */
const STATE_TIMEOUT_MS = 15_000
const TEST_TIMEOUT_MS = 35_000

/** 业务/传输统一错误形状。 */
export class RpcError extends Error {
  /** @type {string} */
  code
  /** @type {boolean} */
  retryable

  /**
   * @param {string} message
   * @param {{ code?: string, retryable?: boolean }} [options]
   */
  constructor(message, { code = 'internal', retryable = false } = {}) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.retryable = retryable
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {{ state: () => Promise<NormalizedState>, test: (payload: { source: string, query: string, maxResults?: number }) => Promise<unknown> }}
 */
export function createCall(ctx) { // quality-floor: ignore docstring-promise throw 均在返回的闭包方法内（RpcError），外层工厂不抛
  /**
   * @param {string} endpoint
   * @param {unknown} payload
   * @param {number} budgetMs
   */
  async function call(endpoint, payload, budgetMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), budgetMs)
    let result
    try {
      result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload, controller.signal)
    } catch (error) {
      const aborted = Boolean(error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
      throw new RpcError(
        aborted ? `调用 ${endpoint} 超时（${Math.round(budgetMs / 1000)}s）` : `RPC 通道失败（${endpoint}）：${error && error.message ? error.message : String(error)}`,
        { code: 'transport', retryable: true },
      )
    } finally {
      clearTimeout(timer)
    }
    if (result && typeof result === 'object' && result.ok === true) return result.value
    const failure = result && typeof result === 'object' && result.error ? result.error : {}
    throw new RpcError(failure.message || '请求失败', { code: failure.code || 'internal', retryable: false })
  }

  return {
    async state() {
      return narrowState(await call('state', {}, STATE_TIMEOUT_MS))
    },
    async test(payload) {
      return call('test', payload, TEST_TIMEOUT_MS)
    },
  }
}

/**
 * @typedef {Object} NormalizedState 收窄后的状态投影（漂移字段有中性缺省）。
 * @property {Array<{id: string, enabled: boolean, configured: boolean, available: boolean, coolingUntil: number, lastOutcome: {outcome: string, code?: string, at?: number} | null}>} engines
 * @property {Array<{id: string, family: string, enabled: boolean, configured: boolean, available: boolean}>} sources
 * @property {{order: string[], cooldownSeconds: number, timeoutMs: number}} chain
 * @property {number} now
 */

/**
 * state 投影防御性收窄：类型漂移落成缺省而不是让页面崩溃。
 * @param {unknown} value
 * @returns {NormalizedState}
 */
export function narrowState(value) {
  const root = /** @type {Record<string, unknown>} */ (value && typeof value === 'object' ? value : {})
  /** @type {(v: unknown) => v is object[]} */
  const isArr = (v) => Array.isArray(v)
  const engines = isArr(root.engines) ? root.engines.map((e) => {
    const row = /** @type {Record<string, unknown>} */ (e)
    return {
      id: typeof row.id === 'string' ? row.id : '?',
      enabled: row.enabled === true,
      configured: row.configured === true,
      available: row.available === true,
      coolingUntil: typeof row.coolingUntil === 'number' ? row.coolingUntil : 0,
      lastOutcome: row.lastOutcome && typeof row.lastOutcome === 'object' ? /** @type {NormalizedState['engines'][number]['lastOutcome']} */ (row.lastOutcome) : null,
    }
  }) : []
  const sources = isArr(root.sources) ? root.sources.map((s) => {
    const row = /** @type {Record<string, unknown>} */ (s)
    return {
      id: typeof row.id === 'string' ? row.id : '?',
      family: typeof row.family === 'string' ? row.family : 'web',
      enabled: row.enabled === true,
      configured: row.configured === true,
      available: row.available === true,
    }
  }) : []
  const chain = /** @type {Record<string, unknown>} */ (root.chain && typeof root.chain === 'object' ? root.chain : {})
  return {
    engines,
    sources,
    chain: {
      order: isArr(chain.order) ? chain.order.filter((x) => typeof x === 'string') : [],
      cooldownSeconds: typeof chain.cooldownSeconds === 'number' ? chain.cooldownSeconds : 300,
      timeoutMs: typeof chain.timeoutMs === 'number' ? chain.timeoutMs : 15000,
    },
    now: typeof root.now === 'number' ? root.now : Date.now(),
  }
}
