'use client'

import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  generateBatchInvoices,
  listDispatchReadyOrders,
  syncOrders,
} from '../../lib/gst-client'
import { GstResponseViewer } from './gst-response-viewer'

type OrderLineRow = {
  lineNumber: number
  title: string
  sku: string
  quantity: number
  unitPrice: number
  grossAmount: number
  mappingStatus: string
  hsnCode: string | null
  taxRate: number | null
}

type OrderRow = {
  id: string
  orderName: string
  orderDate: string | null
  mappingCompleteness: number
  unmappedSkus: string[]
  invoiceStatus: string
  invoiceDocumentId: string | null
  lineItems: OrderLineRow[]
}

const dateToday = new Date().toISOString().slice(0, 10)
const dateThirtyDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function pickDocumentId(row: Record<string, unknown>): string | null {
  const direct = row.documentId || row.invoiceDocumentId || row.gstDocumentId
  if (direct) return String(direct)

  const document = asObject(row.document)
  if (document.id) return String(document.id)

  const invoice = asObject(row.invoice)
  if (invoice.id) return String(invoice.id)
  if (invoice.documentId) return String(invoice.documentId)

  return null
}

function extractGeneratedDocumentId(data: unknown, orderImportId: string): string | null {
  const payloads = [asObject(data), asObject(asObject(data).data)]

  for (const payload of payloads) {
    const direct = pickDocumentId(payload)
    if (direct) return direct

    const results = Array.isArray(payload.results) ? payload.results : []
    const exactMatch = results.find((item) => String(asObject(item).id || '') === orderImportId)
    const exactDocumentId = pickDocumentId(asObject(exactMatch))
    if (exactDocumentId) return exactDocumentId

    for (const item of results) {
      const documentId = pickDocumentId(asObject(item))
      if (documentId) return documentId
    }
  }

  return null
}

