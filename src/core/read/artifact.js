// 全量落盘（DSR-006）：{YYYYMMDD-HHmmss}-{host}-{hash8}.txt|html + 目录级 LRU 驱逐。
// 目录与开关由 settings（readSource.*）决定，本模块只执行；写失败向上暴露为显式结果。
// @ts-check

import { createHash } from 'node:crypto'
import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @typedef {Object} ArtifactIo 可注入文件系统面（测试用真 tmp 目录，签名对齐 node:fs/promises 子集）。
 * @property {typeof mkdir} mkdir
 * @property {typeof writeFile} writeFile
 * @property {typeof readdir} readdir
 * @property {typeof stat} stat
 * @property {typeof unlink} unlink
 */

/** @type {ArtifactIo} */
const defaultIo = { mkdir, writeFile, readdir, stat, unlink }

/**
 * 生成落盘文件名：时间戳（UTC）+ host（净化）+ URL sha256 前 8 位。
 * @param {string} url
 * @param {number} nowMs
 * @param {'text' | 'raw'} kind
 * @returns {string}
 */
export function artifactFileName(url, nowMs, kind) {
  const d = new Date(nowMs)
  const pad = (n) => String(n).padStart(2, '0')
  const ts = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  /** @type {string} */
  let host
  try {
    host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_').slice(0, 60)
  } catch {
    host = 'unknown'
  }
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 8)
  return `${ts}-${host || 'unknown'}-${hash}.${kind === 'raw' ? 'html' : 'txt'}`
}

/**
 * 写全量 artifact 并执行 LRU 驱逐；失败返回显式 error（不抛）。
 * @param {{ dir: string, fileName: string, content: string, maxTotalMB: number, io?: ArtifactIo, warn?: (msg: string) => void }} params
 * @returns {Promise<{ ok: true, path: string, bytes: number, removed: string[] } | { ok: false, error: string }>}
 */
export async function writeArtifact({ dir, fileName, content, maxTotalMB, io = defaultIo, warn }) {
  if (!dir || typeof dir !== 'string') {
    return { ok: false, error: 'readSource.dir is empty; cannot persist artifact' }
  }
  try {
    await io.mkdir(dir, { recursive: true })
    await io.writeFile(join(dir, fileName), content, 'utf8')
  } catch (error) {
    return { ok: false, error: `artifact write failed: ${String(error && error.message ? error.message : error)}` }
  }
  const bytes = new TextEncoder().encode(content).length
  const removed = await evictLru({ dir, maxTotalMB, io, warn })
  return { ok: true, path: join(dir, fileName).replace(/\\/g, '/'), bytes, removed }
}

/**
 * 目录总量超 maxTotalMB 时按 mtime 最旧先删到阈内（LRU）。只处理本目录平铺文件。
 * @param {{ dir: string, maxTotalMB: number, io: ArtifactIo, warn?: (msg: string) => void }} params
 * @returns {Promise<string[]>} 被删除的文件名。
 */
export async function evictLru({ dir, maxTotalMB, io, warn }) {
  if (!(maxTotalMB > 0)) return []
  const limit = Math.floor(maxTotalMB * 1024 * 1024)
  /** @type {Array<{ name: string, size: number, mtimeMs: number }>} */
  const files = []
  let names
  try {
    names = await io.readdir(dir)
  } catch (error) {
    warn?.(`LRU readdir failed: ${String(error && error.message ? error.message : error)}`)
    return []
  }
  let total = 0
  for (const name of names) {
    try {
      const s = await io.stat(join(dir, name))
      if (!s.isFile()) continue
      files.push({ name, size: s.size, mtimeMs: s.mtimeMs })
      total += s.size
    } catch { // quality-floor: ignore silent-catch stat 间隙文件消失是并发清理的正常竞态：跳过该文件，LRU 判定以现存集合为准
      // 文件在 stat 间隙消失：跳过即可，不构成错误。
    }
  }
  if (total <= limit) return []
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  /** @type {string[]} */
  const removed = []
  for (const file of files) {
    if (total <= limit) break
    try {
      await io.unlink(join(dir, file.name))
      removed.push(file.name)
      total -= file.size
    } catch (error) {
      warn?.(`LRU unlink failed for ${file.name}: ${String(error && error.message ? error.message : error)}`)
    }
  }
  return removed
}
