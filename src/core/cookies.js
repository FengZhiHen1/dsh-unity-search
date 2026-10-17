// 会话 cookie 罐：按域维持上游会话状态，供出站请求复用。
// 动机：Bing 一类 HTML 检索端点对无会话的匿名首访会返回忽略查询词的降级结果集（HTTP 仍 200），
// 携带会话 cookie 后同一查询恢复精确排序；实证记录见 docs/technical-details/源适配器清单与端点契约.md。
// 纯 core：时钟与响应对象由调用方注入，无模块级状态。
// @ts-check

/** 单条 cookie 值长度上界（RFC 6265 常见实现上界；超界丢弃而非截断，避免送出被服务端拒收的半条值）。 */
const MAX_VALUE_LENGTH = 4096
/** 单域 cookie 条数上界（超出按最久未用驱逐）。 */
const MAX_PER_DOMAIN = 32
/** 域表容量上界（超出按最久未用逐域驱逐一整域）。 */
const MAX_DOMAINS = 32
/** 域后缀回溯层数上界（host 标签数有限，4 层足够覆盖 www./m./api. 一类前缀）。 */
const MAX_SUFFIX_LEVELS = 4

/** cookie 名：RFC 6265 token。 */
const NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
/** cookie 值：RFC 6265 cookie-octet（排除控制符、引号、逗号、分号、反斜杠），失败即丢弃以防请求头注入。 */
const VALUE_PATTERN = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/
/** 无 getSetCookie 时的回退切分点：逗号后紧跟一个 name= 形态（Expires 的日期逗号后不跟等号，不会被误切）。 */
const SET_COOKIE_SPLIT = /,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/

/**
 * @typedef {Object} StoredCookie 一条已收下的 cookie。
 * @property {string} value 原值（不做 URL 解码）。
 * @property {number} expiresAt 到期时刻（epoch ms）；Infinity 表示会话 cookie（进程内有效）。
 * @property {boolean} secure 是否只在 https 下发送。
 * @property {number} usedAt 最近一次被发送/写入的时刻（域与条数驱逐依据）。
 */

/**
 * @typedef {Object} CookieJar 按域隔离的会话 cookie 罐。
 * @property {(hostname: string, protocol?: string) => string | null} header 组请求头值；该域无可用 cookie 时返回 null。
 * @property {(hostname: string, response: unknown) => void} absorb 收下响应里的 Set-Cookie（可对任意一次响应调用）。
 * @property {(hostname: string) => boolean} has 该域是否有未过期的 cookie（会话是否已建立）。
 * @property {() => { domains: number, cookies: number }} stats 容量观测（诊断与测试用）。
 */

/**
 * 创建 cookie 罐。实例存活于创建者作用域（adapter fiber），不持久化、不落盘。
 * @param {{ now: () => number }} env 时钟注入（Max-Age/Expires 判定与 LRU 时间戳）。
 * @returns {CookieJar}
 */
export function createCookieJar({ now }) {
  /** @type {Map<string, Map<string, StoredCookie>>} */
  const domains = new Map()
  return {
    header: (hostname, protocol = 'https:') => headerOf(domains, now(), hostname, protocol),
    absorb: (hostname, response) => absorbInto(domains, now(), hostname, response),
    has: (hostname) => collectCookies(domains, now(), hostname, 'https:').length > 0,
    stats: () => statsOf(domains),
  }
}

/**
 * 收下响应里的全部 Set-Cookie。到期时刻已过的 cookie 直接删除（Max-Age=0 的注销语义）。
 * @param {Map<string, Map<string, StoredCookie>>} domains
 * @param {number} at 当前时刻（epoch ms）。
 * @param {string} hostname 响应所属 host。
 * @param {unknown} response
 * @returns {void}
 */
function absorbInto(domains, at, hostname, response) {
  const lines = setCookieLines(response)
  if (lines.length === 0) return
  const host = normalizeDomain(hostname)
  if (host.length === 0) return
  for (const line of lines) {
    const parsed = parseSetCookie(line, at)
    if (!parsed) continue
    // 域的归属必须覆盖响应 host（否则是第三方/伪造域的注入，拒收）。
    const domain = parsed.domain ?? host
    if (!domainCovers(host, domain)) continue
    writeCookie(domains, at, domain, parsed)
  }
}

