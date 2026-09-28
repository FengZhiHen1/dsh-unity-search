// rpc — `/unity-search` 通道：`state`（引擎/源健康投影）与 `test`（实跑诊断）。
//
// 边界：handler 必须返回 Result（{ok,value}|{ok:false,error}），抛错会退化成 500 纯文本；
// 生命周期由 connection 服务绑到本插件 fiber，无需自持注销。
// 参考：docs/technical-details/设置页UI.md「RPC 通道契约」；skill-manager createDispatch 同构。
// @ts-check

import { searchSources, searchSingleSource } from '../core/fanout.js'

/** RPC 通道名（Client 侧 api.js 用同名）。 */
export const CHANNEL = '/unity-search'

/** 端点超时语义（文档契约）：state 15s（纯本地投影）、test 30s（出站实跑）。 */
const TEST_BUDGET_MS = 30_000

/**
 * @typedef {object} RpcDeps
 * @property {import('../core/registry.js').Registry} registry 全部 23 适配器（诊断可直调引擎）。
 * @property {import('../core/chain.js').WebChain} chain
 * @property {{ current: () => import('../core/types.js').CoreConfig }} settings
 * @property {(signal: AbortSignal) => import('../core/types.js').CoreRuntime} makeRuntime
 * @property {(ref: string) => string | undefined} resolveCredential 凭据缓存同步读（configured 投影）。
 */

/**
 * 构造 dispatch 并注册通道。
 * ⛔⛔ 本函数当前写法已失效（2026-09-28 二次实证），**必须改造** —— 保留下方说明仅作待改点标记。
 *   现状 `ctx.connection.rpc.handle(CHANNEL, dispatch)` 在**生产 web 组合下注册不上任何自定义通道**：
 *   失败点在 **connection 服务自己的 ctx** 上（rpc-host.ts:87 `get rpc() { const owner = this.ctx }`，
 *   :192 `owner.effect(() => owner.webServer.register(route))`），而 `webserver` 行与 `connection`
 *   行是**顶层兄弟行**，cordis 服务解析只沿祖先链上溯 ⇒ 必抛
 *   `cannot get property "webServer" without inject`；该异常在匿名子 fiber 内、**启动期不外显**
 *   ⇒ 行仍 `active`，浏览器一律 405。
 *   ⇒ 原判断「必须传入已注入 webServer 的 ctx（DSR-028）」**已被推翻**：改调用方 inject
 *     （动态或静态）都无效，这已是消融结论。
 *   正解见 → 仓库级 docs/decisions/0002-自定义RPC通道改用精确Fetch路由.md
 *     首选：ctx.connection.fetch.register({ path: '/api/unity-search/<endpoint>', methods:['POST'],
 *           requestBody:'buffered', fetch }) —— registerFetchRoute 不读 owner.webServer，
 *           且由 connection 自己正确挂载的 /api 承载 ⇒ 免费继承围栏(403)/认证(401)/waterfall/体积上限(413)。
 *     客户端配套：rpc.call('/api', 'unity-search/<endpoint>', payload, signal)。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {RpcDeps} deps
 * @returns {void}
 */
export function registerRpc(ctx, deps) {
  /**
   * @param {string} endpoint
   * @param {unknown} payload
   * @param {AbortSignal} signal
   * @returns {Promise<{ ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }>}
   */
  async function dispatch(endpoint, payload, signal) {
    try {
      if (endpoint === 'state') {
        if (!isEmptyPayload(payload)) return badRequest('state 载荷必须是空对象')
        return { ok: true, value: buildState(deps) }
      }
      if (endpoint === 'test') {
        const parsed = parseTestPayload(payload)
        if (!parsed.ok) return badRequest(parsed.message)
        const runtime = deps.makeRuntime(withBudget(signal, TEST_BUDGET_MS))
        const envelope = parsed.value.source === 'web'
          ? await searchSources({ query: parsed.value.query, sources: ['web'], maxResults: parsed.value.maxResults }, { registry: deps.registry, chain: deps.chain, runtime })
          : await searchSingleSource(parsed.value.source, { query: parsed.value.query, maxResults: parsed.value.maxResults }, { registry: deps.registry, chain: deps.chain, runtime })
        return { ok: true, value: envelope }
      }
      return badRequest(`unknown endpoint: ${endpoint}`)
    } catch (error) {
      // dispatch 永不外抛：任何逃逸在此显形为 internal（带原文）。
      ctx.logger.warn(`unity-search rpc ${endpoint} failed: ${String(error && error.message ? error.message : error)}`)
      return { ok: false, error: { code: 'internal', message: String(error && error.message ? error.message : error) } }
    }
  }
  ctx.connection.rpc.handle(CHANNEL, dispatch)
}

