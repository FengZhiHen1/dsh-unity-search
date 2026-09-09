// theme — Client 主题 token 与样式基元：色值零硬编码，全部映射宿主 --dsw-alias-* token。
// 基线复刻 dsh-skill-manager/src/client/theme.js（同构几何；设置外壳已给页边距，横向零内缩）。
// @ts-check

/** 主题 token 表：宿主换肤即时生效。 */
export const T = {
  bgBase: 'var(--dsw-alias-bg-base)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  bgLayer3: 'var(--dsw-alias-bg-layer-3)',
  bgModulePlatform: 'var(--dsw-alias-bg-module-platform)',
  borderL1: 'var(--dsw-alias-border-l1)',
  borderL2: 'var(--dsw-alias-border-l2)',
  brand: 'var(--dsw-alias-brand-primary)',
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  success: 'var(--dsw-alias-state-success-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
}

/** token 色晕（状态徽章/提示共用）。 @param {string} color */
export const badgeStyle = (color) => ({
  color,
  background: `color-mix(in srgb, ${color} 15%, transparent)`,
})

/** 状态徽章几何基元（对齐原生 pending pill：高 ~19px、圆角 999、11px）。 */
export const pillBase = {
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 11,
  lineHeight: '17px',
  background: T.bgModulePlatform,
  color: T.labelSecondary,
  whiteSpace: 'nowrap',
}

/** 按态取徽章样式：ok/中性灰底，warn/error 色晕。 @param {'ok'|'warn'|'error'} kind */
export const statusPillStyle = (kind) => {
  if (kind === 'warn') return { ...pillBase, ...badgeStyle(T.warn) }
  if (kind === 'error') return { ...pillBase, ...badgeStyle(T.error) }
  return pillBase
}

/** 布局基元速查。 */
export const S = {
  panel: { padding: '10px 0' },
  listRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 13, flexWrap: 'wrap' },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
  muted: { color: T.labelSecondary, fontSize: 12 },
}

/** 卡容器（页签内容分组）。 */
export const cardStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 12, background: T.bgLayer3, overflow: 'hidden' }
/** 浅底子卡。 */
export const subCardStyle = { borderRadius: 10, background: T.bgModulePlatform }
/** 分隔线。 */
export const dividerStyle = { height: 1, background: T.borderL1, flex: 'none' }
/** 次要说明文本。 */
export const noteText = { fontSize: 11, color: T.labelSecondary, lineHeight: 1.5 }
/** 段标题。 */
export const sectionHead = { fontSize: 14, fontWeight: 600, color: T.labelPrimary }
/** 小尺寸文字钮（行内操作）。 */
export const linkBtn = { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 11, color: T.labelSecondary, cursor: 'pointer' }
/** 文本输入基元（原生设置同构：浅底小圆角）。 */
export const fieldStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 8, background: T.bgLayer3, padding: '4px 8px', font: 'inherit', fontSize: 12, color: T.labelPrimary, minWidth: 0 }
