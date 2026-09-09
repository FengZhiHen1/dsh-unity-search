# technical-details

dsh-unity-search 的机制文档目录。定调约束（技术栈、项目结构）见上级目录两份定调文档；需求与验收归《需求》。

## 阅读顺序

1. 「检索核心与信封契约」——核心契约，其他篇目的公共词汇来源。
2. 「L0-Seam 接入」——默认开箱面的实现。
3. 「工具面与有界阅读」——高阶工具面的实现。
4. 「源适配器清单与端点契约」——23 个源的施工细节。
5. 「设置凭据与Skill」——配置面、凭据链与高阶用法载体。
6. 「设置页UI」——设置界面独立标签页（配置 + 状态 + 诊断）。

## 文档地图

| 文档 | 权威范围 |
| --- | --- |
| 检索核心与信封契约.md | 源适配器接口、证据信封 schema、引擎链、fanout 与去重 |
| L0-Seam接入.md | seam provider 注册与投影、patch 双键、仲裁语义 |
| 工具面与有界阅读.md | search_sources/read_source 契约、正文抽取、分页、聚焦、SSRF |
| 源适配器清单与端点契约.md | 各源端点、认证、限速、解析要点与脆弱性 |
| 设置凭据与Skill.md | settings schema、credentials 链、skill 载体结构与 provider 契约、内容预算、L3 逃生舱 |
| 设置页UI.md | 设置节注册、页面五区、RPC 通道契约、凭据录入、状态投影、client 构建 |

## 已知偏差与 missing evidence

- 各引擎的 HTML 解析锚点与 `timeRange` 参数取值（尤其 bing 的 `filters` 取值）未活体核实，以实现期实跑为准（TODO.md 登记）。
- anysearch 的请求/响应字段细节取自 free-search 运行中代码的端点证据，字段级契约需实跑确认。
