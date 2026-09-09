// read_source 管线端到端（fake fetch/dns + 真 tmp 落盘目录）：分页不变量、非2xx即结果、
// 二进制拒绝、逐跳重定向复校验、落盘开关与目录缺失降级、focus 重排。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSource } from '../src/core/read/read.js'
import { reorderForFocus } from '../src/core/read/read.js'
import { makeRuntime, makeFetch, makeResponse } from './helpers.mjs'

const PUBLIC_DNS = { lookup: async () => [{ address: '93.184.216.34' }] }
const PARAGRAPH = 'The quick brown fox jumps over the lazy dog again and again. '.repeat(12)
const LONG_HTML = `<html><head><title>长文页</title></head><body><article><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p></article></body></html>`

async function harness(readSourceCfg = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'unity-read-'))
  const fetch = makeFetch([
    ['https://good.tld/page', () => makeResponse(200, LONG_HTML)],
    ['https://good.tld/tiny', () => makeResponse(200, '<html><body><p>短文本</p></body></html>')],
    ['https://good.tld/empty-html', () => makeResponse(200, '<html><body><img src="x"></body></html>')],
    ['https://nf.tld/x', () => makeResponse(404, '<html><body>nope</body></html>')],
    ['https://bin.tld/f', () => makeResponse(200, 'PDFBINARYDATA', { contentType: 'application/pdf' })],
    ['https://nul.tld/f', () => makeResponse(200, 'abc\0\0\0\0\0\0def', { contentType: 'text/plain' })],
    ['https://rd.tld/go', () => makeResponse(302, '', { location: 'https://good.tld/page' })],
    ['https://badrd.tld/go', () => makeResponse(302, '', { location: 'http://127.0.0.1/secret' })],
    ['https://loop.tld/go', () => makeResponse(302, '', { location: 'https://loop.tld/go' })],
    ['https://plain.tld/t.txt', () => makeResponse(200, PARAGRAPH, { contentType: 'text/plain; charset=utf-8' })],
  ])
  const runtime = makeRuntime({
    fetch,
    dns: PUBLIC_DNS,
    config: {
      chain: { order: [], cooldownSeconds: 0, timeoutMs: 15000 },
      readSource: { dir, defaultChars: 400, maxChars: 1000, persist: true, maxTotalMB: 256, allowPrivate: false, timeoutMs: 5000 },
      ...{ engines: {}, sources: {}, contact: '' },
      ...(Object.keys(readSourceCfg).length ? { readSource: { ...dirCfgBase(dir), ...readSourceCfg } } : {}),
    },
  })
  return { dir, runtime, fetch }
}

function dirCfgBase(dir) {
  return { dir, defaultChars: 400, maxChars: 1000, persist: true, maxTotalMB: 256, allowPrivate: false, timeoutMs: 5000 }
}

test('200 HTML：抽取分页 + 全量落盘 + 字段恒定完整', async () => {
  const { runtime, dir } = await harness()
  const r = await readSource({ url: 'https://good.tld/page' }, { runtime })
  assert.equal(r.status, 'ok')
  assert.equal(r.error, null)
  assert.equal(r.contentKind, 'text')
  assert.equal(r.title, '长文页')
  assert.equal(r.limit, 400)
  assert.equal(r.offset, 0)
  assert.equal(r.content.length, 400)
  assert.equal(r.truncated, true)
  assert.ok(r.totalChars > 800)
  assert.ok(r.artifactPath && r.artifactPath.includes('good.tld'))
  assert.equal(r.artifactKind, 'text')
  const onDisk = await readFile(r.artifactPath, 'utf8')
  assert.equal(onDisk.length, r.totalChars, 'artifact 是全文不是窗口')
  await rm(dir, { recursive: true, force: true })
})

test('offset 翻页不变量：第二窗口拼接覆盖全文且 content ≤ limit', async () => {
  const { runtime, dir } = await harness()
  const r1 = await readSource({ url: 'https://good.tld/page' }, { runtime })
  const r2 = await readSource({ url: 'https://good.tld/page', offset: r1.limit }, { runtime })
  assert.equal(r2.offset, 400)
  assert.ok(r2.truncated, '两页未读完全文')
  const r3 = await readSource({ url: 'https://good.tld/page', offset: 999_999 }, { runtime })
  assert.equal(r3.content, '')
  assert.equal(r3.truncated, false, '越界 offset 是读完信号，不是错误')
  assert.equal(r3.status, 'ok')
  await rm(dir, { recursive: true, force: true })
})

test('limit 超硬上限 → 钳制并 warning', async () => {
  const { runtime, dir } = await harness()
  const r = await readSource({ url: 'https://good.tld/page', limit: 5000 }, { runtime })
  assert.equal(r.limit, 1000)
  assert.match(r.warnings.join(' '), /超出硬上限，按 1000 截断/)
  await rm(dir, { recursive: true, force: true })
})

