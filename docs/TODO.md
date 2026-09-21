# TODO

仅含未完成事项。解决后结果就地写入拥有该事实的文档，并从此处移除。

> 2026-09-09 一期实现落地（core 41 文件 + adapter + client + skill + 97 例单测全绿；分层/产物新鲜度/质量地板三门禁通过）。
> 2026-09-18 test profile（0.1.2-rc.1）直挂实测：**首跑抓出 cordis inject 崩溃**（`ctx.settings` / `ctx.credentials` 属性访问缺 inject ⇒ 整树加载失败、profile 起不来），已修复（事实入《设置凭据与Skill》「服务访问纪律」）；复跑启动干净、Host 半区与设置文档链路双向实证。余项如下。

## 活体回填（首轮 2026-09-09 已完成，余项待净网络/持 key 环境）

- [x] ~~bing `filters=ex1:"ezN"` 时效映射效果~~ → **实证零效果**（四窗口同结果 + 长尾复测一致）；实现已剔除（`supportsTimeRange: false`），结论与证据入《源适配器清单与端点契约》活体验证记录。
- [x] ~~anysearch answer 字段位置~~ → 实证响应**无 answer**（`data.results[]={title,url,snippet,content}`）；实现改 snippet→content 回落 + answer 保留宽松透传。
- [x] ~~keenable MCP 通道形态~~ → 文本块 `Title:/URL:/Published:/Snippets:` 锚点与解析一致；`publishedAfter` 周窗 5/5 实证命中。
- [x] ~~hn `numericFilters=created_at_i>`~~ → 实证生效（窗内命中）。
- [x] ~~arxiv submittedDate 子句 / openalex / crossref / pubmed / 链整跑 / read_source（抽取+落盘+SSRF 169.254 拒绝）~~ → 全通过；europepmc 首跑暴露 `resultList.result` 形状错误并修复复跑。
- [x] ~~github 可达性~~ → 2026-09-18 复测**转可用**（hosts 劫持块已被清除，hosts 现无任何生效映射；3 条命中 666ms）。
- [ ] 实例级落地（2026-09-18 已在代码级证实）：给 test 实例注入 `NODE_USE_ENV_PROXY=1`（或改用代理 TUN 透明模式）后复跑——**代码级 A/B 已证**该变量让 `ddg` / `wikipedia` / `ddg-lite` 恢复出结果、`v2ex` 可达且解析正常（本次查询真空）。⚠ 该变量作用于**全进程 fetch（含 LLM 调用链路）**，副作用未测须一并回归；注入需重启实例（变更命令要求官方启动器关闭）。
- [ ] `reddit` 出口问题：经代理仍 404/403（Reddit 拒该出口 IP）——需其他出口或凭据策略，与网络层修复无关。
- [x] ~~`ddg-lite` 解析回归~~ → 2026-09-18 经代理活体暴露「取第一个双引号串当 href（取到 `rel="nofollow"`）」⇒ 9 条结果静默丢弃（`status: ok, items: 0`）；已修（按属性名取 href + 结构漂移 warning），消融复跑 0 → 3 条，补两条回归用例，单测 97 → 99。**教训**：源长期不可达会掩盖解析层缺陷——可达性恢复后必须做适配器级（而非 curl 标记级）复跑。
- [ ] ddg / ddg-lite / wikipedia / v2ex / reddit：2026-09-18 复测**仍不可达**（统一 `network/fetch failed`；假 IP 池与首轮同批：`wikipedia→199.16.158.9`（Twitter 段）、`v2ex→199.59.149.205`、`reddit→69.171.235.22`（Facebook 段）、`ddg→74.86.151.162`），searxng 本轮未配实例（`no instances configured`，默认关）。**换净网络或代理 TUN 接管复测**（实现侧参数构造已经出站记录核实，非实现缺陷；明细见《源适配器清单与端点契约》复测节）。
- [x] ~~tavily / exa / perplexity / deepseek-official~~ → 2026-09-18 经宿主诊断通道复测（`/unity-search/test`，凭据中心在场）：tavily / exa / perplexity 得 `credential not configured`（该 HOME 未录入 key，显式降级符合设计）；**deepseek-official 得 `HTTP 401`（凭据解析出值但被上游拒收；作用域仅限 test 实例 HOME，stable-dev 未测）**。持有效 key 环境仍需复测其成功路径。

## 实测门禁与部署

