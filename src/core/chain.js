// 网页引擎链：健康感知顺序兜底 + 冷却。契约 = 「检索核心与信封契约」节「网页引擎链（chain）」。
// 冷却状态存活于创建者作用域（adapter fiber），本模块工厂不持模块级状态。
// @ts-check

import { unavailableReasonOf } from './config.js'

/**
 * @typedef {Object} EngineStateEntry 单引擎健康状态（供 state RPC 投影）。
 * @property {number} coolingUntil 冷却截止时刻（epoch ms）；<= now 即不在冷却。
 * @property {{ outcome: 'ok' | 'error', code?: string, at: number } | null} lastOutcome 最近一次尝试记忆。
 */

/**
 * 引擎链逻辑源 id（信封 queried/failed 里出现的名字）。
 */
export const WEB_SOURCE_ID = 'web'

/**
 * @typedef {Object} WebChain createWebChain 的返回面（fiber 作用域实例）。
 * @property {'web'} id 逻辑源 id。
 * @property {(runtime: import('./types.js').CoreRuntime) => boolean} available 至少一个序内引擎在线（本地检查，含冷却）。
 * @property {(request: import('./types.js').SearchRequest, runtime: import('./types.js').CoreRuntime) => Promise<{ outcome: import('./types.js').SourceOutcome, info: import('./envelope.js').ChainInfo, attempts: Array<{ source: string, outcome: string, latencyMs: number }>, warnings: string[] }>} search 顺序兜底一次检索。
 * @property {() => Array<{ id: string, coolingUntil: number, lastOutcome: EngineStateEntry['lastOutcome'] }>} snapshot 健康状态投影（RPC state 消费）。
 */

/**
 * 创建 web 逻辑源（引擎链）。
 * @param {object} deps
 * @param {import('./types.js').SourceAdapter[]} deps.engines family==='web' 的适配器集合。
 * @param {Map<string, EngineStateEntry>} deps.state 冷却/最近结果状态表（fiber 作用域实例注入，配置热更新保留）。
 * @returns {WebChain}
 */
