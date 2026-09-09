// fanout 归并逻辑：源分发、顺序确定性、force 直调、契约违约显形。链细节见 chain.test。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchSources, searchSingleSource, DEFAULT_MAX_RESULTS } from '../src/core/fanout.js'
import { makeRuntime, makeAdapter, okOutcome } from './helpers.mjs'

function deps(adapters, chainCalls = []) {
  const map = new Map(adapters.map((a) => [a.id, a]))
  const chain = {
    async search(request, runtime) {
      chainCalls.push(request)
      return {
        outcome: okOutcome([{ url: 'https://web.result/1' }]),
        info: { winner: 'bing', tried: [{ id: 'bing', outcome: 'ok' }] },
        attempts: [{ source: 'web:bing', outcome: 'ok', latencyMs: 2 }],
        warnings: [],
      }
    },
  }
  return { deps: { registry: { get: (id) => map.get(id) }, chain, runtime: makeRuntime() }, chainCalls }
}

test('缺省 sources → 只走链（web）', async () => {
  const { deps: d, chainCalls } = deps([])
  const env = await searchSources({ query: 'q' }, d)
  assert.deepEqual(env.sources.queried, ['web'])
  assert.equal(chainCalls.length, 1)
  assert.equal(env.status, 'ok')
})

test('未知源 id → failed(unknown_source) + warning，其余源不受影响', async () => {
  const { deps: d } = deps([makeAdapter('s1', 'academic', { search: async () => okOutcome([{ url: 'https://s1/1' }]) })])
  const env = await searchSources({ query: 'q', sources: ['s1', 'ghost'] }, d)
  assert.deepEqual(env.sources.queried, ['s1', 'ghost'])
  assert.deepEqual(env.sources.succeeded, ['s1'])
  assert.deepEqual(env.sources.failed, [{ source: 'ghost', code: 'unknown_source', message: 'unknown source: ghost' }])
  assert.equal(env.status, 'degraded')
  assert.match(env.warnings.join(' '), /未知源 id：ghost/)
})

test('不可用源被跳过（不执行 search）记 unavailable', async () => {
  let ran = false
  const off = makeAdapter('tavily', 'web', { available: false, search: async () => { ran = true; return okOutcome([]) } })
  const { deps: d } = deps([off])
  const env = await searchSources({ query: 'q', sources: ['tavily'] }, d)
  assert.equal(ran, false)
  assert.deepEqual(env.sources.failed[0].code, 'unavailable')
  assert.equal(env.status, 'unavailable')
})

test('timeRange 打到不支持源 → 源级 warning（照常执行）', async () => {
  const { deps: d } = deps([makeAdapter('github', 'platform', { search: async () => okOutcome([{ url: 'https://gh/x' }]) })])
  const env = await searchSources({ query: 'q', sources: ['github'], timeRange: 'week' }, d)
  assert.deepEqual(env.sources.succeeded, ['github'])
  assert.match(env.warnings.join(' '), /github 不支持 timeRange，已忽略/)
})

test('适配器违约抛出 → internal 显形 + 日志，信封仍收尾', async () => {
  const boom = makeAdapter('bad', 'academic', { search: async () => { throw new Error('oops') } })
  const { deps: d } = deps([boom, makeAdapter('good', 'academic', { search: async () => okOutcome([{ url: 'https://g/1' }]) })])
  const env = await searchSources({ query: 'q', sources: ['bad', 'good'] }, d)
  assert.equal(env.sources.failed[0].code, 'internal')
  assert.match(env.sources.failed[0].message, /oops/)
  assert.deepEqual(env.sources.succeeded, ['good'])
  assert.equal(env.status, 'degraded')
  assert.equal(d.runtime.logs.some((l) => l.level === 'warn' && /contract violation/.test(l.msg)), true)
})

test('结果顺序 = 请求顺序（与完成先后无关）', async () => {
  const slow = makeAdapter('slow', 'academic', { search: async () => { await new Promise((r) => setTimeout(r, 20)); return okOutcome([{ url: 'https://slow/1' }]) } })
  const fast = makeAdapter('fast', 'academic', { search: async () => okOutcome([{ url: 'https://fast/1' }]) })
  const { deps: d } = deps([slow, fast])
  const env = await searchSources({ query: 'q', sources: ['slow', 'fast'] }, d)
  assert.deepEqual(env.sources.queried, ['slow', 'fast'])
  assert.deepEqual(env.sources.succeeded, ['slow', 'fast'])
  assert.equal(env.items[0].source, 'slow', '同键归并时请求序先列者优先（跨源去重语义）')
})

test('searchSingleSource：force 直调不可用源并带状态警告', async () => {
  const off = makeAdapter('tavily', 'web', { available: false, search: async () => okOutcome([{ url: 'https://t/1' }]) })
  const { deps: d } = deps([off])
  const env = await searchSingleSource('tavily', { query: 'q' }, d)
  assert.deepEqual(env.sources.succeeded, ['tavily'], 'force 绕门')
  assert.match(env.warnings.join(' '), /直调诊断：该源当前不可用/)
})

test('searchSingleSource("web")：走链投影', async () => {
  const { deps: d, chainCalls } = deps([])
  const env = await searchSingleSource('web', { query: 'q' }, d)
  assert.equal(chainCalls.length, 1)
  assert.deepEqual(env.sources.queried, ['web'])
})

test('maxResults 缺省 DEFAULT_MAX_RESULTS 生效于归并截断', async () => {
  const many = makeAdapter('m', 'academic', { search: async () => okOutcome(Array.from({ length: 15 }, (_, i) => ({ url: `https://m/${i}` }))) })
  const { deps: d } = deps([many])
  const env = await searchSources({ query: 'q', sources: ['m'] }, d)
  assert.equal(env.items.length, DEFAULT_MAX_RESULTS)
})
