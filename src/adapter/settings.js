// settings — 配置边界：Cordis `Config` schema、volatile 引用解包、解析前校验挂点与凭据取值缓存。
//
// 边界：schema 与深合并在此，core 只见解包后的快照；凭据经 ctx.credentials 异步解析，
// core 的 available() 要求同步取值 ⇒ adapter 维护 ref→value 缓存并预热（缺席服务 = 全 key 引擎不可用）。
//
// 0.1.7 配置模型（知识库 host/07 §1-§3；本仓库 dsh-skill-manager DSR-025 为同批已验证先例）：
// 配置真相 = **本行 loader entry 的 Cordis `Config`**。旧注册面整体作废——`settings.yaml` 与
// settings-file 提供方已删，`ctx.settings.installSection(...)`、其返回的 `SettingsScope`、
// 浏览器侧 `ctx.settingsScope.bind`、`settings/updated` 在新树**均零命中**（照抄即运行期
// `TypeError: … is not a function`）。现行四要素：① 插件在 `Config` 里声明全部可配置值；
// ② 即时字段加 `.volatile()`，消费者**操作时**读 `ref.get()`；③ settings 只枚举并生成表单；
// ④ 浏览器半区写 `cordis.patch.yml` 经普通 Loader 协调路径应用。
//
// ⚠ volatile 摆放硬约束（vendor/schemastery/src/index.ts `validateVolatileSchema`）：**只有叶子
// 字段**可标 volatile，且不得有 enclosing volatile 字段——`z.object({...}).volatile()` 与
// `z.array(z.string().volatile())` 在**解析期**抛 `volatile fields require a fixed object path`。
// 故本文件的每个 `.volatile()` 都落在 `z.object` 的字面字段上，中间的 `chain`/`engines`/`sources`/
// `readSource` 与引擎/源子对象一律不带 volatile（`isVolatilePath` 会沿 `dict` 递归认这些路径）。
// 参考：docs/technical-details/设置凭据与Skill.md；官方 web-search-deepseek/src/index.ts 接线形态。
// @ts-check

import z from '@deepseek-ai/schemastery'
import { NAMESPACE } from '../core/config-ns.js'

// 命名空间 = 本插件 loader 行的 id（单一事实源在 core/config-ns.js，Host/Client 两侧共用）。
export { NAMESPACE }

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

/**
 * 引擎/源子 schema 字段构造器：**每个叶子标 `.volatile()`**（只有 volatile 字段可写、才出现在设置页）。
 * 子对象本身**不带** volatile——见文件头「volatile 摆放硬约束」。
 * 缺省值仍逐项取自 `ENGINE_DEFAULTS` / `SOURCE_DEFAULTS`（并非一律 true：searxng/tavily/exa/perplexity
 * 默认关闭，keenable/deepseek-official 等带默认 key 引用），与 `fullDefaults()` 保持同源。
 * @param {boolean} enabled 该引擎/源的默认开关
 * @param {string} apiKeyEnv 默认凭据引用名（空串 = 无需 key）
 * @param {boolean} withInstances searxng 专有：实例列表
 */
const engineSubSchema = (/** @type {boolean} */ enabled, /** @type {string} */ apiKeyEnv, /** @type {boolean} */ withInstances) => ({
  enabled: z.boolean().default(enabled).volatile(),
  apiKeyEnv: z.string().default(apiKeyEnv).volatile(),
  ...(withInstances ? { instances: z.array(z.string()).default([]).volatile() } : {}),
})

/**
 * 校验面 + 设置页表单面（类型层；值完备性由 fullDefaults + mergeConfig 保证）。
 *
 * volatile 覆盖范围 = **设置页真正会写的字段**：链参数、全部引擎与源的开关、
 * `contact`、readSource 六项。`sources.*.language` **刻意非 volatile**——设置页没有该控件
 * （按 spec「不做无关改动」），保留它只是不改既有配置形状；标记非 volatile 不改运行期行为
 * （`resolveConfig` 仍会解析它），代价仅是它不出现在设置表单里、且**不可经设置页写入**。
 */
