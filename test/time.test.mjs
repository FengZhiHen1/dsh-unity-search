// timeRange 词汇归一与相对时间换算（parseTimeRange/approximateRange/isoDaysAgo/timeRangeToSince）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTimeRange, approximateRange, isoDaysAgo, timeRangeToSince } from '../src/core/time.js'

test('parseTimeRange：固定档/相对时长/绝对日期/非法', () => {
  assert.deepEqual(parseTimeRange('day'), { days: 1 })
  assert.deepEqual(parseTimeRange('WEEK'), { days: 7 })
  assert.deepEqual(parseTimeRange(' month '), { days: 30 })
  assert.deepEqual(parseTimeRange('year'), { days: 365 })
  assert.deepEqual(parseTimeRange('12h'), { days: 0.5 })
  assert.deepEqual(parseTimeRange('3d'), { days: 3 })
  assert.deepEqual(parseTimeRange('2mo'), { days: 60 })
  assert.deepEqual(parseTimeRange('1y'), { days: 365 })
  assert.deepEqual(parseTimeRange('2026-07-01'), { after: '2026-07-01T00:00:00Z' })
  assert.equal(parseTimeRange('2026-13-45'), null)
  assert.equal(parseTimeRange('0d'), null)
  assert.equal(parseTimeRange('decade'), null)
  assert.equal(parseTimeRange(''), null)
  assert.equal(parseTimeRange(undefined), null)
})

test('approximateRange：天数回落到最近粗档', () => {
  assert.equal(approximateRange(0.5), 'day')
  assert.equal(approximateRange(2), 'day')
  assert.equal(approximateRange(3), 'week')
  assert.equal(approximateRange(14), 'week')
  assert.equal(approximateRange(15), 'month')
  assert.equal(approximateRange(90), 'month')
  assert.equal(approximateRange(91), 'year')
})

test('isoDaysAgo：注入时钟稳定输出（毫秒段抹零）', () => {
  const now = () => Date.parse('2026-09-09T12:34:56.789Z')
  assert.equal(isoDaysAgo(7, now), '2026-09-02T12:34:56.000Z')
  assert.equal(isoDaysAgo(0.5, now), '2026-09-09T00:34:56.000Z')
})

test('timeRangeToSince：绝对档直通，相对档走时钟', () => {
  const now = () => Date.parse('2026-09-09T00:00:00Z')
  assert.deepEqual(timeRangeToSince('2026-07-01', now), { fromIso: '2026-07-01T00:00:00Z' })
  assert.deepEqual(timeRangeToSince('week', now), { fromIso: '2026-09-02T00:00:00.000Z' })
  assert.equal(timeRangeToSince('bogus', now), null)
})
