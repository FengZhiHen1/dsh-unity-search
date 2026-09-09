// 适配层配置面纯函数：schemastery 缺省合并与校验规则（不起 cordis 上下文，只测数据层）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config, fullDefaults, mergeConfig, resolveConfig, validateConfig, ENGINE_IDS, SOURCE_IDS, TOOL_SOURCE_ENUM, DEFAULT_ORDER } from '../src/adapter/settings.js'

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

test('Config schema：空对象全缺省；类型违规被拒（schemastery 调用即校验）', () => {
  const parsed = Config({})
  assert.deepEqual(parsed.chain.order, [...DEFAULT_ORDER])
  assert.equal(parsed.contact, '')
  assert.throws(() => Config({ readSource: { defaultChars: 'many' } }))
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

test('resolveConfig：raw → 缺省合并产物且过校验', () => {
  const cfg = resolveConfig({ contact: 'a@b.c' })
  assert.equal(cfg.contact, 'a@b.c')
  assert.deepEqual(cfg.chain.order, [...DEFAULT_ORDER])
})
