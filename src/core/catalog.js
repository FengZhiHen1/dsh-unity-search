// SKILL.md frontmatter 解析与校验（纯函数，无 fs）：name/description 合规性与正文预算。
// 契约 = docs/technical-details/设置凭据与Skill.md + 知识库 agent/23 官方 spec 要点：
// name == 目录名、kebab-case、description ≤ 500 码点、正文受 ToolResultPruner 8192 码点预算约束。
// @ts-check

/** description 官方上限（码点）。 */
export const MAX_DESCRIPTION_CODEPOINTS = 500
/** 正文预算（码点）：与 ToolResultPruner 截断线对齐，超出即"读取会被截断"级违规。 */
export const MAX_BODY_CODEPOINTS = 8192

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * 解析 YAML-lite frontmatter（仅一级 `key: value`；值支持引号包裹）。
 * @param {string} markdown
 * @returns {{ fields: Record<string, string>, body: string, error: string | null }}
 */
export function parseFrontmatter(markdown) {
  const match = FRONTMATTER_RE.exec(markdown)
  if (!match) return { fields: {}, body: markdown, error: '缺少 frontmatter（--- 块）' }
  /** @type {Record<string, string>} */
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    // 嵌套结构（缩进行）不是一期契约面：判为解析错误而不是静默吞。
    if (/^\s/.test(line)) {
      return { fields: {}, body: markdown, error: `frontmatter 含不支持的嵌套行：${line.trim().slice(0, 60)}` }
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) return { fields: {}, body: markdown, error: `frontmatter 行无法解析：${line.trim().slice(0, 60)}` }
    let value = kv[2].trim()
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1).replace(/""/g, '"')
    }
    fields[kv[1]] = value
  }
  return { fields, body: markdown.slice(match[0].length), error: null }
}

/**
 * 校验一个包内 skill 文档；返回可注册所需的字段或违规清单（永不抛）。
 * @param {{ dirName: string, markdown: string }} input
 * @returns {{ ok: true, name: string, description: string, whenToUse: string | null, body: string } | { ok: false, violations: string[] }}
 */
export function validateSkillDoc({ dirName, markdown }) {
  /** @type {string[]} */
  const violations = []
  const parsed = parseFrontmatter(markdown)
  if (parsed.error) {
    return { ok: false, violations: [parsed.error] }
  }
  const name = parsed.fields.name ?? ''
  const description = parsed.fields.description ?? ''
  if (!KEBAB_RE.test(name)) violations.push(`name "${name}" 不是 kebab-case`)
  if (name.length > 0 && name !== dirName) violations.push(`name "${name}" 与目录名 "${dirName}" 不一致`)
  if (description.length === 0) violations.push('description 缺失')
  else if ([...description].length > MAX_DESCRIPTION_CODEPOINTS) {
    violations.push(`description ${[...description].length} 码点，超上限 ${MAX_DESCRIPTION_CODEPOINTS}`)
  }
  if ([...parsed.body].length === 0 || parsed.body.trim().length === 0) violations.push('正文为空')
  return violations.length > 0
    ? { ok: false, violations }
    : { ok: true, name, description, whenToUse: parsed.fields.when_to_use ?? null, body: parsed.body }
}

/**
 * 正文预算检查（独立于校验：超预算不判非法，但返回警告供接线层落日志）。
 * @param {string} body
 * @returns {string | null}
 */
export function bodyBudgetWarning(body) {
  const cps = [...body].length
  return cps > MAX_BODY_CODEPOINTS ? `SKILL.md 正文 ${cps} 码点，超 ${MAX_BODY_CODEPOINTS} 预算，模型读取时会被截断` : null
}
