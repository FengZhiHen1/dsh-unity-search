// skill — 包内静态技能 `unity-search` 的 provider 接线（A 类，跟插件版本走）。
//
// 边界：本模块只做 registerProvider 与路径计算；frontmatter 解析/校验在 core/catalog.js；
// 技能正文不在代码内（skills/unity-search/SKILL.md），get() 每次重读、改文件即生效。
// 状态纪律：一切经闭包捕获，无模块级可变单例（《项目结构设计》全局约定）。
// 参考：docs/technical-details/设置凭据与Skill.md「provider 契约」；知识库 agent/23、agent/24。
// @ts-check

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateSkillDoc, bodyBudgetWarning } from '../core/catalog.js'

/** provider 名（层内唯一；`runtime` 是注册表保留名）。 */
export const PROVIDER_NAME = 'unity-search-bundled'

/** 打包技能 rank（与 skill 注册表 BUNDLED_SKILL_RANK 同值语义：兜底层，用户/项目级可覆盖）。 */
const BUNDLED_RANK = 600

const INVOCATION = { modelInvocable: true, userInvocable: true }

/** 包根 skills/ —— src/adapter/ 上溯两级（构建/打包层级不变式，见《项目结构设计》注）。 */
const SKILLS_ROOT = fileURLToPath(new URL('../../skills/', import.meta.url))

/**
 * @typedef {(null | { ok: false, violations: string[] } | { ok: true, name: string, description: string, whenToUse: string | null, body: string })} DocResult
 */

/**
 * 注册包内技能 provider（apply 内同步调用，注册随本 fiber 生命周期）。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {void}
 */
export function registerSkill(ctx) {
  const warn = (/** @type {string} */ msg) => ctx.logger.warn(msg)

  /**
   * 读并校验一个 SKILL.md；文件缺失/损坏返回 null。
   * @param {string} file
   * @param {AbortSignal} [signal]
   * @returns {Promise<DocResult>}
   */
  async function loadDoc(file, signal) {
    /** @type {string} */
    let markdown
    try {
      // encoding 必须显式给：不带 encoding 时 readFile 交的是 Buffer，正文处理会抛
      // `parsed.body.trim is not a function`，导致整个 provider 在目录装配期被跳过——
      // 症状是"工具面正常、技能面静默消失"（2026-09-21 活体实测定位）。
      markdown = await readFile(file, { signal, encoding: 'utf8' })
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code
      if (code && code !== 'ENOENT') warn(`unity-search skill: 读取失败 ${file}：${String(error && error.message ? error.message : error)}`)
      return null
    }
    const dirName = dirname(file).split(/[\\/]/).pop() ?? ''
    return validateSkillDoc({ dirName, markdown })
  }

  /**
   * 单个目录 → 候选（校验失败返回 null 并 warn，不静默）。
   * @param {string} dir
   * @param {AbortSignal} [signal]
   */
  async function readCandidate(dir, signal) {
    const file = join(SKILLS_ROOT, dir, 'SKILL.md')
    const parsed = await loadDoc(file, signal)
    if (!parsed) return null
    if (parsed.ok !== true) {
      warn(`unity-search skill "${dir}" 校验失败，已跳过：${parsed.violations.join('；')}`)
      return null
    }
    const budgetWarning = bodyBudgetWarning(parsed.body)
    if (budgetWarning) warn(`unity-search skill "${dir}": ${budgetWarning}`)
    return {
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
      invocation: INVOCATION,
      provider: PROVIDER_NAME,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: join(SKILLS_ROOT, dir) },
      rank: BUNDLED_RANK,
      locator: file,
      path: file,
    }
  }

  ctx.skills.registerProvider(() => ({
    name: PROVIDER_NAME,
    /**
     * 枚举包内技能。
     * @param {{ signal?: AbortSignal }} options
     */
    async list(options) {
      /** @type {unknown[]} */
      const candidates = []
      /** @type {string[]} */
      let dirs
      try {
        dirs = await readdir(SKILLS_ROOT, { signal: options.signal })
      } catch (error) {
        warn(`unity-search skill: skills root 不可读（${SKILLS_ROOT}）：${String(error && error.message ? error.message : error)}`)
        // 目录读不到属"观测不完整"而非"没有技能"——显式交出不完整观测。
        return { candidates, complete: false }
      }
      for (const dir of dirs.sort()) {
        const candidate = await readCandidate(dir, options.signal)
        if (candidate) candidates.push(candidate)
      }
      return candidates
    },
    /**
     * 取技能定义：重读文件、重校验（改文件即生效）；失败返回 undefined。
     * @param {{ locator?: unknown }} candidate
     */
    async get(candidate) {
      const file = typeof candidate.locator === 'string' ? candidate.locator : null
      if (!file) return undefined
      const parsed = await loadDoc(file)
      if (!parsed || parsed.ok !== true) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
        invocation: INVOCATION,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: dirname(file) },
        content: parsed.body,
      }
    },
  }))
}
