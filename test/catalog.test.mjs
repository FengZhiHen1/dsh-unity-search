// SKILL.md frontmatter 解析与校验真值表（A 类捆绑技能的入库闸门）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, validateSkillDoc, bodyBudgetWarning, MAX_BODY_CODEPOINTS } from '../src/core/catalog.js'

const GOOD = ['---', 'name: unity-search', 'description: 多源检索。', 'when_to_use: 查资料时用。', '---', '', '# 正文', '内容段。'].join('\n')

test('parseFrontmatter：字段/正文分离，无 frontmatter 显式报缺', () => {
  const parsed = parseFrontmatter(GOOD)
  assert.deepEqual(parsed.fields, { name: 'unity-search', description: '多源检索。', when_to_use: '查资料时用。' })
  assert.match(parsed.body, /# 正文/)
  const bare = parseFrontmatter('# 只有正文')
  assert.ok(bare.error, 'SKILL.md 必须带 frontmatter，缺 = error 而非静默空字段')
})

test('parseFrontmatter：未闭合块与嵌套键报错（不静默）', () => {
  const unclosed = parseFrontmatter('---\nname: x\n没有闭合线')
  assert.ok(unclosed.error)
  const nested = parseFrontmatter('---\nname: x\n  child: y\n---\nbody')
  assert.ok(nested.error, '缩进嵌套不是本解析器支持面，必须显式报')
})

test('validateSkillDoc：合法文档通过并回传 name/desc/whenToUse/body', () => {
  const r = validateSkillDoc({ dirName: 'unity-search', markdown: GOOD })
  assert.equal(r.ok, true)
  assert.equal(r.name, 'unity-search')
  assert.equal(r.whenToUse, '查资料时用。')
})

test('validateSkillDoc：违规全清单', () => {
  const cases = [
    [{ dirName: 'a', markdown: '---\nname: Bad_Name\ndescription: d\n---\nb' }, /不是 kebab-case/],
    [{ dirName: 'other', markdown: '---\nname: unity-search\ndescription: d\n---\nb' }, /与目录名/],
    [{ dirName: 'x', markdown: '---\nname: x\n---\nb' }, /description 缺失/],
    [{ dirName: 'x', markdown: `---\nname: x\ndescription: ${'字'.repeat(501)}\n---\nb` }, /超上限 500/],
    [{ dirName: 'x', markdown: '---\nname: x\ndescription: d\n---\n   ' }, /正文为空/],
  ]
  for (const [input, pattern] of cases) {
    const r = validateSkillDoc(input)
    assert.equal(r.ok, false, JSON.stringify(input).slice(0, 60))
    assert.match(r.violations.join(' '), pattern)
  }
})

test('bodyBudgetWarning：8192 码点界（中文按码点不按字节）', () => {
  assert.equal(bodyBudgetWarning('字'.repeat(MAX_BODY_CODEPOINTS)), null)
  const over = '字'.repeat(MAX_BODY_CODEPOINTS + 1)
  assert.match(String(bodyBudgetWarning(over)), /8193 码点/)
  assert.equal(bodyBudgetWarning(Buffer.from('字'.repeat(MAX_BODY_CODEPOINTS + 1), 'utf8').toString('utf8')) !== null, true, '字节 3× 于码点仍按码点判')
})
