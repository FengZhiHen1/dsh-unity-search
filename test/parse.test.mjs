// 共享解析助手：实体解码、剥标签、摘要清洗、跳转包装 URL 还原。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeEntities, stripTags, cleanSnippet, extractRealUrl } from '../src/core/parse.js'

test('decodeEntities：命名/数字实体与未知实体保留', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b')
  assert.equal(decodeEntities('&lt;tag&gt; &#65; &#x42;'), '<tag> A B')
  assert.equal(decodeEntities('&mdash; &hellip; &nbsp;'), '— …  ')
  assert.equal(decodeEntities('&unknownentity;'), '&unknownentity;')
})

test('stripTags：注释剥除、标签换空格（空白压缩是 cleanSnippet 的职责）', () => {
  assert.equal(stripTags('<b>bold</b> <!-- hidden --> <a href="x">link</a>'), ' bold    link ')
})

test('cleanSnippet：压缩空白、300 上限省略号、非串 null', () => {
  assert.equal(cleanSnippet('  a\n b\t c '), 'a b c')
  assert.equal(cleanSnippet('<em>hi</em> &amp; ok'), 'hi & ok')
  const long = 'x'.repeat(350)
  const cut = cleanSnippet(long)
  assert.equal(cut.length, 300)
  assert.ok(cut.endsWith('…'))
  assert.equal(cleanSnippet('   '), null)
  assert.equal(cleanSnippet(null), null)
})

test('extractRealUrl：uddg / l?u= / 协议相对 / 原样 http', () => {
  assert.equal(extractRealUrl('/l?u=https%3A%2F%2Ftarget.tld%2Fp'), 'https://target.tld/p')
  assert.equal(extractRealUrl('https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Ftarget.tld'), 'https://target.tld')
  assert.equal(extractRealUrl('//html.duckduckgo.com/l/?uddg=https%3A%2F%2Ftarget.tld%2Fa'), 'https://target.tld/a')
  assert.equal(extractRealUrl('https://plain.tld/x'), 'https://plain.tld/x')
  assert.equal(extractRealUrl('/l?u=not-a-url'), null)
  assert.equal(extractRealUrl('javascript:alert(1)'), null)
  assert.equal(extractRealUrl(''), null)
})
