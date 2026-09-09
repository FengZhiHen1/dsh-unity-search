# TODO

仅含未完成事项。解决后结果就地写入拥有该事实的文档，并从此处移除。

> 2026-09-09 一期实现落地（core 41 文件 + adapter + client + skill + 97 例单测全绿；分层/产物新鲜度/质量地板三门禁通过）。原「实现期任务」中的编码项已全部完成并从本清单移除，遗留为实跑/门禁类事项如下。

## 活体回填（首轮 2026-09-09 已完成，余项待净网络/持 key 环境）

- [x] ~~bing `filters=ex1:"ezN"` 时效映射效果~~ → **实证零效果**（四窗口同结果 + 长尾复测一致）；实现已剔除（`supportsTimeRange: false`），结论与证据入《源适配器清单与端点契约》活体验证记录。
- [x] ~~anysearch answer 字段位置~~ → 实证响应**无 answer**（`data.results[]={title,url,snippet,content}`）；实现改 snippet→content 回落 + answer 保留宽松透传。
- [x] ~~keenable MCP 通道形态~~ → 文本块 `Title:/URL:/Published:/Snippets:` 锚点与解析一致；`publishedAfter` 周窗 5/5 实证命中。
- [x] ~~hn `numericFilters=created_at_i>`~~ → 实证生效（窗内命中）。
- [x] ~~arxiv submittedDate 子句 / openalex / crossref / pubmed / 链整跑 / read_source（抽取+落盘+SSRF 169.254 拒绝）~~ → 全通过；europepmc 首跑暴露 `resultList.result` 形状错误并修复复跑。
- [ ] ddg / ddg-lite `df`、wikipedia、v2ex、reddit、github、searxng 公共实例：本机 DNS 污染（fake-IP/回环化）不可证，**换净网络复测**（实现侧参数构造已经出站记录核实）。
- [ ] tavily / exa / perplexity / deepseek-official：探针不读凭据中心，**持 key 环境复测**。

## 实测门禁与部署（需用户指令配合，红线：agent 不起 DSH 进程）

- [ ] test profile 直挂冒烟（AC-01～AC-09）：开工前置必跑 `node tools/skill-manager-baseline.mjs gate --prod <生产实例名> --test <试验实例名>` 五条全绿；`readSource.dir` 配置必须指向 fixture 目录（不得用默认 `$DSH_HOME/unity-search/readings` 之外的真实生产路径）。
- [ ] skill 发布前置六项（「设置凭据与Skill」验证方式节）：目录出现 `unity-search`、`skill()` 与 `/unity-search` 均可加载、项目同名覆盖生效、卸载即消失、`pnpm pack` 解包后 `skills/` 相对路径层级正确、过 test 门禁。
- [ ] 会话冒烟：模型在原生工具与 `search_sources` 间的选择质量（DSR-004 风险项）。
- [ ] GitHub 远程仓库创建与 submodule 接线（`FengZhiHen1/dsh-unity-search`；需 gh 或用户手工）→ 子仓 push → 顶层 gitlink 提交 → test 门禁 → `dsh plugin --profile web add github:…`。
- [ ] web profile 移除 free-search 并以本插件替换（DSR-001 后果；未经用户明确指令不执行）。

## 实现期偏差登记（代码按运行时证据落地，文档表述待回填）

- [ ] 「设置页UI」称 client 注入包当前名为 `dsh-client-modules`——运行时安装树浏览器模块表实测注册 id 为 `@deepseek-ai/dsh-client-runtime`（dsh 0.1.2-rc.1 现场 grep `__ModuleLoader__.load({id:}` + 在跑的 dsh-skill-manager dist 同此），`package.json` 的 `dsh.client.inject` 与构建外化均按运行时 id 落地。
- [ ] 「设置页UI」称页签样式用 `*.module.css`——实际沿用 dsh-skill-manager 先例：内联样式 + `--dsw-alias-*` token（宿主 client 构建链对 CSS modules 支持未证实，内联为可运行事实）。
- [ ] 「工具面与有界阅读」`read_source` 返回示例未含 `status`/`error` 两字段——实现扩展为结构恒定完整（失败也是 2xx 形结果对象），示例待补。
- [ ] `search_sources` 的 `sources` 参数枚举定为 `web + 13 学术/平台源`（引擎 id 不进常驻工具面枚举，引擎级直调仅诊断 RPC 暴露）——文档如另有暗示以本条为准补齐。

## 二期（延期项与重访条件）

- [ ] `get_bibliography`（BibTeX/CSL 导出，Crossref 原生端点；占用工具预算第 3 槽位）——重访：学术源 test 实测稳定后。
- [ ] 学术二期原生化：Semantic Scholar/Unpaywall/DOAJ/OpenAIRE/bioRxiv/medRxiv/PMC/IACR/DBLP/Zenodo/HAL/CORE（13 源，L3 桥今天已覆盖；优先级按 paper-search skill 2026-09-08 实测状态排：pubmed/europepmc 已提一期，semantic/unpaywall/doaj/openaire 次优，core 需 key）；google_scholar/ssrn/base/citeseerx **建议不做原生**（实测反爬 403/需注册/常空）；OpenAlex 引文边——重访：DSR-002 的条件。
- [ ] npm 发布评估（`dsh.compatibility.dshReleases` 已预留）——重访：github: 通道稳定运行后。
- [ ] boot 级组合测试（官方 testkit）——重访：二期功能动工时一并补。
