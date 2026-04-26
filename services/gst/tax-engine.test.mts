import test from 'node:test'
import assert from 'node:assert/strict'

import { computeTotals } from './tax-engine.ts'

test('computeTotals handles tax-inclusive pricing', () => {
  const result = computeTotals([
    { description: 'SKU-1', quantity: 1, unitPrice: 118, taxRate: 18 },
  ], false, { priceIncludesTax: true })

  assert.equal(result.ok, true)
  assert.equal(result.data?.totals.taxableAmount, 100)
  assert.equal(result.data?.totals.cgstAmount, 9)
  assert.equal(result.data?.totals.sgstAmount, 9)
  assert.equal(result.data?.totals.igstAmount, 0)
  assert.equal(result.data?.totals.totalAmount, 118)
})

test('computeTotals handles tax-exclusive pricing with interstate split', () => {
  const result = computeTotals([
    { description: 'SKU-1', quantity: 2, unitPrice: 100, taxRate: 12 },
  ], true, { priceIncludesTax: false })

  assert.equal(result.ok, true)
  assert.equal(result.data?.totals.taxableAmount, 200)
  assert.equal(result.data?.totals.igstAmount, 24)
  assert.equal(result.data?.totals.cgstAmount, 0)
  assert.equal(result.data?.totals.sgstAmount, 0)
  assert.equal(result.data?.totals.totalAmount, 224)
})
