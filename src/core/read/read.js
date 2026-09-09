// read_source 管线：SSRF 校验 → 逐跳受界取回 → 抽取 → 聚焦重排 → offset/limit 切片 → 全量落盘。
// 契约 = docs/technical-details/工具面与有界阅读.md「有界阅读机制」全部 6 条 + 不变量。
// @ts-check

import { httpRequest, MAX_READ_BYTES, DEFAULT_MIN_INTERVAL_MS } from '../http.js'
import { assertSafeTarget } from './ssrf.js'
import { extractText, looksLikeHtml } from './extract.js'
import { artifactFileName, writeArtifact } from './artifact.js'

/** 重定向跳数上界（对齐常见浏览器行为；超过即判循环/失控跳转）。 */
const MAX_REDIRECT_HOPS = 5
/** 二进制内容判定：NUL 字符占比阈值（UTF-8 文本正文中正常为 0）。 */
const NUL_RATIO_BINARY = 0.005

/**
 * @typedef {Object} ReadRequest
 * @property {string} url
 * @property {string} [focus]
 * @property {number} [offset]
 * @property {number} [limit]
 */

/**
 * @typedef {Object} ReadResult 结构恒定完整（失败时 error 非空、内容字段为中性值）。
 * @property {'ok' | 'error'} status
 * @property {{ code: string, message: string } | null} error
 * @property {string} url 最终 URL（未取回时为请求 URL）。
 * @property {number | null} statusCode
 * @property {'text' | 'empty' | null} contentKind
 * @property {string | null} title
 * @property {string} content
 * @property {number} offset
 * @property {number} limit
 * @property {number} totalChars
 * @property {boolean} truncated
 * @property {string[]} uncertainty
 * @property {string[]} warnings
 * @property {string | null} artifactPath
 * @property {'text' | 'raw' | null} artifactKind
 * @property {number | null} artifactBytes
 */

/**
 * @param {ReadRequest} request
 * @param {{ runtime: import('../types.js').CoreRuntime }} deps
 * @returns {Promise<ReadResult>}
 */
export async function readSource(request, { runtime }) {
  const cfg = { ...defaultReadConfig(), ...(runtime.config.readSource ?? {}) }
  /** @type {string[]} */
  const warnings = []
  /** @type {string[]} */
  const uncertainty = []
  const neutral = (/** @type {Partial<ReadResult>} */ overrides) => ({
    status: 'error',
    error: null,
    url: request.url,
    statusCode: null,
    contentKind: null,
    title: null,
    content: '',
    offset: 0,
    limit: 0,
    totalChars: 0,
    truncated: false,
    uncertainty: [],
    warnings: [],
    artifactPath: null,
    artifactKind: null,
    artifactBytes: null,
    ...overrides,
  })

  // 1. 目标校验（协议 + DNS + 私网拒绝；allowPrivate 显式放开）。
  const initial = await assertSafeTarget(request.url, { allowPrivate: cfg.allowPrivate, dns: runtime.dns })
  if (!initial.ok) {
    return neutral({ error: { code: initial.code, message: initial.message } })
  }

  // 2. 逐跳取回：manual redirect，每一跳都重新过目标校验（含重定向语义）。
  let current = initial.url
  /** @type {Awaited<ReturnType<typeof httpRequest>> | null} */
  let response = null
  /** @type {import('../types.js').SourceError | null} */
  let failure = null
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const result = await httpRequest(runtime, current.toString(), {
      timeoutMs: cfg.timeoutMs,
      maxBytes: MAX_READ_BYTES,
      throttleMs: DEFAULT_MIN_INTERVAL_MS,
      redirect: 'manual',
      headers: { accept: 'text/html, text/plain, application/xhtml+xml, application/json;q=0.9, */*;q=0.5' },
    })
    if (result.ok) {
      response = result
      break
    }
    // 3xx 且有 Location：校验下一跳后续走。
    if (result.error.code === 'http_3xx' && typeof result.location === 'string' && result.location.length > 0) {
      /** @type {URL} */
      let next
      try {
        next = new URL(result.location, current)
      } catch {
        failure = { code: 'invalid_response', message: `unparseable redirect Location: ${result.location.slice(0, 200)}` }
        break
      }
      const check = await assertSafeTarget(next.toString(), { allowPrivate: cfg.allowPrivate, dns: runtime.dns })
      if (!check.ok) {
        failure = { code: check.code, message: `redirect target rejected: ${check.message}` }
        break
      }
      current = check.url
      if (hop === MAX_REDIRECT_HOPS) {
        failure = { code: 'http_3xx', message: `too many redirects (>${MAX_REDIRECT_HOPS})` }
        break
      }
      continue
    }
    // 非 2xx 响应（4xx/5xx）是结果不是异常：statusCode 进输出、content 为空、无 artifact。
    if (typeof result.status === 'number' && result.error.code !== 'aborted') {
      return neutral({
        status: 'ok',
        error: null,
        url: current.toString(),
        statusCode: result.status,
        contentKind: 'empty',
        warnings: [`HTTP ${result.status}，无正文可抽取`],
        limit: effectiveLimit(request, cfg, warnings).limit,
      })
    }
    failure = result.error
    break
  }
  if (!response) {
    return neutral({ error: failure ?? { code: 'internal', message: 'read pipeline ended without response' } })
  }

  // 3. 内容类型分派：HTML 抽取；text/* 直取；明显二进制判失败（无 artifact——内容不可存为可读文本）。
  const body = response.body
  const contentType = response.contentType
  if (isBinary(contentType, body)) {
    return neutral({
      statusCode: response.status,
      error: { code: 'invalid_response', message: `binary content not supported: ${contentType || 'unknown type'}` },
    })
  }
  /** @type {string | null} */
  let title = null
  /** @type {string} */
  let text
  /** @type {'text' | 'raw'} */
  let artifactKind = 'text'
  let rawFallback = false
  if (looksLikeHtml(contentType, body)) {
    const extracted = extractText(body)
    title = extracted.title
    text = extracted.text
    if (extracted.confidenceLow && extracted.note) uncertainty.push(extracted.note)
    if (text.length === 0) {
      // 抽取失败回退：正文为空，但原始 body 落盘（artifactKind raw），Agent 可离线自救。
      text = ''
      artifactKind = 'raw'
      rawFallback = true
      warnings.push('HTML 抽取失败，正文为空；原始响应体已按 raw 落盘')
    }
  } else {
    text = body
    if (contentType && !contentType.startsWith('text/') && !contentType.includes('json') && !contentType.includes('xml')) {
      uncertainty.push(`非 HTML 且非 text/* 内容（${contentType}），按原文返回未做结构抽取`)
    }
  }

  // 4. 聚焦重排（切片前）：命中段前置，不改变总长与分页语义。
  if (typeof request.focus === 'string' && request.focus.trim().length > 0 && text.length > 0) {
    const reordered = reorderForFocus(text, request.focus)
    if (reordered.hits === 0) warnings.push(`focus "${request.focus.trim().slice(0, 40)}" 无命中，未重排`)
    else text = reordered.text
  }

  // 5. offset/limit 切片（在抽取后的纯文本上；不变量 content.length <= limit）。
  const { limit, offset } = effectiveLimit(request, cfg, warnings)
  const safeOffset = Math.min(Math.max(0, Math.trunc(offset)), text.length)
  const content = text.slice(safeOffset, safeOffset + limit)
  const truncated = safeOffset + content.length < text.length

  // 6. 全量落盘（不受 limit 约束；persist 关闭或目录缺失 → 三字段 null，结构不缺省）。
  /** @type {string | null} */
  let artifactPath = null
  /** @type {number | null} */
  let artifactBytes = null
  if (cfg.persist) {
    const payload = artifactKind === 'raw' ? body : text
    const fileName = artifactFileName(current.toString(), runtime.now(), artifactKind)
    const written = await writeArtifact({ dir: cfg.dir, fileName, content: payload, maxTotalMB: cfg.maxTotalMB, warn: (m) => runtime.logger.warn(m) })
    if (written.ok) {
      artifactPath = written.path
      artifactBytes = written.bytes
      if (written.removed.includes(fileName)) warnings.push('落盘目录超出 maxTotalMB，本文件被 LRU 立即驱逐')
    } else {
      warnings.push(`artifact 写入失败：${written.error}`)
      artifactKind = rawFallback ? 'raw' : artifactKind
    }
  }

  return {
    status: 'ok',
    error: null,
    url: current.toString(),
    statusCode: response.status,
    contentKind: 'text',
    title,
    content,
    offset: safeOffset,
    limit,
    totalChars: text.length,
    truncated,
    uncertainty,
    warnings,
    artifactPath,
    artifactKind: artifactPath ? artifactKind : null,
    artifactBytes,
  }
}

