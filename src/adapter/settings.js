// settings — settings 命名空间 `unity-search` 注册、entry 配置兜底与凭据取值缓存。
//
// 边界：schema 与深合并在此，core 只见解析后的快照；凭据经 ctx.credentials 异步解析，
// core 的 available() 要求同步取值 ⇒ adapter 维护 ref→value 缓存并预热（缺席服务 = 全 key 引擎不可用）。
// 参考：docs/technical-details/设置凭据与Skill.md；web-search-deepseek 的 installSection 接线形态。
// @ts-check

import z from '@deepseek-ai/schemastery'

/** settings 命名空间 = 插件名 = seam provider id（命名链条见《项目结构设计》）。 */
export const NAMESPACE = 'unity-search'

/** @type {readonly string[]} web 族引擎 id（链成员，不直接进模型工具枚举）。 */
export const ENGINE_IDS = Object.freeze(/** @type {string[]} */ (['bing', 'ddg', 'ddg-lite', 'anysearch', 'searxng', 'keenable', 'deepseek-official', 'tavily', 'exa', 'perplexity']))

/** @type {readonly string[]} academic/platform 源 id（search_sources 枚举面）。 */
export const SOURCE_IDS = Object.freeze(/** @type {string[]} */ (['arxiv', 'openalex', 'crossref', 'pubmed', 'europepmc', 'github', 'stackoverflow', 'hn', 'wikipedia', 'npm', 'v2ex', 'bilibili', 'reddit']))

/** @type {readonly string[]} 模型工具可选的源枚举（含链逻辑源 web）。 */
export const TOOL_SOURCE_ENUM = Object.freeze(['web', ...SOURCE_IDS])

/** @type {readonly string[]} 引擎链缺省顺序（keyless 在前；deepseek-official 列 key 引擎首位，DSR-002 修订）。 */
export const DEFAULT_ORDER = Object.freeze(['bing', 'ddg', 'anysearch', 'searxng', 'ddg-lite', 'keenable', 'deepseek-official', 'tavily', 'exa', 'perplexity'])

/**
 * @typedef {import('../core/types.js').CoreConfig} CoreConfig
 */

/** 引擎缺省开关与 key 引用（与 settings yaml 一一对应）。 */
const ENGINE_DEFAULTS = /** @type {const} */ ({
  bing: { enabled: true, apiKeyEnv: '' },
  ddg: { enabled: true, apiKeyEnv: '' },
  'ddg-lite': { enabled: true, apiKeyEnv: '' },
  anysearch: { enabled: true, apiKeyEnv: '' },
  searxng: { enabled: false, apiKeyEnv: '' },
  keenable: { enabled: true, apiKeyEnv: 'KEENABLE_API_KEY' },
  'deepseek-official': { enabled: true, apiKeyEnv: 'DEEPSEEK_API_KEY' },
  tavily: { enabled: false, apiKeyEnv: 'TAVILY_API_KEY' },
  exa: { enabled: false, apiKeyEnv: 'EXA_API_KEY' },
  perplexity: { enabled: false, apiKeyEnv: 'PERPLEXITY_API_KEY' },
})

/** 学术/平台源缺省配置（github 的 apiKeyEnv 为可选项，默认空）。 */
const SOURCE_DEFAULTS = /** @type {const} */ ({
  arxiv: { enabled: true, apiKeyEnv: '' },
  openalex: { enabled: true, apiKeyEnv: '' },
  crossref: { enabled: true, apiKeyEnv: '' },
  pubmed: { enabled: true, apiKeyEnv: '' },
  europepmc: { enabled: true, apiKeyEnv: '' },
  github: { enabled: true, apiKeyEnv: '' },
  stackoverflow: { enabled: true, apiKeyEnv: '' },
  hn: { enabled: true, apiKeyEnv: '' },
  wikipedia: { enabled: true, apiKeyEnv: '' },
  npm: { enabled: true, apiKeyEnv: '' },
  v2ex: { enabled: true, apiKeyEnv: '' },
  bilibili: { enabled: true, apiKeyEnv: '' },
  reddit: { enabled: true, apiKeyEnv: '' },
})

const READ_DEFAULTS = /** @type {const} */ ({
  defaultChars: 8000,
  maxChars: 20000,
  allowPrivate: false,
  persist: true,
  dir: '',
  maxTotalMB: 256,
})

