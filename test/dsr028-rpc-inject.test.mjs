// DSR-028 回归：RPC 必须在 `ctx.inject(['webServer'], …)` 回调里、用**回调给的 ctx** 注册。
//
// 生产实测（0.1.7-rc.2，2026-09-28）：test 实例启动后本插件行挂载失败并报
//   `cannot get property "webServer" without inject`
//   （栈：registerRpc → adapter/rpc.js:60 → connection rpc.handle → register → owner.webServer）
// 成因：平台把 `connection.rpc.handle` 的 owner 绑成**读该服务的 ctx**
//   （connection/lib/index.js:573 `const owner = this.ctx`），注册末端执行
//   `owner.effect(() => owner.webServer.register(route))`（同文件 :656）⇒ 只有读该 ctx 的
//   inject 声明内有 webServer 才放行（cordis reflect.ts:140 `Reflect.has(target, prop)` 是守卫入口）。
//
// 本文件把该守卫复刻进假 ctx，钉死两个易错点（消融已验：改回直接调用即复现生产报错）。
// 这也是本插件**首次**覆盖 `apply` 的 RPC 接线——此前 test/ 无任何 registerRpc 覆盖，
// 正是该缺陷得以漏到实测的原因。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../src/adapter/index.js'
import { CHANNEL } from '../src/adapter/rpc.js'

const mkTmp = () => mkdtemp(join(tmpdir(), 'dsh-us-dsr028-'))
const cleanup = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })

/**
 * 假 Host ctx：只提供本插件 inject 的服务面，并复刻 webServer 守卫语义。
 * - 外层 `ctx.connection.rpc.handle` **必抛**（生产形态：触达 owner.webServer 时被拒）
 * - `ctx.inject(['webServer'], cb)` 交给 cb 的 ctx 才有可用的 `connection.rpc.handle`
 */
function fakeCtx(home) {
  const calls = []
  const disposers = []
  const ctx = {
    logger: { debug() {}, warn() {}, info() {} },
    // 外层连接服务：与生产同形地抛（守卫在 connection 内部触达 webServer 时触发）
    connection: {
      rpc: {
        handle: () => { throw new Error('cannot get property "webServer" without inject') },
      },
    },
    // 本插件静态 inject 的其余服务：给最小真实面（本用例只验接线，不驱动其行为）。
    // 方法名按源码实际调用点给全，否则 apply 会在到达 RPC 接线前就抛（见 seam.js:60 等）。
    web: {
      registerSearchProvider: () => () => {},
      registerFetchProvider: () => () => {},
      search: async () => ({ items: [] }),
      fetch: async () => ({ body: '' }),
    },
    tools: { register: () => () => {} },
    skills: { registerProvider: () => () => {} },
    get: () => undefined,
    on: () => () => {},
    effect: (fn) => { disposers.push(fn()) },
    dshHomePath: (...parts) => join(home, ...parts),
    /** 动态注入：只有回调拿到的 ctx 才能读连接服务的注册面。 */
    inject(deps, callback) {
      calls.push(['inject', deps.join(',')])
      for (const d of deps) {
        if (d !== 'webServer') throw new Error(`fakeCtx.inject: 本假件只提供 webServer，收到 ${d}`)
      }
      const injected = Object.create(ctx)
      injected.connection = {
        rpc: { handle: (channel) => { calls.push(['rpc', channel]) } },
      }
      return callback(injected, undefined)
    },
    calls,
    async dispose() { for (const d of disposers) await (typeof d === 'function' ? d() : d) },
  }
  return ctx
}

test('DSR-028：RPC 走动态注入注册；直接调或误用外层 ctx 都会撞 webServer 守卫', async (t) => {
  const home = await mkTmp()
  t.after(() => cleanup(home))

  const ctx = fakeCtx(home)
  // Config 由 loader 解析后传入；本用例只验 RPC 接线，给最小合法配置。
  plugin.apply(ctx, plugin.Config({}))

  // ① 生产正确路径：经 inject 回调注册，且通道名正确
  assert.deepEqual(ctx.calls.filter(([k]) => k === 'rpc'), [['rpc', CHANNEL]],
    `RPC 必须在动态注入回调里注册成功，通道 ${CHANNEL}`)
  assert.ok(ctx.calls.some(([k, d]) => k === 'inject' && d === 'webServer'),
    '必须请求注入 webServer（否则平台注册路径会撞守卫）')

  // ② 易错点一：绕过动态注入、直接在外层 ctx 注册 → 与生产同形地抛错
  assert.throws(() => ctx.connection.rpc.handle(CHANNEL), /without inject/,
    '外层 ctx 无 webServer 声明 ⇒ 直接注册必须抛（这正是生产失败的形态）')

  // ③ 易错点二：注入回调里误用外层 ctx（而非回调 ctx）→ 同样抛
  let leaked = null
  ctx.inject(['webServer'], () => {
    try { ctx.connection.rpc.handle(CHANNEL) } catch (error) { leaked = error }
  })
  assert.match(String(leaked?.message), /without inject/,
    '注入回调里若读外层 ctx，仍会撞守卫 ⇒ 必须用回调给的 ctx')

  await ctx.dispose()
})
