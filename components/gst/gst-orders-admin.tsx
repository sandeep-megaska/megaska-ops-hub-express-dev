'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { generateBatchInvoices, listDispatchReadyOrders, preparePrintBatch, syncOrders } from '../../lib/gst-client'
import { GstResponseViewer } from './gst-response-viewer'

type Row = Record<string, unknown>

const dateToday = new Date().toISOString().slice(0, 10)
const dateThirtyDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

export function GstOrdersAdmin() {
  const [from, setFrom] = useState(dateThirtyDaysAgo)
  const [to, setTo] = useState(dateToday)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()

  async function loadOrders() {
    const res = await listDispatchReadyOrders({ from, to })
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRows(Array.isArray(res.data) ? res.data : [])
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
    } else {
      setResult(res.data)
      await loadOrders()
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

    const manifest = (res.data as { manifest?: Array<{ pdfUrl?: string }> })?.manifest || []
    const pdfUrl = manifest[0]?.pdfUrl
    if (!pdfUrl) {
      setError('No PDF generated yet for this order. Generate invoice first.')
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
        </form>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-gray-900">GST Orders</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Mapping</th><th className="px-3 py-2">Missing SKU</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Actions</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const id = String(row.id || '')
                  const unmappedSkus = Array.isArray(row.unmappedSkus) ? row.unmappedSkus.map((sku) => String(sku)) : []
                  return (
                    <tr key={id} className="border-t border-gray-100 align-top">
                      <td className="px-3 py-2 font-medium">{String(row.orderName || '')}</td>
                      <td className="px-3 py-2">{String(row.orderDate || '').slice(0, 10)}</td>
                      <td className="px-3 py-2">{String(row.mappingCompleteness || 0)}%</td>
                      <td className="px-3 py-2 text-xs text-amber-700">{unmappedSkus.length > 0 ? unmappedSkus.join(', ') : 'None'}</td>
                      <td className="px-3 py-2">{String(row.invoiceStatus || 'NOT_INVOICED')}</td>
                      <td className="space-x-2 whitespace-nowrap px-3 py-2">
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onGenerate(id)}>Generate Invoice</button>
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onPrintOrDownload(id, 'print')}>Print</button>
                        <button className="rounded-lg border border-gray-300 px-3 py-1.5" onClick={() => void onPrintOrDownload(id, 'download')}>Download</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <GstResponseViewer title="Orders API Response" data={result} error={error} />
    </div>
  )
}
