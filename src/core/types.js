// core 层共享契约：JSDoc typedef + 稳定常量。
// 契约权威 = docs/technical-details/检索核心与信封契约.md；本文件只做可执行化，不新增语义。

/**
 * @typedef {'ok' | 'error'} SourceStatus 单源执行结果状态（空结果仍是 ok，不是 error）。
 * @typedef {'ok' | 'degraded' | 'unavailable'} EnvelopeStatus 信封总体状态（归并规则见 envelope.js）。
 * @typedef {'web' | 'academic' | 'platform'} SourceFamily 源族。
 */

/**
 * 稳定错误码词汇（开放集：消费方必须容忍新增取值）。
 * @typedef {'rate_limited' | 'timeout' | 'http_4xx' | 'http_5xx' | 'http_3xx' | 'parse_failed'
 *   | 'network' | 'too_large' | 'chain_exhausted' | 'unavailable' | 'unknown_source'
 *   | 'unsafe_target' | 'invalid_response' | 'write_failed' | 'internal'} ErrorCode
 */

/**
 * @typedef {Object} SourceError
 * @property {ErrorCode} code
 * @property {string} message 人类可读；上游原文（如 "HTTP 429"）优先。
 */

/**
 * @typedef {Object} ItemIds 源内稳定标识，去重第一依据。缺失即省略键。
 * @property {string} [doi] 归一后的 DOI（小写、去 https://doi.org/ 前缀）。
 * @property {string} [arxiv] arXiv id（不含版本后缀）。
 * @property {string} [pmid] PubMed id。
 * @property {string} [repository] GitHub 仓库全名（owner/repo，小写归一）。
 * @property {string} [questionId] StackOverflow 问题 id。
 */

/**
 * @typedef {Object} SourceItem 单源返回条目。
 * @property {string|null} title
 * @property {string|null} url
 * @property {string|null} snippet
 * @property {string|null} publishedAt ISO-8601 或 null。
 * @property {ItemIds} sourceIds
 * @property {Record<string, unknown>} extra 源特有字段（authors/venue/citationCount/stars…），不进通用排序与去重。
 */

/**
 * @typedef {Object} SourceOutcome 单源一次检索的结果（永不抛出业务异常，失败在 status 里）。
 * @property {SourceStatus} status
 * @property {SourceItem[]} items
 * @property {string} [answer] 源自带答案/摘要（如 Perplexity、anysearch）。
 * @property {SourceError} [error] status==='error' 时必带。
 * @property {number} latencyMs
 * @property {string[]} [uncertainty] 该源对本结果的不确定声明（动态；与适配器静态声明合并）。
 * @property {string[]} [warnings] 该源的非致命问题。
 */

/**
 * @typedef {Object} EnvelopeItem SourceItem + 归并溯源字段。
 * @property {string} source 首选来源适配器 id。
 * @property {string[]} alsoIn 其余命中同一去重键的源 id。
 */

/**
 * @typedef {Object} SearchEnvelope 所有检索路径的归一输出（结构恒定完整，字段不缺省）。
 * @property {EnvelopeStatus} status
 * @property {string} query
 * @property {{ queried: string[], succeeded: string[], failed: Array<{source: string, code: string, message: string}> }} sources
 * @property {EnvelopeItem[]} items
 * @property {number} duplicatesRemoved
 * @property {string|null} answer
 * @property {string[]} uncertainty
 * @property {string[]} warnings
 * @property {Array<{source: string, outcome: string, latencyMs: number}>} attempts
 */

/**
 * @typedef {Object} SearchRequest 适配器收到的检索请求。
 * @property {string} query
 * @property {number} [maxResults]
 * @property {string} [timeRange] day|week|month|year 或相对时长（3d）；不支持的源忽略。
 */

/**
 * @typedef {Object} CoreRuntime core 的全部外部环境，均由 adapter 注入（core 不感知 DSH、不摸全局）。
 * @property {typeof fetch} fetch
 * @property {AbortSignal} signal 当前调用的取消信号（可被 http.js 叠加超时）。
 * @property {(ref: string) => string | undefined | null} resolveCredential 凭据引用名 → 值。
 * @property {string} contact 礼貌池 mailto；空串表示不携带。
 * @property {{ debug: (msg: string, data?: unknown) => void, warn: (msg: string, data?: unknown) => void }} logger core 不打日志，经此上报。
 * @property {() => number} now 时钟（ms epoch），测试注入假时钟。
 * @property {(ms: number, signal: AbortSignal) => Promise<void>} sleep 可取消的等待（限速闸用）。
 * @property {{ gate: (host: string, minMs: number, signal: AbortSignal) => Promise<{ ok: boolean, error?: SourceError }> }} throttle 按 host 节流闸（http.js createThrottle 产出）。
 * @property {{ lookup: (hostname: string) => Promise<Array<{ address: string } | string>> } } [dns] 域名解析（read 路径 SSRF 校验的注入点）；缺省按"无法校验"失败关闭。
 * @property {CoreConfig} config 解析后的设置快照（schema 默认值已由 adapter 层填充）。
 */

/**
 * @typedef {Object} CoreConfig 设置快照（键结构 = docs/technical-details/设置凭据与Skill.md 的 yaml）。
 * @property {string} contact
 * @property {{ order: string[], cooldownSeconds: number, timeoutMs: number }} chain
 * @property {Record<string, { enabled: boolean, apiKeyEnv?: string, instances?: string[] }>} engines
 * @property {Record<string, { enabled: boolean, apiKeyEnv?: string, language?: string }>} sources
 * @property {{ defaultChars: number, maxChars: number, allowPrivate: boolean, persist: boolean, dir: string, maxTotalMB: number }} readSource
 */

/**
 * @typedef {Object} SourceAdapter 源适配器：纯数据 + 函数，无类、无状态。
 * @property {string} id 稳定 id，进信封与 settings 键。
 * @property {SourceFamily} family
 * @property {boolean} [supportsTimeRange] 是否处理 request.timeRange（缺省 false → fanout 记 warning）。
 * @property {string[]} [uncertainty] 该源的静态不确定声明（成功时并入信封）。
 * @property {(runtime: CoreRuntime) => boolean} available 本地廉价可用性判断（不发起网络请求）。
 * @property {(request: SearchRequest, runtime: CoreRuntime) => Promise<SourceOutcome>} search
 */

export {};