test('非 2xx = 结果不是异常：empty 正文 + warning，无 artifact', async () => {
  const { runtime, dir } = await harness()
  const r = await readSource({ url: 'https://nf.tld/x' }, { runtime })
  assert.equal(r.status, 'ok')
  assert.equal(r.statusCode, 404)
  assert.equal(r.contentKind, 'empty')
  assert.equal(r.artifactPath, null)
  assert.match(r.warnings.join(' '), /HTTP 404/)
  await rm(dir, { recursive: true, force: true })
})

test('二进制拒绝：pdf 类型与 NUL 密度嗅探都是 error 通道', async () => {
  const { runtime, dir } = await harness()
  const pdf = await readSource({ url: 'https://bin.tld/f' }, { runtime })
  assert.equal(pdf.status, 'error')
  assert.equal(pdf.error.code, 'invalid_response')
  const nul = await readSource({ url: 'https://nul.tld/f' }, { runtime })
  assert.equal(nul.error.code, 'invalid_response')
  await rm(dir, { recursive: true, force: true })
})

test('重定向：合法跳转更新最终 URL；跳私网逐跳拒绝；循环封顶', async () => {
  const { runtime, dir } = await harness()
  const ok = await readSource({ url: 'https://rd.tld/go' }, { runtime })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.url, 'https://good.tld/page')
  const bad = await readSource({ url: 'https://badrd.tld/go' }, { runtime })
  assert.equal(bad.error.code, 'unsafe_target')
  assert.match(bad.error.message, /redirect target rejected/)
  const loop = await readSource({ url: 'https://loop.tld/go' }, { runtime })
  assert.equal(loop.error.code, 'http_3xx')
  assert.match(loop.error.message, /too many redirects/)
  await rm(dir, { recursive: true, force: true })
})

test('persist:false 与目录缺失：三字段 null + 显式 warning（结构不缺省）', async () => {
  const off = await harness({ persist: false })
  const r1 = await readSource({ url: 'https://good.tld/tiny' }, { runtime: off.runtime })
  assert.equal(r1.artifactPath, null)
  assert.equal(r1.warnings.length, 0)
  const nodir = await harness({ dir: '' })
  const r2 = await readSource({ url: 'https://good.tld/tiny' }, { runtime: nodir.runtime })
  assert.equal(r2.artifactPath, null)
  assert.match(r2.warnings.join(' '), /artifact 写入失败/)
  assert.equal(r2.status, 'ok', '落盘失败不改内容裁决')
})

test('HTML 抽取空正文 → raw 落盘自救通道', async () => {
  const { runtime, dir } = await harness()
  const r = await readSource({ url: 'https://good.tld/empty-html' }, { runtime })
  assert.equal(r.content, '')
  assert.equal(r.artifactKind, 'raw')
  assert.match(r.warnings.join(' '), /原始响应体已按 raw 落盘/)
  const onDisk = await readFile(String(r.artifactPath), 'utf8')
  assert.match(onDisk, /<img/)
  await rm(dir, { recursive: true, force: true })
})

test('focus：命中段前置；无命中只 warning 不动正文', async () => {
  const { runtime, dir } = await harness()
  const hit = await readSource({ url: 'https://good.tld/page', focus: 'fox' }, { runtime })
  assert.match(hit.content.slice(0, 120), /fox/)
  const plain = await readSource({ url: 'https://good.tld/page' }, { runtime })
  const miss = await readSource({ url: 'https://good.tld/page', focus: 'quantum entanglement' }, { runtime })
  assert.match(miss.warnings.join(' '), /无命中，未重排/)
  assert.equal(miss.content, plain.content, '无命中 = 不重排，正文与无 focus 一致')
  await rm(dir, { recursive: true, force: true })
})

test('短正文不误杀：status ok，但置信信号进 uncertainty', async () => {
  const { runtime, dir } = await harness()
  const r = await readSource({ url: 'https://good.tld/tiny' }, { runtime })
  assert.equal(r.status, 'ok')
  assert.equal(r.content.includes('短文本'), true)
  assert.equal(r.uncertainty.length, 1, '低置信必须显形一条')
  await rm(dir, { recursive: true, force: true })
})

test('reorderForFocus 单元：稳定序、词表切分、无词退化', () => {
  const text = ['第一段无关', '第二段有 target 一词', '第三段 target 且 more target 两词'].join('\n\n')
  const out = reorderForFocus(text, 'target more')
  assert.equal(out.hits, 2)
  assert.ok(out.text.indexOf('第三段') < out.text.indexOf('第二段'), '分数高者前')
  assert.ok(out.text.indexOf('第二段') < out.text.indexOf('第一段'), '同分保原序')
  assert.equal(reorderForFocus(text, '   ').text, text)
  assert.equal(reorderForFocus(text, 'nothing-hits').hits, 0)
})
