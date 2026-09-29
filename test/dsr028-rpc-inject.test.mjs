// RPC 承载闸门（2026-09-28 重写，取代已失效的 DSR-028 用例）
//
// 旧用例是**盲闸**：假件的 `inject()` 回调里直接装上可用的 `connection.rpc.handle`
// （由假件自己完成注册），被测代码的真实失败点 `owner.webServer` 从未被触达 ⇒ 恒绿。
// **教训：假件的桩必须落在被测代码的失败点之外。**
//
// 真因：失败发生在 **connection 服务自己的 ctx** 上（`rpc-host.ts:87`
//   `get rpc() { const owner = this.ctx }`），而 `webserver` 行与 `connection` 行是
//   **顶层兄弟行** ⇒ `owner.webServer` 永远解析不到。改**调用方**的 inject（动态或静态）
//   都无效（消融：两种写法均 ❌）。且当时的「修复」把**响亮失败**（行挂载失败 + 日志）
//   变成了**静默 405**（行 `active`、无日志）——**可观测性倒退**。
//
// 现方案：改用 `connection.fetch.register`（`/api` 精确 Fetch 路由）——
//   registerFetchRoute **不读 `owner.webServer`**，且由 connection 自己正确挂载的 `/api`
//   承载 ⇒ **免费继承**围栏(403)/认证(401)/`connection/request` waterfall/体积上限(413)。
//   依据：仓库级 docs/decisions/0002-自定义RPC通道改用精确Fetch路由.md。
//
// 新闸的两条腿（都恒跑，不依赖真实平台包）：
//   ① **接线闸**：注册必须落在 `connection.fetch.register`，路径/方法/body 模式正确；
//      旧写法（`rpc.handle`）在本假件上必抛 `without inject` ⇒ 回退立即变红。
//   ② **可答闸**：**真的**向已注册路由派发一次信封请求，断言拿到标准 `server-response`。
//      旧盲闸从不发请求，故通道是否可达它根本不知道——这正是当初漏到实测的原因。
//
// 安全语义（围栏/认证/上限）由平台 `/api` 路由承担、本插件不再复制 ⇒ 不在本层断言
// （那是平台契约，由真实部署类实验覆盖）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../src/adapter/index.js'
import { RPC_ENDPOINTS } from '../src/adapter/rpc.js'

const mkTmp = () => mkdtemp(join(tmpdir(), 'dsh-us-dsr028-'))
const cleanup = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })

/**
 * 假 Host ctx：只提供本插件 inject 的服务面，并复刻**关键失败点**。
 * - `ctx.connection.rpc.handle` **必抛** `cannot get property "webServer" without inject`
 *   （生产形态：connection 服务自己的 ctx 触达 webServer 时被拒；与调用方 inject 无关）
 * - `ctx.connection.fetch.register`：**只记录、不代为完成任何事**
 *   （桩落在失败点之外；真实平台按完整 pathname 精确匹配，由用例自己派发验证）
 */
function fakeCtx(home) {
  const calls = []
  const disposers = []
  // 精确 Fetch 路由表：**只记录，不代为完成任何事**（关键：桩必须落在失败点之外）。
  // 真实平台按完整 pathname 精确匹配 ⇒ 这里复刻同一语义，供用例自行派发验证。
  const routes = new Map()
  const ctx = {
    logger: { debug() {}, warn() {}, info() {} },
    // 外层连接服务：与生产同形地抛（守卫在 connection 内部触达 webServer 时触发）
    connection: {
      rpc: {
        handle: () => { throw new Error('cannot get property "webServer" without inject') },
      },
      fetch: {
        register: (route) => {
          if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
          routes.set(route.path, route)
          calls.push(['fetch-route', route.path])
          return () => { routes.delete(route.path) }
        },
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
    routes,
    calls,
    async dispose() { for (const d of disposers) await (typeof d === 'function' ? d() : d) },
  }
  return ctx
}

test('RPC 承载：走 /api 精确 Fetch 路由注册，且真的能答一次信封请求', async (t) => {
  const home = await mkTmp()
  t.after(() => cleanup(home))

  const ctx = fakeCtx(home)
  // Config 由 loader 解析后传入；本用例只验 RPC 承载，给最小合法配置。
  plugin.apply(ctx, plugin.Config({}))

  // ① 接线闸：不得再走 rpc.handle（它在本假件上必抛），必须落在 fetch 路由表
  assert.ok(!ctx.calls.some(([k]) => k === 'rpc'), '不得再调用 connection.rpc.handle（生产注册不上）')
  assert.deepEqual([...ctx.routes.keys()].sort(),
    RPC_ENDPOINTS.map((ep) => `/api/unity-search/${ep}`).sort(),
    '每个端点一条 /api 精确路由，且命名空间正确')

  // ② 可答闸：真的派发一次请求（复刻平台按 pathname 精确匹配 + POST 限定）
  const route = ctx.routes.get('/api/unity-search/state')
  const response = await route.fetch(new Request('http://127.0.0.1:3080/api/unity-search/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r-1', method: 'unity-search/state', payload: {} }),
  }))
  assert.equal(response.status, 200, '已注册端点必须能答 200（旧盲闸从不发请求，故查不出 405 类失效）')
  const envelope = await response.json()
  assert.equal(envelope.type, 'server-response')
  assert.equal(envelope.rpcId, 'r-1', 'rpcId 必须原样带回（客户端会比对，不匹配即抛）')
  assert.equal(envelope.result.ok, true, 'state 为纯本地投影，空载荷应成功')

  // ③ 契约面：method 与端点不符 → 400（平台 rpcFetchHandler 同形）
  const mismatched = await route.fetch(new Request('http://127.0.0.1:3080/api/unity-search/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r-2', method: 'other/thing', payload: {} }),
  }))
  assert.equal(mismatched.status, 400, 'method ≠ 端点必须 400')

  // ④ 生命周期：dispose 后路由必须摘除（否则插件重载会因 duplicate 抛错）
  await ctx.dispose()
  assert.equal(ctx.routes.size, 0, 'dispose 后所有精确路由必须摘除')
})
