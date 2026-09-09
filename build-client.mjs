// dsh-unity-search — Client 产物构建（复刻 dsh-skill-manager build-client.mjs 输出格式）。
// esbuild → dist/client.js：lazy-CJS 工厂包裹，外化 react/@deepseek-ai/*，产物提交进 git（github: 直挂门禁）。
//
// 用法：node build-client.mjs          → 构建并写 dist/client.js
//       node build-client.mjs --check  → 内存构建与现有产物逐字节比对（哨兵，不写盘；过期 exit 1）

import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import process from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ID = 'dsh-unity-search'
const ENTRY = join(here, 'src/client/index.jsx')
const OUTFILE = join(here, 'dist/client.js')

// 外化集合与 package.json 的 dsh.client.inject 声明一致（+ react 基线）
const EXTERNALS = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', '@deepseek-ai/*']

const BANNER = [
  `window.__ModuleLoader__.load({ id: "${PLUGIN_ID}", factory: (require) => {`,
  'var module = { exports: {} };',
  'var exports = module.exports;',
].join('\n')
const FOOTER = 'return module.exports; } });'

/** @returns {Promise<string>} 产物文本 */
async function bundle() {
  const result = await build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: EXTERNALS,
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    banner: { js: BANNER },
    footer: { js: FOOTER },
    write: false,
  })
  return result.outputFiles[0].text
}

async function main() {
  const text = await bundle()
  if (process.argv.includes('--check')) {
    let onDisk = null
    try {
      onDisk = await readFile(OUTFILE, 'utf8')
    } catch { /* 产物不存在 → 视为过期 */ } // quality-floor: ignore silent-catch 缺产物即不一致，由下方比对统一裁决
    if (onDisk === text) {
      console.log(`✓ client 产物新鲜（${(text.length / 1024).toFixed(1)} KB）`)
      return
    }
    console.error('✗ client 产物过期或不一致：源码与 dist/client.js 不匹配，请运行 pnpm build 并提交产物')
    process.exit(1)
  }
  await mkdir(dirname(OUTFILE), { recursive: true })
  await writeFile(OUTFILE, text, 'utf8')
  console.log(`✓ 已产出 dist/client.js（${(text.length / 1024).toFixed(1)} KB）`)
}

main().catch((error) => {
  console.error('✗ client 构建失败：', error && error.errors ? JSON.stringify(error.errors, null, 2) : error)
  process.exit(1)
})
