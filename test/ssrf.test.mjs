// SSRF 防线：协议白名单、v4/v6 私网段、IPv4-mapped、NAT64、DNS fail-closed、allowPrivate。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertSafeTarget, isBlockedAddress } from '../src/core/read/ssrf.js'

/** 假 DNS：host → 固定地址表。 @param {Record<string, string[]>} table */
function dns(table) {
  return {
    lookup: async (host) => {
      if (!(host in table)) throw new Error(`ENOTFOUND ${host}`)
      return table[host].map((address) => ({ address }))
    },
  }
}

test('协议白名单：http/https 放行，file/javascript/data 拒绝', async () => {
  const d = dns({ 'pub.tld': ['93.184.216.34'] })
  assert.equal((await assertSafeTarget('https://pub.tld/a', { dns: d })).ok, true)
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://pub.tld/']) {
    const r = await assertSafeTarget(bad, { dns: d })
    assert.equal(r.ok, false, bad)
    assert.equal(r.code, 'unsafe_target')
  }
})

test('IP 字面量：公网放行，私网/回环/链路本地/元数据地址拒绝（不经 DNS）', async () => {
  const cases = [
    ['8.8.8.8', true],
    ['93.184.216.34', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.5.4', false],
    ['172.32.0.1', true],
    ['192.168.0.1', false],
    ['169.254.169.254', false],
    ['0.0.0.0', false],
    ['240.0.0.1', false],
    ['127.1', false],
    ['[::1]', false],
    ['[fe80::1]', false],
    ['[fc00::abcd]', false],
    ['[2001:4860:4860::8888]', true],
    ['[::ffff:127.0.0.1]', false],
    ['[::ffff:8.8.8.8]', true],
    ['[64:ff9b::127.0.0.1]', false],
    ['[64:ff9b::7f00:1]', false],
    ['[64:ff9b::808:808]', true],
  ]
  for (const [host, allowed] of cases) {
    const r = await assertSafeTarget(`http://${host}/x`, {})
    assert.equal(r.ok, allowed, `${host} 期望 ${allowed}，实际 ${r.ok}（${r.message ?? ''}）`)
    if (!allowed) assert.equal(r.code, 'unsafe_target')
  }
})

test('isBlockedAddress 单元面', () => {
  assert.equal(isBlockedAddress('100.64.0.1'), true)
  assert.equal(isBlockedAddress('100.127.255.255'), true)
  assert.equal(isBlockedAddress('101.0.0.1'), false)
  assert.equal(isBlockedAddress('not-an-ip'), true, '不可解析地址按拒绝处理')
})

test('DNS 解析：域名 → 私网 IP 拒绝（rebinding 面），公网 IP 放行', async () => {
  const d = dns({ 'inner.tld': ['192.168.1.9'], 'outer.tld': ['93.184.216.34'], 'dual.tld': ['93.184.216.34', '10.0.0.5'] })
  assert.equal((await assertSafeTarget('http://inner.tld/', { dns: d })).ok, false)
  assert.equal((await assertSafeTarget('http://outer.tld/', { dns: d })).ok, true)
  const dual = await assertSafeTarget('http://dual.tld/', { dns: d })
  assert.equal(dual.ok, false, '多 A 记录任一命中私网即拒')
})

test('fail-closed：无 DNS 注入 / 查询失败 / 空记录 → 一律拒绝', async () => {
  const noDns = await assertSafeTarget('https://example.com/', {})
  assert.equal(noDns.ok, false)
  assert.match(noDns.message, /no DNS resolver/)
  const missing = await assertSafeTarget('https://nonexistent.example/', { dns: dns({}) })
  assert.equal(missing.ok, false)
  assert.equal((await assertSafeTarget('https://empty.example/', { dns: dns({ 'empty.example': [] }) })).ok, false)
})

test('allowPrivate 显式放开（危险开关路径）', async () => {
  const r = await assertSafeTarget('http://127.0.0.1:3080/api', { allowPrivate: true })
  assert.equal(r.ok, true)
  assert.equal(r.url.hostname, '127.0.0.1')
})

test('非法 URL / 空 host 显式拒绝', async () => {
  assert.equal((await assertSafeTarget('not a url', {})).ok, false)
  assert.equal((await assertSafeTarget('https://', {})).ok, false)
})
