// seam — web seam search provider 注册：引擎链结果投影为固定 WebSearchResult 形状。
//
// 边界：seam 面不穿完整信封（DSR-003），降级注记是唯一进 content 的证据信息；
// 链失败抛 WebError（工具层渲染为错误结果）。投影与注记规则本体在 core/envelope.js。
// 参考：docs/technical-details/L0-Seam接入.md。
// @ts-check

import { WebError } from '@deepseek-ai/dsh-web'
import { assembleEnvelope, projectToSeam } from '../core/envelope.js'
import { WEB_SOURCE_ID } from '../core/chain.js'

/** 供 available() 用的常驻未触发信号（available 无网络、不参与取消）。 */
const IDLE = new AbortController().signal

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{
 *   chain: import('../core/chain.js').WebChain,
 *   makeRuntime: (signal: AbortSignal) => import('../core/types.js').CoreRuntime,
 * }} deps
 * @returns {void}
 */
export function registerSeam(ctx, deps) { // quality-floor: ignore docstring-promise 函数体 throw 属内嵌 provider.search（链全不可用时抛 WebError），外层注册函数本身无抛出路径
  const { chain, makeRuntime } = deps
  const provider = {
    id: 'unity-search',
    available() {
      try {
        return chain.available(makeRuntime(IDLE))
      } catch (error) {
        // available 契约是本地廉价检查；意外抛出按不可用呈现，原因落日志（不静默）。
        ctx.logger.warn(`unity-search seam available() threw: ${String(error && error.message ? error.message : error)}`)
        return false
      }
    },
    /**
     * @param {{ query: string, maxResults?: number, timeRange?: string }} request
     * @param {AbortSignal} [signal]
     */
    async search(request, signal) {
      const runtime = makeRuntime(signal ?? IDLE)
      const searchRequest = { query: request.query, maxResults: request.maxResults, timeRange: request.timeRange }
      const { outcome, info, attempts, warnings } = await chain.search(searchRequest, runtime)
      // 单 web 源信封：链胜出 → ok；链耗尽/取消 → unavailable，seam 层抛 WebError。
      const envelope = assembleEnvelope({
        query: request.query,
        results: [outcome.status === 'ok'
          ? { id: WEB_SOURCE_ID, family: 'web', kind: 'ok', outcome, attempts, warnings }
          : { id: WEB_SOURCE_ID, family: 'web', kind: 'error', error: outcome.error ?? { code: 'network', message: 'chain failed without detail' }, attempts, warnings }],
        maxItems: request.maxResults ?? 10,
      })
      const projected = projectToSeam(envelope, info)
      if (projected.kind === 'unavailable') {
        const detail = projected.failed.map((f) => `${f.source}(${f.code}): ${f.message}`).join('; ')
        throw new WebError(`unity-search web chain failed: ${detail}`, 'WEB_SEARCH_FAILED')
      }
      return projected.value
    },
  }
  ctx.web.registerSearchProvider(provider)
  // registerSearchProvider 的注册与 disposer 均绑当前 fiber（平台保证卸载摘除），无需插件自持。
}
