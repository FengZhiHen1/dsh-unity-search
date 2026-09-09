// 正文抽取：article/main 优先、噪声剥除、链接密度置信、非 HTML 判定。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeHtml, extractText } from '../src/core/read/extract.js'

const BODY_SENTENCE = 'DeepSeek Harness is an open agent framework with plugins. '.repeat(20)

test('looksLikeHtml：按 contentType 判定，含嗅探兜底', () => {
  assert.equal(looksLikeHtml('text/html; charset=utf-8', 'anything'), true)
  assert.equal(looksLikeHtml('application/xhtml+xml', ''), true)
  assert.equal(looksLikeHtml('application/json', '{"a":1}'), false)
  assert.equal(looksLikeHtml('', '<html><body>hi</body></html>'), true, '无类型时嗅探正文')
  assert.equal(looksLikeHtml('', 'plain words'), false)
})

test('extractText：title + article 正文，script/style/nav/footer 噪声不入选', () => {
  const html = `<!doctype html><html><head><title> 报告标题 </title><script>var secret=1</script><style>.x{color:red}</style></head>
  <body><nav>首页 关于 联系</nav><article><h2>章</h2><p>${BODY_SENTENCE}</p></article><footer>版权 2026</footer></body></html>`
  const out = extractText(html)
  assert.equal(out.title, '报告标题')
  assert.match(out.text, /open agent framework/)
  assert.ok(!out.text.includes('secret'), 'script 内容必须剥除')
  assert.ok(!out.text.includes('color:red'), 'style 内容必须剥除')
  assert.ok(!out.text.includes('版权'), 'article 选中时外围噪声不混入')
  assert.equal(out.confidenceLow, false)
})

test('extractText：无 article 时退 main，再无则全 body 去噪', () => {
  const withMain = `<html><head><title>M</title></head><body><main><p>${BODY_SENTENCE}</p></main></body></html>`
  assert.match(extractText(withMain).text, /open agent framework/)
  const onlyBody = `<html><body><div><p>${BODY_SENTENCE}</p></div><noscript>ns</noscript><template>tpl</template></body></html>`
  const out = extractText(onlyBody)
  assert.match(out.text, /open agent framework/)
  assert.ok(!out.text.includes('ns') || !out.text.includes('tpl'), 'noscript/template 剥除')
})

test('extractText：链接主导页 → confidenceLow + note', () => {
  const linkFarm = `<html><body>${Array.from({ length: 30 }, (_, i) => `<a href="https://x.tld/${i}">link ${i} click here now</a>`).join('')}<p>tiny</p></body></html>`
  const out = extractText(linkFarm)
  assert.equal(out.confidenceLow, true)
  assert.ok(out.note && out.note.length > 0, '低置信必须给原因')
})

test('extractText：短正文不误杀为空（长度置信信号）', () => {
  const out = extractText('<html><body><p>短小正文</p></body></html>')
  assert.equal(out.text.includes('短小正文'), true)
  assert.equal(out.confidenceLow, true)
})
