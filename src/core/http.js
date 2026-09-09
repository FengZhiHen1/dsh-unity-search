// 出站请求封装：UA 诚实、超时、响应大小界、按 host 节流闸。
// 契约 = docs/technical-details/检索核心与信封契约.md「限速与资源界」+《技术栈设计》安全约束。
// 纯 core：fetch/now/sleep 全部来自 runtime 注入，测试可换假 fetch。
// @ts-check

/** 明示产品身份的 User-Agent（对齐官方 dsh-web-fetch-http 的诚实原则，不伪装浏览器）。 */
export const USER_AGENT = 'dsh-unity-search/0.1.0 (+https://github.com/FengZhiHen1/dsh-unity-search)'

/** 检索类响应大小界（1 MB，《技术栈设计》）。 */
export const MAX_SEARCH_BYTES = 1024 * 1024
/** 阅读类响应大小界（5 MB，对齐官方 web-fetch-http 的 maxResponseBytes）。 */
export const MAX_READ_BYTES = 5 * 1024 * 1024
/** 非 arXiv 源的按 host 最小间隔（毫秒）。 */
export const DEFAULT_MIN_INTERVAL_MS = 1000
/** arXiv 服务条款要求的约 3 秒间隔。 */
export const ARXIV_MIN_INTERVAL_MS = 3000

/**
 * 按 host 的节流闸：同 host 两次请求至少间隔 minMs；并行请求排队串行化。
 * 状态存活于创建者作用域（adapter fiber），本工厂无模块级状态。
 * @param {{ now: () => number, sleep: (ms: number, signal: AbortSignal) => Promise<void>, warn?: (msg: string) => void }} env 时钟、可取消等待与可选告警。
 * @returns {{ gate: (host: string, minMs: number, signal: AbortSignal) => Promise<{ ok: boolean, error?: import('./types.js').SourceError }> }}
 */
export function createThrottle(env) {
  /** @type {Map<string, { lastAt: number, tail: Promise<void> }>} */
  const hosts = new Map()
  return {
    async gate(host, minMs, signal) {
      // 每 host 一条串行队列：排队者依次获得发送许可，间隔由 lastAt + minMs 决定。
      let entry = hosts.get(host)
      if (!entry) {
        entry = { lastAt: 0, tail: Promise.resolve() }
        hosts.set(host, entry)
      }
      const prev = entry.tail
      /** @type {() => void} */
      let release
      entry.tail = new Promise((resolve) => {
        release = resolve
      })
      try {
        await prev
      } catch { // quality-floor: ignore silent-catch 前序排队者的取消是排队预期内信号：tail 已接续，本序位照常通行
        // 前序排队者的等待被取消：不阻断本序位（tail 已由新 promise 接续）。
      }
      if (signal.aborted) {
        release()
        return { ok: false, error: { code: 'aborted', message: 'cancelled while waiting for throttle' } }
      }
      const wait = entry.lastAt + minMs - env.now()
      if (wait > 0) {
        try {
          await env.sleep(wait, signal)
        } catch {
          release()
          if (signal.aborted) {
            return { ok: false, error: { code: 'aborted', message: 'cancelled during throttle wait' } }
          }
          // sleep 本身失败属环境故障：放行请求（由 fetch 层暴露真实错误）。
          env.warn?.(`throttle sleep failed for ${host}, proceeding`)
        }
      }
      entry.lastAt = env.now()
      release()
      return { ok: true }
    },
  }
}

/**
 * @typedef {Object} HttpRequestOptions
 * @property {string} [method] 默认 GET。
 * @property {Record<string,string>} [headers] 调用方附加头（UA 由此函数统一兜底）。
 * @property {string} [body] 请求体（JSON 字符串由调用方序列化）。
 * @property {number} timeoutMs 单次请求超时（含响应体读取）。
 * @property {number} [maxBytes] 响应大小界，默认 MAX_SEARCH_BYTES。
 * @property {number} [throttleMs] 按 host 最小间隔，默认 DEFAULT_MIN_INTERVAL_MS。
 * @property {'follow' | 'manual' | 'error'} [redirect] 重定向策略，默认 follow（阅读路径用 manual 逐跳校验）。
 * @property {string} [expect] 'text'（默认，返回文本）| 'json'（返回解析后的 JSON；解析失败归 parse_failed）。
 */

/**
 * 判别联合返回值：调用方按 ok 分支处理，业务失败不抛异常。
 * 失败分支同样携带 status（HTTP 状态）与 location（3xx 的跳转目标，阅读路径逐跳校验消费）；
 * 成功分支携带 contentType（抽取策略分派消费）。
 * @typedef {{ ok: true, status: number, body: string, json?: unknown, contentType: string }
 *   | { ok: false, status?: number, location?: string, error: import('./types.js').SourceError }} HttpResult
 */

