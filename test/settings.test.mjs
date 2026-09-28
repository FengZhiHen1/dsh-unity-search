// 适配层配置面纯函数：schemastery 缺省合并、volatile 摆放与解包、跨字段校验（不起 cordis，只测数据层）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Config, fullDefaults, mergeConfig, resolveConfig, validateConfig, createSettings, installConfigValidation, NAMESPACE, ENGINE_IDS, SOURCE_IDS, TOOL_SOURCE_ENUM, DEFAULT_ORDER } from '../src/adapter/settings.js'
import adapter from '../src/adapter/index.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('枚举与预算：C-01 常驻 2 工具、sources 枚举 = web + 13 源', () => {
  assert.equal(ENGINE_IDS.length, 10)
  assert.equal(SOURCE_IDS.length, 13)
  assert.deepEqual(TOOL_SOURCE_ENUM, ['web', ...SOURCE_IDS])
  assert.deepEqual(DEFAULT_ORDER.slice(0, 3), ['bing', 'ddg', 'anysearch'])
  assert.equal(DEFAULT_ORDER.length, 10)
})

test('fullDefaults：族齐全 + 默认关闭位（searxng/tavily/exa/perplexity）', () => {
  const d = fullDefaults()
  assert.equal(d.chain.order.join(','), DEFAULT_ORDER.join(','))
  assert.equal(d.engines.searxng.enabled, false)
  assert.equal(d.engines.tavily.enabled, false)
  assert.equal(d.engines.exa.enabled, false)
  assert.equal(d.engines.perplexity.enabled, false)
  assert.equal(d.engines.keenable.enabled, true, 'keenable 免 key 通道默认开')
  assert.equal(d.sources.arxiv.enabled, true)
  assert.equal(d.readSource.persist, true)
  assert.equal(d.readSource.defaultChars, 8000)
  assert.equal(d.readSource.maxChars, 20000)
})

test('Config：字段全为 volatile 引用；空对象解析出全部缺省（调用即校验摆放合法性）', () => {
  // 「调用一次」本身就是摆放合法性断言：非法摆放（子对象/数组元素标 volatile、或外层已 volatile）
  // 在 Schema.resolve 里抛 `volatile fields require a fixed object path`。
  const parsed = Config({})
  assert.equal(typeof parsed.chain.order.get, 'function', 'chain.order 必须是 volatile 引用')
  assert.equal(typeof parsed.contact.get, 'function')
  assert.equal(typeof parsed.readSource.dir.get, 'function')
  assert.deepEqual(parsed.chain.order.get(), [...DEFAULT_ORDER])
  assert.equal(parsed.contact.get(), '')
  assert.equal(parsed.readSource.defaultChars.get(), 8000)
  assert.throws(() => Config({ readSource: { defaultChars: 'many' } }))
})

test('Config 缺省值必须与 fullDefaults 同源（防"改 schema 顺手把所有引擎默认改成 true"）', () => {
  // 回归：引入 volatile 后 engineSubSchema 一度丢掉了逐项缺省（一律 true / 空 key 引用），
  // 而 fullDefaults 仍逐项给值——两者不一致时「空 config 的解析结果」与「回落快照」会分叉，
  // 且因为是 default 而非 required，没有任何东西会报错。本用例把两者钉死。
  const parsed = Config({})
  const defaults = fullDefaults()
  for (const id of ENGINE_IDS) {
    assert.equal(parsed.engines[id].enabled.get(), defaults.engines[id].enabled, `引擎 ${id} 的 enabled 缺省不一致`)
    assert.equal(parsed.engines[id].apiKeyEnv.get(), defaults.engines[id].apiKeyEnv, `引擎 ${id} 的 apiKeyEnv 缺省不一致`)
  }
  for (const id of SOURCE_IDS) {
    assert.equal(parsed.sources[id].enabled.get(), defaults.sources[id].enabled, `源 ${id} 的 enabled 缺省不一致`)
    assert.equal(parsed.sources[id].apiKeyEnv.get(), defaults.sources[id].apiKeyEnv, `源 ${id} 的 apiKeyEnv 缺省不一致`)
  }
  assert.equal(parsed.chain.cooldownSeconds.get(), defaults.chain.cooldownSeconds)
  assert.equal(parsed.chain.timeoutMs.get(), defaults.chain.timeoutMs)
  assert.equal(parsed.readSource.maxTotalMB.get(), defaults.readSource.maxTotalMB)
})