- [x] ~~test profile 直挂冒烟（Host 半区）~~ → 2026-09-18 实测记录见下方「2026-09-18 test 实测实录」。
- [ ] 会话冒烟（模型与页面面，Host 半区已实测）：AC-01（原生 `web_search` 经 seam 接管走本插件链）、AC-02/AC-03（`search_sources` 多源 fanout 与降级信封）、AC-04/AC-09（`read_source` 分页/聚焦/artifact 落盘与 LRU）、AC-05（`<available_skills>` 含 `unity-search`、`skill()` 与 `/unity-search` 加载、卸载即消失、项目同名覆盖）、AC-08（设置节渲染 + 凭据录入 + 诊断区实跑 + 无 cookie 负例 401）。
- [ ] skill 发布前置六项（「设置凭据与Skill」验证方式节）：目录出现 `unity-search`、`skill()` 与 `/unity-search` 均可加载、项目同名覆盖生效、卸载即消失、`pnpm pack` 解包后 `skills/` 相对路径层级正确。
- [x] ~~GitHub 远程仓库创建与 submodule 接线（`FengZhiHen1/dsh-unity-search`）~~ → 2026-09-18 建 public 仓库 + 子仓 push + 补 origin + 顶层 gitlink 提交。
- [ ] web profile 挂载（DSR-001 后果）：先移除同 seam 的 `dsh-free-search`，再 `dsh plugin --profile web add github:FengZhiHen1/dsh-unity-search`；**须用户明确指令**（涉运行中的 stable-dev 实例重启，会打断会话）。

## 2026-09-18 test 实测实录（0.1.2-rc.1）

- 前置：`node tools/skill-manager-baseline.mjs gate --prod stable-dev --test test` 五条全绿（工作区注册表 0 条、skillsDir 为 `E:\Project\Skills-test\skills` fixture）。
- 现场：test profile 移除同 seam 的 `dsh-free-search@0.4.24`（互斥；回滚命令 `dsh plugin --profile test add dsh-free-search@0.4.24`）→ `link:E:/Project/DSH_Plugins/plugins/dsh-unity-search` → `--dump-config` 复查（`web` 行双键重述为 `searchProvider: unity-search` + `fetchProvider: http`，插件行来源 `# == dsh-unity-search`）。
- 首跑：`failed to apply loader entry unity-search … cannot get property "settings" without inject`（堆栈落在 `src/adapter/settings.js` 的 `installSection`）⇒ 整树加载失败。修复：`installSettings` 改 `ctx.inject(['settings'], …)` 动态注入、凭据解析改在 `ctx.get('credentials')` 的返回对象上调 `resolve`。
- 复跑：启动干净（日志末行为 URL、其后 0 行），无 `did not activate`、无 `duplicate loader entry id`。
- Host 半区实证（无浏览器通道：取 token cookie → `POST /unity-search/<endpoint>`）：`state` 返回 10 引擎 + 13 源投影，链序与配置一致；`test` 端点实跑 —— `web` 链 5 条真实结果（`status: ok`）、`arxiv` 3 篇命中、未知源 `no-such-source` 得 `status: unavailable` + `unknown_source`（显式降级）。
- 设置链路双向实证：向 test HOME `settings.yaml` 写 `unity-search.engines.ddg.enabled: false` → `state` 读回 `ddg: enabled=False`；回退后字节数精确复原（2347）且读回 `enabled=True`。
- 源可用性活体复测（`/unity-search/test` 逐源 24 条出站）：**14 条可用 / 5 条网络层不可达 / 5 条未配置或凭据无效**；13 个网络依赖源中 10 个可用，不可用者全由本机网络层造成（假 IP 池复现，github 因 hosts 劫持清除而转可用）——明细与成因见《源适配器清单与端点契约》复测节。
- 未覆盖：模型面两工具与会话内 `web_search` 接管（需真实会话）、设置节页面级渲染（需浏览器）——见上「会话冒烟」。

## 二期（延期项与重访条件）

- [ ] `get_bibliography`（BibTeX/CSL 导出，Crossref 原生端点；占用工具预算第 3 槽位）——重访：学术源 test 实测稳定后。
- [ ] 学术二期原生化：Semantic Scholar/Unpaywall/DOAJ/OpenAIRE/bioRxiv/medRxiv/PMC/IACR/DBLP/Zenodo/HAL/CORE（13 源，L3 桥今天已覆盖；优先级按 paper-search skill 2026-09-08 实测状态排：pubmed/europepmc 已提一期，semantic/unpaywall/doaj/openaire 次优，core 需 key）；google_scholar/ssrn/base/citeseerx **建议不做原生**（实测反爬 403/需注册/常空）；OpenAlex 引文边——重访：DSR-002 的条件。
- [ ] npm 发布评估——重访：github: 通道稳定运行后。**注**：manifest 目前**未**预留任何版本约束字段（`dsh` 只有 `bundle`/`client` 两键），发布前需自行补。
- [ ] boot 级组合测试（官方 testkit）——重访：二期功能动工时一并补。
- [ ] 适配层接线单测（`installSettings` / `createCredentialState`）：单测只覆盖 core，adapter 接线零测试——inject 崩溃正是这一空白的直接后果；同时 **ddg/ddg-lite 两个 HTML 抓取引擎的解析用例也曾长期缺位**（ddg-lite 的 href 提取 bug 因此存活到 2026-09-18）——重访：接入官方 testkit 时一并补。
