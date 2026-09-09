// 出站请求助手：错误分类、大小界、JSON 期望、redirect manual 透漏、节流串行与取消。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { httpRequest, createThrottle } from '../src/core/http.js'
import { makeClock, makeRuntime, makeFetch, makeResponse } from './helpers.mjs'

test('httpRequest：200 文本 + contentType', async () => {
  const runtime = makeRuntime({ fetch: makeFetch([['https://ok.tld', () => makeResponse(200, 'hello')]]) })
  const r = await httpRequest(runtime, 'https://ok.tld/x', { timeoutMs: 1000 })
  assert.deepEqual({ ok: r.ok, body: r.body, status: r.status, contentType: r.contentType.slice(0, 9) }, { ok: true, body: 'hello', status: 200, contentType: 'text/html' })
})

test('httpRequest：状态分类 429/5xx/4xx/3xx(manual 带 location)', async () => {
  const runtime = makeRuntime({
    fetch: makeFetch([
      ['https://r429', () => makeResponse(429, 'slow down')],
      ['https://r500', () => makeResponse(500, 'oops')],
      ['https://r404', () => makeResponse(404, 'gone')],
      ['https://r302', () => makeResponse(302, '', { location: 'https://next.tld/a' })],
    ]),
  })
  assert.equal((await httpRequest(runtime, 'https://r429', { timeoutMs: 100 })).error.code, 'rate_limited')
  assert.equal((await httpRequest(runtime, 'https://r500', { timeoutMs: 100 })).error.code, 'http_5xx')
  const notFound = await httpRequest(runtime, 'https://r404', { timeoutMs: 100 })
  assert.equal(notFound.error.code, 'http_4xx')
  assert.equal(notFound.status, 404)
  const redirect = await httpRequest(runtime, 'https://r302', { timeoutMs: 100, redirect: 'manual' })
  assert.equal(redirect.error.code, 'http_3xx')
  assert.equal(redirect.location, 'https://next.tld/a')
})

test('httpRequest：网络抛出归 network；非法 URL 归 invalid_response；file: 归 unsafe_target', async () => {
  const runtime = makeRuntime({ fetch: makeFetch([['https://boom', () => { throw new Error('socket reset') }]]) })
  assert.equal((await httpRequest(runtime, 'https://boom/x', { timeoutMs: 100 })).error.code, 'network')
  assert.equal((await httpRequest(runtime, 'not a url', { timeoutMs: 100 })).error.code, 'invalid_response')
  assert.equal((await httpRequest(runtime, 'file:///etc/passwd', { timeoutMs: 100 })).error.code, 'unsafe_target')
})

test('httpRequest：expect=json 解析失败 → parse_failed；成功带 json', async () => {
  const runtime = makeRuntime({
    fetch: makeFetch([
      ['https://j-ok', () => makeResponse(200, '{"a":1}', { contentType: 'application/json' })],
      ['https://j-bad', () => makeResponse(200, 'not json', { contentType: 'application/json' })],
    ]),
  })
  const good = await httpRequest(runtime, 'https://j-ok', { timeoutMs: 100, expect: 'json' })
  assert.deepEqual(good.json, { a: 1 })
  assert.equal((await httpRequest(runtime, 'https://j-bad', { timeoutMs: 100, expect: 'json' })).error.code, 'parse_failed')
})

test('httpRequest：超 maxBytes → too_large（分块流）', async () => {
  const big = 'x'.repeat(2048)
  const runtime = makeRuntime({ fetch: makeFetch([['https://big', () => makeResponse(200, big, { chunks: 4 })]]) })
  const r = await httpRequest(runtime, 'https://big/f', { timeoutMs: 1000, maxBytes: 1000 })
  assert.equal(r.error.code, 'too_large')
})

test('httpRequest：timeoutMs 非法即抛（编程错误通道）', async () => {
  const runtime = makeRuntime()
  await assert.rejects(() => httpRequest(runtime, 'https://x.tld', { timeoutMs: 0 }), TypeError)
  await assert.rejects(() => httpRequest(runtime, 'https://x.tld', { timeoutMs: Number.NaN }), TypeError)
})

test('createThrottle：同 host 串行且守最小间隔；不同 host 不互等', async () => {
  const clock = makeClock()
  // 推进时钟放到宏任务：保证 gate 授予时刻的采样确定性（微任务内先行同步 advance 会让旁观者读到未来）。
  const throttle = createThrottle({ now: () => clock.now(), sleep: async (ms) => { await new Promise((resolve) => setTimeout(resolve, 0)); clock.advance(ms) }, warn: () => {} })
  const stamps = []
  const take = async (host) => {
    const got = await throttle.gate(host, 500, new AbortController().signal)
    assert.equal(got.ok, true)
    stamps.push({ host, t: clock.t })
  }
  await Promise.all([take('same.tld'), take('same.tld'), take('other.tld')])
  const same = stamps.filter((s) => s.host === 'same.tld').map((s) => s.t)
  assert.equal(same.length, 2)
  assert.ok(Math.abs(same[1] - same[0]) >= 500, `同 host 间隔守 500ms（实际 ${Math.abs(same[1] - same[0])}）`)
  const other = stamps.find((s) => s.host === 'other.tld')
  assert.ok(other.t <= Math.max(...same), '异 host 不等 same 队列（至多同步于先授予者）')
})

test('createThrottle：signal 已取消 → aborted（不 sleep 不抢发）', async () => {
  const clock = makeClock()
  let slept = 0
  const throttle = createThrottle({ now: () => clock.now(), sleep: async (ms) => { slept += ms }, warn: () => {} })
  const controller = new AbortController()
  controller.abort()
  const r = await throttle.gate('x.tld', 1000, controller.signal)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'aborted')
  assert.equal(slept, 0)
})