export function GstOrdersAdmin() {
  const [from, setFrom] = useState(dateThirtyDaysAgo)
  const [to, setTo] = useState(dateToday)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  async function loadOrders(): Promise<OrderRow[]> {
    const res = await listDispatchReadyOrders({ from, to })
    if (!res.ok) {
      setError(res.error)
      return []
    }
    const parsedRows = (Array.isArray(res.data) ? res.data : []).map((raw) => {
      const row = raw as Record<string, unknown>
      const lineItems = Array.isArray(row.lineItems)
        ? row.lineItems.map((line) => {
            const casted = line as Record<string, unknown>
            return {
              lineNumber: Number(casted.lineNumber || 0),
              title: String(casted.title || ''),
              sku: String(casted.sku || ''),
              quantity: Number(casted.quantity || 0),
              unitPrice: Number(casted.unitPrice || 0),
              grossAmount: Number(casted.grossAmount || 0),
              mappingStatus: String(casted.mappingStatus || 'UNMAPPED'),
              hsnCode: casted.hsnCode ? String(casted.hsnCode) : null,
              taxRate: casted.taxRate == null ? null : Number(casted.taxRate),
            } satisfies OrderLineRow
          })
        : []

      return {
        id: String(row.id || ''),
        orderName: String(row.orderName || ''),
        orderDate: row.orderDate ? String(row.orderDate) : null,
        mappingCompleteness: Number(row.mappingCompleteness || 0),
        unmappedSkus: Array.isArray(row.unmappedSkus) ? row.unmappedSkus.map((sku) => String(sku)) : [],
        invoiceStatus: String(row.invoiceStatus || 'NOT_INVOICED'),
        invoiceDocumentId: row.invoiceDocumentId ? String(row.invoiceDocumentId) : null,
        lineItems,
      } satisfies OrderRow
    })

    setRows(parsedRows)
    return parsedRows
  }

  useEffect(() => {
    void loadOrders()
  }, [])

  async function onSync(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(undefined)

    const res = await syncOrders({ from, to })
    if (!res.ok) {
      setError(res.error)
    } else {
      setResult(res.data)
      await loadOrders()
    }

    setLoading(false)
  }

  async function onGenerate(id: string) {
    setLoading(true)
    setError(undefined)

    const res = await generateBatchInvoices({ orderImportIds: [id] })
    if (!res.ok) {
      setError(res.error)
      setLoading(false)
      return
    }

    setResult(res.data)
    const refreshedRows = await loadOrders()

    const documentId =
      extractGeneratedDocumentId(res.data, id) ||
      refreshedRows.find((row) => row.id === id)?.invoiceDocumentId ||
      null

    if (!documentId) {
      setError('Invoice exists, but no PDF document id was found. Refresh the order list and use Download PDF.')
      setLoading(false)
      return
    }

    onDownloadPdf(documentId)
    setLoading(false)
  }

  const printFrameRef = useRef<HTMLIFrameElement | null>(null)
  const [printHtml, setPrintHtml] = useState<string | null>(null)

  async function onPrintInvoice(invoiceDocumentId: string) {
    setLoading(true)
    setError(undefined)

    const response = await fetch(`/api/gst/invoices/${encodeURIComponent(invoiceDocumentId)}/pdf?format=html`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const html = await response.text().catch(() => '')
    if (!response.ok || !html) {
      setError('Unable to render invoice preview')
      setLoading(false)
      return
    }

    setPrintHtml(html)
    setLoading(false)
  }

  function onDownloadPdf(invoiceDocumentId: string) {
    const link = document.createElement('a')
    link.href = `/api/gst/invoices/${encodeURIComponent(invoiceDocumentId)}/pdf`
    link.download = `gst-invoice-${invoiceDocumentId}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  async function onGenerateReport(reportType: 'b2c_sales_register' | 'credit_note_register' | 'debit_note_register') {
    setLoading(true)
    setError(undefined)

    const runRes = await fetch('/api/gst/reports/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        reportType,
        format: 'CSV',
        periodStart: `${from}T00:00:00.000Z`,
        periodEnd: `${to}T23:59:59.999Z`,
      }),
    })
    const runPayload = (await runRes.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      run?: { id?: string }
    }

    if (!runRes.ok || !runPayload.ok || !runPayload.run?.id) {
      setError(runPayload.error || 'Failed to generate report')
      setLoading(false)
      return
    }

    const fileRes = await fetch(`/api/gst/reports/runs/${encodeURIComponent(runPayload.run.id)}/download`, {
      credentials: 'include',
    })
    const filePayload = (await fileRes.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      fileUrl?: string
    }
    if (!fileRes.ok || !filePayload.ok || !filePayload.fileUrl) {
      setError(filePayload.error || 'Report generated, but no downloadable file was returned')
      setLoading(false)
      return
    }

    window.open(filePayload.fileUrl, '_blank', 'noopener,noreferrer')
    setResult({ reportType, run: runPayload.run, file: { fileUrl: filePayload.fileUrl } })
    setLoading(false)
  }

  const hasOrders = useMemo(() => rows.length > 0, [rows])

  return (
    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="space-y-5">
        <form onSubmit={onSync} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Recent Shopify Orders</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <input type="date" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
            <button type="submit" className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white" disabled={loading}>{loading ? 'Syncing...' : 'Sync Orders'}</button>
          </div>
          <button type="button" className="rounded-xl border border-gray-300 px-4 py-2 text-sm" onClick={() => void loadOrders()}>
            Refresh Order List
          </button>
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm" onClick={() => void onGenerateReport('b2c_sales_register')} disabled={loading}>B2C Export</button>
            <button type="button" className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm" onClick={() => void onGenerateReport('credit_note_register')} disabled={loading}>Credit Note Export</button>
            <button type="button" className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm" onClick={() => void onGenerateReport('debit_note_register')} disabled={loading}>Debit Note Export</button>
          </div>
        </form>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-gray-900">GST Orders</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Mapping</th><th className="px-3 py-2">Missing SKU</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Actions</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const id = row.id
                  const unmappedSkus = row.unmappedSkus
                  const expanded = Boolean(expandedRows[id])
                  return (
                    <Fragment key={id}>
                    <tr className="border-t border-gray-100 align-top">
                      <td className="px-3 py-2 font-medium">
                        <button className="mr-2 rounded border border-gray-300 px-2 py-0.5 text-xs" onClick={() => setExpandedRows((prev) => ({ ...prev, [id]: !expanded }))}>
                          {expanded ? 'Hide' : 'Show'} lines
                        </button>
                        {row.orderName}
                      </td>
                      <td className="px-3 py-2">{String(row.orderDate || '').slice(0, 10)}</td>
                      <td className="px-3 py-2">{row.mappingCompleteness}%</td>
                      <td className="px-3 py-2 text-xs text-amber-700">{unmappedSkus.length > 0 ? unmappedSkus.join(', ') : 'None'}</td>
                      <td className="px-3 py-2">{row.invoiceStatus}</td>
                      <td className="space-x-2 whitespace-nowrap px-3 py-2">
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onGenerate(id)} disabled={loading}>{loading ? 'Generating...' : 'Generate Invoice'}</button>
                        {row.invoiceDocumentId ? (
                          <>
                            <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onPrintInvoice(row.invoiceDocumentId!)}>Print Invoice</button>
                            <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => onDownloadPdf(row.invoiceDocumentId!)}>Download PDF</button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-t border-gray-100 bg-gray-50/50">
                        <td className="px-3 py-3" colSpan={6}>
                          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                            <table className="min-w-full text-xs">
                              <thead className="bg-gray-100 text-gray-600">
                                <tr>
                                  <th className="px-2 py-1.5 text-left">SKU</th>
                                  <th className="px-2 py-1.5 text-right">Qty</th>
                                  <th className="px-2 py-1.5 text-right">Price</th>
                                  <th className="px-2 py-1.5 text-right">Gross</th>
                                  <th className="px-2 py-1.5 text-left">Mapping</th>
                                  <th className="px-2 py-1.5 text-left">HSN</th>
                                  <th className="px-2 py-1.5 text-right">GST %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.lineItems.map((line) => (
                                  <tr key={`${id}-${line.lineNumber}`} className="border-t border-gray-100">
                                    <td className="px-2 py-1.5">{line.sku || '-'}</td>
                                    <td className="px-2 py-1.5 text-right">{line.quantity.toFixed(3).replace(/\.?0+$/, '')}</td>
                                    <td className="px-2 py-1.5 text-right">{line.unitPrice.toFixed(2)}</td>
                                    <td className="px-2 py-1.5 text-right">{line.grossAmount.toFixed(2)}</td>
                                    <td className="px-2 py-1.5">{line.mappingStatus}</td>
                                    <td className="px-2 py-1.5">{line.hsnCode || '-'}</td>
                                    <td className="px-2 py-1.5 text-right">{line.taxRate == null ? '-' : line.taxRate.toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!hasOrders ? <p className="mt-3 text-sm text-gray-500">No synced orders found for this date range.</p> : null}
        </div>
      </div>

      {printHtml ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[90vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Invoice Preview</h3>
              <div className="space-x-2">
                <button
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  onClick={() => printFrameRef.current?.contentWindow?.print()}
                >
                  Print
                </button>
                <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" onClick={() => setPrintHtml(null)}>
                  Close
                </button>
              </div>
            </div>
            <iframe ref={printFrameRef} title="GST Invoice" className="h-full w-full" srcDoc={printHtml} />
          </div>
        </div>
      ) : null}

      <GstResponseViewer title="Orders API Response" data={result} error={error} />
    </div>
  )
}
