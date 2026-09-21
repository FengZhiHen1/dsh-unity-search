// skill 接线回归（2026-09-21）：用最小 ctx 替身驱动 registerSkill，走**真实磁盘读取路径**取候选。
//
// 为什么单独一层：`test/` 此前只覆盖 core，adapter 接线零测试。本次活体 bug 恰在那片空白里——
// `readFile` 未带 encoding ⇒ Buffer ⇒ `validateSkillDoc` 抛 TypeError ⇒ provider 在目录装配期
// 被整体跳过（症状：工具面正常、技能面静默消失）。本文件钉住"provider 真能交出候选"这一事实。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerSkill, PROVIDER_NAME } from '../src/adapter/skill.js'

/** 最小 ctx 替身：只提供 registerSkill 消费的两个面（logger / skills.registerProvider）。 */
function makeCtx() {
  const warnings = []
  let factory = null
  return {
    warnings,
    get factory() {
      return factory
    },
    logger: { warn: (msg) => warnings.push(String(msg)) },
    skills: {
      registerProvider: (create) => {
        factory = create
        return () => {}
      },
    },
  }
}

test('registerSkill：provider 从磁盘真实读出并交出恰一条候选（含全部必填字段）', async () => {
  const ctx = makeCtx()
  registerSkill(ctx)
  assert.equal(typeof ctx.factory, 'function', 'registerProvider 必须在 apply 期同步调用')
  const provider = ctx.factory()
  assert.equal(provider.name, PROVIDER_NAME)
  assert.equal(typeof provider.list, 'function')
  assert.equal(typeof provider.get, 'function')

  const observation = await provider.list({ signal: new AbortController().signal })
  const candidates = Array.isArray(observation) ? observation : observation.candidates
  assert.equal(
    candidates.length,
    1,
    `期望恰好 1 条候选；实得 ${candidates.length}。warnings=${ctx.warnings.join(' | ')}`,
  )

  const candidate = candidates[0]
  assert.equal(candidate.name, 'unity-search')
  assert.equal(candidate.provider, PROVIDER_NAME)
  assert.equal(candidate.source, 'bundled')
  assert.equal(candidate.rank, 600)
  assert.equal(candidate.invocation.modelInvocable, true)
  assert.equal(candidate.invocation.userInvocable, true)
  assert.equal(typeof candidate.description, 'string')
  assert.ok(candidate.description.length > 0, 'description 不得为空（目录就是靠它描述技能）')
  assert.equal(typeof candidate.locator, 'string')

  const loaded = await provider.get(candidate)
  assert.equal(loaded.name, 'unity-search')
  assert.equal(loaded.provider, PROVIDER_NAME)
  assert.ok(Number(loaded.content?.length) > 1000, `正文应完整读出，实得 ${loaded.content?.length}`)
})
