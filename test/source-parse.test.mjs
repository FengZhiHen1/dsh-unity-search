// 源适配器抽查：URL 构造（wiki 语言、arxiv 时间子句）、专有解析（keenable/v2ex/pubmed/openalex）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wikipedia } from '../src/core/platforms/wikipedia.js'
import { ddgLite } from '../src/core/engines/ddg-lite.js'
import { arxiv } from '../src/core/academic/arxiv.js'
import { openalex } from '../src/core/academic/openalex.js'
import { v2ex, filterHotTopics } from '../src/core/platforms/v2ex.js'
import { keenable, extractKeenableSources, formatKeenableRelative } from '../src/core/engines/keenable.js'
import { parseArticles } from '../src/core/academic/pubmed.js'
import { makeRuntime, makeFetch, makeResponse } from './helpers.mjs'

const okJson = (obj) => makeResponse(200, JSON.stringify(obj), { contentType: 'application/json' })

test('wikipedia：语言子域守卫（合法值直取，注入样式回落 zh）', async () => {
  const fetch = makeFetch([['https://', () => okJson({ query: { search: [{ title: 'T', pageid: 1, snippet: 's' }] } })]])
  const rt = makeRuntime({ fetch, config: { sources: { wikipedia: { language: 'en' } } } })
  await wikipedia.search({ query: 'q' }, rt)
  assert.match(fetch.calls[0].url, /^https:\/\/en\.wikipedia\.org\/w\/api\.php/)
  fetch.calls.length = 0
  const evil = makeRuntime({ fetch, config: { sources: { wikipedia: { language: '../../evil' } } } })
  await wikipedia.search({ query: 'q' }, evil)
  assert.match(fetch.calls[0].url, /^https:\/\/zh\.wikipedia\.org/, '非法语言值不得进 host')
})

test('arxiv：timeRange 映射为 submittedDate 区间子句', async () => {
  const atom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2101.00001v3</id><title>T</title><summary>S</summary><published>2021-01-01T00:00:00Z</published><link href="http://arxiv.org/abs/2101.00001v3"/></entry></feed>'
  const fetch = makeFetch([['http://export.arxiv.org', () => makeResponse(200, atom, { contentType: 'application/atom+xml' })]])
  const rt = makeRuntime({ fetch, config: { chain: { timeoutMs: 5000 } } })
  const r = await arxiv.search({ query: 'dense retrieval', timeRange: 'week' }, rt)
  assert.equal(r.status, 'ok')
  assert.equal(r.items[0].sourceIds.arxiv, '2101.00001')
  const url = fetch.calls[0].url
  assert.match(url, /submittedDate%3A%5B\d{12}\+TO\+\d{12}%5D/, '时间窗以 Atom search_query 子句注入（YYYYMMDDHHMM 12 位）')
})

test('openalex：abstract_inverted_index 重建为语序摘要', async () => {
  const payload = { results: [{ id: 'https://openalex.org/W1', doi: 'https://doi.org/10.5/x', title: 'Paper', publication_date: '2024-05-01', abstract_inverted_index: { quick: [1], brown: [2], fox: [3], The: [0] }, primary_location: { url: 'https://oa.org/W1' } }] }
  const fetch = makeFetch([['https://api.openalex.org', () => okJson(payload)]])
  const rt = makeRuntime({ fetch })
  const r = await openalex.search({ query: 'q' }, rt)
  assert.equal(r.status, 'ok')
  assert.equal(r.items[0].snippet, 'The quick brown fox')
  assert.equal(r.items[0].sourceIds.doi, '10.5/x')
})

test('v2ex：热榜本地过滤（标题/内容命中 → SourceItem，序保持）', () => {
  const topics = [
    { id: 1, title: 'DSH 插件开发经验', content: 'xx', url: 'https://v2ex.com/t/1' },
    { id: 2, title: '招聘', content: '高级 DSH 引擎开发', url: 'https://v2ex.com/t/2' },
    { id: 3, title: '天气', content: '晴', url: 'https://v2ex.com/t/3' },
  ]
  const hit = filterHotTopics(topics, 'dsh', 10)
  assert.deepEqual(hit.map((i) => i.url), ['https://www.v2ex.com/t/1', 'https://www.v2ex.com/t/2'])
  assert.equal(filterHotTopics(topics, 'dsh', 1).length, 1)
})