/** 完整缺省配置快照（deep-merge 的 base 层）。 @returns {CoreConfig} */
export function fullDefaults() {
  return {
    contact: '',
    chain: { order: [...DEFAULT_ORDER], cooldownSeconds: 300, timeoutMs: 15000 },
    engines: Object.fromEntries(Object.entries(ENGINE_DEFAULTS).map(([id, v]) => [id, { ...v, ...(id === 'searxng' ? { instances: [] } : {}) }])),
    sources: Object.fromEntries(Object.entries(SOURCE_DEFAULTS).map(([id, v]) => [id, { ...v, ...(id === 'wikipedia' ? { language: 'zh' } : {}) }])),
    readSource: { ...READ_DEFAULTS },
  }
}

/** 引擎子 schema：enabled + apiKeyEnv 引用（searxng 附加 instances 列表）。 */
const engineSchema = (/** @type {{ enabled: boolean, apiKeyEnv: string, hasInstances?: boolean }} */ opts) =>
  z.object({
    enabled: z.boolean().default(opts.enabled),
    apiKeyEnv: z.string().default(opts.apiKeyEnv),
    ...(opts.hasInstances ? { instances: z.array(z.string()).default([]) } : {}),
  })

/** schemastery 校验面（类型层；值完备性由 fullDefaults + mergeConfig 保证）。 */
export const Config = z.object({
  contact: z.string().default(''),
  chain: z.object({
    order: z.array(z.string()).default([...DEFAULT_ORDER]),
    cooldownSeconds: z.number().step(1).min(0).max(3600).default(300),
    timeoutMs: z.number().step(1).min(1000).max(120000).default(15000),
  }).default({}),
  engines: z.object(Object.fromEntries(Object.entries(ENGINE_DEFAULTS).map(([id, v]) => [id, engineSchema({ enabled: v.enabled, apiKeyEnv: v.apiKeyEnv, hasInstances: id === 'searxng' })]))).default({}),
  sources: z.object(Object.fromEntries(Object.entries(SOURCE_DEFAULTS).map(([id, v]) => [id, z.object({
    enabled: z.boolean().default(v.enabled),
    apiKeyEnv: z.string().default(v.apiKeyEnv),
    ...(id === 'wikipedia' ? { language: z.string().default('zh') } : {}),
  })]))).default({}),
  readSource: z.object({
    defaultChars: z.number().step(1).min(1000).max(20000).default(8000),
    maxChars: z.number().step(1).min(1000).max(20000).default(20000),
    allowPrivate: z.boolean().default(false),
    persist: z.boolean().default(true),
    dir: z.string().default(''),
    maxTotalMB: z.number().step(1).min(1).max(10240).default(256),
  }).default({}),
})

/**
 * 深合并（数组整体替换，不逐元素 merge——顺序语义以用户值为准）。
 * @param {CoreConfig} base
 * @param {unknown} patch
 * @returns {CoreConfig}
 */
export function mergeConfig(base, patch) {
  if (!patch || typeof patch !== 'object') return base
  const p = /** @type {Record<string, unknown>} */ (patch)
  /** @type {Record<string, unknown>} */
  const out = { ...base }
  for (const key of Object.keys(base)) {
    const bv = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (base[key]))
    const pv = p[key]
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && pv && typeof pv === 'object' && !Array.isArray(pv)) {
      out[key] = mergeConfig(/** @type {CoreConfig} */ (/** @type {unknown} */ (bv)), pv)
    } else if (pv !== undefined) {
      out[key] = pv
    }
  }
  return /** @type {CoreConfig} */ (/** @type {unknown} */ (out))
}

/**
 * 把（可能不完整的）配置解析为完整快照。
 * @param {unknown} raw
 * @returns {CoreConfig}
 */
export function resolveConfig(raw) {
  return mergeConfig(fullDefaults(), raw)
}

/**
 * 形式校验（settings 写路径）：拒绝脏形状，放行后由 resolveConfig 兜底默认。
 * @param {unknown} value
 * @returns {void}
 * @throws {Error} 校验失败
 */
