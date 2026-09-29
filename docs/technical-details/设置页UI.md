# 设置页 UI

本文唯一拥有：设置界面独立标签页（设置节）的注册接线、页面结构、RPC 通道契约、凭据录入形态、状态投影与构建接线。视觉体系不归本文——本页面必须融入 DSH 原生设置体系（原语 + `--dsw-alias-*` token + 同构几何，机制事实归知识库 `client/15`），禁止自建视觉身份与裸绘。

## 目标与边界

为 RQ-07 提供承接：设置面板左导航的独立设置节「统一搜索」，集中承担配置、凭据录入、运行状态与实跑诊断。职责定位已经用户确认（2026-09-09，DSR-005）：**配置 + 状态 + 诊断**。

- 本页面是插件唯一的自定义 UI 入口；**不注册** `plugins.row.config` 卡片（避免双入口；旧版此处写作已废的 `settings.plugin.item`）。
- 页面只做配置与观测，不承载搜索结果的完整浏览（那是会话内工具结果的事）。
- Host 侧引擎链状态（冷却、最近结果）存活于 adapter fiber 作用域（《项目结构设计》全局约定），本页面经 RPC 读取投影，不另建状态副本。

## 设置节注册

Client 入口（`src/client/index.jsx`）声明 `inject = ['slots', 'configForms', 'connection', 'remote']`，`apply` 内：

```js
const scope = ctx.configForms.get(NAMESPACE)   // NAMESPACE = 本插件 loader 行的 id，见 core/config-ns.js
ctx.slots.inject('settings.section', () =>
  ctx.slots.register(
    { name: 'settings.section', id: 'unity-search', order: 17, label: '统一搜索',
      inject: () => ({ call, scope, credentials }) },
    UnitySearchSection))
```

- **配置读写门面换代（0.1.7）**：`ctx.settingsScope.bind({ namespace })` 在新树**零命中**（运行期 `ctx.settingsScope` 为 `undefined` ⇒ Client 半区加载即抛）。现行通道是 `ctx.configForms.get(entryId)`，**entryId = 本插件 loader 行的 id**（= `NAMESPACE`，不是包名）。`ConfigForm` 与旧 `SettingsScope` 逐方法对应——`getSnapshot()` / `subscribe()` / `mutate(ops, revision)` 签名一致，快照形状也一致（`status`/`value`/`revision`，`status` 取值 `loading|ready|unavailable`），故本节的草稿/保存/防陈旧逻辑**一行未改**。`inject` 相应以 `configForms` 取代 `settingsScope`。
- 注入面**平铺**（`{ call, scope, credentials }`），不碰保留键 `hooks`/`keyedHooks`（skill-manager 同构写法；知识库 `client/15` §4 红线）。
- 导航图标：**已实现** DOM 补丁（见下文「构建与纯净度」末条；DSR-005 的「一期不做」已被 2026-09-21 的实现取代）。
- `order: 17` 排在既有节之后（技能 = 16）；`label` 直接给中文（第三方节无 locale 约束）。

## 页面结构（页头 + 节内分页）

页面形态向原生「插件」节学两件事：页头（标题 + 一行描述）、节内 tab 分页（2026-09-09 用户指令，截图实证原生形态）。分页内的内容组织按各页签需要设计，不套用折叠卡。

- 页头：标题「统一搜索」+ 描述一行（"多源统一检索：网页引擎链、学术与平台源、凭据与诊断。"）。
- 分页栏：页面自有组件状态——原生「插件配置/插件列表」分页栏是插件节私有 slot（`settings.plugins.tab`），非通用机制；样式对齐原生分页几何（文本页签：active = 前景色 + 底部指示条，inactive = secondary 色）。
- 草稿语义：配置编辑进草稿，所在页签底部一条放弃/保存操作条（dirty 才可用，写带 `expectedRevision` 防陈旧覆盖）；切换页签保留各页签草稿。状态徽标与诊断结果是只读投影与实跑结果，不参与草稿。

### 页签一：网页引擎

- 链参数行：`cooldownSeconds`、`timeoutMs`（数字输入）。
- 引擎列表，每引擎一行：名称 + 状态行（冷却至时刻 / 最近失败 code 等只读细节）+ 徽标（`免 KEY`/`需 KEY·未配置`/`需 KEY·已配置`/`已停用`/`冷却中`/`失败`，Pill 原语语义色）+ 顺序调整（上移/下移）+ 启用开关。
- key 引擎行内第二行：引用名输入 + 凭据录入行（复用组件，见下）。
- `searxng` 行内附加：实例列表编辑器（每行一个 URL）。

