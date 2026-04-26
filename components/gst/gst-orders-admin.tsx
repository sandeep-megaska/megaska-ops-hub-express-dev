'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  generateBatchInvoices,
  getImportedOrderById,
  importOrder,
  listImportedOrders,
  preparePrintBatch,
  syncOrders,
  syncSingleOrder,
} from '../../lib/gst-client'
import { GstResponseViewer } from './gst-response-viewer'

type Row = Record<string, unknown>

const syncInitial = {
  from: '',
  to: '',
  financialStatus: '',
  fulfillmentStatus: '',
  forceResync: false,
}

const debugPayloadSample = JSON.stringify({ shopifyOrderName: '#1001', lines: [] }, null, 2)

export function GstOrdersAdmin() {
  const [syncForm, setSyncForm] = useState(syncInitial)
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [singleOrderName, setSingleOrderName] = useState('')
  const [shopifyOrderId, setShopifyOrderId] = useState('')
  const [debugPayload, setDebugPayload] = useState(debugPayloadSample)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  async function runOrdersList() {
    setError(undefined)
    const importedRes = await listImportedOrders({
      from: syncForm.from || undefined,
      to: syncForm.to || undefined,
    })
    if (!importedRes.ok) {
      setError(importedRes.error)
      return
    }
    const importedRows = ((importedRes.data as { data?: Row[] })?.data || []) as Row[]
    setRows(
      importedRows.map((row) => {
        const snapshot = (row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {}) as Record<string, unknown>
        const readinessErrors = Array.isArray(row.readinessErrors) ? row.readinessErrors : []
        const importStatus = String(row.importStatus || '')
        const eligibilityStatus = String(row.eligibilityStatus || '')
        const itemSummary = String(row.itemSummary || '').trim()
        return {
          ...row,
          id: String(row.id || ''),
          orderName: String(row.shopifyOrderName || ''),
          orderDate: row.orderCreatedAt || null,
          customerSummary: String(row.customerName || snapshot.customerName || '-') || '-',
          itemsSummary: itemSummary || '-',
          skuCount: Number(row.skuCount || 0),
          itemCount: Number(row.itemCount || 0),
          readinessErrors,
          readiness: `${importStatus}${eligibilityStatus ? ` / ${eligibilityStatus}` : ''}`,
          invoiceStatus: importStatus === 'INVOICED' ? 'INVOICED' : 'NOT_GENERATED',
        }
      }),
    )
  }

  useEffect(() => {
    void runOrdersList()
  }, [])

  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([id]) => id), [selected])
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(String(row.id || ''))),
    [rows, selectedIds],
  )
  const hasNotReadySelection = useMemo(
    () =>
      selectedRows.some((row) => {
        const importStatus = String(row.importStatus || '')
        const readinessErrors = Array.isArray(row.readinessErrors) ? row.readinessErrors : []
        return importStatus !== 'INVOICE_READY' || readinessErrors.length > 0
      }),
    [selectedRows],
  )

  const syncSummary = (result as { data?: { fetched?: number; imported?: number; alreadySynced?: number; notReady?: number; failed?: number } })?.data || {}

  async function onSyncOrders(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!syncForm.from || !syncForm.to) {
      setError('Select from and to dates to sync orders')
      return
    }

    setLoading(true)
    setError(undefined)

    const res = await syncOrders({
      from: syncForm.from,
      to: syncForm.to,
      financialStatus: syncForm.financialStatus ? syncForm.financialStatus.split(',').map((v) => v.trim()).filter(Boolean) : [],
      fulfillmentStatus: syncForm.fulfillmentStatus ? syncForm.fulfillmentStatus.split(',').map((v) => v.trim()).filter(Boolean) : [],
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

  async function onSyncSingle() {
    if (!singleOrderName.trim()) {
      setError('Enter an order number/name for single-order sync')
      return
    }

    setLoading(true)
    setError(undefined)
    const res = await syncSingleOrder({ orderName: singleOrderName })
    if (!res.ok) {
      setError(res.error)
    } else {
      setResult(res.data)
      await runOrdersList()
    }
    setLoading(false)
  }

  async function onGenerateBatch() {
    if (selectedIds.length === 0) {
      setError('Select at least one order to generate invoices')
      return
    }
    if (hasNotReadySelection) {
      setError('One or more selected orders are not READY. Resolve readiness errors before generating invoices.')
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

  async function onPreparePrint() {
    if (selectedIds.length === 0) {
      setError('Select at least one order to prepare print batch')
      return
    }

    setLoading(true)
    setError(undefined)
    const res = await preparePrintBatch({ orderImportIds: selectedIds })
    if (!res.ok) {
      setError(res.error)
    } else {
      setResult(res.data)
    }
    setLoading(false)
  }

  async function onImportDebug(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(debugPayload)
    } catch {
      setError('Debug payload must be valid JSON')
      return
    }

    setLoading(true)
    const res = await importOrder({ shopifyOrderId, order: parsed })
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
        <form onSubmit={onSyncOrders} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Sync Orders</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <input type="date" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={syncForm.from} onChange={(e) => setSyncForm((p) => ({ ...p, from: e.target.value }))} />
            <input type="date" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={syncForm.to} onChange={(e) => setSyncForm((p) => ({ ...p, to: e.target.value }))} />
            <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Financial statuses (comma)" value={syncForm.financialStatus} onChange={(e) => setSyncForm((p) => ({ ...p, financialStatus: e.target.value }))} />
            <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Fulfillment statuses (comma)" value={syncForm.fulfillmentStatus} onChange={(e) => setSyncForm((p) => ({ ...p, fulfillmentStatus: e.target.value }))} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={syncForm.forceResync} onChange={(e) => setSyncForm((p) => ({ ...p, forceResync: e.target.checked }))} /> Force resync</label>
            <button type="submit" className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white">{loading ? 'Syncing...' : 'Sync Orders'}</button>
            <button type="button" className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm" onClick={() => void runOrdersList()}>Refresh Table</button>
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
                <div className="text-xs text-gray-500 uppercase tracking-wide">{card.label}</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{card.value}</div>
              </div>
            ))}
          </div>
        </form>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap gap-2 items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Synced GST Orders</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={selectedIds.length === 0 || hasNotReadySelection} className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void onGenerateBatch()}>Generate Invoice</button>
              <button type="button" className="rounded-xl border border-gray-300 px-4 py-2 text-sm" onClick={() => void onPreparePrint()}>Print / PDF</button>
              <button type="button" className="rounded-xl border border-gray-300 px-4 py-2 text-sm" onClick={() => { setResult(undefined); setError(undefined) }}>Clear Responses</button>
            </div>
          </div>
          <p className="mb-3 text-xs text-gray-600">Showing imported Shopify GST orders</p>
          {hasNotReadySelection ? <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Generate Invoices is disabled because one or more selected orders are not READY.</p> : null}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">Select</th><th className="px-3 py-2">Order</th><th className="px-3 py-2">Order Date</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Items/SKUs</th><th className="px-3 py-2">Mapping %</th><th className="px-3 py-2">Eligibility</th><th className="px-3 py-2">Readiness errors</th><th className="px-3 py-2">Unmapped SKUs</th><th className="px-3 py-2">Invoice status</th><th className="px-3 py-2">Action</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const id = String(row.id || '')
                  const readinessErrors = Array.isArray(row.readinessErrors) ? row.readinessErrors.map((entry) => String(entry)) : []
                  const unmappedSkus = Array.isArray(row.unmappedSkus) ? row.unmappedSkus.map((entry) => String(entry)) : []
                  const mappingActionUrl = String(row.mappingActionUrl || '/admin/gst/products')
                  return (
                    <tr key={id} className="border-t border-gray-100 align-top">
                      <td className="px-3 py-2"><input type="checkbox" checked={Boolean(selected[id])} onChange={(e) => setSelected((p) => ({ ...p, [id]: e.target.checked }))} /></td>
                      <td className="px-3 py-2 font-medium">{String(row.orderName || '')}</td>
                      <td className="px-3 py-2">{String(row.orderDate || '').slice(0, 10)}</td>
                      <td className="px-3 py-2">{String(row.customerSummary || '-')}</td>
                      <td className="px-3 py-2">
                        <div>{String(row.itemsSummary || '-')}</div>
                        <div className="text-xs text-gray-500">{String(row.skuCount || 0)} SKU / {String(row.itemCount || 0)} item</div>
                      </td>
                      <td className="px-3 py-2 font-medium">{String(row.mappingCompleteness || 0)}%</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{String(row.readiness || '')}</div>
                        <div className="text-xs text-gray-500">{String(row.eligibilityStatus || '')}</div>
                      </td>
                      <td className="px-3 py-2">
                        {readinessErrors.length > 0 ? (
                          <ul className="list-disc pl-4 text-xs text-amber-700 space-y-1">
                            {readinessErrors.map((reason) => <li key={`${id}-${reason}`}>{reason}</li>)}
                          </ul>
                        ) : (
                          <span className="text-xs text-gray-500">None</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {unmappedSkus.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-1">
                              {unmappedSkus.map((sku) => <span key={`${id}-${sku}`} className="rounded bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{sku}</span>)}
                            </div>
                            <a className="text-xs text-blue-700 underline" href={mappingActionUrl}>Open unmapped SKU workflow</a>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">None</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{String(row.invoiceStatus || '')}</td>
                      <td className="px-3 py-2"><button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onViewDetails(id)}>Details</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Single Order Sync (Friendly)</h2>
          <div className="flex gap-2">
            <input className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Order name/number (ex: #1001)" value={singleOrderName} onChange={(e) => setSingleOrderName(e.target.value)} />
            <button type="button" className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm" onClick={() => void onSyncSingle()}>Sync Single</button>
          </div>
        </div>

        <details className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">Advanced / Debug Import</summary>
          <form onSubmit={onImportDebug} className="mt-4 space-y-3">
            <input className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="shopifyOrderId" value={shopifyOrderId} onChange={(e) => setShopifyOrderId(e.target.value)} />
            <textarea className="h-40 w-full rounded-xl border border-gray-300 px-3 py-2.5 font-mono text-xs" value={debugPayload} onChange={(e) => setDebugPayload(e.target.value)} />
            <button type="submit" className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm">Run Low-level Import</button>
          </form>
        </details>
      </div>

      <GstResponseViewer title="Orders Operations Response" data={result} error={error} />
    </div>
  )
}
