'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { importSkuMappingsCsv, listSkuTaxMappings, upsertSkuTaxMapping } from '../../lib/gst-client'
import { GstResponseViewer } from './gst-response-viewer'

type Row = Record<string, unknown>

type MappingDraft = {
  hsnCode: string
  taxRate: string
  cessRate: string
}

function deriveStyleCode(sku: string): string {
  const normalized = String(sku || '').trim()
  if (!normalized) return ''
  const segments = normalized.split(/[-_\/\s]+/).filter(Boolean)
  return String(segments[0] || normalized).toUpperCase()
}

export function GstProductsAdmin() {
  const [rows, setRows] = useState<Row[]>([])
  const [unmappedRows, setUnmappedRows] = useState<Row[]>([])
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, MappingDraft>>({})
  const [mappingForm, setMappingForm] = useState({ sku: '', hsnCode: '', taxRate: '5', cessRate: '0' })
  const [bulkText, setBulkText] = useState('')
  const [search, setSearch] = useState('')
  const [activeView, setActiveView] = useState<'all' | 'unmapped'>('all')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()

  async function refreshMappings(view: 'all' | 'unmapped' = activeView) {
    const res = await listSkuTaxMappings({ search, view })
    if (!res.ok) {
      setError(res.error)
      return
    }

    const data = Array.isArray(res.data) ? res.data : []
    if (view === 'unmapped') {
      setUnmappedRows(data)
      setMappingDrafts((prev) => {
        const next = { ...prev }
        for (const row of data) {
          const sku = String(row.sku || '').trim()
          if (!sku || next[sku]) continue
          next[sku] = { hsnCode: '', taxRate: '5', cessRate: '0' }
        }
        return next
      })
      return
    }

    setRows(data)
  }

  useEffect(() => {
    void refreshMappings('all')
    void refreshMappings('unmapped')
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
      await refreshMappings('all')
      await refreshMappings('unmapped')
    }

    setLoading(false)
  }

  async function onSaveUnmappedSku(sku: string) {
    const draft = mappingDrafts[sku]
    if (!draft) return

    setLoading(true)
    setError(undefined)
    const res = await upsertSkuTaxMapping({
      sku,
      hsnCode: draft.hsnCode,
      taxRate: Number(draft.taxRate),
      cessRate: Number(draft.cessRate || '0'),
      source: 'MANUAL_UI',
    })

    if (!res.ok) {
      setError(res.error)
      setLoading(false)
      return
    }

    setResult(res.data)
    setMappingDrafts((prev) => ({
      ...prev,
      [sku]: { hsnCode: '', taxRate: '5', cessRate: '0' },
    }))
    await refreshMappings('all')
    await refreshMappings('unmapped')
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
      await refreshMappings('all')
      await refreshMappings('unmapped')
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
            <h2 className="text-base font-semibold text-gray-900">SKU Mapping Views</h2>
            <div className="flex gap-2">
              <input className="rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder="Search SKU / style / HSN" value={search} onChange={(e) => setSearch(e.target.value)} />
              <button className="rounded-xl border border-gray-300 px-3 py-2 text-sm" onClick={() => void refreshMappings(activeView)}>Search</button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className={`rounded-xl border px-3 py-2 text-sm ${activeView === 'all' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700'}`}
              onClick={() => {
                setActiveView('all')
                void refreshMappings('all')
              }}
            >
              All SKU Mappings
            </button>
            <button
              className={`rounded-xl border px-3 py-2 text-sm ${activeView === 'unmapped' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700'}`}
              onClick={() => {
                setActiveView('unmapped')
                void refreshMappings('unmapped')
              }}
            >
              Missing GST Mappings ({unmappedRows.length})
            </button>
          </div>

          {activeView === 'all' ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Style</th><th className="px-3 py-2">HSN</th><th className="px-3 py-2">Tax</th><th className="px-3 py-2">Cess</th><th className="px-3 py-2">Source</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)} className="border-t border-gray-100"><td className="px-3 py-2">{String(row.sku || '')}</td><td className="px-3 py-2">{String(row.styleCode || '')}</td><td className="px-3 py-2">{String(row.hsnCode || '')}</td><td className="px-3 py-2">{String(row.taxRate || '')}</td><td className="px-3 py-2">{String(row.cessRate || '')}</td><td className="px-3 py-2">{String(row.source || '')}</td></tr>)}</tbody></table></div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Style</th>
                    <th className="px-3 py-2">Usage</th>
                    <th className="px-3 py-2">Assign HSN</th>
                    <th className="px-3 py-2">GST %</th>
                    <th className="px-3 py-2">CESS %</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unmappedRows.map((row, index) => {
                    const sku = String(row.sku || '').trim()
                    const draft = mappingDrafts[sku] || { hsnCode: '', taxRate: '5', cessRate: '0' }
                    return (
                      <tr key={sku || `${String(row.styleCode || '')}-${index}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-gray-900">{sku || '-'}</div>
                          <div className="text-xs text-gray-500">{String(row.sampleTitle || '')}</div>
                        </td>
                        <td className="px-3 py-2 align-top">{String(row.styleCode || '')}</td>
                        <td className="px-3 py-2 align-top text-xs text-gray-600">
                          <div>Orders: {String(row.orderCount || 0)}</div>
                          <div>Lines: {String(row.lineCount || 0)}</div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            className="w-32 rounded-xl border border-gray-300 px-3 py-2 text-sm"
                            placeholder="HSN"
                            value={draft.hsnCode}
                            onChange={(e) => setMappingDrafts((prev) => ({ ...prev, [sku]: { ...draft, hsnCode: e.target.value } }))}
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="number"
                            className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-sm"
                            placeholder="GST"
                            value={draft.taxRate}
                            onChange={(e) => setMappingDrafts((prev) => ({ ...prev, [sku]: { ...draft, taxRate: e.target.value } }))}
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="number"
                            className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-sm"
                            placeholder="CESS"
                            value={draft.cessRate}
                            onChange={(e) => setMappingDrafts((prev) => ({ ...prev, [sku]: { ...draft, cessRate: e.target.value } }))}
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <button className="rounded-xl bg-gray-900 px-3 py-2 text-xs text-white" disabled={loading || !sku} onClick={() => void onSaveUnmappedSku(sku)}>
                            Save
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
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
