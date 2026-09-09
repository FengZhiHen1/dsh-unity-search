// timeRange 词汇归一：day|week|month|year 或相对时长（12h/3d/2mo/1y）→ 天数；
// 供各适配器映射到自己的过滤参数。语义对齐 harness advanced_search（相对时长换算按 30/365 近似）。
// @ts-check

/** 固定档 → 天数。 */
const DAYS_BY_RANGE = new Map([
  ['day', 1],
  ['week', 7],
  ['month', 30],
  ['year', 365],
])

/**
 * 解析 timeRange 为近似天数。
 * @param {string | undefined | null} timeRange
 * @returns {{ days: number } | { after: string } | null} 固定/相对档返回 days；绝对日期（YYYY-MM-DD）返回 after；非法返回 null。
 */
export function parseTimeRange(timeRange) {
  if (typeof timeRange !== 'string' || timeRange.trim().length === 0) return null
  const token = timeRange.trim().toLowerCase()
  const fixed = DAYS_BY_RANGE.get(token)
  if (fixed !== undefined) return { days: fixed }
  const absolute = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token)
  if (absolute) {
    const date = new Date(`${token}T00:00:00Z`)
    if (!Number.isNaN(date.getTime())) return { after: `${token}T00:00:00Z` }
    return null
  }
  const relative = /^(\d+(?:\.\d+)?)(h|d|w|mo|y)$/.exec(token)
  if (relative && relative[1] && relative[2]) {
    const value = Number.parseFloat(relative[1])
    if (!Number.isFinite(value) || value <= 0) return null
    const days = { h: value / 24, d: value, w: value * 7, mo: value * 30, y: value * 365 }[relative[2]]
    if (days === undefined || days <= 0) return null
    return { days }
  }
  return null
}

/**
 * 把天数近似回固定档（引擎只支持粗档时使用，如 ddg 的 df=d|w|m|y）。
 * @param {number} days
 * @returns {'day' | 'week' | 'month' | 'year'}
 */
export function approximateRange(days) {
  if (days <= 2) return 'day'
  if (days <= 14) return 'week'
  if (days <= 90) return 'month'
  return 'year'
}

/**
 * days 前 ISO 时间戳（毫秒段固定 .000Z，稳定可比）。
 * @param {number} days
 * @param {() => number} now 注入时钟。
 * @returns {string}
 */
export function isoDaysAgo(days, now) {
  return new Date(now() - days * 86400000).toISOString().replace(/\d{3}Z$/, '000Z')
}

/**
 * 统一把 timeRange 解析成 { fromIso }：固定/相对档换算天数、绝对档直接取日期。
 * @param {string | undefined | null} timeRange
 * @param {() => number} now
 * @returns {{ fromIso: string } | null}
 */
export function timeRangeToSince(timeRange, now) {
  const parsed = parseTimeRange(timeRange)
  if (!parsed) return null
  if ('after' in parsed) return { fromIso: parsed.after }
  return { fromIso: isoDaysAgo(parsed.days, now) }
}
