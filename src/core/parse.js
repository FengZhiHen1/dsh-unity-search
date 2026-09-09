// HTML/文本解析共享助手：剥标签、实体解码、摘要清洗。
// 抓取类引擎天然脆弱：解析锚点与各适配器同址，本文件只放跨源公用的纯函数。
// @ts-check

/** 命名字符实体表（覆盖 HTML 检索摘要常见实体；其余走数字实体）。 */
const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['mdash', '—'],
  ['ndash', '–'],
  ['hellip', '…'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['middot', '·'],
  ['bull', '•'],
  ['deg', '°'],
  ['trade', '™'],
  ['reg', '®'],
  ['copy', '©'],
])

/**
 * 解码 HTML 实体：命名表 + 十六/十进制数字实体。未知命名实体原样保留（可诊断，不伪造）。
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (typeof body !== 'string') return whole
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? safeFromCodePoint(code) : whole
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? safeFromCodePoint(code) : whole
    }
    const mapped = NAMED_ENTITIES.get(body)
    return mapped ?? whole
  })
}

/**
 * @param {number} code
 * @returns {string}
 */
function safeFromCodePoint(code) {
  try {
    return String.fromCodePoint(code)
  } catch {
    // 越界已被外层拦住，此处只剩代理区码点等极端形态：以空串替换，实体不外漏。
    return ''
  }
}

/**
 * 剥除 HTML 标签（含属性与注释），随后解码实体。用于标题/摘要类片段。
 * @param {string} html
 * @returns {string}
 */
export function stripTags(html) {
  return decodeEntities(String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
}

/**
 * 摘要清洗：剥标签、压缩空白、截断（默认 300 字符——对齐上游检索摘要的信息密度，非任意值）。
 * @param {string | undefined | null} snippet
 * @param {number} [maxLength]
 * @returns {string | null}
 */
export function cleanSnippet(snippet, maxLength = 300) {
  if (typeof snippet !== 'string') return null
  const text = stripTags(snippet).replace(/\s+/g, ' ').trim()
  if (text.length === 0) return null
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

/**
 * 从 `<a>` 类标签的 href 提取真实 URL：
 * 处理协议相对（`//host`）与跳转包装（`/l?u=<encoded>`、`uddg=`）形态；失败返回 null。
 * @param {string | undefined | null} href
 * @returns {string | null}
 */
export function extractRealUrl(href) {
  if (typeof href !== 'string' || href.trim().length === 0) return null
  let url = href.trim()
  if (url.startsWith('//')) url = `https:${url}`
  if (url.startsWith('/')) {
    // 引擎跳转包装：常见形态 /l/...?u=<encoded> 或 ?uddg=<encoded>
    const m = /[?&](?:u|uddg|url)=([^&]+)/.exec(url)
    if (!m || !m[1]) return null
    try {
      url = decodeURIComponent(m[1])
    } catch {
      return null
    }
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // DuckDuckGo 风格的 uddg 包装参数（绝对 URL 上）。
    try {
      const parsed = new URL(url)
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) url = uddg
    } catch { // quality-floor: ignore silent-catch URL 解析失败保持原值返回：调用方拿到未解包装的 URL 仍可比对，属显式降级非吞错
      // 保持原值。
    }
    return url
  }
  return null
}
