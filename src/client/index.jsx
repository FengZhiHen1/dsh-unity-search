// index — Client 入口：注册「统一搜索」设置节，装配注入面 { call, scope, credentials }。
//
// 边界：注入面平铺，不碰保留键 hooks/keyedHooks（知识库 client/15 红线）；
// 凭据走官方 ctx.remote.credentials 单向读写（值不回显），Remote 缺席时降级为不可录入态；
// 导航图标走 DOM 补丁（外壳未开放 icon 字段，见 `nav-icon.js` 头注）。
//
// 0.1.7 配置读写换代：`ctx.settingsScope.bind({ namespace })` 在新树**零命中**（运行期
// `ctx.settingsScope` 为 undefined ⇒ 加载即抛）。现行通道是 `ctx.configForms.get(entryId)`，
// 其中 **entryId = 本插件 loader 行的 id**（= NAMESPACE，不是包名）。`ConfigForm` 与旧
// `SettingsScope` 逐方法对应——`getSnapshot()` / `subscribe()` / `mutate(ops, rev)` 签名一致，
// 快照形状也一致（`status`/`value`/`revision`，`status` 取值 `loading|ready|unavailable`），
// 故 section.jsx 的草稿/保存/防陈旧的读写代码**一行未改**。
// 参考：docs/technical-details/设置页UI.md；DSR-005；本仓库 dsh-skill-manager DSR-025。
// @ts-check

import { createCall } from './api.js'
import { createCredentials } from './credentials.js'
import { UnitySearchSection } from './section.jsx'
import { SECTION_LABEL, observeSectionNavIcon } from './nav-icon.js'
import { NAMESPACE } from '../core/config-ns.js'

// `configForms` 取代旧 `settingsScope`（同属 ui-settings 包，服务名不同）。
// 客户端 remote 命名空间按"traced service"暴露，取属性前必须在 inject 里声明。
export const inject = ['slots', 'configForms', 'connection', 'remote']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const call = createCall(ctx)
  const scope = ctx.configForms.get(NAMESPACE)
  const credentials = createCredentials(ctx)

  ctx.effect(() => {
    const offSection = ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'unity-search',
          order: 17,
          label: SECTION_LABEL,
          inject: () => ({ call, scope, credentials }),
        },
        UnitySearchSection,
      ),
    )
    const offNavIcon = observeSectionNavIcon()
    return () => {
      offSection()
      offNavIcon()
    }
  }, 'dsh-unity-search: settings section')
}