数据面：configForms + RPC `state` + credentials Remote。

### 页签二：检索源

- 学术/平台源各一行：名称 + 描述 + 徽标（`免 KEY`/`可选 KEY`/`已停用`）+ 启用开关。
- 行内附加：`github` 引用名 + 凭据录入行；`wikipedia` 语言输入。

数据面：configForms + credentials Remote。

### 页签三：通用

- `contact`（礼貌池 mailto，文本输入）。
- 阅读：`defaultChars`、`maxChars`（数字输入）、`allowPrivate`（开关）；落盘：`persist`（开关）、`dir`（路径，空 = 默认插件数据目录）、`maxTotalMB`（数字）。

数据面：configForms。

### 页签四：诊断

- 源选择（`web` 链 / 单引擎 / 单源）+ 查询输入 + 运行按钮。
- 结果区：status 丸、逐源成败 chips、attempts 表（源/结果/延迟）、前 5 条标题链接、`uncertainty`/`warnings` 显式列出；运行后自动重拉状态投影（冷却/最近失败即时反映到引擎行徽标）。

数据面：RPC `test` + `state`。

凭据录入行（引擎与源页签复用同一组件）：引用名存 settings（`apiKeyEnv` 字段），值经官方 `ctx.remote.credentials` 单向写入——`describe([ref])` 得 `{configured, source, writable}` 渲染状态点，「录入」开内联密码框 `set(ref, value)`，「清除」`unset(ref)`；任何路径不回显值。写入被拒（只读源遮蔽）按 RemoteError 原文呈现。

## RPC 通道契约

Host 侧**已改造为**（2026-09-28）`/api` 精确 Fetch 路由：`registerRpcChannel(ctx, { namespace: 'unity-search', endpoints: RPC_ENDPOINTS, dispatch })`（`src/adapter/rpc-channel.js`）逐端点注册 `ctx.connection.fetch.register({ path: '/api/unity-search/<endpoint>', methods: ['POST'], requestBody: 'buffered', fetch })`，免费继承平台围栏 403/认证 401/`connection/request` waterfall/体积上限 413；客户端配套 `rpc.call('/api', 'unity-search/<endpoint>', payload, signal)`。旧写法 `ctx.connection.rpc.handle('/unity-search', dispatch)` **已失效**——该 API 在生产 web 组合下注册不上任何自定义通道（失败点在 connection 服务自己的 ctx 上，而 `webserver` 与 `connection` 是顶层兄弟行），表现为行 `active` 但浏览器一律 405；详见仓库级 `docs/decisions/0002-自定义RPC通道改用精确Fetch路由.md`。Client 侧 `createCall` 归一错误不变（skill-manager `api.js` 同构：`{ok:true,value}` 取值、`{ok:false,error}` 转 `RpcError`，transport 失败 `code: 'transport'`）。入站载荷经 core 校验函数显式拒绝脏形状（`contract-violation`）。

| 端点 | 载荷 | 返回 | 超时 |
| --- | --- | --- | --- |
| `state` | `{}` | `{ engines: [{id, enabled, configured, available, coolingUntil, lastOutcome}], sources: [{id, family, enabled, configured, available}], chain: {order, cooldownSeconds, timeoutMs}, now }` | 15s |
| `test` | `{ source: 'web' \| 引擎 id \| 源 id, query: string }` | 完整证据信封（`source: 'web'` 走链兜底；单 id 直调该适配器） | 30s |

- `lastOutcome`：`{ outcome: 'ok'|'error', code?, at }`（链内最近一次尝试的记忆，随 fiber 生命周期，不持久化）。
- `test` 是实跑（出站网络调用），仅由用户从本人浏览器会话触发；通道围栏保证非本机/未认证不可达。
- 错误码表：`bad-request`（载荷非法）、`unknown-source`、`internal`、`transport`（Client 侧合成）；业务失败带 `message` 原文。

## 状态投影

无推送通道（自定义事件不在 Remote 转发白名单）：节挂载时拉一次 `state`；手动刷新按钮；`test` 运行后自动重拉。设置文档外部变更经 `scope.subscribe()` 反映（settings 域自带 mirror 与 revision 围栏）。

## 构建与纯净度

