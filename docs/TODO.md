# TODO

仅含未完成事项。解决后结果就地写入拥有该事实的文档，并从此处移除。

## 待确认

- [ ] 设计基线整体确认（需求 + 定调 + 技术细节 + 决策记录），确认后进入实现。

## 实现期任务

- [ ] 各 keyless 引擎（bing/ddg/ddg-lite/anysearch）与公共 SearXNG 实例的活体可用性实跑；解析锚点与 `timeRange` 参数取值以实跑为准回填「源适配器清单与端点契约」（当前为 `missing evidence`）。
- [ ] GitHub 远程仓库创建与 submodule 接线（`FengZhiHen1/dsh-unity-search`；需 gh 或用户手工操作）。
- [ ] 会话冒烟：模型在原生工具与 `search_sources` 之间的选择质量（DSR-004 风险项）。
- [ ] skill 发布前置六项验证（清单见「设置凭据与Skill」验证方式节）；其中 `pnpm pack` 解包后 `skills/` 相对路径层级、G 变体在 web 部署的端到端可见性（前提：agent 所在 preset 挂 `tool-skill`）为知识库标记的未实测边界，冒烟时核对。
- [ ] test 实测门禁（AC-01～AC-07）。

## 二期（延期项与重访条件）

- [ ] `get_bibliography`（BibTeX/CSL 导出，Crossref 原生端点；占用工具预算第 3 槽位）——重访：学术三源 test 实测稳定后。
- [ ] 学术二期源 Semantic Scholar/PubMed/EuropePMC；OpenAlex 引文边——重访：DSR-002 的条件。
- [ ] 自定义设置卡 UI（含 client 半侧与 esbuild 构建）——重访：一期设置面实际使用频率值得时。
- [ ] npm 发布评估（`dsh.compatibility.dshReleases` 已预留）——重访：github: 通道稳定运行后。
- [ ] boot 级组合测试（官方 testkit）——重访：二期功能动工时一并补。

## 部署操作（需用户指令）

- [ ] web profile 移除 free-search 并以本插件替换（DSR-001 的直接后果；未经用户明确指令不执行）。