test('createSettings：逐层递归解包 volatile（中间对象不是引用）', () => {
  const parsed = Config({})
  const settings = createSettings(parsed)
  const before = settings.current()
  // 递归解包：中间对象（chain/engines/sources/readSource）是普通对象、叶子才是引用。
  assert.ok(Array.isArray(before.chain.order), 'chain.order 必须是数组而不是 volatile 引用对象')
  assert.equal(before.engines.bing.apiKeyEnv, '')
  assert.equal(before.readSource.defaultChars, 8000)
  assert.equal(before.readSource.allowPrivate, false)
  // 两次调用各得独立快照（现读、不缓存同一对象）。
  assert.notEqual(settings.current(), settings.current())
})

test('createSettings：普通对象（非 volatile）原样可读，不把普通值读成 undefined', () => {
  const settings = createSettings({ engines: { bing: { enabled: false, apiKeyEnv: 'MY_KEY' } }, contact: 'a@b.c' })
  const cfg = settings.current()
  assert.equal(cfg.contact, 'a@b.c')
  assert.equal(cfg.engines.bing.enabled, false)
  assert.equal(cfg.engines.bing.apiKeyEnv, 'MY_KEY')
  assert.deepEqual(cfg.chain.order, [...DEFAULT_ORDER], '未提供的字段回落缺省')
})

test('createSettings：空/非法入参回落全缺省而不抛', () => {
  for (const raw of [undefined, null, 42, 'x', []]) {
    const cfg = createSettings(raw).current()
    assert.deepEqual(cfg.chain.order, [...DEFAULT_ORDER], `入参 ${String(raw)} 应回落缺省`)
    assert.equal(cfg.readSource.maxChars, 20000)
  }
})

test('mergeConfig：深合并对象、数组整体替换、不改入参', () => {
  const base = fullDefaults()
  const merged = mergeConfig(base, { chain: { cooldownSeconds: 60 }, engines: { bing: { apiKeyEnv: 'X' } } })
  assert.equal(merged.chain.cooldownSeconds, 60)
  assert.deepEqual(merged.chain.order, [...DEFAULT_ORDER])
  assert.equal(merged.engines.bing.apiKeyEnv, 'X')
  assert.equal(merged.engines.bing.enabled, true, '兄弟键保留')
  assert.equal(base.engines.bing.apiKeyEnv ?? '', '', '入参不被污染')
  const replace = mergeConfig(base, { chain: { order: ['ddg'] } })
  assert.deepEqual(replace.chain.order, ['ddg'])
})

test('validateConfig：脏数据抛清晰原因', () => {
  validateConfig(fullDefaults())
  assert.throws(() => validateConfig({ ...fullDefaults(), chain: { order: ['ghost'], cooldownSeconds: 300, timeoutMs: 15000 } }), /ghost/)
  assert.throws(() => validateConfig({ ...fullDefaults(), chain: { order: ['bing', 'bing'], cooldownSeconds: 300, timeoutMs: 15000 } }), /重复/)
  assert.throws(() => validateConfig({ ...fullDefaults(), readSource: { ...fullDefaults().readSource, defaultChars: 19999, maxChars: 1000 } }), /maxChars/)
  assert.throws(() => validateConfig({ ...fullDefaults(), engines: { ...fullDefaults().engines, searxng: { enabled: true, apiKeyEnv: '', instances: ['ftp://bad.tld'] } } }), /http/)
})

test('validateConfig：waterfall 候选未经 schema 归一 ⇒ 缺省字段必须先补齐再校验', () => {
  // internal/config 的候选是**原始** config（schema 归一在瀑布之后）。若校验前不 resolveConfig，
  // 一笔只改 cooldownSeconds 的写入会因 chain.order 缺席而误报「chain.order 不能为空」。
  validateConfig({ chain: { cooldownSeconds: 60 } })
  assert.throws(() => validateConfig({ chain: { order: [], cooldownSeconds: 60 } }), /不能为空/)
})

