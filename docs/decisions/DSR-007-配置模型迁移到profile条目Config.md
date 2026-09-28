# DSR-007：配置模型迁移到「profile 条目 Config + volatile」——设置节保留，读写门面换代

> 状态：**已落地，静态闸全绿**（2026-09-28）。`npm run check` 退出 0（client 产物新鲜度 + 分层门禁 42 个 core 文件 + `node --test` **110/110**）。本次为**基线换代适配**：目标基线 DSH `0.1.7-rc.2`（源码 tag `dsh-v0.1.7-rc.2` / `477b4f42`，现场 `dshl env` 现查）。
> ⚠ **实例级实测（test profile 启动冒烟 + 页面走查）尚未做**——见文末「尚未验证」。

## 上下文

知识库 active 版由 `v0.1.2-rc.1` 升到 `v0.1.7-rc.2` 后，本插件的配置面**两端同时**落在被删除的符号集上。源码零命中取证（tag `dsh-v0.1.7-rc.2` 的 `packages/`，非文档转述）：

| 旧符号 | 新树命中 | 后果 |
|---|---|---|
| `ctx.settings.installSection(...)` | 0 | Host `apply` 抛 `TypeError: … is not a function` ⇒ 行 FAILED、插件整体不可用 |
| `SettingsScope` / `settingsScope` / `installSection`（运行时 `dsh-settings@0.1.7-rc.2` lib） | 0 | 编译期/运行期符号归零 |
| Client `ctx.settingsScope.bind({namespace})` | 0 | `ctx.settingsScope` 为 `undefined` ⇒ Client 半区**加载即抛** |
| `settings/updated` | 0 | 监听永不触发 |
| `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` | 包已不存在 | 静默跳过（不炸，但声明失真） |

⚠ **反向教训（本次不必重新发现，但必须记住）**：`dsh-unity-search` 在本仓库 `docs/upgrades/0003` §2.6 曾被记为「`ctx.settings.*` 用法 **0 处** ✅ 不受影响」。那是**假阴性**——扫描写死了 `ctx.settings.` 字面量，漏掉了经 `ctx.inject` 回调改名后的 `settingsCtx.settings.`。**peer 门禁也会 PASS**（4 项 peer 全满足），而代码真实调用已删 API。⇒ 判适配只能看代码面，门禁测不出。

## 与 dsh-skill-manager 的关键差异（决定了本次动作面）

skill-manager 的旧配置页挂在**已删除的槽位** `settings.plugin.item` 上，所以它必须把页面**搬家**到 Plugins 页的 `plugins.row.config`。

本插件不同：它的页面挂在 **`settings.section`，而该槽位在新基线仍然存在**（`packages/client/ui-settings/src/client/contract/slots.ts:57`，第三方可注册）。已核对该槽位的现行注册方含 `ui-settings-models`、`ui-settings-general`、`ui-settings-plugins`、`ui-settings-account`、`ui-agent-preset`。⇒ **页面形态、位置、页签结构全部不动**，本次只换数据面。这一差异使本次改动面显著小于 skill-manager（无页面搬家、无 `view` 分发、无 `whileServed` 包裹）。

## 真实方向与评价

- **A（保留旧写法，等平台兼容层）**：不存在。旧符号是**删除**而非改签名，上游未提供兼容包。
- **B（去掉配置页，只认 profile patch 手改）**：技术上能加载，但砍掉本插件唯一的自定义 UI 入口（DSR-005 用户已确认「配置 + 状态 + 诊断」的职责定位），且 RQ-07 / AC-08 的验收面直接落空。
- **C（保留设置节，只换数据面：`Config` + volatile + `ctx.configForms`）**：唯一可行方向，且是本次采用项。

## 最终决定（C）

### Host 半区（`src/adapter/settings.js`、`src/adapter/index.js`）