/**
 * 组请求头值。
 * @param {Map<string, Map<string, StoredCookie>>} domains
 * @param {number} at 当前时刻（epoch ms）。
 * @param {string} hostname 目标 host。
 * @param {string} protocol 目标协议（决定 Secure cookie 是否发送）。
 * @returns {string | null}
 */
function headerOf(domains, at, hostname, protocol) {
  const entries = collectCookies(domains, at, hostname, protocol)
  if (entries.length === 0) return null
  for (const entry of entries) entry.cookie.usedAt = at
  return entries.map((entry) => `${entry.name}=${entry.cookie.value}`).join('; ')
}

/**
 * 写入一条 cookie，并维护单域条数与域表容量上界。
 * @param {Map<string, Map<string, StoredCookie>>} domains
 * @param {number} at 当前时刻（epoch ms）。
 * @param {string} domain 归一后的域键。
 * @param {{ name: string, value: string, expiresAt: number, secure: boolean }} parsed
 * @returns {void}
 */
function writeCookie(domains, at, domain, parsed) {
  let bucket = domains.get(domain)
  if (!bucket) {
    bucket = new Map()
    domains.set(domain, bucket)
  }
  bucket.delete(parsed.name)
  if (parsed.expiresAt <= at) {
    if (bucket.size === 0) domains.delete(domain)
    return
  }
  evictOldest(bucket, MAX_PER_DOMAIN - 1)
  bucket.set(parsed.name, { value: parsed.value, expiresAt: parsed.expiresAt, secure: parsed.secure, usedAt: at })
  evictDomains(domains, MAX_DOMAINS, domain)
}

/**
 * 把容器裁剪到 keep 条以内，先驱逐最久未用者。
 * @param {Map<string, StoredCookie>} bucket
 * @param {number} keep 允许保留的最大条数。
 * @returns {void}
 */
function evictOldest(bucket, keep) {
  while (bucket.size > keep) {
    /** @type {string | null} */
    let oldestKey = null
    let oldestAt = Infinity
    for (const [key, cookie] of bucket) {
      if (cookie.usedAt < oldestAt) {
        oldestAt = cookie.usedAt
        oldestKey = key
      }
    }
    if (oldestKey === null) return
    bucket.delete(oldestKey)
  }
}

/**
 * 域表超界时驱逐最久未活动的域；刚写入的域不动（它是当前活跃域）。
 * @param {Map<string, Map<string, StoredCookie>>} domains
 * @param {number} keep 允许保留的最大域数。
 * @param {string} fresh 刚写入的域键。
 * @returns {void}
 */
function evictDomains(domains, keep, fresh) {
  while (domains.size > keep) {
    /** @type {string | null} */
    let oldestDomain = null
    let oldestAt = Infinity
    for (const [key, bucket] of domains) {
      let last = 0
      for (const cookie of bucket.values()) if (cookie.usedAt > last) last = cookie.usedAt
      if (last < oldestAt) {
        oldestAt = last
        oldestDomain = key
      }
    }
    if (oldestDomain === null || oldestDomain === fresh) return
    domains.delete(oldestDomain)
  }
}

/**
 * 收集该 host 可发送的 cookie（顺带清理已过期条目）。
 * @param {Map<string, Map<string, StoredCookie>>} domains
 * @param {number} at 当前时刻（epoch ms）。
 * @param {string} hostname
 * @param {string} protocol
 * @returns {Array<{ name: string, cookie: StoredCookie }>}
 */
function collectCookies(domains, at, hostname, protocol) {
  const host = normalizeDomain(hostname)
  if (host.length === 0) return []
  /** @type {Array<{ name: string, cookie: StoredCookie }>} */
  const out = []
  for (const domain of suffixDomains(host)) {
    const bucket = domains.get(domain)
    if (!bucket) continue
    for (const [name, cookie] of bucket) {
      if (cookie.expiresAt <= at) {
        bucket.delete(name)
        continue
      }
      if (cookie.secure && protocol !== 'https:') continue
      out.push({ name, cookie })
    }
    if (bucket.size === 0) domains.delete(domain)
  }
  return out
}