test('installConfigValidation：本 fiber 非法抛、合法放行、他 fiber 不拦、必调 next', () => {
  const listeners = []
  const selfFiber = { name: 'self' }
  const ctx = { fiber: selfFiber, on: (name, fn) => { listeners.push([name, fn]); return () => {} } }
  installConfigValidation(ctx)
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0][0], 'internal/config')
  const [, listener] = listeners[0]

  // 合法：原样返回候选，且 next 被调用（waterfall 不调 next 即短路改写编排）。
  let nextCalls = 0
  const ok = listener.call(selfFiber, { chain: { cooldownSeconds: 10 } }, () => { nextCalls += 1; return { contact: 'x' } })
  assert.equal(nextCalls, 1)
  assert.deepEqual(ok, { contact: 'x' })

  // 本 fiber 非法：抛（写路径据此拒绝且不落盘）。
  assert.throws(() => listener.call(selfFiber, { chain: { order: ['ghost'] } }, () => ({ chain: { order: ['ghost'] } })), /ghost/)

  // 他 fiber：先放行 next，再原样返回（不校验别人的配置）。
  const otherResult = listener.call({ name: 'other' }, { chain: { order: ['ghost'] } }, () => ({ chain: { order: ['ghost'] } }))
  assert.deepEqual(otherResult, { chain: { order: ['ghost'] } })
})

test('Config 必须挂在 default 导出对象上（loader 读 plugin.Config；具名导出到不了那里）', () => {
  assert.equal(adapter.name, 'unity-search')
  assert.equal(adapter.Config, Config, '对象式插件的 Config 必须能被 loader 从 default 上取到')
  assert.deepEqual(adapter.inject, ['web', 'tools', 'skills', 'connection', 'dshHomePath'])
  // 配置真相 = 本行的 Config；settings 服务不再需要出现在 inject 里。
  assert.ok(!adapter.inject.includes('settings'), '0.1.7 模型不再依赖 ctx.settings')
})

test('NAMESPACE 必须与 cordis.patch.yml 的 insert 行 id 逐字一致（否则配置页与命名空间静默解绑）', () => {
  const patch = readFileSync(join(PLUGIN_ROOT, 'cordis.patch.yml'), 'utf8')
  const match = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)
  assert.ok(match, 'cordis.patch.yml 里找不到 insert 行的 id')
  assert.equal(match[1], NAMESPACE)
})

test('设置页会写的每条路径都必须是 volatile 叶子（否则 Host 写被拒、且只在浏览器里可见）', () => {
  // 平台判据（packages/settings/settings/src/index.ts:388 / schema.ts:74-79）：写路径必须落在
  // volatile 之下，否则抛 `Config field "x" is not volatile`；只有 volatile 字段才出现在设置表单里。
  // 本用例断言更强的一档（**叶子自身**标了 volatile），它蕴含平台那条「祖先链上有 volatile」——
  // 且不复制平台实现，只读本插件自己 schema 的元数据。
  // 触发场景：给 section.jsx 加了新控件、却忘了在 Config 对应字段上加 .volatile()。
  const leaf = (path) => path.reduce((node, key) => node?.dict?.[key], Config)
  const paths = [
    ['contact'],
    ['chain', 'order'], ['chain', 'cooldownSeconds'], ['chain', 'timeoutMs'],
    ['readSource', 'defaultChars'], ['readSource', 'maxChars'], ['readSource', 'allowPrivate'],
    ['readSource', 'persist'], ['readSource', 'dir'], ['readSource', 'maxTotalMB'],
    ...ENGINE_IDS.flatMap((id) => [['engines', id, 'enabled'], ['engines', id, 'apiKeyEnv']]),
    ...SOURCE_IDS.flatMap((id) => [['sources', id, 'enabled'], ['sources', id, 'apiKeyEnv']]),
    ['engines', 'searxng', 'instances'],
  ]
  for (const path of paths) {
    const node = leaf(path)
    assert.ok(node, `路径 ${path.join('.')} 不在 Config schema 里（设置页写了 schema 不认识的字段）`)
    assert.equal(node.meta?.volatile, true, `路径 ${path.join('.')} 未标 .volatile()，设置在页面里写了也会被 Host 拒绝`)
  }
  // 反向：设置页**没有**控件的字段刻意非 volatile（不许悄悄可写）。
  assert.notEqual(leaf(['sources', 'wikipedia', 'language']).meta?.volatile, true)
})

test('resolveConfig：raw → 缺省合并产物且过校验', () => {
  const cfg = resolveConfig({ contact: 'a@b.c' })
  assert.equal(cfg.contact, 'a@b.c')
  assert.deepEqual(cfg.chain.order, [...DEFAULT_ORDER])
})
