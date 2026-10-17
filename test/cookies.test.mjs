// 会话 cookie 罐：按域隔离、过期与注销、注入拒收、容量驱逐、回退切分，以及 httpRequest 的接线。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCookieJar } from '../src/core/cookies.js'
import { httpRequest } from '../src/core/http.js'
import { makeClock, makeRuntime, makeFetch, makeResponse } from './helpers.mjs'

/** @param {ReturnType<typeof makeClock>} clock */
function jarOf(clock) {
  return createCookieJar({ now: () => clock.now() })
}

/** cookie 头值的集合形态（同域多条 cookie 的发送顺序无语义，断言按集合）。 */
const partsOf = (header) => String(header ?? '').split('; ').filter((p) => p.length > 0).sort()

test('cookie：收下 Set-Cookie 后按域拼装请求头；他域不串 cookie', () => {
  const clock = makeClock()
  const jar = jarOf(clock)
  jar.absorb('www.bing.com', makeResponse(200, '', { setCookies: ['MUID=abc; Domain=.bing.com; Path=/', 'SRCHUID=xyz; Path=/'] }))
  assert.deepEqual(partsOf(jar.header('www.bing.com')), ['MUID=abc', 'SRCHUID=xyz'])
  assert.equal(jar.header('cn.bing.com'), 'MUID=abc', '子域继承 Domain 属性声明的 cookie')
  assert.equal(jar.header('example.com'), null, '他域不得携带')
  assert.equal(jar.has('www.bing.com'), true)
  assert.equal(jar.has('example.com'), false)
})

test('cookie：Max-Age 注销与到期后不再发送', () => {
  const clock = makeClock()
  const jar = jarOf(clock)
  jar.absorb('h.tld', makeResponse(200, '', { setCookies: ['k=v; Max-Age=60'] }))
  assert.equal(jar.header('h.tld'), 'k=v')
  clock.advance(61_000)
  assert.equal(jar.header('h.tld'), null, '到期即不发')
  assert.equal(jar.has('h.tld'), false)
  jar.absorb('h.tld', makeResponse(200, '', { setCookies: ['session=1'] }))
  jar.absorb('h.tld', makeResponse(200, '', { setCookies: ['session=; Max-Age=0'] }))
  assert.equal(jar.header('h.tld'), null, 'Max-Age=0 是同名注销')
})

test('cookie：非法名/值与跨域声明一律拒收（请求头注入面）', () => {
  const clock = makeClock()
  const jar = jarOf(clock)
  jar.absorb('h.tld', makeResponse(200, '', { setCookies: [
    'bad name=v',
    'k=v\r\nX-Injected: 1',
    'other=v; Domain=evil.tld',
    '=novalue',
  ] }))
  assert.equal(jar.header('h.tld'), null)
  assert.equal(jar.header('evil.tld'), null)
  assert.deepEqual(jar.stats(), { domains: 0, cookies: 0 })
})

test('cookie：secure 只在 https 下发送', () => {
  const clock = makeClock()
  const jar = jarOf(clock)
  jar.absorb('h.tld', makeResponse(200, '', { setCookies: ['sid=s; Secure'] }))
  assert.equal(jar.header('h.tld', 'https:'), 'sid=s')
  assert.equal(jar.header('h.tld', 'http:'), null)
})

test('cookie：单域条数上界按最久未用驱逐', () => {
  const clock = makeClock()
  const jar = jarOf(clock)
  for (let i = 0; i < 33; i++) {
    clock.advance(1)
    jar.absorb('h.tld', makeResponse(200, '', { setCookies: [`c${i}=v${i}`] }))
  }
  assert.equal(jar.stats().cookies, 32, '超出上界即驱逐，不无界增长')
  const header = jar.header('h.tld') ?? ''
  assert.equal(header.includes('c0='), false, '最久未用的 c0 被驱逐')
  assert.equal(header.includes('c32='), true, '最近写入的保留')
})

test('cookie：无 getSetCookie 时按 name= 形态保守切分（Expires 的逗号不误切）', () => {
  const clock = makeClock()
  const jar = jarOf(clock)
  const legacy = {
    headers: {
      get: (name) => (name.toLowerCase() === 'set-cookie'
        ? 'a=1; Expires=Wed, 09 Jun 2033 10:18:14 GMT, b=2; Path=/'
        : null),
    },
  }
  jar.absorb('h.tld', legacy)
  assert.equal(jar.header('h.tld'), 'a=1; b=2')
})

test('cookie：httpRequest 发出前带 cookie、收到响应即收下新 cookie', async () => {
  const clock = makeClock()
  const jar = jarOf(clock)
  const fetch = makeFetch([
    ['https://h.tld/first', () => makeResponse(200, 'ok', { setCookies: ['sid=s1; Path=/'] })],
    ['https://h.tld/second', () => makeResponse(200, 'ok')],
  ])
  const runtime = makeRuntime({ clock, fetch, cookies: jar })
  await httpRequest(runtime, 'https://h.tld/first', { timeoutMs: 1000 })
  await httpRequest(runtime, 'https://h.tld/second', { timeoutMs: 1000 })
  assert.equal(/** @type {Record<string, string>} */ (fetch.calls[0].init.headers).cookie, undefined, '首请求无 cookie')
  assert.equal(/** @type {Record<string, string>} */ (fetch.calls[1].init.headers).cookie, 'sid=s1')
})

test('cookie：调用方显式 cookie 头优先于罐值', async () => {
  const clock = makeClock()
  const jar = jarOf(clock)
  jar.absorb('h.tld', makeResponse(200, '', { setCookies: ['sid=from-jar'] }))
  const fetch = makeFetch([['https://h.tld/x', () => makeResponse(200, 'ok')]])
  const runtime = makeRuntime({ clock, fetch, cookies: jar })
  await httpRequest(runtime, 'https://h.tld/x', { timeoutMs: 1000, headers: { cookie: 'sid=explicit' } })
  assert.equal(/** @type {Record<string, string>} */ (fetch.calls[0].init.headers).cookie, 'sid=explicit')
})

test('cookie：runtime 不注入罐时行为不变（不读不写 cookie）', async () => {
  const fetch = makeFetch([['https://h.tld/x', () => makeResponse(200, 'ok', { setCookies: ['sid=s1'] })]])
  const runtime = makeRuntime({ fetch })
  const r = await httpRequest(runtime, 'https://h.tld/x', { timeoutMs: 1000 })
  assert.equal(r.ok, true)
  assert.equal(/** @type {Record<string, string>} */ (fetch.calls[0].init.headers).cookie, undefined)
})
