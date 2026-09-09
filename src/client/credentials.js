// credentials — 官方 `ctx.remote.credentials` 的浏览器门面：describe/set/unset + 错误归一。
//
// 边界：值单向写入、永不回显；Remote 命名空间缺席（如未挂 settings-controller）时
// describe 报 configured=false + 不可写，UI 据此渲染禁用态而不是崩溃。
// @ts-check

import { RpcError } from './api.js'

/**
 * @typedef {Object} CredentialState
 * @property {boolean} configured
 * @property {string | null} source
 * @property {boolean} writable
 */

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {{ describe: (refs: string[]) => Promise<Map<string, CredentialState>>, set: (ref: string, value: string) => Promise<void>, unset: (ref: string) => Promise<void> }}
 */
export function createCredentials(ctx) { // quality-floor: ignore docstring-promise throw 均在返回的闭包方法内（RpcError），外层工厂不抛
  /** 生成 Remote 面在 client 图上按命名空间挂载；缺席时返回 undefined（不抛）。 */
  function remoteCredentials() {
    try {
      return /** @type {{ describe?: Function, set?: Function, unset?: Function } | undefined} */ (
        ctx.remote && /** @type {Record<string, unknown>} */ (ctx.remote).credentials
      )
    } catch {
      return undefined
    }
  }

  /**
   * typert Remote 返回原始 Result 信封：拆包，业务失败转 RpcError。
   * @param {unknown} result
   * @param {string} op
   */
  function unwrap(result, op) {
    if (result && typeof result === 'object' && result.ok === true) return result.value
    const failure = result && typeof result === 'object' && result.error ? result.error : {}
    throw new RpcError(failure.message || `credentials.${op} 失败`, { code: failure.code || 'internal', retryable: false })
  }

  return {
    /**
     * @param {string[]} refs
     * @returns {Promise<Map<string, CredentialState>>}
     */
    async describe(refs) {
      const rc = remoteCredentials()
      const out = new Map()
      if (!rc || typeof rc.describe !== 'function') {
        for (const ref of refs) out.set(ref, { configured: false, source: null, writable: false })
        return out
      }
      const value = unwrap(await rc.describe(refs), 'describe')
      const record = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {}
      for (const ref of refs) {
        const info = record[ref] && typeof record[ref] === 'object' ? /** @type {Record<string, unknown>} */ (record[ref]) : {}
        out.set(ref, {
          configured: info.configured === true,
          source: typeof info.source === 'string' ? info.source : null,
          writable: info.writable === true,
        })
      }
      return out
    },
    /**
     * @param {string} ref
     * @param {string} value
     */
    async set(ref, value) {
      const rc = remoteCredentials()
      if (!rc || typeof rc.set !== 'function') throw new RpcError('凭据中心不可用：当前部署未挂载 credentials Remote 命名空间', { code: 'unavailable', retryable: false })
      unwrap(await rc.set(ref, value), 'set')
    },
    /**
     * @param {string} ref
     */
    async unset(ref) {
      const rc = remoteCredentials()
      if (!rc || typeof rc.unset !== 'function') throw new RpcError('凭据中心不可用：当前部署未挂载 credentials Remote 命名空间', { code: 'unavailable', retryable: false })
      unwrap(await rc.unset(ref), 'unset')
    },
  }
}
