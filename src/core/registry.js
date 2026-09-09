// 源适配器注册表：按 id 与 family 索引。纯数据结构，实例由 adapter 层组装。
// @ts-check

/**
 * @typedef {{
 *   get: (id: string) => import('./types.js').SourceAdapter | undefined,
 *   ids: () => string[],
 *   byFamily: (family: import('./types.js').SourceFamily) => import('./types.js').SourceAdapter[],
 * }} Registry
 */

/**
 * 创建注册表。id 重复 = 装配错误，立即抛（不留到运行期撞车）。
 * @param {import('./types.js').SourceAdapter[]} adapters
 * @returns {Registry}
 * @throws {TypeError} 适配器缺 id/接口或 id 重复（装配编程错误）
 */
export function createRegistry(adapters) {
  /** @type {Map<string, import('./types.js').SourceAdapter>} */
  const byId = new Map()
  /** @type {Map<string, import('./types.js').SourceAdapter[]>} */
  const byFamily = new Map()
  for (const adapter of adapters) {
    if (!adapter || typeof adapter.id !== 'string' || adapter.id.length === 0) {
      throw new TypeError('registry: adapter missing stable id')
    }
    if (typeof adapter.available !== 'function' || typeof adapter.search !== 'function') {
      throw new TypeError(`registry: adapter ${adapter.id} missing available/search`)
    }
    if (byId.has(adapter.id)) throw new TypeError(`registry: duplicate adapter id ${adapter.id}`)
    byId.set(adapter.id, adapter)
    const list = byFamily.get(adapter.family) ?? []
    list.push(adapter)
    byFamily.set(adapter.family, list)
  }
  return {
    get: (id) => byId.get(id),
    ids: () => [...byId.keys()],
    byFamily: (family) => [...(byFamily.get(family) ?? [])],
  }
}