- 复刻 skill-manager `build-client.mjs`：`src/client/index.jsx` → esbuild → `dist/client.js`（lazy-CJS factory、platform browser、外部表 = 模块系统基线 + primitives）。`exports["./client"]` + `dsh.client = { platform: 'web', inject: [...] }`；现行四项 = `@deepseek-ai/dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-settings`、`dsh-client-connection`（0.1.7 起 `dsh-client-runtime` 已不存在，配置表单服务由 `dsh-client-ui-settings` 提供故列出它；与 `dsh-skill-manager` 逐字一致）。⚠ `dsh-client-modules` **不是**浏览器模块 id，它是 Host 侧 `modules` 行的包名（扫描 `dsh.client` 行、组装 `__DSH_BOOT__`、服务 `/plugins/<id>/client.js`）；`inject` 项指向不存在的包只会被静默跳过，不影响本模块加载（知识库 `must-read/04` §7）。
- 纯净度门禁：client 代码对 `@deepseek-ai/*` 只允许模块表基线的 value import（primitives 为 static UI library 直接 `require`），其余一律 type-only；跨插件协作走 cordis service。
- **client bundle 不得触到 Node 侧依赖**：命名空间常量放 `src/core/config-ns.js`（零依赖）而非 `src/adapter/settings.js`——后者顶层依赖 Node 侧 schemastery，被 client 引用即拖进浏览器产物。交付前以产物字符串审计钉住：`dist/client.js` 中 `settingsScope` / `installSection` / `schemastery` / `dsh-client-runtime` 须 0 命中。
- 样式：内联样式 + `--dsw-alias-*` token（沿用 `dsh-skill-manager` 先例；宿主 client 构建链对 CSS modules 的支持未证实，内联是可运行事实）；几何与 token 对齐原生设置页；交互态（disabled/hover/focus）按原生配方以状态条件算样式（无伪类依赖），禁用态必须可见（知识库 `client/15` §4.1 红线）。
- **左侧导航图标 = DOM 补丁（宿主未开放注册面）**：外壳 `ui-settings-general` 的 `navIcon(id)` 是**封闭清单**（仅 `models`/`agent-presets`/`plugins` 有专属字形，其余一律 `IconSettingsOutline16` 齿轮兜底），而 `settings.section` 只投影 `id`/`order`/`label`、**无 icon 字段**——两代一致（v0.1.2-rc.1 部署树 `lib/client.js` 与 v0.1.5-rc.2 检出 `SettingsRoot.tsx:27-31`，2026-09-21 复核）。本插件按本仓库 `dsh-skill-manager/src/client/nav-icon.js` 先例实现 `src/client/nav-icon.js`：按 `span[class*="navLabel"]` 文本命中自己那行 → **保留 svg 节点**、替换其子 path 为 `IconSearchOutline16` 几何（逐字取自 `ui-primitives/src/icons/index.tsx:21`）→ `MutationObserver` 跟随模态反复挂载，disposer 交 `ctx.effect` 回收。宿主 DOM 变化时静默保持原图标：纯装饰，无功能影响。

## 失败语义

- RPC transport 失败：诊断区/状态区显式错误态（可重试措辞），不静默空渲染。
- 配置保存冲突（`expectedRevision` 陈旧）：保留草稿并提示刷新后重试（对齐原生被拒保留草稿语义）。
- Host 半区缺席（行未挂载）：`ctx.configForms.get(NAMESPACE)` 返回的表单快照 `status` 停在 `loading`、`value` 为 `undefined`，故组件走「注入面缺失」空态文案，不报错也不崩。
- Client bundle 渲染崩溃 = 该 section 一次性 abdicate（无痕）；防线 = 组件 props 防御（注入面缺成员时降级为空态，不抛）。

## 验证方式

- 无浏览器通道（知识库 `client/17` §7）：curl + token cookie 直连 `/unity-search/state` 与 `/test`，正例返回信封、负例（无 cookie）401。
- 页面冒烟（追溯 AC-08）：节出现、配置保存落**本 profile 的 `cordis.patch.yml`**（0.1.7 起不再是 `settings.yaml`；见「设置凭据与Skill」）、凭据录入后 `describe` 转 configured、诊断区实跑返回摘要。
- 构建验证：`pnpm pack` 解包含 `dist/client.js`；页面 `__DSH_BOOT__` 图含本包；纯净度门禁通过（构建即检查）。
