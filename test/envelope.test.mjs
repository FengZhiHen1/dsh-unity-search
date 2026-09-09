// 信封组装/不变量/seam 投影的真值表。契约 = docs/technical-details/检索核心与信封契约.md + L0-Seam接入.md。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStatus, assembleEnvelope, assertEnvelope, projectToSeam, degradedNote } from '../src/core/envelope.js'

const ok = (id, items = [], extra = {}) => ({ id, family: 'web', kind: 'ok', outcome: { status: 'ok', items, latencyMs: 5, ...extra } })
const err = (id, code = 'network') => ({ id, family: 'web', kind: 'error', error: { code, message: `${id} boom` } })

test('mergeStatus 真值表', () => {
  assert.equal(mergeStatus([ok('a'), ok('b')]), 'ok')
  assert.equal(mergeStatus([ok('a'), err('b')]), 'degraded')
  assert.equal(mergeStatus([ok('a'), { id: 'b', kind: 'unavailable' }]), 'degraded')
  assert.equal(mergeStatus([err('a'), err('b')]), 'unavailable')
  assert.equal(mergeStatus([]), 'unavailable')
})

test('assembleEnvelope：跨源同 DOI 合并 + alsoIn + 恒定结构', () => {
  const a = { url: 'https://x.org/1', title: 'T1', sourceIds: { doi: '10.1/A' } }
  const b = { url: 'https://y.org/1', title: 'T1', sourceIds: { doi: 'https://doi.org/10.1/a' } }
  const env = assembleEnvelope({
    query: 'q',
    maxItems: 10,
    results: [
      { ...ok('arxiv', [a]), family: 'academic' },
      { ...ok('crossref', [b]), family: 'academic' },
    ],
  })
  assert.equal(env.status, 'ok')
  assert.deepEqual(env.sources.queried, ['arxiv', 'crossref'])
  assert.deepEqual(env.sources.succeeded, ['arxiv', 'crossref'])
  assert.deepEqual(env.sources.failed, [])
  assert.equal(env.items.length, 1)
  assert.equal(env.items[0].source, 'arxiv')
  assert.deepEqual(env.items[0].alsoIn, ['crossref'])
  assert.equal(env.duplicatesRemoved, 1)
  assert.equal(env.query, 'q')
  assert.equal(env.answer, null)
  assert.deepEqual(env.uncertainty, [])
  assert.deepEqual(env.warnings, [])
  assert.deepEqual(env.attempts, [])
})

test('assembleEnvelope：失败/跳过/未知 kind 的 code 映射与 attempts/warnings 归并去重', () => {
  const env = assembleEnvelope({
    query: 'q',
    warnings: ['w1'],
    results: [
      { ...ok('web', [{ url: 'https://a.tld' }]), attempts: [{ source: 'web:bing', outcome: 'ok', latencyMs: 3 }], warnings: ['忽略', '忽略'] },
      { id: 'tavily', kind: 'error', error: { code: 'http_4xx', message: '401' } },
      { id: 'searxng', kind: 'unavailable', message: 'disabled' },
      { id: 'wat', kind: 'unknown', message: 'unknown source: wat' },
    ],
  })
  assert.equal(env.status, 'degraded')
  assert.deepEqual(env.sources.failed.map((f) => [f.source, f.code]), [['tavily', 'http_4xx'], ['searxng', 'unavailable'], ['wat', 'unknown_source']])
  assert.deepEqual(env.attempts, [{ source: 'web:bing', outcome: 'ok', latencyMs: 3 }])
  assert.deepEqual(env.warnings, ['w1', '忽略'])
})

test('assembleEnvelope：answer 单源透传 / 多源取先并警告', () => {
  const single = assembleEnvelope({ query: 'q', results: [{ ...ok('anysearch', []), outcome: { status: 'ok', items: [], latencyMs: 1, answer: 'A1' } }] })
  assert.equal(single.answer, 'A1')
  const multi = assembleEnvelope({
    query: 'q',
    results: [
      { ...ok('p1', []), outcome: { status: 'ok', items: [], latencyMs: 1, answer: 'P1' } },
      { ...ok('p2', []), outcome: { status: 'ok', items: [], latencyMs: 1, answer: 'P2' } },
    ],
  })
  assert.equal(multi.answer, 'P1')
  assert.match(multi.warnings.join(' '), /仅透传 p1/)
})

test('assembleEnvelope：未知 kind 抛（判别穷尽）', () => {
  assert.throws(() => assembleEnvelope({ query: 'q', results: [{ id: 'x', kind: 'weird' }] }), TypeError)
})

test('assertEnvelope 违反不变量即抛', () => {
  assert.throws(
    () => assertEnvelope({ status: 'ok', query: 'q', sources: { queried: ['a'], succeeded: ['a'], failed: [{ source: 'a', code: 'x', message: '' }] }, items: [], duplicatesRemoved: 0, answer: null, uncertainty: [], warnings: [], attempts: [] }),
    /succeeded\/failed overlap/,
  )
  assert.throws(
    () => assertEnvelope({ status: 'unavailable', query: 'q', sources: { queried: ['a'], succeeded: [], failed: [{ source: 'a', code: 'x', message: '' }] }, items: [{ url: 'u', source: 'a', alsoIn: [] }], duplicatesRemoved: 0, answer: null, uncertainty: [], warnings: [], attempts: [] }),
    /unavailable status with non-empty items/,
  )
})

test('projectToSeam：字段白名单 + 无 url 条目丢弃 + truncated 恒 false', () => {
  const env = assembleEnvelope({
    query: 'q',
    results: [ok('web', [{ url: 'https://x.tld/p', title: 'T', snippet: 'S', publishedAt: '2026-01-01', extra: { noise: 1 }, sourceIds: { doi: '10.9/Z' } }])],
  })
  const projected = projectToSeam(env)
  assert.equal(projected.kind, 'result')
  assert.deepEqual(projected.value.sources, [{ url: 'https://x.tld/p', title: 'T', snippet: 'S', publishedAt: '2026-01-01' }])
  assert.equal(projected.value.truncated, false)
  assert.equal('content' in projected.value, false)
})

test('projectToSeam：degraded → content 降级注记；全败 → unavailable 携带 failed', () => {
  const degraded = assembleEnvelope({ query: 'q', results: [ok('web', [{ url: 'https://x.tld' }]), err('tavily')] })
  const p1 = projectToSeam(degraded)
  assert.equal(p1.kind, 'result')
  assert.match(p1.value.content, /部分源不可用（tavily\(network\)）/)
  const allFail = assembleEnvelope({ query: 'q', results: [err('a', 'timeout'), err('b')] })
  const p2 = projectToSeam(allFail)
  assert.equal(p2.kind, 'unavailable')
  assert.deepEqual(p2.failed.map((f) => f.code), ['timeout', 'network'])
})

test('projectToSeam：单赢者链的备选降级注记（L0 投影规则例）', () => {
  const env = assembleEnvelope({ query: 'q', results: [ok('web', [{ url: 'https://x.tld' }])] })
  const chainInfo = {
    winner: 'ddg',
    tried: [
      { id: 'bing', outcome: 'error', code: 'rate_limited' },
      { id: 'ddg', outcome: 'ok' },
    ],
  }
  assert.match(projectToSeam(env, chainInfo).value.content, /引擎链降级：bing\(rate_limited\) 未产出可用结果，结果来自备选引擎 ddg/)
  assert.match(degradedNote({ status: 'degraded', sources: { succeeded: ['web'], failed: [{ source: 'tavily', code: 'http_4xx' }] } }, chainInfo), /引擎链降级：bing\(rate_limited\) 失败/)
})
