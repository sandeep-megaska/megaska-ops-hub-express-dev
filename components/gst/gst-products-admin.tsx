'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { importSkuMappingsCsv, listSkuTaxMappings, upsertSkuTaxMapping } from '../../lib/gst-client'
import { GstResponseViewer } from './gst-response-viewer'

type Row = Record<string, unknown>

function deriveStyleCode(sku: string): string {
  const normalized = String(sku || '').trim()
  if (!normalized) return ''
  const segments = normalized.split(/[-_\/\s]+/).filter(Boolean)
  return String(segments[0] || normalized).toUpperCase()
}

export function GstProductsAdmin() {
  const [rows, setRows] = useState<Row[]>([])
  const [mappingForm, setMappingForm] = useState({ sku: '', hsnCode: '', taxRate: '5', cessRate: '0' })
  const [bulkText, setBulkText] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()

  async function refreshMappings() {
    const res = await listSkuTaxMappings({ search })
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRows(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => {
    void refreshMappings()
  }, [])

  const stylePreview = useMemo(() => deriveStyleCode(mappingForm.sku), [mappingForm.sku])

  async function onSaveSingle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(undefined)

    const res = await upsertSkuTaxMapping({
      sku: mappingForm.sku,
      hsnCode: mappingForm.hsnCode,
      taxRate: Number(mappingForm.taxRate),
      cessRate: Number(mappingForm.cessRate),
      source: 'MANUAL_UI',
    })

    if (!res.ok) {
      setError(res.error)
    } else {
      setResult(res.data)
      setMappingForm({ sku: '', hsnCode: '', taxRate: '5', cessRate: '0' })
      await refreshMappings()
    }

    setLoading(false)
  }

  async function onBulkSave() {
    setLoading(true)
    setError(undefined)

    const rowsToImport = bulkText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (rowsToImport.length === 0) {
      setError('Paste at least one CSV row in sku,hsnCode,taxRate,cessRate format')
      setLoading(false)
      return
    }

    const csvText = ['sku,hsnCode,taxRate,cessRate', ...rowsToImport].join('\n')
    const res = await importSkuMappingsCsv({ csvText })

    if (!res.ok) {
      setError(res.error)
    } else {
      setResult(res.data)
      await refreshMappings()
    }

    setLoading(false)
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="space-y-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-base font-semibold text-gray-900">SKU Tax Mapping (Source of Truth)</h2>
          <p className="text-xs text-gray-600">Use SKU as the operational key. styleCode is derived automatically. No productId/variantId in UI.</p>
          <form onSubmit={onSaveSingle} className="grid gap-3 md:grid-cols-5">
            <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="SKU" value={mappingForm.sku} onChange={(e) => setMappingForm((p) => ({ ...p, sku: e.target.value }))} />
            <input className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500" value={stylePreview ? `Style: ${stylePreview}` : 'Style: -'} readOnly />
            <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="HSN Code" value={mappingForm.hsnCode} onChange={(e) => setMappingForm((p) => ({ ...p, hsnCode: e.target.value }))} />
            <input type="number" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Tax Rate" value={mappingForm.taxRate} onChange={(e) => setMappingForm((p) => ({ ...p, taxRate: e.target.value }))} />
            <input type="number" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Cess Rate" value={mappingForm.cessRate} onChange={(e) => setMappingForm((p) => ({ ...p, cessRate: e.target.value }))} />
            <button className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white w-fit" disabled={loading}>{loading ? 'Saving...' : 'Save Mapping'}</button>
          </form>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">Current SKU Mappings</h2>
            <div className="flex gap-2">
              <input className="rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder="Search SKU / style / HSN" value={search} onChange={(e) => setSearch(e.target.value)} />
              <button className="rounded-xl border border-gray-300 px-3 py-2 text-sm" onClick={() => void refreshMappings()}>Search</button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Style</th><th className="px-3 py-2">HSN</th><th className="px-3 py-2">Tax</th><th className="px-3 py-2">Cess</th><th className="px-3 py-2">Source</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)} className="border-t border-gray-100"><td className="px-3 py-2">{String(row.sku || '')}</td><td className="px-3 py-2">{String(row.styleCode || '')}</td><td className="px-3 py-2">{String(row.hsnCode || '')}</td><td className="px-3 py-2">{String(row.taxRate || '')}</td><td className="px-3 py-2">{String(row.cessRate || '')}</td><td className="px-3 py-2">{String(row.source || '')}</td></tr>)}</tbody></table></div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Bulk Paste</h2>
          <p className="text-xs text-gray-600">Paste rows in: <code>sku,hsnCode,taxRate,cessRate</code></p>
          <textarea className="min-h-40 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="MWSW05-Black-S,61124990,5,0" value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
          <button className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white" onClick={() => void onBulkSave()} disabled={loading}>{loading ? 'Importing...' : 'Import Bulk Mappings'}</button>
        </div>
      </div>

      <GstResponseViewer title="Products API Response" data={result} error={error} />
    </div>
  )
}
