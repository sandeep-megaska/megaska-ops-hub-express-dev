'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  assignSlabToHsn,
  bulkApplyProductMappings,
  bulkPreviewProductMappings,
  deleteHsnCode,
  deleteTaxSlab,
  listHsnCodes,
  listHsnSlabMaps,
  listProductTaxMappings,
  listTaxSlabs,
  listUnmappedProducts,
  importSkuMappingsCsv,
  recomputeSkuMappingReadiness,
  upsertHsnCode,
  upsertProductTaxMapping,
  upsertTaxSlab,
} from '../../lib/gst-client'
import { GstResponseViewer } from './gst-response-viewer'

type Row = Record<string, unknown>

const tabs = ['HSN Master', 'Tax Slabs', 'SKU Mappings', 'Unmapped SKUs', 'Bulk Assignment'] as const

export function GstProductsAdmin() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('HSN Master')
  const [hsnRows, setHsnRows] = useState<Row[]>([])
  const [slabRows, setSlabRows] = useState<Row[]>([])
  const [mappingRows, setMappingRows] = useState<Row[]>([])
  const [hsnSlabRows, setHsnSlabRows] = useState<Row[]>([])
  const [unmappedRows, setUnmappedRows] = useState<Row[]>([])
  const [bulkText, setBulkText] = useState('')
  const [bulkCsvText, setBulkCsvText] = useState('')
  const [importSummary, setImportSummary] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const [hsnForm, setHsnForm] = useState({ hsnCode: '', description: '' })
  const [slabForm, setSlabForm] = useState({ slabCode: '', taxRate: '18', cessRate: '0' })
  const [mappingForm, setMappingForm] = useState({ sku: '', shopifyProductId: '', shopifyVariantId: '', hsnId: '', slabId: '' })
  const [hsnSlabForm, setHsnSlabForm] = useState({ hsnId: '', slabId: '' })

  async function refreshAll() {
    setLoading(true)
    const [hsnRes, slabRes, hsnSlabRes, mappingsRes, unmappedRes] = await Promise.all([
      listHsnCodes(),
      listTaxSlabs(),
      listHsnSlabMaps(),
      listProductTaxMappings(),
      listUnmappedProducts(),
    ])

    if (!hsnRes.ok) setError(hsnRes.error)
    if (!slabRes.ok) setError(slabRes.error)
    if (!hsnSlabRes.ok) setError(hsnSlabRes.error)
    if (!mappingsRes.ok) setError(mappingsRes.error)
    if (!unmappedRes.ok) setError(unmappedRes.error)

    setHsnRows((hsnRes.data as { data?: Row[] })?.data || [])
    setSlabRows((slabRes.data as { data?: Row[] })?.data || [])
    setHsnSlabRows((hsnSlabRes.data as { data?: Row[] })?.data || [])
    setMappingRows((mappingsRes.data as { data?: Row[] })?.data || [])
    setUnmappedRows((unmappedRes.data as { data?: Row[] })?.data || [])
    setLoading(false)
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  const stats = useMemo(() => ({
    hsn: hsnRows.length,
    slabs: slabRows.length,
    mapped: mappingRows.length,
    unmapped: unmappedRows.length,
  }), [hsnRows.length, slabRows.length, mappingRows.length, unmappedRows.length])

  function parseBulkRows() {
    return bulkText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sku, hsnCode] = line.split(',').map((v) => v.trim())
        return { sku, hsnCode }
      })
  }

  async function onPreviewBulk() {
    const rows = parseBulkRows()
    const res = await bulkPreviewProductMappings({ rows })
    if (!res.ok) setError(res.error)
    else setResult(res.data)
  }

  async function onApplyBulk() {
    const rows = parseBulkRows()
    const res = await bulkApplyProductMappings({ rows })
    if (!res.ok) {
      setError(res.error)
      return
    }
    setResult(res.data)
    await refreshAll()
  }

  async function onImportSkuMappingsCsv() {
    const res = await importSkuMappingsCsv({ csvText: bulkCsvText })
    if (!res.ok) {
      setError(res.error)
      return
    }
    const payload = (res.data as { imported?: number; skipped?: number; errors?: string[] }) || {}
    setImportSummary({
      imported: Number(payload.imported || 0),
      skipped: Number(payload.skipped || 0),
      errors: Array.isArray(payload.errors) ? payload.errors : [],
    })
    setResult(res.data)
    await refreshAll()
  }

  async function onRecomputeReadiness() {
    const res = await recomputeSkuMappingReadiness()
    if (!res.ok) setError(res.error)
    else {
      setResult(res.data)
      await refreshAll()
    }
  }

  async function onSaveHsn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const res = await upsertHsnCode({ hsnCode: hsnForm.hsnCode, description: hsnForm.description, isActive: true, isService: false })
    if (!res.ok) setError(res.error)
    else {
      setResult(res.data)
      setHsnForm({ hsnCode: '', description: '' })
      await refreshAll()
    }
  }

  async function onSaveSlab(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const res = await upsertTaxSlab({ slabCode: slabForm.slabCode, taxRate: Number(slabForm.taxRate), cessRate: Number(slabForm.cessRate), isActive: true })
    if (!res.ok) setError(res.error)
    else {
      setResult(res.data)
      setSlabForm({ slabCode: '', taxRate: '18', cessRate: '0' })
      await refreshAll()
    }
  }

  async function onSaveMapping(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const res = await upsertProductTaxMapping({
      shopifyProductId: mappingForm.shopifyProductId,
      shopifyVariantId: mappingForm.shopifyVariantId || null,
      hsnId: mappingForm.hsnId,
      slabId: mappingForm.slabId,
      source: 'manual_sku_ui',
      status: 'ACTIVE',
      metadata: { sku: mappingForm.sku },
    })

    if (!res.ok) setError(res.error)
    else {
      setResult(res.data)
      await refreshAll()
    }
  }

  async function onAssignHsnSlab(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const res = await assignSlabToHsn({
      hsnId: hsnSlabForm.hsnId,
      slabId: hsnSlabForm.slabId,
    })
    if (!res.ok) setError(res.error)
    else {
      setResult(res.data)
      setHsnSlabForm({ hsnId: '', slabId: '' })
      await refreshAll()
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          {[{ label: 'HSN Codes', value: stats.hsn }, { label: 'Tax Slabs', value: stats.slabs }, { label: 'SKU Mappings', value: stats.mapped }, { label: 'Unmapped SKUs', value: stats.unmapped }].map((item) => (
            <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{item.label}</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button key={tab} className={`rounded-xl px-3 py-2 text-sm ${activeTab === tab ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700'}`} onClick={() => setActiveTab(tab)}>{tab}</button>
            ))}
          </div>
        </div>

        {activeTab === 'HSN Master' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-gray-900">HSN Master</h2>
            <form onSubmit={onSaveHsn} className="grid gap-3 md:grid-cols-3">
              <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="HSN code" value={hsnForm.hsnCode} onChange={(e) => setHsnForm((p) => ({ ...p, hsnCode: e.target.value }))} />
              <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm md:col-span-2" placeholder="Description" value={hsnForm.description} onChange={(e) => setHsnForm((p) => ({ ...p, description: e.target.value }))} />
              <button className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white w-fit">Save HSN</button>
            </form>
            <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">HSN</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Action</th></tr></thead><tbody>{hsnRows.map((row) => <tr key={String(row.id)} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{String(row.hsnCode || '')}</td><td className="px-3 py-2">{String(row.description || '')}</td><td className="px-3 py-2"><button className="rounded-lg border border-red-200 px-2.5 py-1 text-red-700" onClick={() => void deleteHsnCode(String(row.id))}>Delete</button></td></tr>)}</tbody></table></div>
          </div>
        )}

        {activeTab === 'Tax Slabs' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Tax Slabs</h2>
            <form onSubmit={onSaveSlab} className="grid gap-3 md:grid-cols-4">
              <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Slab code" value={slabForm.slabCode} onChange={(e) => setSlabForm((p) => ({ ...p, slabCode: e.target.value }))} />
              <input type="number" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Tax" value={slabForm.taxRate} onChange={(e) => setSlabForm((p) => ({ ...p, taxRate: e.target.value }))} />
              <input type="number" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Cess" value={slabForm.cessRate} onChange={(e) => setSlabForm((p) => ({ ...p, cessRate: e.target.value }))} />
              <button className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white">Save Slab</button>
            </form>
            <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Tax</th><th className="px-3 py-2">Cess</th><th className="px-3 py-2">Action</th></tr></thead><tbody>{slabRows.map((row) => <tr key={String(row.id)} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{String(row.slabCode || '')}</td><td className="px-3 py-2">{String(row.taxRate || '')}</td><td className="px-3 py-2">{String(row.cessRate || '')}</td><td className="px-3 py-2"><button className="rounded-lg border border-red-200 px-2.5 py-1 text-red-700" onClick={() => void deleteTaxSlab(String(row.id))}>Delete</button></td></tr>)}</tbody></table></div>
            <div className="rounded-xl border border-gray-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Assign Tax Slab to HSN</h3>
              <form onSubmit={onAssignHsnSlab} className="grid gap-3 md:grid-cols-3">
                <select className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={hsnSlabForm.hsnId} onChange={(e) => setHsnSlabForm((p) => ({ ...p, hsnId: e.target.value }))}><option value="">HSN code</option>{hsnRows.map((h) => <option key={String(h.id)} value={String(h.id)}>{String(h.hsnCode)}</option>)}</select>
                <select className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={hsnSlabForm.slabId} onChange={(e) => setHsnSlabForm((p) => ({ ...p, slabId: e.target.value }))}><option value="">Tax slab</option>{slabRows.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.slabCode)} ({String(s.taxRate || '')}%)</option>)}</select>
                <button className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white w-fit">Assign</button>
              </form>
              <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">HSN</th><th className="px-3 py-2">Slab</th><th className="px-3 py-2">Tax</th><th className="px-3 py-2">Priority</th></tr></thead><tbody>{hsnSlabRows.map((row) => <tr key={String(row.id)} className="border-t border-gray-100"><td className="px-3 py-2">{String(row.hsnCode || row.hsnId || '')}</td><td className="px-3 py-2">{String(row.slabCode || row.slabId || '')}</td><td className="px-3 py-2">{String(row.taxRate || '')}</td><td className="px-3 py-2">{String(row.priority || 0)}</td></tr>)}</tbody></table></div>
            </div>
          </div>
        )}

        {activeTab === 'SKU Mappings' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-gray-900">SKU Mappings</h2>
            <form onSubmit={onSaveMapping} className="grid gap-3 md:grid-cols-5">
              <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="SKU" value={mappingForm.sku} onChange={(e) => setMappingForm((p) => ({ ...p, sku: e.target.value }))} />
              <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Product ID" value={mappingForm.shopifyProductId} onChange={(e) => setMappingForm((p) => ({ ...p, shopifyProductId: e.target.value }))} />
              <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Variant ID" value={mappingForm.shopifyVariantId} onChange={(e) => setMappingForm((p) => ({ ...p, shopifyVariantId: e.target.value }))} />
              <select className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={mappingForm.hsnId} onChange={(e) => setMappingForm((p) => ({ ...p, hsnId: e.target.value }))}><option value="">HSN</option>{hsnRows.map((h) => <option key={String(h.id)} value={String(h.id)}>{String(h.hsnCode)}</option>)}</select>
              <select className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={mappingForm.slabId} onChange={(e) => setMappingForm((p) => ({ ...p, slabId: e.target.value }))}><option value="">Slab</option>{slabRows.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.slabCode)}</option>)}</select>
              <button className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white w-fit">Save Mapping</button>
            </form>
            <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Variant</th><th className="px-3 py-2">HSN</th><th className="px-3 py-2">Slab</th></tr></thead><tbody>{mappingRows.map((row) => <tr key={String(row.id)} className="border-t border-gray-100"><td className="px-3 py-2">{String((row.metadata as { sku?: string })?.sku || '-')}</td><td className="px-3 py-2">{String(row.shopifyProductId || '')}</td><td className="px-3 py-2">{String(row.shopifyVariantId || '')}</td><td className="px-3 py-2">{String(row.hsnId || '')}</td><td className="px-3 py-2">{String(row.slabId || '')}</td></tr>)}</tbody></table></div>
          </div>
        )}

        {activeTab === 'Unmapped SKUs' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <h2 className="text-base font-semibold text-gray-900">Bulk SKU HSN Mapping</h2>
              <div className="flex flex-wrap gap-2">
                <a className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" href="/api/gst/products/unmapped-skus/export">Export Unmapped SKUs CSV</a>
                <button className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" onClick={() => void onRecomputeReadiness()}>Recompute Readiness</button>
              </div>
              <textarea className="h-32 w-full rounded-xl border border-gray-300 px-3 py-2.5 font-mono text-xs" placeholder="sku,styleCode,hsnCode,taxRate,cessRate" value={bulkCsvText} onChange={(e) => setBulkCsvText(e.target.value)} />
              <button className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white" onClick={() => void onImportSkuMappingsCsv()}>Upload Completed Mapping CSV</button>
              {importSummary && (
                <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                  <div><span className="font-medium">Imported:</span> {importSummary.imported}</div>
                  <div><span className="font-medium">Skipped:</span> {importSummary.skipped}</div>
                  <div><span className="font-medium">Errors:</span> {importSummary.errors.length}</div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between"><h2 className="text-base font-semibold text-gray-900">Unmapped SKUs</h2><a className="rounded-xl border border-gray-300 px-3 py-2 text-sm" href="/api/gst/products/unmapped/export">Legacy Export CSV</a></div>
            <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Product Title</th><th className="px-3 py-2">Product ID</th><th className="px-3 py-2">Variant ID</th></tr></thead><tbody>{unmappedRows.map((row, idx) => <tr key={`${String(row.sku || '')}-${idx}`} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{String(row.sku || '')}</td><td className="px-3 py-2">{String(row.title || '')}</td><td className="px-3 py-2">{String(row.shopifyProductId || '')}</td><td className="px-3 py-2">{String(row.shopifyVariantId || '')}</td></tr>)}</tbody></table></div>
          </div>
        )}

        {activeTab === 'Bulk Assignment' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Bulk Assignment (SKU + HSN)</h2>
            <p className="text-sm text-gray-500">Paste CSV lines in format: <span className="font-mono">SKU,HSN_CODE</span></p>
            <textarea className="h-40 w-full rounded-xl border border-gray-300 px-3 py-2.5 font-mono text-xs" value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
            <div className="flex gap-2"><button className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm" onClick={() => void onPreviewBulk()}>Preview</button><button className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white" onClick={() => void onApplyBulk()}>Apply</button></div>
          </div>
        )}
      </div>

      <GstResponseViewer title="Products API Response" data={result} error={error} />
    </div>
  )
}
