import test from 'node:test'
import assert from 'node:assert/strict'

import { computeSyncCountersForImportedOrder, deriveSyncReadinessMetrics } from './order-sync.ts'

test('imported + ready increments imported and keeps notReady zero', () => {
  const counters = computeSyncCountersForImportedOrder({
    importStatus: 'INVOICE_READY',
    eligibilityStatus: 'ELIGIBLE',
    readinessErrors: [],
  })

  assert.equal(counters.imported, 1)
  assert.equal(counters.notReady, 0)
})

test('imported + review required increments both imported and notReady', () => {
  const counters = computeSyncCountersForImportedOrder({
    importStatus: 'IMPORTED',
    eligibilityStatus: 'REVIEW_REQUIRED',
    readinessErrors: ['One or more line items have no GST tax profile (SKU-HSN mapping)'],
  })

  assert.equal(counters.imported, 1)
  assert.equal(counters.notReady, 1)
})

test('deriveSyncReadinessMetrics surfaces readiness details for per-order payload', () => {
  const readiness = deriveSyncReadinessMetrics({
    importStatus: 'IMPORTED',
    eligibilityStatus: 'REVIEW_REQUIRED',
    mappingCompleteness: 50,
    readinessErrors: ['One or more line items have no GST tax profile (SKU-HSN mapping)'],
    unmappedSkus: ['SKU-1', 'SKU-2'],
    warnings: ['Order imported but requires GST readiness review'],
  })

  assert.deepEqual(readiness.readinessErrors, ['One or more line items have no GST tax profile (SKU-HSN mapping)'])
  assert.equal(readiness.mappingCompleteness, 50)
  assert.deepEqual(readiness.unmappedSkus, ['SKU-1', 'SKU-2'])
  assert.deepEqual(readiness.warnings, ['Order imported but requires GST readiness review'])
  assert.equal(readiness.isNotReady, true)
})
