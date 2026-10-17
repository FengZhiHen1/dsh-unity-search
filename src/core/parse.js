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
 * 从 `<a>` 类标签的 href 提取真实 URL：剥实体、补协议相对（`//host`）、解开引擎跳转包装
 * （`/l?u=<encoded>`、`uddg=`、Bing 的 `ck/a?u=a1<base64url>`）；失败返回 null。
 * 包装未解开时返回包装本身（不丢条目），由调用方决定可用性。
 * @param {string | undefined | null} href
 * @returns {string | null}
 */
export function extractRealUrl(href) {
  if (typeof href !== 'string' || href.trim().length === 0) return null
  // 实体必须先解：`&amp;u=a1…` 若不解，URLSearchParams 会把参数名读成 `amp;u`。
  let url = decodeEntities(href).trim()
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
  if (!/^https?:\/\//.test(url)) return null
  return unwrapRedirector(url)
}

/**
 * 解开已知跳转包装的绝对 URL。无法解开时原样返回。
 * @param {string} url
 * @returns {string}
 */
function unwrapRedirector(url) {
  /** @type {URL} */
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  // Bing 搜索结果锚点：真实目标只在 u=a1<base64url> 里；直接请求 /ck/a 包装实测返回空跳转壳。
  const wrapped = parsed.searchParams.get('u')
  if (typeof wrapped === 'string' && wrapped.startsWith('a1')) {
    const decoded = decodeBase64Url(wrapped.slice(2))
    if (decoded && /^https?:\/\//.test(decoded)) return decoded
  }
  // DuckDuckGo 形态（绝对 URL 上的 uddg 参数）。
  const uddg = parsed.searchParams.get('uddg')
  if (typeof uddg === 'string' && /^https?:\/\//.test(uddg)) return uddg
  return url
}

/**
 * base64url 解码为 UTF-8 文本；非法输入返回 null。
 * @param {string} text
 * @returns {string | null}
 */
function decodeBase64Url(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    // Buffer 对非法字符是宽松丢弃而非抛错：回读校验以拦住"解出一半"的伪造包装。
    const reencoded = Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '')
    return reencoded === normalized.replace(/=+$/, '') ? decoded : null
  } catch {
    return null
  }
}

/** 查询词覆盖评判的停用词（英文功能词与中文疑问词）。只为"结果是否跑题"服务，不参与排序。 */
const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'what', 'how', 'why', 'which', 'who', 'when', 'where',
  'does', 'can', 'are', 'was', 'were', 'you', 'your', 'from', 'that', 'this', 'into',
  '什么', '怎么', '如何', '为什么', '哪些', '多少', '是什么',
])

/**
 * 查询词覆盖率：把查询切成若干"词位组"，统计多少组在给定文本里出现过。
 * 用途是识别上游软降级（HTTP 200 但结果忽略查询词），不是相关性打分：
 * 拉丁词按子串匹配（天然覆盖单复数），中文按相邻二字切片任一片命中即算覆盖。
 * @param {string} query 原始查询。
 * @param {string[]} texts 待检文本（各条目的标题与摘要）。
 * @returns {{ total: number, covered: number, ratio: number, missing: string[] }} 词位组总数、覆盖数、覆盖率与未覆盖组的代表词。
 */
export function queryTermCoverage(query, texts) {
  const haystack = texts.join('\n').toLowerCase()
  const groups = queryTermGroups(query)
  /** @type {string[]} */
  const missing = []
  let covered = 0
  for (const group of groups) {
    if (group.some((term) => haystack.includes(term))) covered++
    else missing.push(group[0])
  }
  const total = groups.length
  return { total, covered, ratio: total === 0 ? 1 : covered / total, missing }
}

/**
 * 查询 → 词位组。每组是若干等价写法，任一处出现即算该组被覆盖。
 * @param {string} query
 * @returns {string[][]}
 */
function queryTermGroups(query) {
  const text = String(query ?? '').toLowerCase()
  /** @type {string[][]} */
  const groups = []
  const seen = new Set()
  /** @param {string[]} group */
  const push = (group) => {
    const unique = [...new Set(group.filter((term) => term.length >= 2))]
    if (unique.length === 0) return
    const key = unique.join('|')
    if (seen.has(key)) return
    seen.add(key)
    groups.push(unique)
  }
  for (const match of text.matchAll(/[a-z0-9][a-z0-9.+#_-]*/g)) {
    const raw = match[0].replace(/[.+#_-]+$/, '')
    if (raw.length < 3 && !/^\d{2,}$/.test(raw)) continue
    if (QUERY_STOPWORDS.has(raw)) continue
    // 带分隔符的复合词额外提供首段（node.js → node），避免结果只写主名时被误判跑题。
    push([raw, raw.split(/[.+#_-]/)[0]])
  }
  for (const match of text.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = match[0]
    if (run.length <= 2) {
      push([run])
      continue
    }
    /** @type {string[]} */
    const bigrams = []
    for (let i = 0; i + 2 <= run.length; i++) bigrams.push(run.slice(i, i + 2))
    push(bigrams)
  }
  return groups
}
