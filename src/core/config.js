// 设置快照访问助手：引擎/源配置的读取与可用性理由推导。
// core 假设 config 已由 adapter 层填好 schema 默认值，但对缺失键保守处理（缺 enabled 视为 true，与设置文档「缺省即启用」一致）。
// @ts-check

/**
 * 取引擎配置行（family: web）。
 * @param {import('./types.js').CoreRuntime} runtime
 * @param {string} id
 * @returns {{ enabled: boolean, apiKeyEnv?: string, instances?: string[] }}
 */
export function engineConfig(runtime, id) {
  const cfg = runtime.config.engines?.[id] ?? {}
  return { ...cfg, enabled: cfg.enabled !== false }
}

/**
 * 取源配置行（academic/platform）。
 * @param {import('./types.js').CoreRuntime} runtime
 * @param {string} id
 * @returns {{ enabled: boolean, apiKeyEnv?: string, language?: string }}
 */
export function sourceConfig(runtime, id) {
  const cfg = runtime.config.sources?.[id]
  return { language: 'zh', ...cfg, enabled: cfg?.enabled !== false }
}

/**
 * 凭据引用是否解析到有值。apiKeyEnv 为空/缺省视为无需凭据（keyless 源）。
 * @param {string | undefined} apiKeyEnv
 * @param {import('./types.js').CoreRuntime} runtime
 * @returns {boolean}
 */
export function keyAvailable(apiKeyEnv, runtime) {
  if (typeof apiKeyEnv !== 'string' || apiKeyEnv.length === 0) return true
  const value = runtime.resolveCredential(apiKeyEnv)
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 推导适配器不可用原因（供链跳过记录与设置页状态徽标）。可用时返回 null。
 * 优先用适配器自带的 `unavailableReason`（能区分凭据缺失细节），缺省按通用规则推导。
 * @param {import('./types.js').SourceAdapter & { unavailableReason?: (runtime: import('./types.js').CoreRuntime) => string | null }} adapter
 * @param {import('./types.js').CoreRuntime} runtime
 * @returns {string | null}
 */
export function unavailableReasonOf(adapter, runtime) {
  if (typeof adapter.unavailableReason === 'function') return adapter.unavailableReason(runtime)
  return adapter.available(runtime) ? null : 'unavailable'
}