/**
 * 一次受界出站请求：节流 → fetch → 超时/取消归一 → 流式读取（大小界）→ 可选 JSON 解析。
 * @param {import('./types.js').CoreRuntime} runtime
 * @param {string} url
 * @param {HttpRequestOptions} [options]
 * @returns {Promise<HttpResult>}
 * @throws {TypeError} timeoutMs 非正有限数（调用方编程错误，不进业务失败通道）
 */
export async function httpRequest(runtime, url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs,
    maxBytes = MAX_SEARCH_BYTES,
    throttleMs = DEFAULT_MIN_INTERVAL_MS,
    redirect = 'follow',
    expect = 'text',
  } = options
  if (typeof timeoutMs !== 'number' || !(timeoutMs > 0) || !Number.isFinite(timeoutMs)) {
    // 超时是资源界的硬要求：缺省即契约违例（编程错误，抛出而非静默无界）。
    throw new TypeError(`httpRequest(${url}): timeoutMs must be a positive finite number`)
  }
  /** @type {URL} */
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: { code: 'invalid_response', message: `invalid request URL: ${url}` } }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: { code: 'unsafe_target', message: `unsupported protocol: ${parsed.protocol}` } }
  }

  const throttled = await runtime.throttle.gate(parsed.hostname, throttleMs, runtime.signal)
  if (!throttled.ok) return { ok: false, error: throttled.error ?? { code: 'aborted', message: 'throttle aborted' } }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  /** @type {() => void} */
  const onOuterAbort = () => controller.abort(runtime.signal.reason ?? new Error('aborted'))
  runtime.signal.addEventListener('abort', onOuterAbort, { once: true })
  try {
    /** @type {Response} */
    let response
    try {
      response = await runtime.fetch(url, {
        method,
        body,
        redirect,
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, ...headers },
      })
    } catch (error) {
      if (runtime.signal.aborted) {
        return { ok: false, error: { code: 'aborted', message: 'request cancelled' } }
      }
      if (controller.signal.aborted) {
        return { ok: false, error: { code: 'timeout', message: `request timed out after ${timeoutMs}ms` } }
      }
      return { ok: false, error: { code: 'network', message: `fetch failed: ${String(error && error.message ? error.message : error)}` } }
    }
    if (!response.ok) {
      // 丢弃未读 body（防连接挂起），但先尝试短错误信息。
      void response.body?.cancel().catch(() => {}) // quality-floor: ignore silent-catch body 丢弃失败无关结果分类，错误已由 status 通道呈现
      const code = response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'http_5xx' : response.status >= 400 ? 'http_4xx' : 'http_3xx'
      const location = response.headers.get('location')
      return { ok: false, status: response.status, ...(location ? { location } : {}), error: { code, message: `HTTP ${response.status} from ${parsed.hostname}` } }
    }
    // 流式读取 + 大小界：超过 maxBytes 立即取消并报错，不整包吞下。
    const reader = response.body?.getReader()
    const chunks = []
    let received = 0
    if (reader) {
      for (;;) {
        let done, value
        try {
          ;({ done, value } = await reader.read())
        } catch (error) {
          if (runtime.signal.aborted) return { ok: false, error: { code: 'aborted', message: 'read cancelled' } }
          if (controller.signal.aborted) return { ok: false, error: { code: 'timeout', message: 'timed out during body read' } }
          return { ok: false, error: { code: 'network', message: `body read failed: ${String(error && error.message ? error.message : error)}` } }
        }
        if (done) break
        received += value.byteLength
        if (received > maxBytes) {
          await reader.cancel().catch(() => {}) // quality-floor: ignore silent-catch 超限取消失败不改变 too_large 裁决，bytes 界已生效
          return { ok: false, error: { code: 'too_large', message: `response exceeds ${maxBytes} bytes` } }
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const c of chunks) {
      bytes.set(c, offset)
      offset += c.byteLength
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (expect === 'json') {
      try {
        return { ok: true, status: response.status, body: text, contentType: response.headers.get('content-type') ?? '', json: JSON.parse(text) }
      } catch (error) {
        return { ok: false, error: { code: 'parse_failed', message: `JSON parse failed: ${String(error && error.message ? error.message : error)}` } }
      }
    }
    return { ok: true, status: response.status, body: text, contentType: response.headers.get('content-type') ?? '' }
  } finally {
    clearTimeout(timer)
    runtime.signal.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 把 HttpResult 的失败映射为 SourceOutcome 的 error 字段（开放码词汇表消费方容忍新增）。
 * @param {HttpResult} result 必须是 ok:false 分支。
 * @returns {import('./types.js').SourceError}
 * @throws {TypeError} 传入 ok:true 分支（调用方未判分支，属编程错误）
 */
export function httpErrorOf(result) {
  if (result.ok) throw new TypeError('httpErrorOf called on ok result')
  return result.error
}
