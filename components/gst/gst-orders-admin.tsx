'use client'

import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  generateBatchInvoices,
  listDispatchReadyOrders,
  syncOrders,
} from '../../lib/gst-client'
import { adminAuthHeaders } from '../../lib/admin-fetch'

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
  taxReconciliation: TaxReconciliation | null
  lineItems: OrderLineRow[]
}

type TaxReconciliation = {
  invoiceTax: number
  shopifyTax: number
  matches: boolean
  basis?: 'CHECKOUT_TAX' | 'GRAND_TOTAL'
  invoiceTotal?: number
  orderTotal?: number
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

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function TaxCheckBadge({ recon }: { recon: TaxReconciliation | null }) {
  if (!recon) {
    return <span className="mk-badge mk-badge-neutral" title="Generate the invoice to reconcile against checkout tax">—</span>
  }
  const isInclusiveTotalBasis = recon.basis === 'GRAND_TOTAL'
  if (recon.matches) {
    const title = isInclusiveTotalBasis
      ? `Tax-inclusive order: GST ${formatInr(recon.invoiceTax)} is included in the price. Invoice total ${formatInr(
          recon.invoiceTotal ?? 0,
        )} matches the amount paid ${formatInr(recon.orderTotal ?? 0)}.`
      : `Invoice GST ${formatInr(recon.invoiceTax)} matches checkout tax ${formatInr(recon.shopifyTax)}`
    return (
      <span className="mk-badge mk-badge-success" title={title}>
        Matches
      </span>
    )
  }
  if (isInclusiveTotalBasis) {
    return (
      <span
        className="inline-flex flex-col items-start gap-1"
        title={`Tax-inclusive order: invoice total ${formatInr(recon.invoiceTotal ?? 0)} does not match the amount paid ${formatInr(
          recon.orderTotal ?? 0,
        )}. Check the order's pricing.`}
      >
        <span className="mk-badge mk-badge-danger">Mismatch</span>
        <span className="text-[11px] leading-tight text-[color:var(--danger-text)]">
          Inv {formatInr(recon.invoiceTotal ?? 0)} vs Paid {formatInr(recon.orderTotal ?? 0)}
        </span>
      </span>
    )
  }
  return (
    <span
      className="inline-flex flex-col items-start gap-1"
      title={`Invoice GST ${formatInr(recon.invoiceTax)} does not match the tax charged at checkout ${formatInr(
        recon.shopifyTax,
      )}. Check that this product's GST rate matches your Shopify tax settings.`}
    >
      <span className="mk-badge mk-badge-danger">Mismatch</span>
      <span className="text-[11px] leading-tight text-[color:var(--danger-text)]">
        Inv {formatInr(recon.invoiceTax)} vs Checkout {formatInr(recon.shopifyTax)}
      </span>
    </span>
  )
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
  const [forceResync, setForceResync] = useState(false)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [isB2cExporting, setIsB2cExporting] = useState(false)
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null)
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

      const recon = asObject(row.taxReconciliation)
      const taxReconciliation: TaxReconciliation | null =
        row.taxReconciliation && typeof recon.matches === 'boolean'
          ? {
              invoiceTax: Number(recon.invoiceTax || 0),
              shopifyTax: Number(recon.shopifyTax || 0),
              matches: Boolean(recon.matches),
              basis: recon.basis === 'GRAND_TOTAL' ? 'GRAND_TOTAL' : 'CHECKOUT_TAX',
              invoiceTotal: Number(recon.invoiceTotal || 0),
              orderTotal: Number(recon.orderTotal || 0),
            }
          : null

      return {
        id: String(row.id || ''),
        orderName: String(row.orderName || ''),
        orderDate: row.orderDate ? String(row.orderDate) : null,
        mappingCompleteness: Number(row.mappingCompleteness || 0),
        unmappedSkus: Array.isArray(row.unmappedSkus) ? row.unmappedSkus.map((sku) => String(sku)) : [],
        invoiceStatus: String(row.invoiceStatus || 'NOT_INVOICED'),
        invoiceDocumentId: row.invoiceDocumentId ? String(row.invoiceDocumentId) : null,
        taxReconciliation,
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

    const res = await syncOrders({ from, to, forceResync })
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

  async function onDownloadPdf(invoiceDocumentId: string) {
    if (downloadingPdfId) return
    setDownloadingPdfId(invoiceDocumentId)
    setLoading(true)
    setError(undefined)

    try {
      // format=chromium renders the invoice through headless Chromium's real layout
      // engine: portrait, multi-page (no dropped line items), matching the Print preview.
      // The route falls back to the hand-drawn PDF if Chromium is unavailable.
      const response = await fetch(`/api/gst/invoices/${encodeURIComponent(invoiceDocumentId)}/pdf?format=chromium`, {
        credentials: 'include',
        cache: 'no-store',
        headers: await adminAuthHeaders(),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({} as { error?: string }))
        setError(payload.error || 'Unable to generate invoice PDF. Please try again.')
        return
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.toLowerCase().includes('application/pdf')) {
        console.error('Unexpected GST invoice PDF response content-type', { invoiceDocumentId, contentType })
        setError('Unable to generate invoice PDF. Unexpected response from server.')
        return
      }

      const blob = await response.blob()
      if (!blob.size) {
        console.error('Generated GST invoice PDF was empty', { invoiceDocumentId })
        setError('Unable to generate invoice PDF. Empty document was returned.')
        return
      }

      const fileUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = fileUrl
      anchor.download = `gst-invoice-${invoiceDocumentId}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(fileUrl)
    } catch (downloadError) {
      console.error('GST invoice PDF download failed', { invoiceDocumentId, downloadError })
      setError('Unable to generate invoice PDF right now. Please retry in a moment.')
    } finally {
      setLoading(false)
      setDownloadingPdfId(null)
    }
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
        headers: await adminAuthHeaders(),
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
  const mismatchCount = useMemo(
    () => rows.filter((row) => row.taxReconciliation && !row.taxReconciliation.matches).length,
    [rows],
  )

  return (
    <div className="mk-page">
      {error ? <div className="mk-alert mk-alert-error">{error}</div> : null}

      <form onSubmit={onSync} className="mk-card space-y-4">
        <div>
          <h2 className="mk-section-title">Recent Shopify Orders</h2>
          <p className="mk-section-subtitle">Sync orders for a date range, then generate GST invoices below.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="mk-field">
            <label className="mk-label">From</label>
            <input type="date" className="mk-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="mk-field">
            <label className="mk-label">To</label>
            <input type="date" className="mk-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="mk-field">
            <label className="mk-label">&nbsp;</label>
            <button type="submit" className="mk-btn mk-btn-primary" disabled={loading}>{loading ? 'Syncing...' : 'Sync Orders'}</button>
          </div>
        </div>
        <label className="mk-check">
          <input type="checkbox" checked={forceResync} onChange={(e) => setForceResync(e.target.checked)} />
          Re-import already-synced orders (refresh HSN/tax mapping &amp; readiness)
        </label>
        <div className="mk-header-actions">
          <button type="button" className="mk-btn" onClick={() => void loadOrders()}>
            Refresh Order List
          </button>
          <button type="button" className="mk-btn" onClick={() => void onGenerateB2cReport()} disabled={isB2cExporting}>
            {isB2cExporting ? 'Exporting B2C...' : 'B2C Export'}
          </button>
        </div>
        {b2cExportError ? <div className="mk-alert mk-alert-error">{b2cExportError}</div> : null}
        {b2cWarnings.length > 0 ? (
          <div className="mk-alert mk-alert-info">
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

      <div className="mk-card space-y-4">
        <h2 className="mk-section-title">GST Orders</h2>
        {mismatchCount > 0 ? (
          <div className="mk-alert mk-alert-error">
            <span className="font-medium">
              {mismatchCount} order{mismatchCount === 1 ? '' : 's'} with a tax mismatch.
            </span>{' '}
            The invoice GST (from the app&apos;s HSN mapping) does not match the tax charged at checkout. Fix the
            product&apos;s GST rate or the Shopify tax setting so they agree — see the &ldquo;Tax check&rdquo; column.
          </div>
        ) : null}
        {hasOrders ? (
          <div className="mk-table-wrap">
            <table className="mk-table">
              <thead><tr><th>Order</th><th>Date</th><th>Mapping</th><th>Missing SKU</th><th>Invoice</th><th>Tax check</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const id = row.id
                  const unmappedSkus = row.unmappedSkus
                  const expanded = Boolean(expandedRows[id])
                  return (
                    <Fragment key={id}>
                    <tr className="align-top">
                      <td className="font-medium">
                        <button className="mk-btn mk-btn-sm mk-btn-ghost mr-2" onClick={() => setExpandedRows((prev) => ({ ...prev, [id]: !expanded }))}>
                          {expanded ? 'Hide' : 'Show'} lines
                        </button>
                        {row.orderName}
                      </td>
                      <td>{String(row.orderDate || '').slice(0, 10)}</td>
                      <td>{row.mappingCompleteness}%</td>
                      <td className="text-xs text-[color:var(--warning-text)]">{unmappedSkus.length > 0 ? unmappedSkus.join(', ') : 'None'}</td>
                      <td>{row.invoiceStatus}</td>
                      <td><TaxCheckBadge recon={row.taxReconciliation} /></td>
                      <td className="whitespace-nowrap">
                        <div className="mk-header-actions">
                          <button className="mk-btn mk-btn-sm mk-btn-primary" onClick={() => void onGenerate(id)} disabled={generatingId === id}>
                            {generatingId === id ? 'Generating...' : 'Generate Invoice'}
                          </button>
                          {row.invoiceDocumentId ? (
                            <button className="mk-btn mk-btn-sm" onClick={() => onDownloadPdf(row.invoiceDocumentId!)} disabled={Boolean(downloadingPdfId)}>
                              {downloadingPdfId === row.invoiceDocumentId ? 'Downloading PDF...' : 'Download PDF'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="mk-table-wrap">
                            <table className="mk-table">
                              <thead>
                                <tr>
                                  <th>SKU</th>
                                  <th className="text-right">Qty</th>
                                  <th className="text-right">Price</th>
                                  <th className="text-right">Gross</th>
                                  <th>Mapping</th>
                                  <th>HSN</th>
                                  <th className="text-right">GST %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.lineItems.map((line) => (
                                  <tr key={`${id}-${line.lineNumber}`}>
                                    <td>{line.sku || '-'}</td>
                                    <td className="text-right">{line.quantity.toFixed(3).replace(/\.?0+$/, '')}</td>
                                    <td className="text-right">{line.unitPrice.toFixed(2)}</td>
                                    <td className="text-right">{line.grossAmount.toFixed(2)}</td>
                                    <td>{line.mappingStatus}</td>
                                    <td>{line.hsnCode || '-'}</td>
                                    <td className="text-right">{line.taxRate == null ? '-' : line.taxRate.toFixed(2)}</td>
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
        ) : (
          <div className="mk-empty">
            <p className="mk-empty-title">No synced orders</p>
            <p>No synced orders found for this date range.</p>
          </div>
        )}
      </div>
    </div>
  )
}
