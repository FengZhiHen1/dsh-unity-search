// 测试基建：fake CoreRuntime / fake fetch / 假时钟。core 模块经依赖注入可全离线测。
// @ts-check

import { createThrottle } from '../src/core/http.js'

/**
 * 假时钟：手动推进。
 * @param {number} [start]
 */
export function makeClock(start = 1_700_000_000_000) {
  /** @type {{ t: number, advance: (ms: number) => void, now: () => number }} */
  const clock = {
    t: start,
    advance(ms) {
      clock.t += ms
    },
    now: () => clock.t,
  }
  return clock
}

/**
 * 最小 Response 替身（对齐 httpRequest 消费面：ok/status/headers.get/body.getReader/text）。
 * @param {number} status
 * @param {string} body
 * @param {{ contentType?: string, location?: string, chunks?: number }} [opts]
 */
export function makeResponse(status, body, opts = {}) {
  const { contentType = 'text/html; charset=utf-8', location, chunks = 1 } = opts
  const headers = new Map([['content-type', contentType]])
  if (location) headers.set('location', location)
  /** @type {string[]} */
  const parts = []
  if (chunks <= 1) parts.push(body)
  else {
    const size = Math.ceil(body.length / chunks)
    for (let i = 0; i < body.length; i += size) parts.push(body.slice(i, i + size))
  }
  const reader = {
    async read() {
      const next = parts.shift()
      if (next === undefined) return { done: true, value: undefined }
      return { done: false, value: new TextEncoder().encode(next) }
    },
    async cancel() {
      parts.length = 0
    },
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    body: {
      getReader: () => reader,
      async cancel() {
        parts.length = 0
      },
    },
    async text() {
      return body
    },
  }
}

/**
 * 记录式 fake fetch：按 url 前缀路由响应，其余记为未路由调用（测试里断言出站集合）。
 * @param {Array<[string, (url: string, init: Record<string, unknown>) => unknown]>} routes
 */
export function makeFetch(routes) {
  /** @type {Array<{url: string, init: Record<string, unknown>}>} */
  const calls = []
  /**
   * @param {string} url
   * @param {Record<string, unknown>} [init]
   */
  async function fetchImpl(url, init = {}) {
    calls.push({ url, init })
    for (const [prefix, handler] of routes) {
      if (String(url).startsWith(prefix)) return handler(url, init)
    }
    throw new Error(`unrouted fetch: ${url}`)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

/**
 * 组装最小 CoreRuntime（字段齐全，缺省中性）。
 * @param {{ clock?: ReturnType<typeof makeClock>, fetch?: (url: string, init?: Record<string, unknown>) => Promise<unknown>, config?: Record<string, unknown>, resolveCredential?: (ref: string) => string | undefined, dns?: { lookup: (host: string) => Promise<Array<{ address: string }>> }, sleep?: (ms: number, signal: AbortSignal) => Promise<void> }} [overrides]
 */
export function makeRuntime(overrides = {}) {
  const clock = overrides.clock ?? makeClock()
  /** @type {Array<{ level: string, msg: string, data?: unknown }>} */
  const logs = []
  const config = {
    chain: { order: [], cooldownSeconds: 300, timeoutMs: 15000 },
    engines: {},
    sources: {},
    readSource: { dir: '', defaultChars: 8000, maxChars: 20000, persist: true, maxTotalMB: 256, allowPrivate: false, timeoutMs: 30000 },
    contact: '',
    ...overrides.config,
  }
  const signal = new AbortController().signal
  /**
   * 假睡眠：推进时钟并检查取消。
   * @param {number} ms
   * @param {AbortSignal} sig
   */
  const sleepImpl = overrides.sleep ?? (async (ms, sig) => {
    clock.advance(ms)
    if (sig.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  })
  const runtime = {
    signal,
    now: () => clock.now(),
    sleep: sleepImpl,
    fetch: overrides.fetch ?? makeFetch([]),
    logger: {
      info: (msg, data) => logs.push({ level: 'info', msg, data }),
      warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
      error: (msg, data) => logs.push({ level: 'error', msg, data }),
    },
    resolveCredential: overrides.resolveCredential ?? (() => undefined),
    contact: '',
    throttle: createThrottle({ now: () => clock.now(), sleep: sleepImpl, warn: (msg) => logs.push({ level: 'warn', msg }) }),
    config,
    logs,
    ...(overrides.dns ? { dns: overrides.dns } : {}),
  }
  return /** @type {import('../src/core/types.js').CoreRuntime} */ (runtime)
}

/**
 * 造适配器（纯数据 + 行为注入），用于 fanout/chain 测试。
 * @param {string} id
 * @param {import('../src/core/types.js').SourceFamily} family
 * @param {{ available?: boolean, supportsTimeRange?: boolean, search?: (req: unknown, rt: unknown) => Promise<unknown> }} [opts]
 */
export function makeAdapter(id, family, opts = {}) {
  return {
    id,
    family,
    supportsTimeRange: opts.supportsTimeRange ?? false,
    available: () => opts.available ?? true,
    search: opts.search ?? (async () => ({ status: 'ok', items: [], latencyMs: 0 })),
  }
}

/** ok outcome 速造。 @param {Array<Record<string, unknown>>} items */
export function okOutcome(items, extra = {}) {
  return { status: 'ok', items, latencyMs: 10, ...extra }
}