/**
 * @param {Map<string, Map<string, StoredCookie>>} domains
 * @returns {{ domains: number, cookies: number }}
 */
function statsOf(domains) {
  let cookies = 0
  for (const bucket of domains.values()) cookies += bucket.size
  return { domains: domains.size, cookies }
}

/**
 * host 的后缀域序列（含自身，至多 MAX_SUFFIX_LEVELS 层）。
 * @param {string} host
 * @returns {string[]}
 */
function suffixDomains(host) {
  const labels = host.split('.')
  if (labels.length <= 1) return [host]
  /** @type {string[]} */
  const out = []
  const limit = Math.min(labels.length, MAX_SUFFIX_LEVELS)
  for (let skip = 0; skip < limit; skip++) out.push(labels.slice(skip).join('.'))
  return out
}

/**
 * 归一域键：小写、去前导点与首尾空白。
 * @param {string} domain
 * @returns {string}
 */
function normalizeDomain(domain) {
  return String(domain ?? '').trim().toLowerCase().replace(/^\.+/, '')
}

/**
 * 域是否覆盖 host（自身或其后缀）。
 * @param {string} host
 * @param {string} domain
 * @returns {boolean}
 */
function domainCovers(host, domain) {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * 解析单条 Set-Cookie。非法名/值、超长值、无 name=value 结构返回 null（拒收，不修补）。
 * @param {string} line
 * @param {number} nowMs
 * @returns {{ name: string, value: string, domain: string | null, expiresAt: number, secure: boolean } | null}
 */
function parseSetCookie(line, nowMs) {
  const parts = String(line ?? '').split(';')
  const head = parts.shift() ?? ''
  const eq = head.indexOf('=')
  if (eq <= 0) return null
  const name = head.slice(0, eq).trim()
  const value = head.slice(eq + 1).trim()
  if (!NAME_PATTERN.test(name) || !VALUE_PATTERN.test(value) || value.length > MAX_VALUE_LENGTH) return null
  /** @type {string | null} */
  let domain = null
  let expiresAt = Infinity
  let secure = false
  let maxAgeSeen = false
  for (const attribute of parts) {
    const sep = attribute.indexOf('=')
    const key = (sep < 0 ? attribute : attribute.slice(0, sep)).trim().toLowerCase()
    const attrValue = sep < 0 ? '' : attribute.slice(sep + 1).trim()
    if (key === 'domain' && attrValue.length > 0) {
      domain = normalizeDomain(attrValue)
    } else if (key === 'max-age') {
      // RFC 6265 §5.3：Max-Age 优先于 Expires。
      const seconds = Number.parseInt(attrValue, 10)
      if (Number.isFinite(seconds)) {
        expiresAt = nowMs + seconds * 1000
        maxAgeSeen = true
      }
    } else if (key === 'expires' && !maxAgeSeen) {
      const parsed = Date.parse(attrValue)
      if (Number.isFinite(parsed)) expiresAt = parsed
    } else if (key === 'secure') {
      secure = true
    }
  }
  return { name, value, domain, expiresAt, secure }
}

/**
 * 取出响应的 Set-Cookie 行。优先 getSetCookie（Node 22 undici 支持，保留多值），
 * 缺该能力时按 name= 形态保守切分；两者都不可用即视为无 cookie。
 * @param {unknown} response
 * @returns {string[]}
 */
function setCookieLines(response) {
  const headers = /** @type {{ getSetCookie?: () => string[], get?: (name: string) => string | null } | undefined} */ (
    response && typeof response === 'object' ? /** @type {{ headers?: unknown }} */ (response).headers : undefined
  )
  if (!headers) return []
  if (typeof headers.getSetCookie === 'function') {
    const lines = headers.getSetCookie()
    return Array.isArray(lines) ? lines.filter((line) => typeof line === 'string' && line.length > 0) : []
  }
  if (typeof headers.get !== 'function') return []
  const raw = headers.get('set-cookie')
  if (typeof raw !== 'string' || raw.length === 0) return []
  return raw
    .split(SET_COOKIE_SPLIT)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
