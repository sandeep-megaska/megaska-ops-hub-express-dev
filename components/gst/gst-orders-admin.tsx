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

type ReportWarning = {
  code: string
  message: string
  documentId: string
  documentNumber: string
  lineNumber?: number
}

const dateToday = new Date().toISOString().slice(0, 10)
const dateThreeDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function pickDocumentId(value: unknown): string | null {
  const row = asObject(value)
  const direct = row.documentId || row.invoiceDocumentId || row.gstDocumentId
  if (direct) return String(direct)

  const document = asObject(row.document)
  if (document.id) return String(document.id)
  if (document.documentId) return String(document.documentId)

  const invoice = asObject(row.invoice)
  if (invoice.id) return String(invoice.id)
  if (invoice.documentId) return String(invoice.documentId)

  return null
}

function extractGeneratedDocumentId(data: unknown): string | null {
  const payload = asObject(data)
  const nestedPayload = asObject(payload.data)
  const candidates = [payload, nestedPayload]

  for (const candidate of candidates) {
    const direct = pickDocumentId(candidate)
    if (direct) return direct

    const results = Array.isArray(candidate.results) ? candidate.results : []
    for (const result of results) {
      const documentId = pickDocumentId(result)
      if (documentId) return documentId
    }
  }

  return null
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function GstOrdersAdmin() {
  const [from, setFrom] = useState(dateThreeDaysAgo)
  const [to, setTo] = useState(dateToday)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const printFrameRef = useRef<HTMLIFrameElement | null>(null)
  const [printHtml, setPrintHtml] = useState<string | null>(null)
  const [isB2cExporting, setIsB2cExporting] = useState(false)
  const [b2cExportError, setB2cExportError] = useState<string>()
  const [b2cWarnings, setB2cWarnings] = useState<ReportWarning[]>([])

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
    setGeneratingId(id)
    setError(undefined)

    const res = await generateBatchInvoices({ orderImportIds: [id] })

    if (!res.ok) {
      setError(res.error)
      setGeneratingId(null)
      return
    }

    setResult(res.data)

    const documentId = extractGeneratedDocumentId(res.data)
    if (documentId) {
      onDownloadPdf(documentId)
      setGeneratingId(null)
      void loadOrders()
      return
    }

    const refreshedRows = await loadOrders()
    const fallbackDocumentId = refreshedRows.find((row) => row.id === id)?.invoiceDocumentId || null
    if (fallbackDocumentId) {
      onDownloadPdf(fallbackDocumentId)
      setGeneratingId(null)
      return
    }

    setError('Invoice was not generated. Check the response for missing SKU mappings or validation errors.')
    setGeneratingId(null)
  }

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

  async function onDownloadPdf(invoiceDocumentId: string) {
    setLoading(true)
    setError(undefined)

    const response = await fetch(`/api/gst/invoices/${encodeURIComponent(invoiceDocumentId)}/pdf?format=html`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const html = await response.text().catch(() => '')
    if (!response.ok || !html) {
      setError('Unable to prepare invoice for PDF download')
      setLoading(false)
      return
    }

    const popup = window.open('', '_blank', 'noopener,noreferrer')
    if (!popup) {
      setError('Popup blocked. Please allow popups and try again.')
      setLoading(false)
      return
    }

    const printReadyHtml = `${html}
<script>(async()=>{const wait=(ms)=>new Promise(r=>setTimeout(r,ms));const imgs=[...document.images];await Promise.all(imgs.map((img)=>img.complete?Promise.resolve():new Promise((resolve)=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});})));await wait(120);window.print();})();</script>`
    popup.document.open()
    popup.document.write(printReadyHtml)
    popup.document.close()
    setLoading(false)
  }

  async function onGenerateB2cReport() {
    setIsB2cExporting(true)
    setB2cExportError(undefined)
    setB2cWarnings([])

    const filename = from && to ? `gst-b2c-sales-register-${from}-to-${to}.csv` : 'gst-b2c-sales-register.csv'
    try {
      const runRes = await fetch('/api/gst/reports/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reportType: 'B2C_SALES_REGISTER',
          format: 'CSV',
          periodStart: `${from}T00:00:00.000Z`,
          periodEnd: `${to}T23:59:59.999Z`,
        }),
      })
      const runPayload = (await runRes.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        run?: { id?: string; fileUrl?: string | null; warnings?: ReportWarning[] }
        reportType?: string
        headers?: string[]
        rowCount?: number
        csv?: string
        warnings?: ReportWarning[]
      }

      if (!runRes.ok || !runPayload.ok) {
        setB2cExportError(runPayload.error || 'Failed to generate B2C export')
        return
      }

      const runWarnings = runPayload.run?.warnings
      const warnings = Array.isArray(runWarnings)
        ? runWarnings
        : Array.isArray(runPayload.warnings)
          ? runPayload.warnings
          : []
      setB2cWarnings(warnings)

      if (typeof runPayload.csv === 'string' && runPayload.csv.length > 0) {
        downloadCsv(filename, runPayload.csv)
        setResult({
          reportType: 'B2C_SALES_REGISTER',
          run: runPayload.run,
          csv: runPayload.csv,
          headers: runPayload.headers,
          rowCount: runPayload.rowCount,
          warnings,
        })
        return
      }

      if (!runPayload.run) {
        setB2cExportError('Report generated, but no download reference was returned')
        return
      }

      if (runPayload.run.fileUrl) {
        const link = document.createElement('a')
        link.href = runPayload.run.fileUrl
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        setResult({ reportType: 'B2C_SALES_REGISTER', run: runPayload.run, warnings })
        return
      }

      if (!runPayload.run.id) {
        setB2cExportError('Report generated, but no download reference was returned')
        return
      }

      const fileRes = await fetch(`/api/gst/reports/runs/${encodeURIComponent(runPayload.run.id)}/download`, {
        credentials: 'include',
      })
      const filePayload = (await fileRes.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        fileUrl?: string
        csv?: string
        warnings?: ReportWarning[]
      }
      if (!fileRes.ok || !filePayload.ok) {
        setB2cExportError(filePayload.error || 'Failed to download B2C export')
        return
      }

      if (typeof filePayload.csv === 'string' && filePayload.csv.length > 0) {
        downloadCsv(filename, filePayload.csv)
      } else if (filePayload.fileUrl) {
        const link = document.createElement('a')
        link.href = filePayload.fileUrl
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
      } else {
        setB2cExportError('Report generated, but no downloadable file was returned')
        return
      }

      if (Array.isArray(filePayload.warnings) && filePayload.warnings.length > 0) {
        setB2cWarnings(filePayload.warnings)
      }

      setResult({ reportType: 'B2C_SALES_REGISTER', run: runPayload.run, file: filePayload, warnings })
    } catch (error) {
      setB2cExportError(error instanceof Error ? error.message : 'Failed to export B2C sales register')
    } finally {
      setIsB2cExporting(false)
    }
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
            <button type="button" className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm" onClick={() => void onGenerateB2cReport()} disabled={isB2cExporting}>
              {isB2cExporting ? 'Exporting B2C...' : 'B2C Export'}
            </button>
            <button type="button" className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm text-gray-500" disabled title="Coming soon">Credit Note Export</button>
            <button type="button" className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm text-gray-500" disabled title="Coming soon">Debit Note Export</button>
          </div>
          {b2cExportError ? <p className="pt-2 text-sm text-red-600">{b2cExportError}</p> : null}
          {b2cWarnings.length > 0 ? (
            <div className="pt-2 text-sm text-amber-700">
              <p className="font-medium">B2C export warnings ({b2cWarnings.length}):</p>
              <ul className="list-disc pl-5">
                {b2cWarnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.documentId}-${warning.lineNumber ?? 'na'}-${index}`}>
                    {warning.message} (Doc: {warning.documentNumber}{warning.lineNumber != null ? `, Line ${warning.lineNumber}` : ''})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onGenerate(id)} disabled={generatingId === id}>
                          {generatingId === id ? 'Generating...' : 'Generate Invoice'}
                        </button>
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
                <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" onClick={() => printFrameRef.current?.contentWindow?.print()}>
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
