// index — DSH Host 侧装配入口：settings/凭据 → core 运行时 → seam/tools/rpc/skill 四面接线。
//
// 边界：只做装配（组装 runtime、注册各面），不含领域逻辑；模块清单与分层规则见《项目结构设计》。
// 状态载体：引擎冷却表与凭据缓存都是本 fiber 闭包实例（配置热更新不重置冷却）。
// @ts-check

import { promises as nodeDns } from 'node:dns'
import { createRegistry } from '../core/registry.js'
import { createThrottle } from '../core/http.js'
import { createWebChain } from '../core/chain.js'
import { webEngines } from '../core/engines/index.js'
import { academicSources } from '../core/academic/index.js'
import { platformSources } from '../core/platforms/index.js'
import { Config, installSettings, createCredentialState } from './settings.js'
import { registerSeam } from './seam.js'
import { registerTools } from './tools.js'
import { registerRpc } from './rpc.js'
import { registerSkill } from './skill.js'

/** 常驻未触发信号：available()/state 投影等无网络路径复用。 */
const IDLE = new AbortController().signal

/** 可取消 sleep（throttle 闸用）；abort 时 reject，由 throttle 归一为 aborted。 */
function sleep(/** @type {number} */ ms, /** @type {AbortSignal} */ signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('sleep aborted'))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

export default {
  name: 'unity-search',
  inject: ['web', 'tools', 'skills', 'connection', 'dshHomePath'],
  Config,
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {import('../core/types.js').CoreConfig} config
   */
  apply(ctx, config) {
    const logger = {
      debug: (/** @type {string} */ msg, /** @type {unknown} */ data) => ctx.logger.debug(`unity-search: ${msg}${data !== undefined ? ` ${safeStringify(data)}` : ''}`),
      warn: (/** @type {string} */ msg, /** @type {unknown} */ data) => ctx.logger.warn(`unity-search: ${msg}${data !== undefined ? ` ${safeStringify(data)}` : ''}`),
    }

    // settings：installSection 缺席回落 entry 配置；变更仅触发凭据刷新（配置快照每次调用现读）。
    /** @type {{ refresh: () => Promise<void> } | null} */
    let credentials = null
    const settings = installSettings(ctx, config, () => {
      if (credentials) void credentials.refresh()
    })
    credentials = createCredentialState(ctx, settings)

    // 凭据中心事件 → 缓存刷新（服务缺席时无事件可订）。ctx.on 返回 disposer 随 fiber 清理。
    if (ctx.get('credentials') != null) {
      ctx.effect(() => ctx.on('credentials/reference-updated', () => {
        void credentials.refresh()
      }), 'unity-search: credentials watch')
    }
    // 启动预热：key 引擎的可用性判定依赖缓存命中，冷启动先拉一轮（失败已在内部 warn）。
    void credentials.refresh()

    const registry = createRegistry([...academicSources, ...platformSources])
    const diagRegistry = createRegistry([...webEngines, ...academicSources, ...platformSources])
    const engineState = new Map()
    const chain = createWebChain({ engines: webEngines, state: engineState })
    const throttle = createThrottle({ now: () => Date.now(), sleep, warn: (msg) => logger.warn(msg) })

    /**
     * 每次调用组装 core runtime（config 现读快照、signal 逐调用注入）；
     * 落盘目录缺省指 $DSH_HOME 插件数据区（test 红线：settings.readSource.dir 可覆盖为 fixture）。
     * @param {AbortSignal} signal
     * @returns {import('../core/types.js').CoreRuntime}
     */
    const makeRuntime = (signal) => {
      const cfg = settings.current()
      return {
        fetch: (input, init) => fetch(input, init),
        signal,
        resolveCredential: (ref) => credentials.resolve(ref),
        contact: cfg.contact,
        logger,
        now: () => Date.now(),
        sleep,
        throttle,
        dns: {
          lookup: async (hostname) => nodeDns.lookup(hostname, { all: true }),
        },
        config: {
          ...cfg,
          readSource: { ...cfg.readSource, dir: cfg.readSource.dir || ctx.dshHomePath('unity-search', 'readings') },
        },
      }
    }

    registerSeam(ctx, { chain, makeRuntime: (signal) => makeRuntime(signal ?? IDLE) })
    registerTools(ctx, { registry, chain, makeRuntime })
    registerRpc(ctx, { registry: diagRegistry, chain, settings, makeRuntime, resolveCredential: (ref) => credentials.resolve(ref) })
    registerSkill(ctx)
  },
}

/**
 * 日志 data 的安全序列化（循环引用/BigInt 不外抛）。
 * @param {unknown} data
 * @returns {string}
 */
function safeStringify(data) {
  try {
    return JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? String(v) : v)) ?? String(data)
  } catch {
    return String(data)
  }
}
