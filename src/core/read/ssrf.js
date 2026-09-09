// SSRF 目标校验：协议白名单 + DNS 解析后 IP 分类（私网/环回/链路本地拒绝）。
// DNS 解析经 runtime.dns 注入（core 不摸 node:dns）；缺注入 = 无法校验 = 失败关闭。
// 契约 = docs/technical-details/工具面与有界阅读.md「有界阅读机制 1」。
// @ts-check

/**
 * IPv4 点分十进制 → 数值（非法返回 null）。
 * @param {string} ip
 * @returns {number | null}
 */
function ipv4ToNum(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let num = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    num = num * 256 + n
  }
  return num
}

/**
 * 是否 IPv4 私网/特殊段（RFC1918 + 环回 + 链路本地 + CGNAT + 组播/保留等）。
 * @param {number} num 32 位无符号数值
 * @returns {boolean}
 */
function isBlockedV4Num(num) {
  const checks = /** @type {Array<[number, number]>} */ ([
    [0x00000000, 0xff000000], // 0.0.0.0/8「本网络」
    [0x0a000000, 0xff000000], // 10/8
    [0x64400000, 0xffc00000], // 100.64/10 CGNAT
    [0x7f000000, 0xff000000], // 127/8 环回
    [0xa9fe0000, 0xffff0000], // 169.254/16 链路本地
    [0xac100000, 0xfff00000], // 172.16/12
    [0xc0000000, 0xffffff00], // 192.0.0/24 IETF 协议分配
    [0xc0a80000, 0xffff0000], // 192.168/16
    [0xc6120000, 0xfffe0000], // 198.18/15 基准测试
    [0xe0000000, 0xf0000000], // 224/4 组播
    [0xf0000000, 0xf0000000], // 240/4 保留（含 255.255.255.255）
  ])
  return checks.some(([base, mask]) => ((num & mask) >>> 0) === base)
}

/**
 * 是否 IPv6 特殊地址（含 IPv4-mapped 与 NAT64 内嵌 v4 的递归判定）。
 * @param {string} ip 已去 zone 的小写 IPv6
 * @returns {boolean}
 */
function isBlockedV6(ip) {
  if (ip === '::' || ip === '::1') return true
  // IPv4-mapped ::ffff:a.b.c.d 与兼容 ::a.b.c.d
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (mapped) {
    const num = ipv4ToNum(mapped[1])
    return num === null || isBlockedV4Num(num)
  }
  const hex = v6ToHex(ip)
  if (!hex) return true // 无法解析形态一律拒绝（失败关闭）
  // IPv4-mapped / IPv4-compatible 的十六进制形态：WHATWG URL 会把 ::ffff:127.0.0.1 归一为 ::ffff:7f00:1，
  // 正则抓不到，必须按 hex 兜底递归判内嵌 IPv4。
  if (hex.startsWith('00000000000000000000ffff')) return blockedNat64(hex.slice(24))
  if (hex.startsWith('000000000000000000000000')) return blockedNat64(hex.slice(24))
  const head = Number.parseInt(hex.slice(0, 4), 16)
  if ((head & 0xfe00) === 0xfc00) return true // fc00::/7 ULA
  if ((head & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
  if ((head & 0xff00) === 0xff00) return true // ff00::/8 组播
  // 64:ff9b:1::/48 本地 NAT64 与 64:ff9b::/96 Wellknown——内嵌 v4 递归判。
  if (hex.startsWith('0064ff9b0001')) return blockedNat64(hex.slice(24))
  if (hex.startsWith('0064ff9b')) return blockedNat64(hex.slice(24))
  return false
}

/**
 * NAT64 / IPv4-mapped 尾 32 位（十六进制）→ 对应 IPv4 是否被封（长度不足失败关闭）。
 * @param {string} hexTail
 * @returns {boolean}
 */
function blockedNat64(hexTail) {
  if (hexTail.length < 8) return true
  const n = Number.parseInt(hexTail.slice(0, 8), 16)
  return isBlockedV4Num(n)
}

/**
 * IPv6（允许 :: 缩写）→ 32 字符十六进制；解析失败返回 null。
 * @param {string} ip
 * @returns {string | null}
 */
function v6ToHex(ip) {
  const parts = ip.split('::')
  if (parts.length > 2) return null
  /** @type {string[]} */
  let words
  if (parts.length === 1) {
    words = ip.split(':')
    if (words.length !== 8) return null
  } else {
    const head = parts[0] ? parts[0].split(':') : []
    const tail = parts[1] ? parts[1].split(':') : []
    const gap = 8 - head.length - tail.length
    if (gap < 1) return null
    words = [...head, ...Array.from({ length: gap }, () => '0'), ...tail]
  }
  if (words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null
  return words.map((w) => w.padStart(4, '0')).join('')
}

/**
 * IP 字面量或解析结果 → 是否被禁（私网/环回/链路本地/组播/保留）。
 * 非 IP 形态返回 true（调用方不应把域名传进来）。
 * @param {string} address
 * @returns {boolean}
 */
export function isBlockedAddress(address) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '')
  const v4 = ipv4ToNum(ip)
  if (v4 !== null) return isBlockedV4Num(v4)
  if (ip.includes(':')) return isBlockedV6(ip)
  return true
}

/**
 * 校验一个待请求 URL：协议白名单；IP 字面量直接判；域名经注入 DNS 判全部解析结果。
 * @param {string} rawUrl
 * @param {{ allowPrivate: boolean, dns?: import('../types.js').CoreRuntime['dns'] }} policy
 * @returns {Promise<{ ok: true, url: URL } | { ok: false, code: 'unsafe_target' | 'invalid_response', message: string }>}
 */
export async function assertSafeTarget(rawUrl, policy) {
  /** @type {URL} */
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, code: 'invalid_response', message: `invalid URL: ${rawUrl.slice(0, 200)}` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'unsafe_target', message: `unsupported protocol: ${url.protocol}` }
  }
  if (policy.allowPrivate) return { ok: true, url }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (ipv4ToNum(hostname) !== null || hostname.includes(':')) {
    if (isBlockedAddress(hostname)) {
      return { ok: false, code: 'unsafe_target', message: `blocked address literal: ${hostname}` }
    }
    return { ok: true, url }
  }
  if (!hostname) return { ok: false, code: 'unsafe_target', message: 'empty hostname' }
  if (!policy.dns) {
    // 失败关闭：没有注入 DNS 就无法证明目标公网可达，宁可拒绝也不放行未校验请求。
    return { ok: false, code: 'unsafe_target', message: `no DNS resolver injected; cannot verify ${hostname}` }
  }
  /** @type {Array<{ address: string } | string>} */
  let records
  try {
    records = await policy.dns.lookup(hostname)
  } catch (error) {
    return { ok: false, code: 'unsafe_target', message: `DNS lookup failed for ${hostname}: ${String(error && error.message ? error.message : error)}` }
  }
  const addresses = records.map((r) => (typeof r === 'string' ? r : r.address))
  if (addresses.length === 0) {
    return { ok: false, code: 'unsafe_target', message: `DNS returned no addresses for ${hostname}` }
  }
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      return { ok: false, code: 'unsafe_target', message: `${hostname} resolves to blocked address ${address}` }
    }
  }
  return { ok: true, url }
}
