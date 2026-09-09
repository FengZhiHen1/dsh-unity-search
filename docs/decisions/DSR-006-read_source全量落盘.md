# DSR-006 read_source 全量落盘

> 决定：`read_source` 在有界返回之外，把当次取回的全量内容落盘保存并在结果返回 `artifactPath`/`artifactKind`/`artifactBytes`；抽取成功存全量抽取文本，抽取失败存原始 body（`artifactKind: 'raw'` + `warnings` 明示）。
> 理由：工具返回是有界有损投影；落盘给 Agent 一条上下文外的自查通道——工具失效（抽取失真）或内容不足时自行 read/grep 落盘副本，无需重抓。modsearch `/modsearch/fetch`（返回落盘路径 + 预览）与用户 paper-search skill（"落文件后分段读"）是该模式的实证。
> 被否决项：纯有界返回无落盘（初版；失效时只能重抓或放弃）；全文直接进上下文（paper-search-mcp 教训，不变量保持否决）。

## 上下文

用户提议（2026-09-09）：工具返回处理内容的同时把获取结果全量保存到某位置，这样即使工具失效，Agent 也可自行查找具体信息。本插件的正文抽取是无依赖手写实现（技术栈设计：不引 Readability 级依赖），抽取失败/失真是真实存在的失败模式；落盘原始 body 是该失败模式的廉价兜底。`search_sources` 无此需求——信封本就无损失返回全量结果。

## 方向与评价

| 方向 | 何时成立 | 代价与风险 |
| --- | --- | --- |
| 有界返回 + 全量落盘（双通道） | 抽取失真/内容不足时 Agent 可自救；重抓成本（限速/反爬）归零 | 磁盘卫生义务（LRU 驱逐 + `dir` 可配）；写盘使 test 隔离红线适用 |
| 纯有界返回（初版） | 零写盘、零磁盘义务 | 抽取失效即死路；分页误判需重抓 |
| 全文直接进上下文 | 无 | 直接违反有界不变量（保持否决） |

评价维度：失效自愈能力、上下文预算、磁盘与安全暴露、test 隔离合规。

## 决定与理由

选双通道。边界：不变量"全文永不一次性返回**进上下文**"不动——落盘在上下文之外；每次调用只存一份（成功 = 全量抽取文本，不受 `limit` 约束；失败 = 原始 body）；默认目录在 `$DSH_HOME` 插件数据目录（不污染用户工作区），`readSource.persist`/`dir`/`maxTotalMB` 三设置项收口，`dir` 可配同时满足 test 隔离红线（fixture 目录）。

## 直接后果

- 波及文档：需求.md（RQ-04 扩展 + AC-09）、technical-details/工具面与有界阅读.md（输出形状、机制第 5 步、落盘管理）、technical-details/设置凭据与Skill.md（readSource 三设置项、skill 大纲第 6 节逃生指引）、technical-details/设置页UI.md（通用页签落盘区）、借鉴地图.md（modsearch 先例行）、TODO.md（test fixture 登记）。
- skill 须教会 Agent 使用落盘副本（大纲第 6 节），否则通道建了没人走。

## 重访条件

- 会话冒烟发现 Agent 几乎不使用 `artifactPath` 时，重评 skill 指引的显著性或 `persist` 默认值。
- 落盘内容敏感性成为问题（如付费墙页面全文残留）时，加 `maxAgeDays` 或按来源分类的保留策略。