1. **`Config` 声明全部可配置值为 volatile 叶子**。⚠ **摆放硬约束**（`vendor/schemastery/src/index.ts` `validateVolatileSchema`）：只有**叶子**可标 volatile，且不得有外层 volatile 字段——`z.object({...}).volatile()`、`z.array(z.string().volatile())` 在**解析期**抛 `volatile fields require a fixed object path without an enclosing volatile field`。故 `chain`/`engines`/`sources`/`readSource` 这些中间对象不带 volatile，其叶子才带。
2. **volatile 覆盖范围 = 设置页真正会写的字段**：链参数、10 个引擎与 13 个源的 `enabled`/`apiKeyEnv`、searxng 的 `instances`、`contact`、readSource 六项。**`sources.*.language` 刻意非 volatile**——设置页没有该控件（按 spec 不做无关改动），保留它只是不改既有配置形状；代价是该字段不进设置表单且不可经设置页写入，运行期仍照常解析。
3. **`createSettings(config)` 取代 `installSettings(...)`**。旧版要经 `ctx.inject(['settings'], …)` 起子 fiber、等 settings 就绪后 `installSection` 才拿到权威值，服务缺席还要回落 entry config；新模型的配置真相**就在本行的 `Config` 里**，无需任何服务、不存在「缺席」分支。返回值形状 `{ current() }` 与旧版**逐字一致**，故 `src/adapter/index.js` 的消费点（`makeRuntime`、rpc、seam、tools）一行未改。
4. **`current()` 必须递归解包**：volatile 是逐叶子标记的，中间对象仍是普通对象。只解一层会把 `{ order: ref }` 交给 core，而 core 读的是 `cfg.chain.order`（应为数组）。已由单测钉住。
5. **跨字段校验换挂点**：旧 `installSection` 的 `validate` 选项 → `ctx.on('internal/config', …)` waterfall（`installConfigValidation`）。该瀑布与设置页写路径（`config-editor.edit`）**是同一条**，故抛错 ⇒ 写被拒且不落盘。候选是**原始** config（`!!js` 未求值、schema 归一尚未发生），故校验前先 `resolveConfig` 补齐缺省——否则一笔只改 `cooldownSeconds` 的写会因 `chain.order` 缺席而误报。
6. **不挂 `loader/volatile-update`**：旧版的 `onChange` 回调只做 `credentials.refresh()`，而引用名集合本来就在 `refresh()` 内部现读 ⇒ 回调是冗余的，新模型下不需要对应物。运行时每次组装都现读 volatile，故配置变更**下次调用即生效**。
7. **包元数据重排**：`@deepseek-ai/schemastery` 由 `dependencies`（`^3.18.2`）上移到 `peerDependencies` + 同版本 `devDependencies`（`^3.18.4`）——`.volatile()` 是 3.18.4 的扩展，而「一般模块导入先取 importer 搜索路径下的物理候选、未命中才进 runtime interception」，留 `dependencies` 副本会把解析钉死在旧版、import 期抛 `TypeError`。五个 `@deepseek-ai/dsh*` / `cordis` peer 由 `*` 抬到 `^0.1.7-rc.2` / `^4.0.4`（devDependencies 同步），使**版本门禁**生效。

### Client 半区（`src/client/index.jsx`、`src/client/section.jsx`）

8. **读写门面换代**：`ctx.settingsScope.bind({ namespace })` → `ctx.configForms.get(NAMESPACE)`。`ConfigForm` 与旧 `SettingsScope` **逐方法对应**（`getSnapshot`/`subscribe`/`mutate(ops, revision)`），快照形状也一致（`status`/`value`/`revision`，`status` 取值 `loading|ready|unavailable`）⇒ `section.jsx` 的草稿/保存/防陈旧逻辑**一行未改**。`inject` 以 `configForms` 取代 `settingsScope`。
9. **命名空间是 loader entry id，不是包名**（= `unity-search`）。Host 与 Client 两侧共用新增的 `src/core/config-ns.js` 单一事实源，并由单测直接读 `cordis.patch.yml` 钉住它与 `insert` 行 id 一致——改 id 不改常量会让配置页与命名空间**静默解绑**（无报错）。
10. **命名空间常量必须放 core 而非 adapter**：`adapter/settings.js` 顶层依赖 Node 侧 schemastery，client 若引用它会把该依赖拖进浏览器产物。core 零依赖，两侧都安全（同 skill-manager `core/model/config-fields.js` 形态）。
11. **`settings.section` 的 `id` 保持 `unity-search`**（与 `NAMESPACE` 同值纯属巧合：前者是导航节 key，后者是 loader 行 id；两处语义不同，故未强行合并为同一常量）。
12. **`dsh.client.inject` 换代**：`dsh-client-runtime` 已不存在 → 换为 `dsh-client-ui-settings`（`configForms` 的提供方；该包原先只作值 import 用，未列入声明，属既有疏漏）。