export const Config = z.object({
  contact: z.string().default('').volatile(),
  chain: z.object({
    order: z.array(z.string()).default([...DEFAULT_ORDER]).volatile(),
    cooldownSeconds: z.number().step(1).min(0).max(3600).default(300).volatile(),
    timeoutMs: z.number().step(1).min(1000).max(120000).default(15000).volatile(),
  }).default({}),
  engines: z.object(Object.fromEntries(
    Object.entries(ENGINE_DEFAULTS).map(([id, v]) => [
      id,
      z.object(engineSubSchema(v.enabled, v.apiKeyEnv, id === 'searxng')).default({}),
    ]),
  )).default({}),
  sources: z.object(Object.fromEntries(
    Object.entries(SOURCE_DEFAULTS).map(([id, v]) => [
      id,
      z.object({
        ...engineSubSchema(v.enabled, v.apiKeyEnv, false),
        ...(id === 'wikipedia' ? { language: z.string().default('zh') } : {}),
      }).default({}),
    ]),
  )).default({}),
  readSource: z.object({
    defaultChars: z.number().step(1).min(1000).max(20000).default(8000).volatile(),
    maxChars: z.number().step(1).min(1000).max(20000).default(20000).volatile(),
    allowPrivate: z.boolean().default(false).volatile(),
    persist: z.boolean().default(true).volatile(),
    dir: z.string().default('').volatile(),
    maxTotalMB: z.number().step(1).min(1).max(10240).default(256).volatile(),
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
 * 配置值是否为 cordis volatile 引用。
 * 鸭子类型（`typeof value.get === 'function'`）而非 import `Volatile<T>`：该协议以 `Symbol.for`
 * 为身份，且平台会把「本 schema 之外的普通值」原样交给插件（对象式插件形态、手写行 config、
 * 裸 node 单测注入的普通对象）——不认这些形态就会把普通值读成 undefined。
 * 官方同款判据见 `@deepseek-ai/cosmokit` 的 `isVolatile`（`Symbol.for('cosmokit.volatile.write') in value`）。
 */
const isVolatileRef = (value) => typeof value === 'object' && value !== null && typeof value.get === 'function'

/**
 * 递归把 loader 解析出的 config 解包成纯数据。
 *
 * volatile 字段在运行期是**引用对象**，`ref.get()` 永远答最新值（设置页写入即替换其内部快照，
 * 不重挂载），故**每次调用现读**：无需 watch、无陈旧快照窗口——这正是旧代 `installSection` 的
 * `setSource`/`onChange` 回调在新模型下的消失方式。
 *
 * 必须**递归**：volatile 是逐叶子标记的（见文件头摆放约束），`chain`/`engines`/`sources`/
 * `readSource` 这些中间对象仍是普通对象、其内部字段才是引用。只解一层会把 `{ order: ref }`
 * 这种形状交给 core，而 core 读的是 `cfg.chain.order`（应为数组）。
 * @param {unknown} value
 * @returns {unknown} 纯数据快照（volatile 引用取当前值，普通值原样）
 */
function unwrapVolatile(value) {
  if (isVolatileRef(value)) return unwrapVolatile(value.get())
  if (Array.isArray(value)) return value.map(unwrapVolatile)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapVolatile(child)]))
  }
  return value
}

/**
 * 配置只读门面：把 apply 收到的 config 读成完整快照（**每次调用现读**，不缓存）。
 *
 * 取代旧 `installSettings` 返回的 `{ current() }`：旧版要经 `ctx.inject(['settings'], …)` 起子
 * fiber、等 settings 服务就绪后 `installSection` 才拿得到权威值，服务缺席还要回落 entry config；
 * 新模型的配置真相**就在本行的 `Config` 里**，无需任何服务、不存在"缺席"分支。
 * @param {unknown} config apply 收到的配置
 * @returns {{ current: () => CoreConfig }} 语义与旧 `installSettings(...).current` 逐字一致
 */
export function createSettings(config) {
  return { current: () => resolveConfig(unwrapVolatile(config)) }
}

/**
 * 注册解析前跨字段校验。
 *
 * `internal/config` 是 waterfall：监听器**必须**调用 `next()`，返回值即后续使用的配置
 * （本层只校验、不改编排，故原样返回）。候选是**原始** config（未经 schema 归一，`!!js` 尚未
 * 求值）——与设置页写路径的 `config-editor.edit` 走**同一条**瀑布（`fiber.ctx.waterfall(fiber,
 * 'internal/config', next, …)`），故抛错即让那笔写被拒且**不落盘**。
 * `this !== ctx.fiber` 表示是别的 fiber 在解析自己的配置，不属本行，直接放行。
 *
 * ⚠ **schema 归一发生在本 waterfall 之后**（`_resolveConfig`：先 waterfall 再 `resolveConfig`），
 * 因此候选里缺省字段尚未填充 ⇒ 校验前先 `resolveConfig` 补齐（与旧代 `installSection` 的
 * `validate` 作用在已解析值上等价）。
 *
 * 抛错的后果（vendor/loader/src/config/entry.ts `_commitVolatile`）：候选被拒、**运行中的引用
 * 不动**，loader 记一条 warn，原始 config 保留到下次激活。⇒ 运行期校验经此瀑布**永不**让
 * fiber 失败：`Fiber._reload` 与 `_commitVolatile` 都各自 `try/catch`（前者不上抛、后者只 warn）。
 * @param {import('@deepseek-ai/cordis').Context} ctx Host 插件上下文
 */
export function installConfigValidation(ctx) {
  ctx.on('internal/config', function (_raw, next) {
    const candidate = next()
    if (this !== ctx.fiber) return candidate
    validateConfig(candidate)
    return candidate
  })
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
