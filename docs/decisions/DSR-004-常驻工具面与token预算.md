# DSR-004 常驻工具面与 token 预算

> 决定：常驻工具恰为 2 个（`search_sources` + `read_source`），预算 ≤3；高阶用法一律走 skill 按需加载，不注册常驻工具。
> 理由：工具 schema 是每请求固定税，skill 目录是几十 token、内容按需零成本；57 工具与 13–23k token/请求是反面定价实证。
> 被否决项：按源族拆多个常驻工具（schema 税翻倍且违背标准化接口）；全部能力塞进 PTC 模式（可见性差，非常态）。

## 上下文

C-01 约束常驻工具 ≤3。候选工具面：统一 `search_sources` vs 按源族拆分（`paper_search`/`platform_search`/…）；`read_source` 独立成工具 vs 并入 search 参数。

## 方向与评价

| 方向 | 何时成立 | 代价与风险 |
| --- | --- | --- |
| 统一 search_sources + read_source | 一套参数语义覆盖全部源族（标准化接口）；阅读与检索语义不同（输入是 URL 不是查询） | 工具描述需写清与原生工具的分工 |
| 按源族拆工具 | 各工具描述更聚焦 | schema 税按族翻倍；模型还要先想"用哪个工具"，违背"无需过多思考" |
| PTC 模式承载 | 工具不进 schema | 依赖部署切 PTC，非常态；默认面不可用 |

zotero-mcp 作者以产品动作背书"skill 驱动优于全量 MCP schema"（实测 13–23k token/请求后自建 install-skill 通道）；modsearch 已写好 skill 资产却未接 DSH——两个方向正确性的旁证。

## 决定与理由

选统一双工具 + skill。`search_sources` 用 `sources` 参数承载源选择（参数税远低于工具税）；`read_source` 因输入语义不同（URL 而非查询）独立；第 3 个槽位为二期 `get_bibliography` 保留。skill 承载全部"怎么用"的知识（源选择、fanout、核验、L3 桥），不加载零成本。

## 直接后果

- 波及文档：需求.md（C-01/RQ-05）、technical-details/工具面与有界阅读.md（工具契约）、设置凭据与Skill.md（skill 大纲）。
- 工具描述与 skill 第一节必须写清分工，否则模型在原生工具与插件工具间随机选择（机制兼容 ≠ 编排好用，需会话冒烟验证，登记于 TODO.md）。

## 重访条件

- 冒烟发现模型工具选择混乱时，重评工具描述、命名，乃至 `search_sources` 是否改名以更明确地区分于 `web_search`。
- 二期 `get_bibliography` 落地占用第 3 槽位后，任何新工具请求必须替换而非新增。