## 直接后果

- **升级顺序成为硬约束**：peer 抬到 `^0.1.7-rc.2` 后，本版**不得**挂到更低运行时。`stable-dev`（运行时仍 `0.1.2-rc.1`）现挂的是**旧版本**，在其升级之前**不要 `dsh plugin update`**——peer 门禁会把整行置 `disabled: true`（插件静默消失）。正确顺序：**先把实例升到 `0.1.7-rc.2`，再挂载/更新本插件**。
- 配置真相从 `$DSH_HOME/settings.yaml` 的 `unity-search` 段变成 profile `cordis.patch.yml` 的 `unity-search` 行 `config`。`settings.yaml` 在新基线只作一次性导入源（导入后改名 `.imported`）。
- 页面**不加**「重启才生效」的措辞：新模型下 volatile 字段**全部**即时生效（`applies` 已收窄为字面量 `'live'`）。
- 新增/改写回归闸（`test/settings.test.mjs` 7→15 例，全包 101→110）：`Config` 全量 volatile 与摆放合法性（真的调用一次 schema，因为违规在解析期抛）、**缺省值必须与 `fullDefaults` 同源**、`createSettings` 的递归解包与普通值容忍、`internal/config` 三态（本 fiber 非法抛 / 合法放行 / 他 fiber 不拦 / 必调 next）、waterfall 候选需先补缺省、`Config` 必须挂在 default 导出对象上、`NAMESPACE` 与 patch 行 id 一致、**设置页会写的每条路径都必须是 volatile 叶子**。

## 消融验证（每条保护都单独证明其必要性）

把保护逐个移除、其余不变、重跑，确认对应用例**确实转红**（全部已还原并核对 SHA256 一致）：

| 移除的保护 | 转红的用例 |
|---|---|
| 逐项缺省改回「一律 `true` / 空 key 引用」 | `Config 缺省值必须与 fullDefaults 同源` |
| `unwrapVolatile` 不递归（只解一层） | `createSettings：逐层递归解包 volatile` |
| `Config` 从 default 导出对象上摘掉 | `Config 必须挂在 default 导出对象上` |
| `readSource.dir` 去掉 `.volatile()` | `设置页会写的每条路径都必须是 volatile 叶子`（+ volatile 引用断言） |

## 重访条件

- 上游恢复「插件自选命名空间」或提供 `Config` 的具名导出读取路径 → 第 9/10 条的约束可放宽。
- 上游为 volatile 摆放或跨字段校验提供更直接的声明面（如 `Config` 级 schema 约束）→ 第 5 条的 `internal/config` 挂点可撤。
- 上游开放 `settings.section` 的 `icon` 字段 → `nav-icon.js` 的 DOM 补丁可退役（纯装饰、无功能影响）。

## 尚未验证（如实登记）

- **实例级实测未做**：本轮只跑静态闸（单测 + 分层 + 语法 + 产物新鲜度 + 复刻判据探针）。**未**起实例、**未**做页面走查——按 AGENTS.md 红线，实例启停只能由用户在启动器侧执行。
- 以下属**读源码 + 复刻探针推断**，未经真实启动观察：
  - 设置表单在真页面上出现、`chain.order`（数组）与 `searxng.instances`（数组）的控件读写正常；
  - peer 门禁 `disabling profile plugin …` 的实机文案；
  - DOM 补丁在 0.1.7 外壳 DOM 上仍命中 `span[class*="navLabel"]`（两代一致已由源码核对，但未在 0.1.7 页面实测）。
- **已取证的部分**（供后续复核）：
  - 用真 `@deepseek-ai/schemastery@3.18.4` 复刻平台 `volatileForm` / `isVolatilePath` 判据跑本插件 `Config`：`volatileForm(Config)` 非空（⇒ `describe()` 不会跳过本行、设置页能看到表单），设置页会写的 **56 条路径全部通过**，`sources.wikipedia.language` 如设计被拒。
  - `dist/client.js` 产物字符串审计：`settingsScope` / `installSection` / `schemastery` / `dsh-client-runtime` 均 **0 命中**；`configForms` 2 处、`"unity-search"` 2 处。
  - `@deepseek-ai/schemastery@3.18.4` 在 npm registry 与 `0.1.7-rc.2` 安装树内**都是 3.18.4**，与本插件 peer 范围同版。