export function validateConfig(value) {
  const cfg = resolveConfig(value)
  const knownEngines = new Set(Object.keys(ENGINE_DEFAULTS))
  if (cfg.chain.order.length === 0) throw new Error('chain.order 不能为空')
  const seen = new Set()
  for (const id of cfg.chain.order) {
    if (!knownEngines.has(id)) throw new Error(`chain.order 含未知引擎：${id}`)
    if (seen.has(id)) throw new Error(`chain.order 含重复引擎：${id}`)
    seen.add(id)
  }
  if (cfg.readSource.maxChars < cfg.readSource.defaultChars) {
    throw new Error(`readSource.maxChars (${cfg.readSource.maxChars}) 不能小于 defaultChars (${cfg.readSource.defaultChars})`)
  }
  for (const instance of cfg.engines.searxng?.instances ?? []) {
    let url
    try {
      url = new URL(instance)
    } catch {
      throw new Error(`searxng.instances 含非法 URL：${String(instance).slice(0, 100)}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`searxng.instances 仅允许 http/https：${instance}`)
    }
  }
}

/**
 * 装配 settings 消费面：settings 服务就绪时装 section，始终可缺席（回落 entry 配置）。
 *
 * 服务访问纪律（cordis 4.0.2，实测）：本 fiber 的 inject 不含 settings，故 `ctx.settings`
 * 属性访问抛 `cannot get property "settings" without inject`（整个 profile 启动失败）；
 * 动态注入是官方通道——`ctx.inject(['settings'], (settingsCtx) => …)` 起子 fiber，
 * 依赖就绪后才执行回调，回调内 `settingsCtx.settings` 合法（同 `dsh-web-search-deepseek`）。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} entryConfig apply 收到的插件 entry 配置
 * @param {() => void} [onChange] 变更回调（热重建消费方）
 * @returns {{ current: () => CoreConfig }}
 */
export function installSettings(ctx, entryConfig, onChange) {
  let base = resolveConfig(entryConfig)
  /** @type {(() => CoreConfig) | null} */
  let source = null
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NAMESPACE, Config, base, {
      setSource: (current) => {
        source = current
      },
      onChange: () => {
        onChange?.()
      },
      validate: validateConfig,
    })
  })
  return {
    current: () => resolveConfig(source ? source() : base),
  }
}

/**
 * 凭据取值缓存：异步 resolve → 同步读。引用名集合来自当前配置的 apiKeyEnv 字段。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ current: () => CoreConfig }} settings
 * @returns {{ resolve: (ref: string) => string | undefined, refresh: () => Promise<void> }}
 */
export function createCredentialState(ctx, settings) {
  /** @type {Map<string, string | null>} ref → 值（null = 确认未配置）；无键 = 未探知 */
  const cache = new Map()
  /** @type {Promise<void> | null} */
  let inflight = null

  /** 当前配置引用的全部凭据名（引擎 + 源）。 */
  function refs() {
    const cfg = settings.current()
    const out = new Set()
    for (const engine of Object.values(cfg.engines)) if (engine.apiKeyEnv) out.add(engine.apiKeyEnv)
    for (const source of Object.values(cfg.sources)) if (source.apiKeyEnv) out.add(source.apiKeyEnv)
    return [...out]
  }

  async function refresh() {
    // ctx.get 免 inject 取值；调用一律落在返回对象上（`ctx.credentials` 属性访问会抛，见 installSettings 注）。
    const credentials = ctx.get('credentials')
    if (credentials == null) return
    if (inflight) await inflight
    inflight = (async () => {
      for (const ref of refs()) {
        try {
          // resolve 收 CredentialRef 品牌串；品牌仅类型层，运行时传纯字符串（宿主 resolve 同样按串查表）。
          const resolved = await credentials.resolve(/** @type {never} */ (ref))
          cache.set(ref, resolved && typeof resolved.value === 'string' && resolved.value.length > 0 ? resolved.value : null)
        } catch (error) {
          // 单次解析失败不伪装成"未配置"：保持未探知态，下轮刷新重试。
          ctx.logger.warn(`unity-search: 凭据解析失败 ${ref}：${String(error && error.message ? error.message : error)}`)
        }
      }
    })().finally(() => {
      inflight = null
    })
    await inflight
  }

  return {
    resolve(ref) {
      if (!ref) return undefined
      const hit = cache.get(ref)
      if (hit === undefined) void refresh().catch(() => {}) // quality-floor: ignore silent-catch 冷缓存触发后台补刷即返回未配置：错误由 refresh() 内部逐 ref 记日志，此处不阻塞同步 available 判定
      return typeof hit === 'string' ? hit : undefined
    },
    refresh,
  }
}
