// 正文抽取：无依赖正则启发式（去脚本样式 → article/main 优先 → 段落密度 → 纯文本保留段落边界）。
// 契约 = docs/technical-details/工具面与有界阅读.md「有界阅读机制 2」。
// 置信度低（正文过短 / 链接密度过高）→ confidenceLow + note，由 read 层转成 uncertainty。
// @ts-check

import { cleanSnippet, decodeEntities, stripTags } from '../parse.js'

/** 正文过短阈值（码点）：低于此值更像列表页/跳转页而非文章。 */
const MIN_REASONABLE_TEXT = 500
/** 链接文本占比阈值：超过即判"目录/导航页"倾向。 */
const MAX_LINK_DENSITY = 0.5
/** boilerplate 容器 class/id 噪声词（导航/页脚/侧栏/评论等）。 */
const BOILERPLATE_RE = /\b(?:nav|navbar|menu|header|footer|sidebar|side-bar|comment|comments|advert|banner|promo|cookie|share|social|related|breadcrumb|pagination|subscribe|newsletter)\b/i

/**
 * @typedef {Object} ExtractResult
 * @property {string | null} title
 * @property {string} text 段落间以 \n\n 连接的纯文本
 * @property {boolean} confidenceLow
 * @property {string | null} note 置信度低的原因（成功时 null）
 */

/**
 * HTML 是否值得走抽取路径（text/html 或嗅探到 html 头）。
 * @param {string} contentType
 * @param {string} body
 * @returns {boolean}
 */
export function looksLikeHtml(contentType, body) {
  if (contentType.includes('html')) return true
  if (contentType && !contentType.startsWith('text/')) return false
  return /^\s*<!doctype html|^\s*<html[\s>]/i.test(body.slice(0, 2048))
}

/**
 * 从 HTML 抽取正文纯文本与标题。永不抛异常：最差输出空文本 + 置信度低。
 * @param {string} html
 * @returns {ExtractResult}
 */
export function extractText(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  // 非内容标签整体连内部文本一起丢弃（script 里的假正文是最常见污染源）。
  let work = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  // 候选容器：article > main > 全文（boilerplate 段剔除后）。
  const candidates = collectCandidates(work)
  /** @type {{ text: string, linkChars: number, totalChars: number } | null} */
  let best = null
  for (const candidate of candidates) {
    const measured = measure(candidate)
    if (!best || measured.text.length > best.text.length) best = measured
  }
  if (!best || best.text.length === 0) {
    return { title: normalizeTitle(title), text: '', confidenceLow: true, note: '未找到可抽取正文' }
  }
  const linkDensity = best.totalChars > 0 ? best.linkChars / best.totalChars : 0
  if (best.text.length < MIN_REASONABLE_TEXT) {
    return { title: normalizeTitle(title), text: best.text, confidenceLow: true, note: `正文仅 ${best.text.length} 字符，可能是列表页或跳转页` }
  }
  if (linkDensity > MAX_LINK_DENSITY) {
    return { title: normalizeTitle(title), text: best.text, confidenceLow: true, note: `链接文本占比 ${(linkDensity * 100) | 0}%，可能是目录/导航页` }
  }
  return { title: normalizeTitle(title), text: best.text, confidenceLow: false, note: null }
}

/**
 * 收集候选正文容器 HTML 段（article/main 命中则只返回它们；否则返回剔除 boilerplate 的 body/全文）。
 * @param {string} html
 * @returns {string[]}
 */
function collectCandidates(html) {
  /** @type {string[]} */
  const semantic = []
  for (const match of html.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    semantic.push(match[2] ?? '')
  }
  if (semantic.length > 0) return semantic
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  const scope = bodyMatch?.[1] ?? html
  // boilerplate 剔除：按带 class/id 噪声词的块级容器整段删（启发式，允许误删）。
  const scrubbed = scope.replace(
    /<(?:div|section|aside|nav|ul|header|footer)\b[^>]*(?:class|id)=["'][^"']*["'][^>]*>[\s\S]*?<\/(?:div|section|aside|nav|ul|header|footer)>/gi,
    (whole) => (BOILERPLATE_RE.test(/(?:class|id)=["'][^"']*["']/.exec(whole)?.[0] ?? '') ? ' ' : whole),
  )
  return [scrubbed]
}

/**
 * 容器 HTML → 段落化纯文本度量（段落 = 块级标签切分）。
 * @param {string} html
 * @returns {{ text: string, linkChars: number, totalChars: number }}
 */
function measure(html) {
  // 链接文本单独计数（密度启发式）。
  let linkChars = 0
  const linkless = html.replace(/<a\b[\s\S]*?<\/a>/gi, (anchor) => {
    linkChars += plainLen(stripTags(anchor))
    return ' '
  })
  const paragraphs = linkless
    .split(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr|section|article|ul|ol|figure|figcaption|dd|dt)>|<br\s*\/?>/i)
    .map((chunk) => cleanParagraph(chunk))
    .filter((p) => p.length > 0)
  const text = paragraphs.join('\n\n')
  return { text, linkChars, totalChars: text.length + linkChars }
}

/**
 * 单段清洗：去标签、解实体、压空白（保留词间单空格）。
 * @param {string} chunk
 * @returns {string}
 */
function cleanParagraph(chunk) {
  const plain = decodeEntities(stripTags(chunk))
    .replace(/\s+/g, ' ')
    .trim()
  return plain
}

/**
 * @param {string | undefined} raw
 * @returns {string | null}
 */
function normalizeTitle(raw) {
  if (!raw) return null
  const cleaned = cleanSnippet(decodeEntities(stripTags(raw)), 300)
  return cleaned.length > 0 ? cleaned : null
}

/**
 * @param {string} s
 * @returns {number}
 */
function plainLen(s) {
  return s.replace(/\s+/g, '').length
}
