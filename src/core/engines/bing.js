// bing 引擎：HTML 抓取。解析锚点来源 = dsh-free-search v0.4.24 运行中代码（契约参考，代码不搬）。
// timeRange：活体实测（2026-09-09）`filters=ex1:"ezN"` 对 www.bing.com 结果集零影响
// （基线/day/week/month 同查询同结果，长尾查询复测一致）→ 判不支持，参数映射已删。
// 结果 URL 与相关性两处活体坑（2026-10-17 实测）见 docs/technical-details/源适配器清单与端点契约.md「bing」：
// 锚点 href 是 ck/a 点击包装，真实目标只在 u=a1<base64url>；无会话首访会返回忽略查询词的降级结果集。
// @ts-check

import { httpRequest, MAX_SEARCH_BYTES } from '../http.js'
import { cleanSnippet, extractRealUrl, queryTermCoverage } from '../parse.js'
import { engineConfig } from '../config.js'

const ENDPOINT = 'https://www.bing.com/search'
const HOME = 'https://www.bing.com/'
/** 会话预热响应体界：只为收 cookie，首页 HTML 不解析，超界即弃。 */
const WARMUP_MAX_BYTES = 96 * 1024
/** 降级判定阈值：查询词位组 ≥2 且覆盖率低于此值即判上游未按查询词出结果。 */
const MIN_COVERAGE_RATIO = 0.5

/**
 * @param {string} html
 * @returns {import('../types.js').SourceItem[]}
 */
function parseResults(html) {
  /** @type {import('../types.js').SourceItem[]} */
  const items = []
  for (const block of html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)) {
    const chunk = block[0]
    const href = /<a[^>]*href="([^"]+)"/.exec(chunk)
    // extractRealUrl 负责剥实体并解 ck/a 包装：包装 URL 直接请求实测只回空跳转壳。
    const url = extractRealUrl(href?.[1])
    if (!url) continue
    const titleMatch = /<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/.exec(chunk)
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/.exec(chunk)
    items.push({
      title: titleMatch && titleMatch[1] ? cleanSnippet(titleMatch[1], 200) : null,
      url,
      snippet: snippetMatch && snippetMatch[1] ? cleanSnippet(snippetMatch[1]) : null,
      publishedAt: null,
      sourceIds: {},
      extra: {},
    })
  }
  return items
}

/**
 * 建立会话：本 host 还没有 cookie 时先取一次首页（只收 Set-Cookie，不解析、失败不阻断）。
 * 无会话首访实测会拿到忽略查询词的降级结果集，故会话是相关性的前置条件而非优化。
 * @param {import('../types.js').CoreRuntime} runtime
 * @returns {Promise<void>}
 */
async function ensureSession(runtime) {
  const jar = runtime.cookies
  if (!jar || jar.has('www.bing.com')) return
  await httpRequest(runtime, HOME, {
    timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
    maxBytes: WARMUP_MAX_BYTES,
    headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
  })
}

/** @type {import('../types.js').SourceAdapter} */
export const bing = {
  id: 'bing',
  family: 'web',
  supportsTimeRange: false,
  available(runtime) {
    return engineConfig(runtime, 'bing').enabled
  },
  async search(request, runtime) {
    const started = runtime.now()
    await ensureSession(runtime)
    const params = new URLSearchParams({ q: request.query })
    if (typeof request.maxResults === 'number' && request.maxResults > 0) {
      params.set('count', String(Math.min(Math.round(request.maxResults), 50)))
    }
    const result = await httpRequest(runtime, `${ENDPOINT}?${params.toString()}`, {
      timeoutMs: runtime.config.chain?.timeoutMs ?? 15000,
      maxBytes: MAX_SEARCH_BYTES,
      headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    })
    if (!result.ok) {
      return { status: 'error', items: [], error: result.error, latencyMs: runtime.now() - started }
    }
    const items = parseResults(result.body)
    if (items.length === 0) {
      // 结构探测：非空页但零 b_algo 块且含登录/反爬特征 → 解析失败而非空结果（区分上游改版与真无结果）。
      const antiBot = /Anomaly|captcha|unusual traffic/i.test(result.body.slice(0, 4000))
      if (antiBot) {
        return { status: 'error', items: [], error: { code: 'rate_limited', message: 'bing anti-bot challenge' }, latencyMs: runtime.now() - started }
      }
      if (result.body.includes('b_algo')) {
        // 有结果块标记却解析为空：锚点漂移信号。
        return { status: 'error', items: [], error: { code: 'parse_failed', message: 'bing layout matched but no b_algo item parsed' }, latencyMs: runtime.now() - started }
      }
    }
    const latencyMs = runtime.now() - started
    // 软降级显形：HTTP 200 且结构完好，但结果集不覆盖查询词（实测上游对匿名/被限流客户端如此降级）。
    const coverage = queryTermCoverage(request.query, items.flatMap((item) => [item.title ?? '', item.snippet ?? '']))
    if (items.length > 0 && coverage.total >= 2 && coverage.ratio < MIN_COVERAGE_RATIO) {
      const reason = `结果未覆盖查询词（覆盖 ${coverage.covered}/${coverage.total}，缺：${coverage.missing.join('、')}）`
      return { status: 'ok', items, latencyMs, degraded: { reason }, warnings: [reason] }
    }
    return { status: 'ok', items, latencyMs }
  },
}
