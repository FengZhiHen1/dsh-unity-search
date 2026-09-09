// 去重键与跨源归并（alsoIn/首选来源/extra 并集/keyless 位置/上限截断）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDoi, normalizeArxiv, normalizeUrl, normalizeTitle, dedupeKey, dedupeItems } from '../src/core/dedup.js'

test('normalizeDoi：前缀/大小写/空白归一', () => {
  assert.equal(normalizeDoi('DOI: 10.123/AbC '), '10.123/abc')
  assert.equal(normalizeDoi('https://doi.org/10.123/abc'), '10.123/abc')
  assert.equal(normalizeDoi('http://dx.doi.org/10.123/ABC'), '10.123/abc')
  assert.equal(normalizeDoi(''), null)
  assert.equal(normalizeDoi(undefined), null)
})

test('normalizeArxiv：去版本与前缀', () => {
  assert.equal(normalizeArxiv('cs/0101001v2'), 'cs/0101001')
  assert.equal(normalizeArxiv('arXiv:2101.00001v1'), '2101.00001')
  assert.equal(normalizeArxiv('2101.00001v3'), '2101.00001')
  assert.equal(normalizeArxiv('https://arxiv.org/abs/2101.00001v2'), '2101.00001')
  assert.equal(normalizeArxiv('nope'), null)
})

test('normalizeUrl：host 小写/www/默认端口/追踪参数/fragment/尾斜杠/参数排序', () => {
  assert.equal(normalizeUrl('HTTPS://WWW.Example.COM:443/Path/?b=2&utm_source=x&a=1&fbclid=9#/frag'), 'example.com/Path?a=1&b=2')
  assert.equal(normalizeUrl('http://example.com:80/a/'), 'example.com/a')
  assert.equal(normalizeUrl('https://example.com/a?ref=1&keep=2'), 'example.com/a?keep=2')
  assert.equal(normalizeUrl('not a url'), 'not a url')
  assert.equal(normalizeUrl(''), null)
})

test('dedupeKey 优先级与标题兜底键', () => {
  assert.deepEqual(dedupeKey({ url: 'https://a.tld', sourceIds: { doi: '10.1/X', arxiv: '2101.00001' } }), { kind: 'doi', value: '10.1/x' })
  assert.deepEqual(dedupeKey({ url: 'https://a.tld', sourceIds: { arxiv: '2101.00001v2' } }), { kind: 'arxiv', value: '2101.00001' })
  assert.deepEqual(dedupeKey({ url: 'https://a.tld/x' }), { kind: 'url', value: 'a.tld/x' })
  assert.deepEqual(dedupeKey({ title: 'Hello', extra: { authors: [{ name: 'Alice' }] } }), { kind: 'title', value: 'hello|alice' })
  assert.equal(dedupeKey({}), null)
})

test('dedupeItems：同族先到为首选，alsoIn 记分流源，extra 并集保留首选值', () => {
  const first = { url: 'https://a.tld/p', title: 'P', sourceIds: { doi: '10.5/P' }, extra: { citations: 10, only: 'first' }, _from: 'arxiv', _family: 'academic' }
  const second = { url: 'https://b.tld/p', title: 'P', sourceIds: { doi: 'doi:10.5/p' }, extra: { citations: 999 }, _from: 'crossref', _family: 'academic' }
  const { items, duplicatesRemoved } = dedupeItems([first, second])
  assert.equal(duplicatesRemoved, 1)
  assert.equal(items.length, 1)
  assert.equal(items[0].source, 'arxiv')
  assert.deepEqual(items[0].alsoIn, ['crossref'])
  assert.equal(items[0].extra.citations, 10)
  assert.equal(items[0].extra.only, 'first')
})

test('dedupeItems：族优先级 academic > platform > web；后来高族取代首选且旧首选进 alsoIn', () => {
  const webItem = { url: 'https://blog.tld/post', title: 'Post', _from: 'bing', _family: 'web' }
  const p1 = dedupeItems([webItem])
  assert.equal(p1.items[0].source, 'bing')
  const merged = dedupeItems([
    { url: 'https://blog.tld/post', title: 'Post', _from: 'bing', _family: 'web' },
    { url: 'https://blog.tld/post', title: 'Post', extra: { score: 3 }, _from: 'hn', _family: 'platform' },
  ])
  assert.equal(merged.items.length, 1)
  assert.equal(merged.items[0].source, 'hn')
  assert.deepEqual(merged.items[0].alsoIn, ['bing'])
  assert.equal(merged.items[0].extra.score, 3)
})

test('dedupeItems：无键条目不参与合并且排在有键组之后；maxItems 截断不计 duplicatesRemoved', () => {
  const out = dedupeItems([
    { _from: 'x1', _family: 'web' },
    { url: 'https://dup.a/1', _from: 'x2', _family: 'web' },
    { url: 'https://dup.a/1?utm_medium=a', _from: 'x3', _family: 'web' },
    { _from: 'x4', _family: 'web' },
  ], 3)
  assert.equal(out.duplicatesRemoved, 1)
  assert.equal(out.items.length, 3)
  assert.deepEqual(out.items.map((i) => i.source), ['x2', 'x1', 'x4'])
})
