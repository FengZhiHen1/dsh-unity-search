// config-ns — 配置命名空间的单一事实源。
//
// 为什么单独一个模块：0.1.7 起**命名空间就是本插件 loader 行的 id**（不是插件自选的 kebab-case 名，
// 也不是包名 `dsh-unity-search`），而它同时被两侧消费——
//   Host：`ctx.settings` 的 describe/mutate 按 entry id 寻址；
//   Client：`ctx.configForms.get(entryId)` 取表单。
// 两侧若各自写死一份字面量，改名时就会**静默解绑**（表单与命名空间对不上，无报错）。
//
// 放 core 而非 adapter：adapter/settings.js 顶层依赖 Node 侧的 `@deepseek-ai/schemastery`（schema 用），
// 浏览器半区若引用该 adapter 会把它拖进 client bundle；本模块零依赖，两侧都安全。
// 同一形态见本仓库 dsh-skill-manager 的 `core/model/config-fields.js`。
//
// ⚠ 与 `cordis.patch.yml` 里 `insert` 行的 `id` 必须逐字一致——已由 `test/settings.test.mjs`
// 直接读 patch 文件钉住（改 id 不改这里 = 配置页与命名空间静默解绑）。

/** 配置命名空间 = 本插件 loader 行的 id（= seam provider id，命名链条见《项目结构设计》）。 */
export const NAMESPACE = 'unity-search'
