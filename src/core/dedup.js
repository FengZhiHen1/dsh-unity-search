// 跨源去重：键优先级、条目归并（alsoIn/首选来源/extra 并集）。
// 规则权威 = docs/technical-details/检索核心与信封契约.md「多源 fanout 与去重」节。
// @ts-check

/** 族优先级：数字越小越优先（academic > platform > web）。同族比较时先到者胜（rank 相等 → prefer 返回保留既有）。 */
const FAMILY_RANK = /** @type {const} */ ({ academic: 0, platform: 1, web: 2 })

/**
 * DOI 归一：去 `https://doi.org/` / `dx.doi.org` / `doi:` 前缀、小写、去首尾空白。
 * @param {string | undefined | null} doi
 * @returns {string | null}
 */
export function normalizeDoi(doi) {
  if (typeof doi !== 'string') return null
  const s = doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .replace(/\/+$/, '')
  return s.length > 0 ? s : null
}

/**
 * arXiv id 归一：取 URL/`abs/` 尾段、去 `.pdf` 与版本后缀（vN）；小写。
 * @param {string | undefined | null} arxiv
 * @returns {string | null}
 */
export function normalizeArxiv(arxiv) {
  if (typeof arxiv !== 'string') return null
  const s = arxiv
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, '')
    .replace(/^arxiv:/, '')
    .replace(/^abs\//, '')
    .replace(/\.pdf$/, '')
    .replace(/v\d+$/, '')
  // 格式白名单（新版 2101.00001[.cs]/旧版 cs/0101001）；不匹配返回 null，避免任意字符串被当 arXiv 键错误合并。
  if (!/^(\d{4}\.\d{4,5}([a-z][a-z0-9])?|[a-z][a-z.-]*\/\d{7})$/.test(s)) return null
  return s
}

/**
 * URL 规范化：小写 host、去协议与 `www.`、去默认端口、剔除追踪参数（utm_ 前缀、fbclid、gclid、ref）、
 * 去尾斜杠与 fragment；剩余查询参数排序以稳定键值。
 * 非法 URL 以原文小写返回（显式降级键，宁可少合并不可错合并，也绝不返回空串）。
 * @param {string | undefined | null} url
 * @returns {string | null}
 */
