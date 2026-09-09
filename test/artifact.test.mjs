// artifact 落盘：命名确定性、写读、LRU 驱逐（真 tmp 目录 + 默认 node io）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, utimes, stat, writeFile, readFile, readdir, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactFileName, writeArtifact, evictLru } from '../src/core/read/artifact.js'

const NOW = Date.parse('2026-09-09T08:30:45.123Z')

test('artifactFileName：UTC 时间戳 + host + URL hash8 + 扩展名（确定性）', () => {
  const a = artifactFileName('https://example.com/a/b?x=1', NOW, 'text')
  const b = artifactFileName('https://example.com/a/b?x=1', NOW, 'text')
  assert.equal(a, b)
  assert.match(a, /^20260909-083045-example\.com-[0-9a-f]{8}\.txt$/)
  assert.match(artifactFileName('https://example.com/a/b?x=1', NOW, 'raw'), /\.html$/)
  assert.match(artifactFileName('not a url', NOW, 'text'), /-unknown-[0-9a-f]{8}\.txt$/)
})

test('writeArtifact：dir 空/写失败 → 显式 error 返回（不抛）', async () => {
  const empty = await writeArtifact({ dir: '', fileName: 'x.txt', content: 'hi', maxTotalMB: 10 })
  assert.equal(empty.ok, false)
  assert.match(empty.error, /dir is empty/)
})

test('writeArtifact：正常写盘 + bytes；LRU 按 mtime 删旧保新', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unity-art-'))
  try {
    const old = await writeArtifact({ dir, fileName: '0001-old.txt', content: 'A'.repeat(1000), maxTotalMB: 256 })
    assert.equal(old.ok, true)
    assert.equal(old.bytes, 1000)
    const past = new Date(Date.now() - 60_000)
    await utimes(join(dir, '0001-old.txt'), past, past)
    const fresh = await writeArtifact({ dir, fileName: '0002-new.txt', content: 'B'.repeat(500), maxTotalMB: 256 })
    assert.equal(fresh.ok, true)
    assert.deepEqual(fresh.removed, [])
    // 上限压到 ~1KB：新写后旧者出局（阈值按写后总量判定）。
    const third = await writeArtifact({ dir, fileName: '0003.txt', content: 'C'.repeat(900), maxTotalMB: 0.001 })
    assert.equal(third.ok, true)
    assert.deepEqual(third.removed, ['0001-old.txt', '0002-new.txt'], '按 mtime 最旧序删到阈内')
    await assert.rejects(() => stat(join(dir, '0001-old.txt')))
    await assert.rejects(() => stat(join(dir, '0002-new.txt')))
    assert.match(await readFile(join(dir, '0003.txt'), 'utf8'), /^C+$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('evictLru：目录不存在 → 空操作不抛；超限删到阈内', async () => {
  const io = { mkdir, writeFile, readdir, stat, unlink }
  const missing = await evictLru({ dir: join(tmpdir(), 'unity-no-such-dir-xyz'), maxTotalMB: 1, io, warn: () => {} })
  assert.deepEqual(missing, [])
  const dir = await mkdtemp(join(tmpdir(), 'unity-art2-'))
  try {
    await writeFile(join(dir, 'big.txt'), 'x'.repeat(5000))
    const out = await evictLru({ dir, maxTotalMB: 0.001, io, warn: () => {} })
    assert.deepEqual(out, ['big.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
