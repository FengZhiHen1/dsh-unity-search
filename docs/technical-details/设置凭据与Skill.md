# 设置、凭据与 Skill

本文唯一拥有：settings 命名空间 schema、凭据解析链、skill 的载体结构与接线契约、skill 内容大纲与 L3 逃生舱指引。skill 机制事实（注册表分层、rank、消费面、剪枝风险）归本仓库知识库（`agent/23`、`agent/24`），本文只定义本插件的接线。

## settings 命名空间 `unity-search`

经 `installSection` 注册（entry config 作 base 层；消费方读合并后值）。用户文档段示例（字段即默认意图，缺省即下列值）：

```yaml
unity-search:
  contact: ''                    # 礼貌池 mailto（openalex/crossref）；空则不携带
  chain:
    order: [bing, ddg, anysearch, searxng, ddg-lite, tavily, exa, perplexity]
    cooldownSeconds: 300
    timeoutMs: 15000
  engines:                       # family: web 的引擎开关与 key 引用
    bing:       { enabled: true }
    ddg:        { enabled: true }
    ddg-lite:   { enabled: true }
    anysearch:  { enabled: true }
    searxng:    { enabled: false, instances: [] }   # 公共实例 URL 列表
    tavily:     { enabled: false, apiKeyEnv: TAVILY_API_KEY }
    exa:        { enabled: false, apiKeyEnv: EXA_API_KEY }
    perplexity: { enabled: false, apiKeyEnv: PERPLEXITY_API_KEY }
  sources:                       # academic/platform 源开关
    arxiv:        { enabled: true }
    openalex:     { enabled: true }
    crossref:     { enabled: true }
    github:       { enabled: true, apiKeyEnv: '' }  # 可选 token 提额
    stackoverflow: { enabled: true }
    hn:           { enabled: true }
    wikipedia:    { enabled: true, language: zh }
    npm:          { enabled: true }
  readSource:
    defaultChars: 8000
    maxChars: 20000
    allowPrivate: false
```

- `enabled: false` 的引擎退出兜底链、源退出 fanout 可选集（对齐 modsearch 的 `engines.<name>.enabled` 语义）。
- 设置变更热生效：`installSection` 的 `onChange` 重建 core 运行时（引擎链顺序、冷却参数、源开关）；冷却状态保留不重置。
- 一期无自定义设置卡（非目标，见需求文档）；用户经原生设置文档编辑。

## 凭据解析链（追溯 RQ-06）

- 设置字段 `apiKeyEnv` 存**引用名**，不存 key；取值经 `ctx.credentials.resolve(ref)` 落到 credentials 中心（四层优先：启动环境快照 > `.credentials.yaml` > 项目 `.env` > `$DSH_HOME/.env`）。
- adapter 把 `resolveCredential` 注入 core `runtime`；key 引擎 `available()` = `enabled && resolveCredential(ref) 有值`。声明了 `apiKeyEnv` 而引用未设置 → 该引擎不可用（不回落无关环境变量，防串 key）。
- `ctx.credentials` 为可选依赖：服务缺席时所有 key 引擎不可用，免 key 面不受影响。

## skill `unity-search`（A 类包内静态技能）

技能跟插件版本走、用户不改 → A 类包内静态技能（判定口诀与结构规范见知识库 `agent/24`）。载体为包根目录形技能，扁平不嵌套：

```text
skills/unity-search/
├── SKILL.md                     # frontmatter + 正文（≤ ~8k 码点）
└── references/                  # 重内容下沉，模型按需读（一层深相对路径）
    ├── sources.md               # 源能力矩阵详情与各源行为细节
    ├── academic-workflow.md     # 学术工作流展开与引注整理模板
    └── mcp-bridge.md            # L3 桥配置样例与安全告诫
```

### frontmatter 契约

| 字段 | 取值约束 |
| --- | --- |
| `name` | `unity-search`，== 目录名（官方硬性）；自带插件域前缀——rank 600 同层撞名时先注册的 provider 胜、后者仅 warn，前缀使归属可判断 |
| `description` | **≤500 字符硬预算**：官方上限 1024，但 DSH 目录注入默认截断 500，超长描述的关键词被切掉、路由失效。祈使句、聚焦用户意图，含"多源检索 / 学术 / 论文 / 平台 / 交叉核验 / 有界阅读"关键词——description 是唯一进模型目录的路由面 |
| `whenToUse` | 补充触发说明；进浏览器 Remote（`SkillEntry`），**不进模型目录**，不能替代 description 的关键词 |

### provider 契约（`src/adapter/skill.js`）

经 `ctx.skills.registerProvider()` 注册（`inject = ['skills']`，`apply` 内同步）：

| 参数 | 取值 |
| --- | --- |
| provider `name` | `unity-search-bundled`（层内唯一；`runtime` 为注册表保留名，禁止占用） |
| `rank` | 600（`BUNDLED_SKILL_RANK`）：打包技能作兜底，项目级（100/200）与用户级（400/500）同名可覆盖 |
| `source` | `'bundled'`（提示词可见来源标签，非优先级） |
| `resourceBase` | `{ kind: 'directory', path: <包内 skills/unity-search/> }`，经 `new URL('../../skills/unity-search/', import.meta.url)` 计算（`src/adapter/` 上溯两级到包根；构建后相对层级复验）；模型据此解析正文里的相对路径 |
| `invocation` | 默认 `{ modelInvocable: true, userInvocable: true }`：`skill()` 工具、`/unity-search` 手势与浏览器 `/` 菜单均可用 |
| `list()` / `get()` | `list()` 返回数组（完整观测）；`get()` 每次重读正文不缓存（改文件即生效），返回剥 frontmatter 的正文 |

