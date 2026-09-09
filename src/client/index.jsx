// index — Client 入口：注册「统一搜索」设置节，装配注入面 { call, scope, credentials }。
//
// 边界：注入面平铺，不碰保留键 hooks/keyedHooks（知识库 client/15 红线）；
// 凭据走官方 ctx.remote.credentials 单向读写（值不回显），Remote 缺席时降级为不可录入态。
// 参考：docs/technical-details/设置页UI.md「设置节注册」。
// @ts-check

import { createCall } from './api.js'
import { createCredentials } from './credentials.js'
import { UnitySearchSection } from './section.jsx'

export const inject = ['slots', 'settingsScope', 'connection', 'remote']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const call = createCall(ctx)
  const scope = ctx.settingsScope.bind({ namespace: 'unity-search' })
  const credentials = createCredentials(ctx)

  ctx.effect(() => {
    const offSection = ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'unity-search',
          order: 17,
          label: '统一搜索',
          inject: () => ({ call, scope, credentials }),
        },
        UnitySearchSection,
      ),
    )
    return () => {
      offSection()
    }
  }, 'dsh-unity-search: settings section')
}
