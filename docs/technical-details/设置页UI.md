# 设置页 UI

本文唯一拥有：设置界面独立标签页（设置节）的注册接线、页面结构、RPC 通道契约、凭据录入形态、状态投影与构建接线。视觉体系不归本文——本页面必须融入 DSH 原生设置体系（原语 + `--dsw-alias-*` token + 同构几何，机制事实归知识库 `client/15`），禁止自建视觉身份与裸绘。

## 目标与边界

为 RQ-07 提供承接：设置面板左导航的独立设置节「统一搜索」，集中承担配置、凭据录入、运行状态与实跑诊断。职责定位已经用户确认（2026-09-09，DSR-005）：**配置 + 状态 + 诊断**。

- 本页面是插件唯一的自定义 UI 入口；**不注册** `settings.plugin.item` 卡片（避免双入口）。
- 页面只做配置与观测，不承载搜索结果的完整浏览（那是会话内工具结果的事）。
- Host 侧引擎链状态（冷却、最近结果）存活于 adapter fiber 作用域（《项目结构设计》全局约定），本页面经 RPC 读取投影，不另建状态副本。

## 设置节注册

Client 入口（`src/client/index.jsx`）声明 `inject = ['slots', 'settingsScope', 'connection', 'remote']`，`apply` 内：

```js
ctx.slots.inject('settings.section', () =>
  ctx.slots.register(
    { name: 'settings.section', id: 'unity-search', order: 17, label: '统一搜索',
      inject: () => ({ call, scope, credentials }) },
    UnitySearchSection))
```

- 注入面**平铺**（`{ call, scope, credentials }`），不碰保留键 `hooks`/`keyedHooks`（skill-manager 同构写法；知识库 `client/15` §4 红线）。
- 导航图标接受宿主默认（宿主按 section id 硬编码图标、未开放注册；MutationObserver 改 DOM 是 skill-manager 用过的脆弱补丁，一期不做，决策见 DSR-005）。
- `order: 17` 排在既有节之后（技能 = 16）；`label` 直接给中文（第三方节无 locale 约束）。

## 页面结构（五区）

页面组件 = 一个纵向滚动页，五区按职责分块；配置类编辑统一走 settingsScope 草稿语义（dirty 跟踪 + 放弃/保存操作条 + `expectedRevision` 防陈旧覆盖，对齐原生卡片交互配方）。

| 区 | 内容 | 数据面 |
| --- | --- | --- |
| 引擎链 | 8 个 web 引擎各一行：启用开关、顺序调整（上移/下移）、key 引用名（key 引擎）、凭据状态点与录入/清除、冷却中与最近失败徽标；链参数（`cooldownSeconds`/`timeoutMs`） | settingsScope + RPC `state` + credentials Remote |
| 检索源 | 学术/平台源各一行：启用开关；行内附加项——`github` token 引用与凭据、`wikipedia` 语言、`searxng` 实例列表编辑器 | settingsScope + credentials Remote |
| 阅读 | `defaultChars`/`maxChars`/`allowPrivate` | settingsScope |
| 通用 | `contact`（礼貌池 mailto） | settingsScope |
| 诊断 | 源选择（`web` 链 / 单引擎 / 单源）+ 查询输入 + 运行按钮 → 信封摘要：status 丸、逐源成败 chips、attempts 表（源/结果/延迟）、前 5 条标题链接、`uncertainty`/`warnings` 显式列出 | RPC `test` |

凭据录入行（引擎链区与检索源区内复用同一组件）：引用名存 settings（`apiKeyEnv` 字段），值经官方 `ctx.remote.credentials` 单向写入——`describe([ref])` 得 `{configured, source, writable}` 渲染状态点，「录入」开内联密码框 `set(ref, value)`，「清除」`unset(ref)`；任何路径不回显值。写入被拒（只读源遮蔽）按 RemoteError 原文呈现。

## RPC 通道契约

Host 侧 `ctx.connection.rpc.handle('/unity-search', dispatch)`（继承 loopback/认证围栏，知识库 `client/17` §4）；Client 侧 `createCall` 归一错误（skill-manager `api.js` 同构：`{ok:true,value}` 取值、`{ok:false,error}` 转 `RpcError`，transport 失败 `code: 'transport'`）。入站载荷经 core 校验函数显式拒绝脏形状（`contract-violation`）。

| 端点 | 载荷 | 返回 | 超时 |
| --- | --- | --- | --- |
| `state` | `{}` | `{ engines: [{id, enabled, configured, available, coolingUntil, lastOutcome}], sources: [{id, family, enabled, configured, available}], chain: {order, cooldownSeconds, timeoutMs}, now }` | 15s |
| `test` | `{ source: 'web' \| 引擎 id \| 源 id, query: string }` | 完整证据信封（`source: 'web'` 走链兜底；单 id 直调该适配器） | 30s |

- `lastOutcome`：`{ outcome: 'ok'|'error', code?, at }`（链内最近一次尝试的记忆，随 fiber 生命周期，不持久化）。
- `test` 是实跑（出站网络调用），仅由用户从本人浏览器会话触发；通道围栏保证非本机/未认证不可达。
- 错误码表：`bad-request`（载荷非法）、`unknown-source`、`internal`、`transport`（Client 侧合成）；业务失败带 `message` 原文。

## 状态投影

无推送通道（自定义事件不在 Remote 转发白名单）：节挂载时拉一次 `state`；手动刷新按钮；`test` 运行后自动重拉。设置文档外部变更经 `settingsScope.subscribe()` 反映（settings 域自带 mirror）。

## 构建与纯净度

- 复刻 skill-manager `build-client.mjs`：`src/client/index.jsx` → esbuild → `dist/client.js`（lazy-CJS factory、platform browser、外部表 = 模块系统基线 + primitives）。`exports["./client"]` + `dsh.client = { platform: 'web', inject: [...] }`（inject 列 slots/primitives/connection/settings 提供包；**不用已改名的 `dsh-client-runtime`**，写当前名 `dsh-client-modules`——旧名会被静默跳过）。
- 纯净度门禁：client 代码对 `@deepseek-ai/*` 只允许模块表基线的 value import（primitives 为 static UI library 直接 `require`），其余一律 type-only；跨插件协作走 cordis service。
- 样式：`.module.css`（构建内联）；几何与 token 对齐原生设置页；交互态（disabled/hover/focus）按原生配方以状态条件算样式（无伪类依赖），禁用态必须可见（知识库 `client/15` §4.1 红线）。

## 失败语义

- RPC transport 失败：诊断区/状态区显式错误态（可重试措辞），不静默空渲染。
- 配置保存冲突（`expectedRevision` 陈旧）：保留草稿并提示刷新后重试（对齐原生被拒保留草稿语义）。
- Host 半区缺席（行未挂载/无 settings 服务）：设置节不渲染内容以外不发生任何报错；section 条目仍在但页面示空态文案。
- Client bundle 渲染崩溃 = 该 section 一次性 abdicate（无痕）；防线 = 组件 props 防御（注入面缺成员时降级为空态，不抛）。

## 验证方式

- 无浏览器通道（知识库 `client/17` §7）：curl + token cookie 直连 `/unity-search/state` 与 `/test`，正例返回信封、负例（无 cookie）401。
- 页面冒烟（追溯 AC-08）：节出现、配置保存落 `settings.yaml`、凭据录入后 `describe` 转 configured、诊断区实跑返回摘要。
- 构建验证：`pnpm pack` 解包含 `dist/client.js`；页面 `__DSH_BOOT__` 图含本包；纯净度门禁通过（构建即检查）。