frontmatter 解析与校验（name == 目录名、description ≤500、kebab-case、标准 YAML）为 `src/core/catalog.js` 纯函数，裸 node 单测。

### 内容预算与分层（硬约束）

- **SKILL.md 正文 ≤ ~8k 码点**：DSH 无技能内容豁免机制，`tool/result` 超 8192 码点会被 ToolResultPruner 剪掉中段；按码点不按字节（中文 3 字节/码点）。
- 七节大纲的分配：SKILL.md 留检索面地图、源能力速查简表、fanout 与交叉核验要点、有界阅读纪律、references 指引；源矩阵详情、学术工作流展开、L3 桥配置样例下沉 `references/` 三个文件。
- DSH 不枚举 bundled 资源清单（`<skill_resources>` 只给基址提示）⇒ SKILL.md 正文必须列出 `references/` 的文件名与各自用途，模型经 fs 读工具按相对路径取读。
- 目录层成本：每技能约 50–100 tokens（`name` + `description` 全量常驻），单技能插件远低于预算。

### 可见性与覆盖语义

- 本插件行走 bundle（global 层，G 变体）：所有 agent 的合并视图可见；preset 层同名技能整体压掉 global 层（近层覆盖，rank 不跨层比较）。
- 消费面前提：web 部署下宿主 `tool-skill` 被 `dsh-web-app` 禁用、由 preset 拥有——agent 所在 preset 须挂 `tool-skill`（standard preset 已挂）才有目录与加载器。该前提在 web 部署的端到端可见性为代码推断，冒烟时核对（TODO.md 登记）。
- 覆盖即特性：用户在项目 `.dsh/skills` 放同名 `unity-search` 技能即可定制覆盖插件版；卸载插件技能即从目录消失。

### 反模式（遵守知识库 `agent/24` §9）

- 不挂 `tool-skill` / `skill-filesystem`（preset 所有权，重复挂抢注册与目录发布）。
- 不改 `skill-filesystem` 的 `customSkillDirs` 指向包内目录（patch config 整体替换，多插件互相吃掉）。
- 不往 `$DSH_HOME/skills` 或项目 `.dsh/skills` 写任何文件（那是 B 类物化路线，且触碰 test/prod 隔离红线）。
- 不用 `packs/` 嵌套子技能（DSH 不递归发现）。

### 内容大纲（七节）

1. **检索面地图**：`web_search`/`web_fetch`（默认）vs `search_sources`（多源+信封）vs `read_source`（聚焦阅读）vs L3 桥（长尾）的选择判据。
2. **源能力矩阵**：各源族擅长什么（速查简表留正文，详情下沉 `references/sources.md`），含 timeRange 支持度。
3. **查询规划**：改写、关键词选取、时间窗、站点限定的成文指引。
4. **多源 fanout 与交叉核验**：何时指定多源；`alsoIn` 多源命中信号的读法；`sources.failed` 与 `uncertainty` 的处置（何时重查、何时声明不确定）。
5. **学术工作流**：关键词 → 学术三源 fanout → 去重/佐证 → 选条目 `read_source` 读 OA 页面 → 整理引注；强调元数据级证据的边界（展开下沉 `references/academic-workflow.md`）。
6. **有界阅读纪律**：不灌全文；先聚焦后翻页；`truncated` 时如何续读。
7. **L3 逃生舱**：学术长尾（paper-search-mcp 22 源）经官方 `dsh-mcp-client` 一行配置桥接；**必须显式 `use_scihub=False`**；token 税提示（57 工具全量注入，仅需要时开启）。配置样例与安全告诫下沉 `references/mcp-bridge.md`。

## L3 逃生舱（不进插件代码）

机制事实（已确认）：`@deepseek-ai/dsh-mcp-client` 随 0.1.2-rc.1 安装树发布，每 MCP server 一行 config（stdio/streamable-http）即桥，工具以 `mcp__<server>__<tool>` 注册，默认不启用。dsh-academic-paper-search 的 YAML-only 桥是该路线的实证。本插件只在其 skill 与 README 中给出配置样例与安全告诫，不承担桥的生命周期。

## 验证方式

- 单测：settings schema 默认值与非法值拒绝；`resolveCredential` 缺席/空值的可用性真值表；`catalog.js` 的 frontmatter 解析/校验真值表（缺 `name`、名 ≠ 目录名、`description` 超 500 字符、非法 YAML）。
- 冒烟（test profile）：credentials 中心录入测试 ref 后 tavily 可用（追溯 AC-06）。
- skill 发布前置六项（知识库 `agent/24` §8，缺一不算完成）：启动无 `N entries did not activate`；`<available_skills>` 出现且 `skill()` 与 `/unity-search` 均可加载（追溯 AC-05）；项目 `.dsh/skills` 放同名技能后项目版生效（覆盖语义）；从 profile 移除后技能消失（卸载语义）；`pnpm pack` 解包确认 `skills/` 在包内且相对路径层级正确（知识库 `agent/24` §10 标记的未实测边界）；过 test 实测门禁。
