---
name: unity-search
description: 统一多源检索与有界阅读。当需要跨网页引擎、学术库（arXiv/OpenAlex/Crossref/PubMed/EuropePMC）与平台源（GitHub/StackOverflow/HackerNews/Wikipedia/npm/V2EX/Bilibili/Reddit）做 fanout 检索、交叉核验、引用佐证，或需要聚焦读取并截断续传某个 URL 时使用。关键词：多源检索、学术、论文、平台、交叉核验、有界阅读、证据信封、timeRange。
when_to_use: 用户要求"查一查/核实/找资料/最近的新闻/有没有论文"、需要多引擎互为佐证、单一 web_search 结果不足或覆盖面不够、需要按引用读某页正文并可能翻页时。
---

# 统一检索（unity-search）

本技能描述如何使用插件 `dsh-unity-search` 提供的常驻工具面：`search_sources`（多源检索证据信封）与 `read_source`（有界阅读）。两者与宿主默认 `web_search`/`web_fetch` 并存，按下面的判据选择。

## 1. 检索面地图（选择判据）

| 面 | 工具 | 何时用 |
|---|---|---|
| 默认网页 | `web_search` / `web_fetch` | 单源就够、只要链接清单的普通查询。底层已被本插件引擎链接管，免 key 兜底 |
| 多源证据 | `search_sources` | 需要跨源交叉核验（学术/平台/网页混跑）、需要失败显形与不确定性声明、需要 timeRange |
| 有界阅读 | `read_source` | 读某一 URL 的正文：抽取+聚焦重排+截断续传+全量落盘，不灌全文 |
| L3 桥 | `mcp__paper_search__*` 等 | 本插件 23 源覆盖不到的学术长尾，见第 7 节 |

## 2. 源能力矩阵（速查）

`search_sources` 的 `sources` 参数取值：`web`（引擎链整体）+ 10 引擎 id + 13 源 id。`timeRange` 支持度如下（✗ 的源带 timeRange 调用会在信封 `warnings` 显形"未生效"）：

| 族 | 源 | timeRange |
|---|---|---|
| 网页链 | ddg / ddg-lite / searxng / tavily / exa / keenable | ✓（keenable/arxiv/hn 活体实证有效） |
| 网页链 | bing / anysearch / deepseek-official / perplexity | ✗（bing 的 ez 参数实证无效已剔除） |
| 学术 | arxiv / openalex / crossref / pubmed / europepmc | ✓（全部） |
| 平台 | hn / reddit | ✓（reddit 仅 t=day 粗档） |
| 平台 | github / stackoverflow / wikipedia / npm / v2ex / bilibili | ✗ |

要点：学术五源是元数据/题录级（摘要未必全，OA 全文靠 `read_source` 读落地页）；v2ex 只有热榜本地过滤；`web` 是链式单赢者（第一个出结果的引擎拿走），多引擎 id 并发跑才产生跨引擎佐证。详表（端点、字段级行为、限额）见 `references/sources.md`。

## 3. 查询规划

- 学术：从用户表述抽 2-4 个关键词短语，必要时补一个同义变体重跑；arXiv 用类目词，PubMed 用 MeSH 风格词。
- 平台：github 搜仓库用名词短语；npm 搜包用单词/前缀；stackoverflow/hn 直接用用户原问句风格。
- timeRange：固定档位 `day|week|month|year`，或绝对日期 `YYYY-MM-DD`（引擎侧按最近似能力换算，粗档位会进 `uncertainty`）。
- 站点限定：网页链支持 `site:` 的只有部分引擎——不要假设所有源都懂，跨源核验时把限定词放查询里并接受噪声。

## 4. 多源 fanout 与交叉核验

- 典型学术 fanout：`sources: ["arxiv","openalex","crossref","pubmed","europepmc"]`；平台+学术混跑直接多 id 并列。返回信封恒定结构：`status`（ok/degraded/unavailable）、`sources.{queried,succeeded,failed}`、`items`（含 `source`、`alsoIn`）、`duplicatesRemoved`、`answer`、`uncertainty`、`warnings`、`attempts`。
- 读法：`alsoIn` 非空 = 多源命中同一资源（DOI/arXiv id/URL 规范化键合并），是强佐证信号，优先引用；`sources.failed` 逐项带 `code`，个别源失败不推翻其余结论；`uncertainty` 有内容时向用户转述边界（如"题录级，未读到全文"），不要伪装成已验证。
- 何时重查：status=unavailable 或关键源失败且该源对结论必要 → 改查询词或换源族重查一次；`degraded` 但 succeeded 覆盖了你关心的族 → 一般直接用，同时报告降级。

## 5. 学术工作流（概要）

关键词 → 学术五源 fanout → 按 `alsoIn`/DOI 去重后的条目排序选 Top 条目 → `read_source` 读 OA 落地页（arxiv abs / europepmc / DOI openalex）→ 整理引注（标题/作者/年份/DOI 或 arXiv id）。元数据级证据的边界与分源引注细节见 `references/academic-workflow.md`。

## 6. 有界阅读纪律

- 不要为"读全"而重复抓同一 URL：`read_source` 每次已把**全量**正文落盘（返回 `artifactPath`），续读用 `offset` 翻页，聚焦用 `focus` 关键词重排。
- `truncated: true` → 增大 `offset` 续传（默认 8000 字符，上限 20000/次）；怀疑抽取失真（正文像导航噪声、`confidenceLow`）→ 用 read/grep 工具直接读 `artifactPath` 文件；`artifactKind: 'raw'` 表示未能抽取纯文本、落的是原始 HTML——同样直接 grep 该文件而不是重抓。
- 非 2xx 不抛错而是返回 `contentKind: 'empty'` 的结果——这不是失败，是页面状态信号；`status: 'error'` 才需要处置（换 UA 场景不存在，多为 SSRF 拒绝/二进制/网络）。
- SSRF 私网拒绝默认开启（127.x/10.x/169.254.x 等）；确需读内网在设置「通用」页开 `allowPrivate`，属危险开关。

## 7. L3 逃生舱（学术长尾）

23 源之外走官方 `@deepseek-ai/dsh-mcp-client` 桥（如 paper-search-mcp 22 源），一行 YAML 配置即得 `mcp__<server>__<tool>` 工具。代价与红线：全部桥工具会进工具目录（paper-search-mcp ≈57 工具 token 税，仅需要时开启）；**必须显式 `use_scihub=False`**（SciHub 域名属侵权灰区且不可信源）。配置样例、验证步骤与安全告诫见 `references/mcp-bridge.md`。本插件不承担桥的生命周期。

## 参考文件（按需读取）

- `references/sources.md` —— 23 源逐源细则：端点、鉴权、限额/节流、字段映射、timeRange 语义、已知坑。写 fanout 前不确定某源行为时读。
- `references/academic-workflow.md` —— 学术工作流展开：查询构造、五源分工、佐证分级、引注格式、元数据边界话术。
- `references/mcp-bridge.md` —— L3 桥配置样例（YAML）、`use_scihub=False` 红线、token 税与卸载指引。
