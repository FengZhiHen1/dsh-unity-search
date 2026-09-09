# 学术检索工作流（展开）

SKILL.md 第 5 节的完整展开。目标：从用户问题到"可引用、带边界声明"的文献证据。

## 1. 查询构造

- 抽 2-4 个核心短语（名词化术语优先），别塞整句。中文问题先译成英文术语（学术五源以英文索引为主），保留中文原词作备用查询。
- 同义变体（如 "neural retrieval" / "dense passage retrieval"）分两次跑，不要指望单查询覆盖。
- 时间约束用 `timeRange` 参数（`day|week|month|year` 或绝对日期），学术五源全部支持并映射到各自的日期子句。

## 2. 五源分工（fanout 一次调用）

`sources: ["arxiv","openalex","crossref","pubmed","europepmc"]`，`maxResults` 建议 10-15。

| 源 | 强项 | 弱项 |
|---|---|---|
| arxiv | CS/物理/数学预印本最快 | 无同行评审信号；非理工无关 |
| openalex | 覆盖面最广、引用数、OA 链接 | 摘要由 inverted_index 重建，部分缺 |
| crossref | DOI/出版元数据权威 | 摘要常空；检索相关性排序弱 |
| pubmed | 生医题录质量最高 | 仅生医 |
| europepmc | 生医 + OA 全文标识 | 仅生医 |

选择建议：CS 题 = arxiv + openalex + crossref；生医题 = pubmed + europepmc + openalex（+crossref 补 DOI）。

## 3. 去重与佐证读法

- 信封已按 DOI > arXiv id > URL > 标题 归一合并：`alsoIn` 非空 = 多源同一对象，命中数越多越可信。
- 分级话术：仅 arxiv 命中 → "预印本，未评审"；arxiv+openalex → "预印本被二次索引"；crossref 有 DOI/venue → "已出版"；pubmed/europepmc 命中 → "生医题录成立"。
- `duplicatesRemoved` 说明合并量；`sources.failed` 逐项看 code——个别源 `unavailable`（如 pubmed 两步解析改版）不动摇其余源结论，但要向用户披露。

## 4. 读正文（read_source）

元数据级 ≠ 全文。对入选条目用 `read_source`：

- arxiv → `https://arxiv.org/abs/<id>`（摘要页 HTML 抽取良好；PDF 会命中二进制拒绝，不重试）。
- openalex → 优先条目 `extra`/landing URL 里的 OA 页面；crossref DOI → `https://doi.org/<doi>`（付费墙会落到出版社壳页，抽取失真时按 SKILL 第 6 节读 `artifactPath` 判断）。
- 聚焦读法：`focus: "<方法名> results"` 重排相关段落；一次 8000 字符读不够用 `offset` 续，别重抓。

## 5. 引注输出

向用户交付引用时用：标题 · 作者（前 3 位 + et al.）· 年份 · venue 或 "arXiv:<id>" · DOI（若有）· 一句话说明该源角色（预印本/已出版/题库收录）。链接给可点开的落地页（abs/doi/pmc），不给 API JSON 端点。

## 6. 元数据级证据的边界（必须会说的话术）

- "题录/摘要级：未读全文，结论基于摘要与元数据"——凡是没走 read_source 的条目都要带。
- 覆盖缺口：Crossref/OpenAlex 对非英语/新预印本入库有延迟；v2ex/热榜类平台源根本不是学术证据，不要混入引注。
- 长尾（如冷门期刊全文、LibGen 类需求）不要试图用本插件硬凑：见 `mcp-bridge.md` 的 L3 路线及其红线。
