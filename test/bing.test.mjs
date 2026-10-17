// bing 引擎：ck/a 包装解包、会话预热、软降级自陈。fixture 取自 2026-10-17 活体抓取的结构骨架。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bing } from '../src/core/engines/bing.js'
import { createCookieJar } from '../src/core/cookies.js'
import { makeClock, makeRuntime, makeFetch, makeResponse } from './helpers.mjs'

/** base64url（无填充），对齐包装参数里的编码形态。 */
const b64url = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** Bing 结果锚点的点击包装形态（属性值里的 & 在 HTML 源码中是实体，必须解）。 */
const wrapper = (target) => `https://www.bing.com/ck/a?!&amp;&amp;p=deadbeef&amp;u=a1${b64url(target)}&amp;ntb=1`
/** 单条 b_algo 块。 */
const block = (href, title, snippet) => `<li class="b_algo" data-id iid=SERP.1><h2><a href="${href}">${title}</a></h2><p>${snippet}</p></li>`
/** 结果页骨架。 */
const serp = (...blocks) => `<html><body><ol id="b_results">${blocks.join('')}</ol></body></html>`

const SEARCH_PREFIX = 'https://www.bing.com/search?'

test('bing：ck/a 包装解出真实目标 URL（含实体与查询串）', async () => {
  const target = 'https://example.tld/post?a=1&b=2'
  const html = serp(block(wrapper(target), 'Cordis 插件生命周期', 'plugin lifecycle 与 cordis 事件模型'))
  const fetch = makeFetch([[SEARCH_PREFIX, () => makeResponse(200, html)]])
  const out = await bing.search({ query: 'cordis plugin lifecycle' }, makeRuntime({ fetch }))
  assert.equal(out.status, 'ok')
  assert.equal(out.items.length, 1)
  assert.equal(out.items[0].url, target, '不得把 bing.com/ck/a 包装交给上层')
  assert.equal(out.items[0].title, 'Cordis 插件生命周期')
  assert.equal(out.degraded, undefined, '查询词全部覆盖时不判降级')
})

test('bing：直链锚点原样保留，实体在 URL 中解码', async () => {
  const html = serp(block('https://direct.tld/p?x=1&amp;y=2', 'cordis plugin lifecycle', 'lifecycle'))
  const fetch = makeFetch([[SEARCH_PREFIX, () => makeResponse(200, html)]])
  const out = await bing.search({ query: 'cordis plugin lifecycle' }, makeRuntime({ fetch }))
  assert.equal(out.items[0].url, 'https://direct.tld/p?x=1&y=2')
})

test('bing：包装无法解码时保留包装 URL（不丢条目）', async () => {
  const html = serp(block('https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1!!!not-base64!!!', 'cordis plugin lifecycle', 'lifecycle'))
  const fetch = makeFetch([[SEARCH_PREFIX, () => makeResponse(200, html)]])
  const out = await bing.search({ query: 'cordis plugin lifecycle' }, makeRuntime({ fetch }))
  assert.equal(out.items.length, 1)
  assert.match(String(out.items[0].url), /^https:\/\/www\.bing\.com\/ck\/a/)
})

test('bing：会话缺失时先取首页建会话，再带 cookie 检索', async () => {
  const clock = makeClock()
  const jar = createCookieJar({ now: () => clock.now() })
  const html = serp(block(wrapper('https://example.tld/a'), 'cordis plugin lifecycle', 'lifecycle'))
  const fetch = makeFetch([
    // 路由按前缀首个命中：检索端点在 / 前缀之下，必须先注册。
    [SEARCH_PREFIX, () => makeResponse(200, html)],
    ['https://www.bing.com/', () => makeResponse(200, '<html><body>home</body></html>', { setCookies: ['MUID=abc; Domain=.bing.com; Path=/'] })],
  ])
  const runtime = makeRuntime({ clock, fetch, cookies: jar })
  const out = await bing.search({ query: 'cordis plugin lifecycle' }, runtime)
  assert.equal(fetch.calls[0].url, 'https://www.bing.com/', '首个出站是会话预热')
  assert.match(/** @type {string} */ (fetch.calls[1].url), /^https:\/\/www\.bing\.com\/search\?/)
  assert.equal(/** @type {Record<string, string>} */ (fetch.calls[1].init.headers).cookie, 'MUID=abc', '检索请求带会话 cookie')
  assert.equal(out.items.length, 1)
})

test('bing：已有会话时不再预热（每会话只多一次请求）', async () => {
  const clock = makeClock()
  const jar = createCookieJar({ now: () => clock.now() })
  jar.absorb('www.bing.com', makeResponse(200, '', { setCookies: ['MUID=abc; Domain=.bing.com; Path=/'] }))
  const html = serp(block(wrapper('https://example.tld/a'), 'cordis plugin lifecycle', 'lifecycle'))
  const fetch = makeFetch([[SEARCH_PREFIX, () => makeResponse(200, html)]])
  const out = await bing.search({ query: 'cordis plugin lifecycle' }, makeRuntime({ clock, fetch, cookies: jar }))
  assert.equal(fetch.calls.length, 1, '会话在位即直接检索')
  assert.equal(/** @type {Record<string, string>} */ (fetch.calls[0].init.headers).cookie, 'MUID=abc')
  assert.equal(out.items[0].url, 'https://example.tld/a')
})

test('bing：HTTP 200 但结果不覆盖查询词 → 自陈 degraded（链可继续兜底）', async () => {
  const html = serp(
    block(wrapper('https://www.deepseek.com/'), 'DeepSeek | Into the Unknown', 'DeepSeek is an AI research company'),
    block(wrapper('https://www.deepseek.com/en/platform/'), 'DeepSeek | API Platform', 'Build with DeepSeek API'),
  )
  const fetch = makeFetch([[SEARCH_PREFIX, () => makeResponse(200, html)]])
  const out = await bing.search({ query: 'deepseek harness 插件开发' }, makeRuntime({ fetch }))
  assert.equal(out.status, 'ok')
  assert.equal(out.items.length, 2, '条目不被丢弃')
  assert.equal(out.degraded?.reason.includes('未覆盖查询词'), true, '降级必须自陈')
  assert.match(out.warnings?.[0] ?? '', /缺：/)
})

test('bing：注入 runtime 无 cookie 罐时不预热（纯解析路径可用）', async () => {
  const html = serp(block(wrapper('https://example.tld/a'), 'cordis plugin lifecycle', 'lifecycle'))
  const fetch = makeFetch([[SEARCH_PREFIX, () => makeResponse(200, html)]])
  await bing.search({ query: 'cordis plugin lifecycle' }, makeRuntime({ fetch }))
  assert.equal(fetch.calls.length, 1)
  assert.equal(/** @type {Record<string, string>} */ (fetch.calls[0].init.headers).cookie, undefined)
})
