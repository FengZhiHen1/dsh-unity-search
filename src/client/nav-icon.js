// nav-icon — 设置导航图标补丁：把设置面板里「统一搜索」那一行的图标改画成放大镜。
//
// 为什么只能改 DOM（2026-09-21 两代复核）：宿主外壳按 section id 从**封闭清单**里挑图标
// （v0.1.5-rc.2 检出 `packages/client/ui-settings-general/src/client/SettingsRoot.tsx:27-31`：
// 仅 models / agent-presets / plugins 三支，其余一律齿轮兜底），而 `settings.section`
// 注册面只投影 id/order/label，**没有 icon 字段**。故第三方节只能就地改 DOM——本仓库
// skill-manager（`plugins/dsh-skill-manager/src/client/nav-icon.js`）与外部插件
// dsh-better-sidebar（`src/client/settings-nav-icon.ts`，其注释原文："Until that public
// contract grows an icon field…"）用的是同一招。
// 几何复刻宿主 `IconSearchOutline16`（v0.1.5-rc.2 检出
// `packages/client/ui-primitives/src/icons/index.tsx:21`，viewBox 0 0 16 16，fill 制式）。
//
// 边界：纯装饰。宿主 DOM 结构变化导致找不到目标时保持原图标，不影响任何功能。
// @ts-check

/** 设置节 label（与 index.jsx 的注册共用同一常量，避免两处字面量漂移）。 */
export const SECTION_LABEL = '统一搜索'

/** `IconSearchOutline16` 的两条 path（主机 primitives 的原始几何，逐字复制）。 */
const SEARCH_ICON_PATHS = [
  'M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z',
  'M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z',
]

/** 把匹配到的导航行图标改画成放大镜；已是目标图标则跳过。 */
function patchSectionNavIcon() {
  for (const label of document.querySelectorAll('span[class*="navLabel"]')) {
    if (label.textContent?.trim() !== SECTION_LABEL) continue
    const cell = label.closest('button')
    const svg = cell?.querySelector('svg')
    if (!svg) continue
    // React 重渲染还原内容后会再次走到这里；已是目标图标即返回（避免与自身改写互相触发）。
    const first = svg.firstElementChild
    if (first && first.tagName === 'path' && first.getAttribute('d') === SEARCH_ICON_PATHS[0]) continue
    // 保留 svg 节点本身（React 持有其引用），只替换子节点与 viewBox 制式。
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    for (const d of SEARCH_ICON_PATHS) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', d)
      path.setAttribute('fill', 'currentColor')
      svg.appendChild(path)
    }
  }
}

/**
 * 跟随 DOM 变化重画导航图标，返回 disposer（经 `ctx.effect` 回收）。
 * 设置面板为模态挂载，导航行随开关反复出现，故用 MutationObserver 跟随。
 * @returns {() => void}
 */
export function observeSectionNavIcon() {
  patchSectionNavIcon()
  const observer = new MutationObserver((mutations) => {
    // 仅在有新节点挂载时扫描，避免流式文本等纯文本变更触发无谓查询。
    if (mutations.some((m) => m.addedNodes.length > 0)) patchSectionNavIcon()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}
