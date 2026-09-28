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
import { Config, createSettings, installConfigValidation, createCredentialState } from './settings.js'
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
   * @param {unknown} config 本行 loader entry 的已解析配置；可配置字段是 volatile 引用（见 adapter/settings.js）
   */
  apply(ctx, config) {
    const logger = {
      debug: (/** @type {string} */ msg, /** @type {unknown} */ data) => ctx.logger.debug(`unity-search: ${msg}${data !== undefined ? ` ${safeStringify(data)}` : ''}`),
      warn: (/** @type {string} */ msg, /** @type {unknown} */ data) => ctx.logger.warn(`unity-search: ${msg}${data !== undefined ? ` ${safeStringify(data)}` : ''}`),
    }

    // 配置面（0.1.7 模型）：`Config` 即配置真相，设置页写入经 loader 的 volatile 提交路径
    // 原地替换引用（不重挂载本 fiber），故无需订阅即可现读最新值。
    // 跨字段非法（chain.order 含未知/重复引擎、readSource 预算倒挂、searxng 实例 URL）在
    // **写路径**被 `internal/config` 瀑布拒掉且不落盘——这是旧代 installSection 的 `validate`
    // 在新模型下的落点，也是"自绘设置页只做形状校验、真校验在 Host"这一分工的实现。
    installConfigValidation(ctx)
    const settings = createSettings(config)

    // 凭据取值缓存。**不是** let + 回调赋值了：旧代要把创建推迟到 installSettings 的回调里
    // 才能闭包引用它，新模型没有那个回调。
    const credentials = createCredentialState(ctx, settings)

    // 凭据中心事件 → 缓存刷新（服务缺席时无事件可订）。ctx.on 返回 disposer 随 fiber 清理。
    // 配置变更不再挂回调：`settings.current()` 每次调用现读 volatile 引用，本就没有缓存可失效
    // （旧代 settings 变更回调只做 `credentials.refresh()`，而引用名集合同样在 refresh 内现读
    //  ——语义等价，故此处**不需要** `loader/volatile-update` 订阅）。
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