test('keenable：MCP 文本块解析（Title/URL/Published/Snippets 锚点）', () => {
  const text = '结果如下：\nTitle: 标题一\nURL: https://a.tld/1\nPublished: 2026-09-01T00:00:00Z\nSnippets: 摘要一\n\nTitle: 标题二\nURL: https://b.tld/2\nSnippets: 摘要二\n尾部杂项'
  const items = extractKeenableSources(text)
  assert.equal(items.length, 2)
  assert.equal(items[0].title, '标题一')
  assert.equal(items[0].url, 'https://a.tld/1')
  assert.equal(items[0].publishedAt, '2026-09-01T00:00:00Z')
  assert.equal(items[1].publishedAt, null)
  assert.equal(extractKeenableSources('没有任何块').length, 0)
})

test('keenable：相对时长词汇（12h 下限、天/月/年档）', () => {
  assert.equal(formatKeenableRelative(0.2), '12h')
  assert.equal(formatKeenableRelative(1), '1d')
  assert.equal(formatKeenableRelative(7), '7d')
  assert.equal(formatKeenableRelative(45), '2mo')
  assert.equal(formatKeenableRelative(400), '1y')
})

test('pubmed：efetch XML → 题录条目', () => {
  const xml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle>
    <MedlineCitation><PMID Version="1">12345</PMID><Article>
      <ArticleTitle>生医标题</ArticleTitle>
      <Abstract><AbstractText>生医摘要</AbstractText></Abstract>
      <Journal><Title>J. Test</Title></Journal>
    </Article></MedlineCitation>
    <PubmedData><History><PubMedPubDate><Year>2024</Year><Month>5</Month><Day>1</Day></PubMedPubDate></History></PubmedData>
  </PubmedArticle></PubmedArticleSet>`
  const items = parseArticles(xml)
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '生医标题')
  assert.equal(items[0].snippet, '生医摘要')
  assert.equal(items[0].sourceIds.pmid, '12345')
  assert.match(String(items[0].publishedAt), /2024/)
})

test('未路由请求显形（fetch 替身不吞错）', async () => {
  const fetch = makeFetch([])
  await assert.rejects(() => fetch('https://nowhere.tld/'), /unrouted/)
})

// ── ddg-lite 解析回归（2026-09-18：本机经代理活体暴露——"取第一个双引号串当 href"取到 rel 值，9 条结果被静默丢弃）──
const DDG_LITE_HTML = `<html><body><table>
  <tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeepseek.com%2Fen%2Findex.html&amp;rut=85e378ac" class='result-link'>DeepSeek | Into the Unknown</a></td></tr>
  <tr><td class="result-snippet">DeepSeek official site</td></tr>
  <tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.deepseek.com%2Fen%2Fplatform%2F&amp;rut=0385124b" class='result-link'>DeepSeek | API Platform</a></td></tr>
</table></body></html>`

test('ddg-lite：rel 先于 href 的真实标记仍能取到解包后的真实 URL', async () => {
  const fetch = makeFetch([['https://lite.duckduckgo.com/lite/', () => makeResponse(200, DDG_LITE_HTML)]])
  const rt = makeRuntime({ fetch })
  const out = await ddgLite.search({ query: 'deepseek', maxResults: 3 }, rt)
  assert.equal(out.status, 'ok')
  assert.equal(out.items.length, 2, 'rel 值不得被当作 href 而整批丢弃')
  assert.equal(out.items[0].url, 'https://deepseek.com/en/index.html')
  assert.equal(out.items[0].title, 'DeepSeek | Into the Unknown')
  assert.equal(out.items[1].url, 'https://www.deepseek.com/en/platform/')
})

test('ddg-lite：检出结果块但提取全失败时以 warning 显形（不静默交空结果）', async () => {
  const fetch = makeFetch([['https://lite.duckduckgo.com/lite/', () => makeResponse(200, "<a class='result-link'>没有 href 的锚点</a>")]])
  const rt = makeRuntime({ fetch })
  const out = await ddgLite.search({ query: 'x' }, rt)
  assert.equal(out.status, 'ok')
  assert.equal(out.items.length, 0)
  assert.match(out.warnings?.[0] ?? '', /页面结构可能已变/)
})
