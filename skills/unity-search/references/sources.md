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
| bing | 免 | HTML 解析 | ✗（ez 参数活体实证零效果，已剔除） | 结果含 news 混排 |
| ddg | 免 | HTML（html.duckduckgo.com） | ✓（df=d/w/m/y；本机环境未证效） | uddg 包装自动解 |
| ddg-lite | 免 | HTML（lite.duckduckgo.com） | ✓（df；同上） | 索引配对解析，容错优先 |
| anysearch | 免 | POST api.anysearch.com/v1/search | ✗ | 活体证实响应无 answer 字段；snippet 缺时回落 content |
| searxng | 免 | 配置实例列表逐个 GET（format=json） | ✓（time_range 近似换算） | 默认停用；需 ≥1 个允许 JSON 的实例 |
| tavily | KEY | POST api.tavily.com/search | ✓（time_range，未实跑） | Bearer；401=未配置好 |
| exa | KEY | POST api.exa.ai/search | ✓（startPublishedDate，日级精确；未实跑） | highlights 作 snippet |
| perplexity | KEY | POST api.deepseek 风格 chat（sonar） | ✗ | citations → items（snippet=答案前缀，标记 citationOnly） |
| deepseek-official | KEY | Anthropic messages + web_search 工具 | ✗ | 宿主现任后端自包含复刻 |
| keenable | 免/KEY | 无 key：公共 MCP JSON-RPC；有 key：REST /v1/search | ✓ 活体实证（publishedAfter 窗内命中） | REST 模式 realtime |

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

## 验证状态（2026-09-09 活体后）

- 已实证：bing（`b_algo` 锚点稳定；ez 时间参数**无效已剔除**）、anysearch（无 answer 字段）、keenable（MCP 文本块锚点 + 时间窗生效）、arxiv/hn（timeRange 生效）、其余成功源见插件 `docs/technical-details/源适配器清单与端点契约.md`《活体验证记录》。
- 本机网络不可证（DNS 污染，实现未判负）：ddg / ddg-lite / wikipedia / v2ex / reddit / github / searxng 公共实例——换净网络复测。
- 待 key 实跑：tavily / exa / perplexity / deepseek-official（deepseek-official 复刻块结构亦在此列）。
