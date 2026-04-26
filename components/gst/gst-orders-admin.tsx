'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  generateBatchInvoices,
  getImportedOrderById,
  listDispatchReadyOrders,
  preparePrintBatch,
  syncOrders,
} from '../../lib/gst-client'
import { GstResponseViewer } from './gst-response-viewer'

type Row = Record<string, unknown>

const dateToday = new Date().toISOString().slice(0, 10)
const dateThirtyDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const syncInitial = {
  from: dateThirtyDaysAgo,
  to: dateToday,
  financialStatus: '',
  fulfillmentStatus: '',
  forceResync: false,
}

export function GstOrdersAdmin() {
  const [syncForm, setSyncForm] = useState(syncInitial)
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  async function runOrdersList() {
    setError(undefined)
    const res = await listDispatchReadyOrders({ from: syncForm.from || undefined, to: syncForm.to || undefined })
    if (!res.ok) {
      setError(res.error)
      return
    }

    const nextRows = ((res.data as { data?: Row[] })?.data || []) as Row[]
    setRows(nextRows)
  }

  useEffect(() => {
    void runOrdersList()
  }, [])

  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([id]) => id), [selected])
  const syncSummary = (result as { data?: { fetched?: number; imported?: number; alreadySynced?: number; notReady?: number; failed?: number } })?.data || {}

  async function onSyncOrders(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(undefined)

    const res = await syncOrders({
      from: syncForm.from,
      to: syncForm.to,
      financialStatus: syncForm.financialStatus
        ? syncForm.financialStatus
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : [],
      fulfillmentStatus: syncForm.fulfillmentStatus
        ? syncForm.fulfillmentStatus
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : [],
      forceResync: syncForm.forceResync,
    })

    if (!res.ok) {
      setError(res.error)
    } else {
      setResult(res.data)
      await runOrdersList()
    }

    setLoading(false)
  }

  async function onGenerateSingle(id: string) {
    setLoading(true)
    setError(undefined)
    const res = await generateBatchInvoices({ orderImportIds: [id] })
    if (!res.ok) setError(res.error)
    else {
      setResult(res.data)
      await runOrdersList()
    }
    setLoading(false)
  }

  async function onPrintOrDownload(id: string, mode: 'print' | 'download') {
    setLoading(true)
    setError(undefined)
    const res = await preparePrintBatch({ orderImportIds: [id] })
    if (!res.ok) {
      setError(res.error)
      setLoading(false)
      return
    }

    const manifest = (res.data as { data?: { manifest?: Array<{ pdfUrl?: string }> } })?.data?.manifest || []
    const pdfUrl = manifest[0]?.pdfUrl
    if (!pdfUrl) {
      setError('No PDF generated for this order yet. Generate invoice first.')
      setLoading(false)
      return
    }

    if (mode === 'print') {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer')
    } else {
      const anchor = document.createElement('a')
      anchor.href = pdfUrl
      anchor.download = ''
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
    }

    setResult(res.data)
    setLoading(false)
  }

  async function onGenerateBatch() {
    if (selectedIds.length === 0) {
      setError('Select at least one order to generate invoices')
      return
    }
    setLoading(true)
    setError(undefined)
    const res = await generateBatchInvoices({ orderImportIds: selectedIds })
    if (!res.ok) {
      setError(res.error)
    } else {
      setResult(res.data)
      await runOrdersList()
    }
    setLoading(false)
  }

  async function onViewDetails(id: string) {
    setLoading(true)
    const res = await getImportedOrderById(id)
    if (res.ok) setResult(res.data)
    else setError(res.error)
    setLoading(false)
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="space-y-5">
        <form onSubmit={onSyncOrders} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Recent Shopify Orders</h2>
          <p className="text-xs text-gray-600">
            Choose a date range to sync and review GST orders. Invoice generation is available per order row.
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            <input type="date" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={syncForm.from} onChange={(e) => setSyncForm((p) => ({ ...p, from: e.target.value }))} />
            <input type="date" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={syncForm.to} onChange={(e) => setSyncForm((p) => ({ ...p, to: e.target.value }))} />
            <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Financial statuses (comma)" value={syncForm.financialStatus} onChange={(e) => setSyncForm((p) => ({ ...p, financialStatus: e.target.value }))} />
            <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Fulfillment statuses (comma)" value={syncForm.fulfillmentStatus} onChange={(e) => setSyncForm((p) => ({ ...p, fulfillmentStatus: e.target.value }))} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={syncForm.forceResync} onChange={(e) => setSyncForm((p) => ({ ...p, forceResync: e.target.checked }))} /> Force resync</label>
            <button type="submit" className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white">{loading ? 'Syncing...' : 'Sync Orders'}</button>
            <button type="button" className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm" onClick={() => void runOrdersList()}>Apply Date Filter</button>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {[
              { label: 'Fetched', value: Number(syncSummary.fetched || 0) },
              { label: 'Imported', value: Number(syncSummary.imported || 0) },
              { label: 'Already Synced', value: Number(syncSummary.alreadySynced || 0) },
              { label: 'Not Ready', value: Number(syncSummary.notReady || 0) },
              { label: 'Failed', value: Number(syncSummary.failed || 0) },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">{card.label}</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{card.value}</div>
              </div>
            ))}
          </div>
        </form>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900">GST Orders</h2>
            <button type="button" disabled={selectedIds.length === 0} className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void onGenerateBatch()}>Generate GST Invoices (Selected)</button>
          </div>
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">GST is computed per line item using GstSkuTaxMap (sku/styleCode → hsnCode/taxRate/cessRate). Missing mappings appear as line-level warnings.</p>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">Select</th><th className="px-3 py-2">Order</th><th className="px-3 py-2">Order Date</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Line Mapping</th><th className="px-3 py-2">Warnings</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Actions</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const id = String(row.id || '')
                  const unmappedSkus = Array.isArray(row.unmappedSkus) ? row.unmappedSkus.map((entry) => String(entry)) : []
                  const warnings = Array.isArray(row.warnings) ? row.warnings.map((entry) => String(entry)) : []
                  return (
                    <tr key={id} className="border-t border-gray-100 align-top">
                      <td className="px-3 py-2"><input type="checkbox" checked={Boolean(selected[id])} onChange={(e) => setSelected((p) => ({ ...p, [id]: e.target.checked }))} /></td>
                      <td className="px-3 py-2 font-medium">{String(row.orderName || '')}</td>
                      <td className="px-3 py-2">{String(row.orderDate || '').slice(0, 10)}</td>
                      <td className="px-3 py-2">{String(row.customerSummary || '-')}</td>
                      <td className="px-3 py-2">
                        <div>{String(row.mappingCompleteness || 0)}% mapped</div>
                        <div className="text-xs text-gray-500">{String(row.skuCount || 0)} SKU / {String(row.itemCount || 0)} items</div>
                      </td>
                      <td className="px-3 py-2">
                        {unmappedSkus.length > 0 || warnings.length > 0 ? (
                          <div className="space-y-1 text-xs text-amber-700">
                            {warnings.map((warning) => <div key={`${id}-${warning}`}>{warning}</div>)}
                            {unmappedSkus.map((sku) => <div key={`${id}-${sku}`}>Missing mapping: {sku}</div>)}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">None</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{String(row.invoiceStatus || 'NOT_INVOICED')}</td>
                      <td className="space-x-2 whitespace-nowrap px-3 py-2">
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onGenerateSingle(id)}>Generate GST Invoice</button>
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onPrintOrDownload(id, 'print')}>Print Invoice</button>
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onPrintOrDownload(id, 'download')}>Download PDF</button>
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onViewDetails(id)}>Details</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <GstResponseViewer title="Orders Operations Response" data={result} error={error} />
    </div>
  )
}