/**
 * @param {string} message
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function badRequest(message) {
  return { ok: false, error: { code: 'bad-request', message } }
}

/**
 * @param {unknown} payload
 * @returns {boolean}
 */
function isEmptyPayload(payload) {
  return payload == null || (typeof payload === 'object' && !Array.isArray(payload) && Object.keys(/** @type {object} */ (payload)).length === 0)
}

/**
 * test 载荷契约：{ source: string, query: string(非空), maxResults?: number }。脏形状显式拒绝。
 * @param {unknown} payload
 * @returns {{ ok: true, value: { source: string, query: string, maxResults?: number } } | { ok: false, message: string }}
 */
function parseTestPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, message: 'test 载荷必须是对象' }
  const p = /** @type {Record<string, unknown>} */ (payload)
  if (typeof p.source !== 'string' || p.source.length === 0) return { ok: false, message: 'test.source 必须是非空字符串' }
  if (typeof p.query !== 'string' || p.query.trim().length === 0) return { ok: false, message: 'test.query 必须是非空字符串' }
  if (p.maxResults !== undefined && (typeof p.maxResults !== 'number' || !(p.maxResults > 0) || p.maxResults > 50)) {
    return { ok: false, message: 'test.maxResults 必须是 1..50 的数字' }
  }
  return { ok: true, value: { source: p.source, query: p.query.trim(), ...(typeof p.maxResults === 'number' ? { maxResults: p.maxResults } : {}) } }
}

/**
 * 叠加预算的派生 signal（保留外层取消，超时后由 fanout 归一为 timeout 结果）。
 * @param {AbortSignal} outer
 * @param {number} ms
 * @returns {AbortSignal}
 */
function withBudget(outer, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`rpc budget ${ms}ms`)), ms)
  const onOuter = () => controller.abort(outer.reason ?? new Error('aborted'))
  if (outer.aborted) onOuter()
  else outer.addEventListener('abort', onOuter, { once: true })
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return controller.signal
}

/**
 * 状态投影：引擎（链快照 + 配置 + 凭据）与源（配置 + 可用性）。无网络，纯本地。
 * @param {RpcDeps} deps
 * @returns {unknown}
 */
export function buildState(deps) {
  const cfg = deps.settings.current()
  const runtime = deps.makeRuntime(new AbortController().signal)
  const cooling = new Map(deps.chain.snapshot().map((s) => [s.id, s]))
  const engines = deps.registry.byFamily('web').map((adapter) => {
    const engineCfg = cfg.engines[adapter.id] ?? { enabled: false, apiKeyEnv: '' }
    const ref = engineCfg.apiKeyEnv ?? ''
    const configured = ref.length === 0 ? true : deps.resolveCredential(ref) !== undefined
    const snap = cooling.get(adapter.id)
    return {
      id: adapter.id,
      enabled: engineCfg.enabled,
      configured,
      available: safeAvailable(adapter, runtime),
      coolingUntil: snap?.coolingUntil ?? 0,
      lastOutcome: snap?.lastOutcome ?? null,
    }
  })
  const sources = [...deps.registry.byFamily('academic'), ...deps.registry.byFamily('platform')].map((adapter) => {
    const sourceCfg = cfg.sources[adapter.id] ?? { enabled: false, apiKeyEnv: '' }
    const ref = sourceCfg.apiKeyEnv ?? ''
    const configured = ref.length === 0 ? true : deps.resolveCredential(ref) !== undefined
    return {
      id: adapter.id,
      family: adapter.family,
      enabled: sourceCfg.enabled,
      configured,
      available: safeAvailable(adapter, runtime),
    }
  })
  return {
    engines,
    sources,
    chain: { order: cfg.chain.order, cooldownSeconds: cfg.chain.cooldownSeconds, timeoutMs: cfg.chain.timeoutMs },
    now: Date.now(),
  }
}

/**
 * available() 契约是本地检查；意外抛出不让 RPC 整页失败——显形为不可用。
 * @param {import('../core/types.js').SourceAdapter} adapter
 * @param {import('../core/types.js').CoreRuntime} runtime
 * @returns {boolean}
 */
function safeAvailable(adapter, runtime) {
  try {
    return adapter.available(runtime)
  } catch {
    return false
  }
}
