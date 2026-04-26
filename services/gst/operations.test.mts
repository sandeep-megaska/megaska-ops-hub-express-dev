import test from 'node:test'
import assert from 'node:assert/strict'

import { syncOrdersByDateRange } from './order-sync.ts'
import { generateInvoiceBatch } from './dispatch-batch.ts'
import { previewBulkProductTaxMappings } from './product-tax-bulk.ts'
import { gstDb } from './db.ts'

const originalHsnFindUnique = gstDb.gstHsnCode.findUnique
const originalHsnSlabFindFirst = gstDb.gstHsnSlabMap.findFirst
const originalSkuMapFindFirst = gstDb.gstSkuTaxMap.findFirst

test.afterEach(() => {
  gstDb.gstHsnCode.findUnique = originalHsnFindUnique
  gstDb.gstHsnSlabMap.findFirst = originalHsnSlabFindFirst
  gstDb.gstSkuTaxMap.findFirst = originalSkuMapFindFirst
})

test('order sync validates date range', async () => {
  const result = await syncOrdersByDateRange({
    from: '2026-04-16',
    to: '2026-04-01',
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, 'from must be less than or equal to to')
})

test('invoice batch validates orderImportIds', async () => {
  const result = await generateInvoiceBatch({ orderImportIds: [] })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'orderImportIds[] is required')
})

test('bulk preview returns duplicates and keeps unknown sku rows valid', async () => {
  gstDb.gstHsnCode.findUnique = async ({ where }) => {
    if ((where as { hsnCode?: string }).hsnCode === '6109') {
      return { id: 'hsn-1', hsnCode: '6109' }
    }
    return null
  }

  gstDb.gstHsnSlabMap.findFirst = async () => ({ slab: { taxRate: 12, cessRate: 1 } })
  gstDb.gstSkuTaxMap.findFirst = async () => null

  const result = await previewBulkProductTaxMappings([
    { sku: 'KNOWN-1', hsnCode: '6109' },
    { sku: 'KNOWN-1', hsnCode: '6109' },
    { sku: 'UNKNOWN-2', hsnCode: '6109' },
  ])

  assert.equal(result.ok, true)
  assert.equal(result.data?.duplicateCount, 1)
  assert.equal(result.data?.unmatchedCount, 0)
  assert.equal(result.data?.matchedCount, 3)
})
