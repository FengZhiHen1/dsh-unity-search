# 源能力细则（23 源）

`search_sources` 的合法 `sources` 值与逐源行为。表与代码同源（`src/core/`），若与宿主设置页有出入以设置页 state 投影为准。

## 全局约束

- 统一 UA：`dsh-unity-search/0.1.0 (+https://github.com/FengZhiHen1/dsh-unity-search)`；reddit/crossref/openalex/pubmed 附加 `(contact: <contact>)`（设置「通用」页可填）。
- 单次搜索响应界 1MB；搜索请求默认超时 15s（设置可调）。节流：arxiv ≥3s，其余按源（同 URL host 串行）。
- 信封恒定结构；单源失败进 `sources.failed[{source, code}]`，code 词表：`timeout / network / rate_limited / http_3xx / http_4xx / http_5xx / parse_failed / too_large / aborted / unavailable / chain_exhausted / unknown_source / internal`（开放词汇，消费方容忍新增；`unsafe_target`/`invalid_response` 属 `read_source` 通道）。
- 空结果 ≠ 失败（计入 `succeeded`，0 条目）；全空时 `status: ok` 且 `items: []`。

## 网页引擎（10，`sources: ["web"]` = 链式跑，逐 id = 指定引擎直调）

链行为：按设置 `chain.order` 依次尝试，第一个"有结果"的引擎赢；错误进冷却（默认 300s，冷却期内跳过）；全部错误 → `chain_exhausted`；`attempts` 逐引擎记 `ok / ok-empty / error / skipped(原因)`。

| id | KEY | 端点/方式 | timeRange | 备注 |
|---|---|---|---|---|
| bing | 免 | HTML 解析 | 部分（filters=ez1/2/3，未活体确证） | 结果含 news 混排 |
| ddg | 免 | HTML（html.duckduckgo.com） | ✓（df=d/w/m/y） | uddg 包装自动解 |
| ddg-lite | 免 | HTML（lite.duckduckgo.com） | ✓（df） | 索引配对解析，容错优先 |
| anysearch | 免 | POST api.anysearch.com/v1/search | ✗ | `answer` 进信封 |
| searxng | 免 | 配置实例列表逐个 GET（format=json） | ✓（time_range 近似换算） | 默认停用；需 ≥1 个允许 JSON 的实例 |
| tavily | KEY | POST api.tavily.com/search | ✓（time_range） | Bearer；401=未配置好 |
| exa | KEY | POST api.exa.ai/search | ✓（startPublishedDate，日级精确） | highlights 作 snippet |
| perplexity | KEY | POST api.deepseek 风格 chat（sonar） | ✗ | citations → items（snippet=答案前缀，标记 citationOnly） |
| deepseek-official | KEY | Anthropic messages + web_search 工具 | ✗ | 宿主现任后端自包含复刻 |
| keenable | 免/KEY | 无 key：公共 MCP JSON-RPC；有 key：REST /v1/search | ✓（publishedAfter/相对时间） | REST 模式 realtime |

## 学术源（5，题录/元数据级）

| id | KEY | 端点 | timeRange 语义 | 备注 |
|---|---|---|---|---|
| arxiv | 免 | export.arxiv.org/api/query（Atom） | ✓（submittedDate 区间） | 3s 节流硬约束；摘要级全文；`uncertainty` 恒带"预印本未经同行评审" |
| openalex | 免 | api.openalex.org/works | ✓（from_publication_date） | mailto 礼貌参数；摘要按 inverted_index 重建（部分缺） |
| crossref | 免 | api.crossref.org/works | ✓（from-created-date） | DOI 权威；摘要多为空（JATS 剥离尽力） |
| pubmed | 免 | esearch + efetch（两步） | ✓（reldate 天数 / mindate） | 生医；摘要从 XML 抽取 |
| europepmc | 免 | www.ebi.ac.uk/europepmc/webservices/rest | ✓（FIRST_SUB_DATE 区间） | `isOpenAccess` 进 extra；落地页 DOI>PMC>PMID |

去重键优先级：doi（小写去前缀）> arxiv id（去版本 vN）> 规范化 URL > 标题归一。跨族命中同一论文时 `alsoIn` 列出其余源。

## 平台源（8）

| id | KEY | 端点 | timeRange | 备注 |
|---|---|---|---|---|
| github | 可选 | api.github.com/search/repositories | ✗ | 结果=仓库；snippet 带 ⭐ 数；Bearer 提限额 |
| stackoverflow | 免 | api.stackexchange.com/search/advanced | ✗ | filter 去噪；已采纳 ✓ 进 snippet |
| hn | 免 | hn.algolia.com/api/v1/search | ✓（created_at_i） | 结果=帖子/评论页；extra.discussionUrl |
| wikipedia | 免 | {lang}.wikipedia.org/api.php list=search | ✗ | 语言取设置 `sources.wikipedia.language` |
| npm | 免 | registry.npmjs.org/-/v1/search | ✗ | 结果=包页；snippet 带版本与日期的截断描述 |
| v2ex | 免 | www.v2ex.com/api/topics/hot.json | ✗ | 只有热榜 + 本地关键词过滤，覆盖面有限（恒带 `uncertainty`） |
| bilibili | 免 | api.bilibili.com/x/web-interface/search/all/v2 | ✗ | 必须带 referer；-412 归 rate_limited |
| reddit | 免 | old.reddit.com/search.json | 粗（t=day 级） | UA+contact 必需；带 timeRange 时动态 `uncertainty` |

## 未验证项（使用本报告时注意）

- bing `filters=ex1:"ezN"` 的时效过滤效果为"约定推断"，未经活体确证（docs/ 待办清单）。
- deepseek-official 复刻的响应块结构基于宿主同代代码阅读，官方接口若变更会进 `parse_failed`。