/**
 * @returns {{ allowPrivate: boolean, persist: boolean, dir: string, maxTotalMB: number, defaultChars: number, maxChars: number, timeoutMs: number }}
 */
function defaultReadConfig() {
  return { allowPrivate: false, persist: true, dir: '', maxTotalMB: 256, defaultChars: 8000, maxChars: 20000, timeoutMs: 30000 }
}

/**
 * limit/offset 归一：默认值、硬上限钳制（记 warning）、非数回退。
 * @param {ReadRequest} request
 * @param {{ defaultChars: number, maxChars: number }} cfg
 * @param {string[]} warnings
 * @returns {{ limit: number, offset: number }}
 */
function effectiveLimit(request, cfg, warnings) {
  let limit = typeof request.limit === 'number' && Number.isFinite(request.limit) && request.limit > 0 ? Math.trunc(request.limit) : cfg.defaultChars
  if (limit > cfg.maxChars) {
    warnings.push(`limit ${limit} 超出硬上限，按 ${cfg.maxChars} 截断`)
    limit = cfg.maxChars
  }
  const offset = typeof request.offset === 'number' && Number.isFinite(request.offset) && request.offset > 0 ? Math.trunc(request.offset) : 0
  return { limit, offset }
}

/**
 * @param {string} contentType
 * @param {string} body
 * @returns {boolean}
 */
function isBinary(contentType, body) {
  if (/^(image|audio|video)\//.test(contentType) || contentType.includes('application/pdf') || contentType.includes('application/zip') || contentType.includes('octet-stream')) return true
  const sample = body.slice(0, 4096)
  if (sample.length === 0) return false
  let nul = 0
  for (const ch of sample) if (ch === '\0') nul++
  return nul / sample.length > NUL_RATIO_BINARY
}

/**
 * 聚焦重排：按段落与 focus 词的字符重叠打分，高分前置（稳定排序保留原相对序）。
 * @param {string} text
 * @param {string} focus
 * @returns {{ text: string, hits: number }}
 */
export function reorderForFocus(text, focus) {
  const terms = focus
    .toLowerCase()
    .split(/[\s,，、;；]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  if (terms.length === 0) return { text, hits: 0 }
  const paragraphs = text.split(/\n\n+/)
  /** @type {Array<{ p: string, score: number, index: number }>} */
  const scored = paragraphs.map((p, index) => {
    const lower = p.toLowerCase()
    return { p, score: terms.reduce((acc, term) => acc + (lower.includes(term) ? 1 : 0), 0), index }
  })
  const hits = scored.filter((s) => s.score > 0).length
  if (hits === 0) return { text, hits: 0 }
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return { text: scored.map((s) => s.p).join('\n\n'), hits }
}