export function normalizeUrl(url) {
  if (typeof url !== 'string' || url.trim().length === 0) return null
  /** @type {URL} */
  let parsed
  try {
    parsed = new URL(url.trim())
  } catch {
    // 非绝对 URL：降级为原文归一小写键（显式返回，不抛出）。
    return url.trim().toLowerCase()
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const keep = []
  for (const [k, v] of parsed.searchParams.entries()) {
    const lk = k.toLowerCase()
    if (lk.startsWith('utm_') || lk === 'fbclid' || lk === 'gclid' || lk === 'ref') continue
    keep.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  }
  keep.sort()
  const path = parsed.pathname.replace(/\/+$/, '')
  const nonDefaultPort =
    parsed.port === '' ||
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
      ? ''
      : `:${parsed.port}`
  const query = keep.length > 0 ? `?${keep.join('&')}` : ''
  return `${host}${nonDefaultPort}${path}${query}`
}

/**
 * 标题归一：小写、压缩空白、剥首尾引号与句读；空标题返回 null。
 * @param {string | undefined | null} title
 * @returns {string | null}
 */
export function normalizeTitle(title) {
  if (typeof title !== 'string') return null
  const s = title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'"”]+|[\s"'"”.,;:!?,]+$/g, '')
    .trim()
  return s.length > 0 ? s : null
}

/**
 * 标题键的所有者部分（兜底键的第二段）：extra.authors[0] / extra.owner / extra.user；
 * 兼容字符串与 {name} 对象形态；缺省空串。
 * @param {import('./types.js').SourceItem} item
 * @returns {string}
 */
function ownerPart(item) {
  const extra = /** @type {Record<string, unknown>} */ (item.extra ?? {})
  /** @param {unknown} v @returns {string} */
  const pick = (v) => {
    if (typeof v === 'string') return v.toLowerCase().trim()
    if (v && typeof v === 'object') {
      const name = /** @type {{ name?: unknown }} */ (v).name
      if (typeof name === 'string') return name.toLowerCase().trim()
    }
    return ''
  }
  const authors = extra.authors
  if (Array.isArray(authors) && authors.length > 0) return pick(authors[0])
  return pick(extra.owner) || pick(extra.user)
}

/**
 * 计算条目的去重键（优先级 doi → arxiv → 规范化 URL → 标题+首作者/owner）。
 * 键类型互不跨并（doi 与 url 相同指向不同条目时并存）；无可用键返回 null（该条目不参与去重）。
 * @param {import('./types.js').SourceItem} item
 * @returns {{ kind: 'doi' | 'arxiv' | 'url' | 'title', value: string } | null}
 */
export function dedupeKey(item) {
  const ids = item.sourceIds ?? {}
  const doi = normalizeDoi(ids.doi)
  if (doi) return { kind: 'doi', value: doi }
  const arxiv = normalizeArxiv(ids.arxiv)
  if (arxiv) return { kind: 'arxiv', value: arxiv }
  const url = normalizeUrl(item.url)
  if (url) return { kind: 'url', value: url }
  const title = normalizeTitle(item.title)
  if (title) return { kind: 'title', value: `${title}|${ownerPart(item)}` }
  return null
}

/**
 * 首选来源判定：族优先级高者胜；同族或更劣保留先到者（调用方顺序 = 请求顺序，见 fanout 注）。
 * @param {import('./types.js').SourceFamily} existing
 * @param {import('./types.js').SourceFamily} incoming
 * @returns {boolean} incoming 是否应取代 existing 成为首选来源。
 */
function incomingWins(existing, incoming) {
  return (FAMILY_RANK[incoming] ?? 9) < (FAMILY_RANK[existing] ?? 9)
}

/**
 * 跨源条目归并。输入 = 各成功源按（请求顺序 × 源内顺序）展平的条目，附 `_from` 源 id 与 `_family`；
 * 输出条目 = 原字段 + `source`（首选来源 id）+ `alsoIn`（其余命中源 id，不含 source）。
 * 输出按首次出现顺序（确定性：请求顺序取代并行完成顺序）。
 * @param {Array<import('./types.js').SourceItem & { _from: string, _family: import('./types.js').SourceFamily }>} items
 * @param {number} [maxItems] 归并后条目上限（截断不计入 duplicatesRemoved）。
 * @returns {{ items: import('./types.js').EnvelopeItem[], duplicatesRemoved: number }}
 */
export function dedupeItems(items, maxItems) {
  /** @type {Map<string, { item: import('./types.js').EnvelopeItem & Record<string, unknown>, family: import('./types.js').SourceFamily }>} */
  const groups = new Map()
  /** @type {Array<import('./types.js').EnvelopeItem & Record<string, unknown>>} */
  const keyless = []
  let duplicatesRemoved = 0

  for (const raw of items) {
    const { _from: from, _family: family, ...item } = raw
    const key = dedupeKey(/** @type {import('./types.js').SourceItem} */ (item))
    if (key === null) {
      keyless.push({ ...item, source: from, alsoIn: [] })
      continue
    }
    const mapKey = `${key.kind}\u0000${key.value}`
    const existing = groups.get(mapKey)
    if (!existing) {
      groups.set(mapKey, {
        item: { ...item, source: from, alsoIn: [] },
        family,
      })
      continue
    }
    duplicatesRemoved++
    if (incomingWins(existing.family, family)) {
      // incoming 成为首选：条目字段取 incoming 版本，extra 并集且冲突取 incoming 值；
      // alsoIn 汇总全部其余命中源（含被降级的原首选）。
      const prev = existing.item
      const alsoIn = new Set([...(prev.alsoIn ?? []), prev.source, from])
      alsoIn.delete(from)
      existing.item = {
        ...item,
        source: from,
        alsoIn: [...alsoIn],
        extra: { ...(prev.extra ?? {}), ...(item.extra ?? {}) },
      }
      existing.family = family
    } else {
      // existing 保留首选：alsoIn 追加分流来源，extra 并集且冲突保留首选值。
      if (!existing.item.alsoIn.includes(from)) existing.item.alsoIn.push(from)
      existing.item.extra = { ...(item.extra ?? {}), ...(existing.item.extra ?? {}) }
    }
  }

  const out = [...groups.values().map((g) => g.item), ...keyless]
  const capped = typeof maxItems === 'number' && maxItems >= 0 ? out.slice(0, maxItems) : out
  return { items: /** @type {import('./types.js').EnvelopeItem[]} */ (capped), duplicatesRemoved }
}