export function createWebChain({ engines, state }) {
  /** @type {Map<string, import('./types.js').SourceAdapter>} */
  const byId = new Map(engines.map((e) => [e.id, e]))

  /** 取（或惰性建）引擎状态行。@param {string} id */
  function stateOf(id) {
    let entry = state.get(id)
    if (!entry) {
      entry = { coolingUntil: 0, lastOutcome: null }
      state.set(id, entry)
    }
    return entry
  }

  /**
   * 按 settings.chain.order 解析本次尝试序列；order 外或未注册的引擎 id 被跳过（契约第 1 条）。
   * @param {import('./types.js').CoreRuntime} runtime
   * @returns {import('./types.js').SourceAdapter[]}
   */
  function orderedEngines(runtime) {
    const order = runtime.config.chain?.order
    if (!Array.isArray(order)) return []
    const out = []
    for (const id of order) {
      const engine = byId.get(id)
      if (engine) out.push(engine)
    }
    return out
  }

  return {
    id: WEB_SOURCE_ID,

    /** 至少一个引擎当前可用（本地检查，含冷却状态；无网络）。@param {import('./types.js').CoreRuntime} runtime */
    available(runtime) {
      return orderedEngines(runtime).some((engine) => !isCooling(stateOf(engine.id), runtime) && engine.available(runtime))
    },

    /**
     * 顺序兜底：第一个 ok 且 items 非空的引擎胜出；失败引擎进冷却；空结果不算失败但记录。
     * @param {import('./types.js').SearchRequest} request
     * @param {import('./types.js').CoreRuntime} runtime
     */
    async search(request, runtime) {
      /** @type {import('./envelope.js').ChainInfo['tried']} */
      const tried = []
      /** @type {Array<{source: string, outcome: string, latencyMs: number}>} */
      const attempts = []
      /** @type {string[]} */
      const warnings = []
      let winner = null
      /** @type {import('./types.js').SourceOutcome | null} */
      let firstEmpty = null

      for (const engine of orderedEngines(runtime)) {
        const st = stateOf(engine.id)
        if (isCooling(st, runtime)) {
          tried.push({ id: engine.id, outcome: 'skipped', reason: 'cooling' })
          continue
        }
        const reason = unavailableReasonOf(engine, runtime)
        if (reason !== null) {
          tried.push({ id: engine.id, outcome: 'skipped', reason })
          continue
        }
        const started = runtime.now()
        let outcome
        let violation = false
        try {
          outcome = await engine.search(request, runtime)
        } catch (error) {
          // 适配器契约规定业务失败不抛；抛了即编程错误 → 记 error 尝试但不进冷却（冷却只针对上游故障）。
          violation = true
          runtime.logger.warn(`engine ${engine.id} threw (contract violation)`, error)
          outcome = { status: 'error', items: [], latencyMs: runtime.now() - started, error: { code: 'internal', message: String(error && error.message ? error.message : error) } }
        }
        const latencyMs = outcome.latencyMs ?? runtime.now() - started
        if (outcome.status === 'error') {
          const code = outcome.error?.code ?? 'network'
          if (!violation) {
            st.coolingUntil = runtime.now() + cooldownMs(runtime)
            warnings.push(`引擎 ${engine.id} 失败（${code}：${outcome.error?.message ?? '无详情'}），已冷却`)
          }
          st.lastOutcome = { outcome: 'error', code, at: runtime.now() }
          tried.push({ id: engine.id, outcome: 'error', code })
          attempts.push({ source: `web:${engine.id}`, outcome: 'error', latencyMs })
          if (violation) {
            warnings.push(`引擎 ${engine.id} 违约抛出（internal），未冷却`)
          }
          continue
        }
        if (outcome.items.length === 0) {
          st.lastOutcome = { outcome: 'ok', at: runtime.now() }
          tried.push({ id: engine.id, outcome: 'ok-empty' })
          attempts.push({ source: `web:${engine.id}`, outcome: 'empty', latencyMs })
          if (!firstEmpty) firstEmpty = outcome
          continue
        }
        st.lastOutcome = { outcome: 'ok', at: runtime.now() }
        tried.push({ id: engine.id, outcome: 'ok' })
        attempts.push({ source: `web:${engine.id}`, outcome: 'ok', latencyMs })
        winner = { engine, outcome }
        break
      }

      /** @type {import('./envelope.js').ChainInfo} */
      const info = { winner: winner ? winner.engine.id : null, tried }

      if (winner) {
        if (request.timeRange && !winner.engine.supportsTimeRange) {
          warnings.push(`胜出引擎 ${winner.engine.id} 不支持 timeRange，已忽略`)
        }
        return { outcome: winner.outcome, info, attempts, warnings }
      }
      if (firstEmpty) {
        // 有引擎成功返回但全为空：空结果不算失败 → web 源 ok（0 条）。
        return { outcome: firstEmpty, info, attempts, warnings }
      }
      const anyTried = tried.some((t) => t.outcome === 'error')
      if (!anyTried) {
        // 没有任何引擎被真正尝试（全 disabled/缺 key/冷却）→ 逻辑源不可用。
        return {
          outcome: { status: 'error', items: [], latencyMs: 0, error: { code: 'unavailable', message: `无可用引擎（skipped: ${tried.map((t) => `${t.id}:${t.reason ?? t.outcome}`).join(', ') || '链为空'}）` } },
          info,
          attempts,
          warnings: [],
        }
      }
      return {
        outcome: { status: 'error', items: [], latencyMs: 0, error: { code: 'chain_exhausted', message: `全部引擎失败：${tried.filter((t) => t.outcome === 'error').map((t) => `${t.id}(${t.code})`).join(', ')}` } },
        info,
        attempts,
        warnings,
      }
    },

    /** 状态投影（设置页「引擎运行状态」消费）。@returns {Array<{id: string, coolingUntil: number, lastOutcome: EngineStateEntry['lastOutcome']}>} */
    snapshot() {
      return engines.map((e) => {
        const st = state.get(e.id) ?? { coolingUntil: 0, lastOutcome: null }
        return { id: e.id, coolingUntil: st.coolingUntil, lastOutcome: st.lastOutcome }
      })
    },
  }
}

/**
 * 冷却剩余判定。@param {EngineStateEntry} st @param {import('./types.js').CoreRuntime} runtime */
function isCooling(st, runtime) {
  return st.coolingUntil > runtime.now()
}

/**
 * 冷却时长（ms）。@param {import('./types.js').CoreRuntime} runtime */
function cooldownMs(runtime) {
  const seconds = runtime.config.chain?.cooldownSeconds
  return typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : 0
}
