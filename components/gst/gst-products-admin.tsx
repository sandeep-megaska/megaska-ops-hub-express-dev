'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { importSkuMappingsCsv, listSkuTaxMappings, upsertSkuTaxMapping } from '../../lib/gst-client'

type Row = Record<string, unknown>

type MappingDraft = {
  hsnCode: string
  taxRate: string
  cessRate: string
}

const emptyForm = {
  sku: '',
  hsnCode: '',
  taxRate: '5',
  cessRate: '0',
  priceCapThreshold: '',
  taxRateAbove: '',
  cessRateAbove: '0',
}

function formatSlab(row: Row): string {
  const threshold = row.priceCapThreshold
  if (threshold == null || threshold === '') return 'Flat'
  const above = row.taxRateAbove == null ? '' : String(row.taxRateAbove)
  const aboveCess = Number(row.cessRateAbove || 0)
  const cessSuffix = aboveCess > 0 ? ` + ${aboveCess}% cess` : ''
  return `> ₹${String(threshold)} → ${above}%${cessSuffix}`
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
  const [mappingForm, setMappingForm] = useState(emptyForm)
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
      priceCapThreshold: mappingForm.priceCapThreshold === '' ? null : Number(mappingForm.priceCapThreshold),
      taxRateAbove: mappingForm.taxRateAbove === '' ? null : Number(mappingForm.taxRateAbove),
      cessRateAbove: mappingForm.cessRateAbove === '' ? 0 : Number(mappingForm.cessRateAbove),
      source: 'MANUAL_UI',
    })

    if (!res.ok) {
      setError(res.error)
    } else {
      setResult(res.data)
      setMappingForm(emptyForm)
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

    const csvText = ['sku,hsnCode,taxRate,cessRate,priceCapThreshold,taxRateAbove,cessRateAbove', ...rowsToImport].join('\n')
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
    <div className="mk-page">
      {error ? <div className="mk-alert mk-alert-error">{error}</div> : null}

      <div className="mk-card space-y-4">
        <div>
          <h2 className="mk-section-title">SKU Tax Mapping (Source of Truth)</h2>
          <p className="mk-section-subtitle">Use SKU as the operational key. styleCode is derived automatically. No productId/variantId in UI.</p>
        </div>
        <form onSubmit={onSaveSingle} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="mk-field">
              <label className="mk-label">SKU</label>
              <input className="mk-input" placeholder="SKU" value={mappingForm.sku} onChange={(e) => setMappingForm((p) => ({ ...p, sku: e.target.value }))} />
            </div>
            <div className="mk-field">
              <label className="mk-label">Style (derived)</label>
              <input className="mk-input" value={stylePreview ? `Style: ${stylePreview}` : 'Style: -'} readOnly disabled />
            </div>
            <div className="mk-field">
              <label className="mk-label">HSN Code</label>
              <input className="mk-input" placeholder="HSN Code" value={mappingForm.hsnCode} onChange={(e) => setMappingForm((p) => ({ ...p, hsnCode: e.target.value }))} />
            </div>
            <div className="mk-field">
              <label className="mk-label">Tax Rate (≤ cap)</label>
              <input type="number" className="mk-input" placeholder="Tax Rate (≤ cap)" value={mappingForm.taxRate} onChange={(e) => setMappingForm((p) => ({ ...p, taxRate: e.target.value }))} />
            </div>
            <div className="mk-field">
              <label className="mk-label">Cess Rate (≤ cap)</label>
              <input type="number" className="mk-input" placeholder="Cess Rate (≤ cap)" value={mappingForm.cessRate} onChange={(e) => setMappingForm((p) => ({ ...p, cessRate: e.target.value }))} />
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-[color:var(--line-strong)] bg-[color:var(--panel-2)] p-4">
            <p className="mb-3 mk-help">
              Optional price-cap slab — leave blank for a flat rate. When a threshold is set, a line priced
              <em> above</em> it (per unit) uses the rates below; at or below it, the base Tax/Cess above apply.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="mk-field">
                <label className="mk-label">Price cap (per unit ₹)</label>
                <input type="number" className="mk-input" placeholder="Price cap ≤ (per unit ₹)" value={mappingForm.priceCapThreshold} onChange={(e) => setMappingForm((p) => ({ ...p, priceCapThreshold: e.target.value }))} />
              </div>
              <div className="mk-field">
                <label className="mk-label">Tax Rate above cap</label>
                <input type="number" className="mk-input" placeholder="Tax Rate above cap" value={mappingForm.taxRateAbove} onChange={(e) => setMappingForm((p) => ({ ...p, taxRateAbove: e.target.value }))} />
              </div>
              <div className="mk-field">
                <label className="mk-label">Cess Rate above cap</label>
                <input type="number" className="mk-input" placeholder="Cess Rate above cap" value={mappingForm.cessRateAbove} onChange={(e) => setMappingForm((p) => ({ ...p, cessRateAbove: e.target.value }))} />
              </div>
            </div>
          </div>
          <button className="mk-btn mk-btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save Mapping'}</button>
        </form>
      </div>

      <div className="mk-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="mk-section-title">SKU Mapping Views</h2>
          <div className="mk-header-actions">
            <input className="mk-input" placeholder="Search SKU / style / HSN" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="mk-btn" onClick={() => void refreshMappings(activeView)}>Search</button>
          </div>
        </div>

        <div className="mk-header-actions">
          <button
            className={`mk-btn ${activeView === 'all' ? 'mk-btn-primary' : ''}`}
            onClick={() => {
              setActiveView('all')
              void refreshMappings('all')
            }}
          >
            All SKU Mappings
          </button>
          <button
            className={`mk-btn ${activeView === 'unmapped' ? 'mk-btn-primary' : ''}`}
            onClick={() => {
              setActiveView('unmapped')
              void refreshMappings('unmapped')
            }}
          >
            Missing GST Mappings ({unmappedRows.length})
          </button>
        </div>

        {activeView === 'all' ? (
          <div className="mk-table-wrap"><table className="mk-table"><thead><tr><th>SKU</th><th>Style</th><th>HSN</th><th>Tax</th><th>Cess</th><th>Price-cap slab</th><th>Source</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{String(row.sku || '')}</td><td>{String(row.styleCode || '')}</td><td>{String(row.hsnCode || '')}</td><td>{String(row.taxRate || '')}</td><td>{String(row.cessRate || '')}</td><td className="text-xs">{formatSlab(row)}</td><td>{String(row.source || '')}</td></tr>)}</tbody></table></div>
        ) : (
          <div className="mk-table-wrap">
            <table className="mk-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Style</th>
                  <th>Usage</th>
                  <th>Assign HSN</th>
                  <th>GST %</th>
                  <th>CESS %</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {unmappedRows.map((row, index) => {
                  const sku = String(row.sku || '').trim()
                  const draft = mappingDrafts[sku] || { hsnCode: '', taxRate: '5', cessRate: '0' }
                  return (
                    <tr key={sku || `${String(row.styleCode || '')}-${index}`}>
                      <td className="align-top">
                        <div className="font-medium">{sku || '-'}</div>
                        <div className="text-xs text-[color:var(--muted)]">{String(row.sampleTitle || '')}</div>
                      </td>
                      <td className="align-top">{String(row.styleCode || '')}</td>
                      <td className="align-top text-xs text-[color:var(--muted)]">
                        <div>Orders: {String(row.orderCount || 0)}</div>
                        <div>Lines: {String(row.lineCount || 0)}</div>
                      </td>
                      <td className="align-top">
                        <input
                          className="mk-input w-32"
                          placeholder="HSN"
                          value={draft.hsnCode}
                          onChange={(e) => setMappingDrafts((prev) => ({ ...prev, [sku]: { ...draft, hsnCode: e.target.value } }))}
                        />
                      </td>
                      <td className="align-top">
                        <input
                          type="number"
                          className="mk-input w-24"
                          placeholder="GST"
                          value={draft.taxRate}
                          onChange={(e) => setMappingDrafts((prev) => ({ ...prev, [sku]: { ...draft, taxRate: e.target.value } }))}
                        />
                      </td>
                      <td className="align-top">
                        <input
                          type="number"
                          className="mk-input w-24"
                          placeholder="CESS"
                          value={draft.cessRate}
                          onChange={(e) => setMappingDrafts((prev) => ({ ...prev, [sku]: { ...draft, cessRate: e.target.value } }))}
                        />
                      </td>
                      <td className="align-top">
                        <button className="mk-btn mk-btn-sm mk-btn-primary" disabled={loading || !sku} onClick={() => void onSaveUnmappedSku(sku)}>
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

      <div className="mk-card space-y-4">
        <div>
          <h2 className="mk-section-title">Bulk Paste</h2>
          <p className="mk-section-subtitle">
            Paste rows in: <code>sku,hsnCode,taxRate,cessRate,priceCapThreshold,taxRateAbove,cessRateAbove</code>. The last
            three are optional — omit them (or leave blank) for a flat rate.
          </p>
        </div>
        <textarea className="mk-textarea min-h-40" placeholder={'MWSW05-Black-S,61124990,5,0\nFOOTWEAR-01,64039990,5,0,2500,18,0'} value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
        <button className="mk-btn mk-btn-primary" onClick={() => void onBulkSave()} disabled={loading}>{loading ? 'Importing...' : 'Import Bulk Mappings'}</button>
      </div>
    </div>
  )
}
