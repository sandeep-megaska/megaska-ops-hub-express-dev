import test from 'node:test'
import assert from 'node:assert/strict'

import { gstDb } from './db.ts'
import { importSkuMappingsCsv, upsertSkuTaxMapping } from './sku-tax-map.ts'

const originalFindFirst = (gstDb as any).gstSkuTaxMap.findFirst
const originalCreate = (gstDb as any).gstSkuTaxMap.create
const originalUpdate = (gstDb as any).gstSkuTaxMap.update

let createdPayload: any = null
let updatedPayload: any = null

test.afterEach(() => {
  ;(gstDb as any).gstSkuTaxMap.findFirst = originalFindFirst
  ;(gstDb as any).gstSkuTaxMap.create = originalCreate
  ;(gstDb as any).gstSkuTaxMap.update = originalUpdate
  createdPayload = null
  updatedPayload = null
})

test('milestone 1: CSV row upserts GstSkuTaxMap with taxRate 5', async () => {
  ;(gstDb as any).gstSkuTaxMap.findFirst = async () => null
  ;(gstDb as any).gstSkuTaxMap.create = async ({ data }: any) => {
    createdPayload = data
    return { id: 'map-1', ...data }
  }

  const result = await importSkuMappingsCsv('sku,hsnCode,taxRate,cessRate\nMWSW05-Black-S,61124990,5,0', 'shop-1')

  assert.equal(result.ok, true)
  assert.equal(result.data?.imported, 1)
  assert.equal(createdPayload.sku, 'MWSW05-Black-S')
  assert.equal(createdPayload.styleCode, 'MWSW05')
  assert.equal(createdPayload.hsnCode, '61124990')
  assert.equal(createdPayload.taxRate, 5)
  assert.equal(createdPayload.cessRate, 0)
})

test('milestone 1: direct upsert updates existing taxRate to 5', async () => {
  ;(gstDb as any).gstSkuTaxMap.findFirst = async () => ({ id: 'map-existing' })
  ;(gstDb as any).gstSkuTaxMap.update = async ({ data }: any) => {
    updatedPayload = data
    return { id: 'map-existing', ...data }
  }

  const result = await upsertSkuTaxMapping({
    shopId: 'shop-1',
    sku: 'MWSW05-Black-S',
    hsnCode: '61124990',
    taxRate: 5,
    cessRate: 0,
  })

  assert.equal(result.ok, true)
  assert.equal(updatedPayload.hsnCode, '61124990')
  assert.equal(updatedPayload.taxRate, 5)
})
