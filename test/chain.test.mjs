// 引擎链状态机：赢者通吃、冷却跳过、空结果≠失败、全败 chain_exhausted、无尝试 unavailable。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebChain } from '../src/core/chain.js'
import { makeClock, makeRuntime, makeAdapter, okOutcome } from './helpers.mjs'

/** 造一个按剧本响应的引擎：'ok' 出 1 条、'empty' 出 0 条、'error' 失败、'throw' 违约抛出。 */
function scriptedEngine(id, behavior, hits) {
  return {
    id,
    family: 'web',
    supportsTimeRange: behavior !== 'no-tr',
    available: () => true,
    search: async () => {
      hits.push(id)
      if (behavior === 'throw') throw new Error('contract violation')
      if (behavior === 'error') return { status: 'error', items: [], latencyMs: 1, error: { code: 'rate_limited', message: '429' } }
      if (behavior === 'empty') return okOutcome([])
      return okOutcome([{ url: `https://${id}.tld/r` }])
    },
  }
}

function harness(scripts, { cooldownSeconds = 300, order } = {}) {
  const clock = makeClock()
  const hits = []
  const engines = scripts.map(([id, behavior]) => scriptedEngine(id, behavior, hits))
  const state = new Map()
  const chain = createWebChain({ engines, state })
  const runtime = makeRuntime({
    clock,
    config: { chain: { order: order ?? scripts.map(([id]) => id), cooldownSeconds, timeoutMs: 15000 } },
  })
  return { chain, runtime, clock, hits, state }
}

test('链：首个出结果的引擎赢，后续引擎不被调用', async () => {
  const { chain, runtime, hits } = harness([['bing', 'error'], ['ddg', 'ok'], ['lite', 'ok']])
  const r = await chain.search({ query: 'q' }, runtime)
  assert.equal(r.outcome.status, 'ok')
  assert.equal(r.info.winner, 'ddg')
  assert.deepEqual(hits, ['bing', 'ddg'])
  assert.deepEqual(r.info.tried.map((t) => [t.id, t.outcome]), [['bing', 'error'], ['ddg', 'ok']])
  assert.deepEqual(r.attempts.map((a) => [a.source, a.outcome]), [['web:bing', 'error'], ['web:ddg', 'ok']])
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /bing 失败（rate_limited：429），已冷却/)
})

test('冷却状态机：error 进冷却 → 期内 skipped → 期满后重试', async () => {
  const { chain, runtime, hits, state } = harness([['bing', 'error'], ['ddg', 'ok']])
  await chain.search({ query: 'q' }, runtime)
  assert.equal(state.get('bing').coolingUntil > runtime.now(), true)
  hits.length = 0
  const second = await chain.search({ query: 'q2' }, runtime)
  assert.deepEqual(hits, ['ddg'])
  assert.deepEqual(second.info.tried[0], { id: 'bing', outcome: 'skipped', reason: 'cooling' })
  runtime.now = () => state.get('bing').coolingUntil + 1
  hits.length = 0
  await chain.search({ query: 'q3' }, runtime)
  assert.deepEqual(hits, ['bing', 'ddg'])
})

test('空结果≠失败：全部空 → ok 0 条；空者不进冷却', async () => {
  const { chain, runtime, state } = harness([['bing', 'empty'], ['ddg', 'empty']])
  const r = await chain.search({ query: 'q' }, runtime)
  assert.equal(r.outcome.status, 'ok')
  assert.deepEqual(r.outcome.items, [])
  assert.equal(r.info.winner, null)
  assert.equal(state.get('bing').coolingUntil, 0)
  assert.deepEqual(r.attempts.map((a) => a.outcome), ['empty', 'empty'])
})

test('全败 → chain_exhausted（message 逐引擎带码）', async () => {
  const { chain, runtime } = harness([['a', 'error'], ['b', 'error']])
  const r = await chain.search({ query: 'q' }, runtime)
  assert.equal(r.outcome.status, 'error')
  assert.equal(r.outcome.error.code, 'chain_exhausted')
  assert.match(r.outcome.error.message, /a\(rate_limited\), b\(rate_limited\)/)
})

test('无引擎被真正尝试（全禁用）→ unavailable；链序外引擎不参战', async () => {
  const { chain, runtime, hits } = harness([['a', 'ok'], ['b', 'ok']], { order: ['ghost'] })
  const r = await chain.search({ query: 'q' }, runtime)
  assert.equal(r.outcome.error.code, 'unavailable')
  assert.deepEqual(hits, [])
  assert.match(r.outcome.error.message, /链为空/)
})

test('disabled/缺凭据引擎被 skip（记原因不记 error）', async () => {
  const clock = makeClock()
  const hits = []
  const disabled = { id: 'tavily', family: 'web', available: () => false, search: async () => { hits.push('tavily'); return okOutcome([]) } }
  const winner = scriptedEngine('bing', 'ok', hits)
  const chain = createWebChain({ engines: [disabled, winner], state: new Map() })
  const runtime = makeRuntime({ clock, config: { chain: { order: ['tavily', 'bing'], cooldownSeconds: 0, timeoutMs: 15000 } } })
  const r = await chain.search({ query: 'q' }, runtime)
  assert.equal(r.info.winner, 'bing')
  assert.deepEqual(r.info.tried[0], { id: 'tavily', outcome: 'skipped', reason: 'unavailable' })
  assert.deepEqual(hits, ['bing'])
})

test('胜出引擎不支持 timeRange → warning；支持则无', async () => {
  const t1 = harness([['bing', 'no-tr']])
  const r1 = await t1.chain.search({ query: 'q', timeRange: 'week' }, t1.runtime)
  assert.match(r1.warnings.join(' '), /不支持 timeRange/)
  const t2 = harness([['bing', 'ok']])
  const r2 = await t2.chain.search({ query: 'q', timeRange: 'week' }, t2.runtime)
  assert.deepEqual(r2.warnings, [])
})

test('引擎违约抛出 → internal 尝试记录，不进冷却', async () => {
  const { chain, runtime, state } = harness([['bing', 'throw'], ['ddg', 'ok']])
  const r = await chain.search({ query: 'q' }, runtime)
  assert.equal(r.info.winner, 'ddg')
  assert.equal(r.info.tried[0].code, 'internal')
  assert.equal(state.get('bing').coolingUntil, 0)
})

test('available()：有在线引擎才 true；available 全 false → false', () => {
  const t1 = harness([['a', 'ok']])
  assert.equal(t1.chain.available(t1.runtime), true)
  const clock = makeClock()
  const dead = [{ id: 'a', family: 'web', available: () => false, search: async () => okOutcome([]) }]
  const chain = createWebChain({ engines: dead, state: new Map() })
  const runtime = makeRuntime({ clock, config: { chain: { order: ['a'], cooldownSeconds: 0, timeoutMs: 1000 } } })
  assert.equal(chain.available(runtime), false)
})

test('snapshot()：全引擎投影冷却与最近结果（state RPC 消费面）', async () => {
  const { chain, runtime } = harness([['bing', 'error'], ['ddg', 'ok']])
  await chain.search({ query: 'q' }, runtime)
  const snap = chain.snapshot()
  assert.deepEqual(snap.map((s) => s.id), ['bing', 'ddg'])
  assert.equal(snap[0].lastOutcome.code, 'rate_limited')
  assert.equal(snap[1].lastOutcome.outcome, 'ok')
})
