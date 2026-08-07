'use client'

// Full-page, in-app GST invoice view for a single order — the replacement for
// the sandboxed "GST Invoice" admin *action* popup. Shopify's admin *link*
// extension (target admin.order-details.action.link) navigates here from the
// order page's More actions menu and appends the order id as a query param.
//
// Because the invoice is pre-generated when the order is created (orders/create
// webhook -> autoGenerateInvoiceForOrder), this page normally just *finds* the
// ready invoice and shows Download + Send-email immediately — no generation
// wait, and none of the sandboxed-iframe round-trips that made the popup slow.
// Auth is the same App Bridge session-token path every other in-app GST page
// uses (adminAuthHeaders()).

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { adminAuthHeaders } from '../../lib/admin-fetch'

interface OrderInvoiceStatus {
  orderName?: string | null
  invoiceId?: string | null
  documentNumber?: string | null
  status?: string | null
  customerEmail?: string | null
  readinessErrors?: string[]
  error?: string | null
}

// Shopify admin links append the launching resource id; be liberal about the
// exact param name and accept either a numeric id or a full gid. The backend
// (by-shopify-id) extracts the numeric id from either form.
function resolveOrderIdFromParams(params: URLSearchParams | null): string {
  if (!params) return ''
  for (const key of ['id', 'orderId', 'order_id', 'resourceId', 'objectId', 'object_id']) {
    const value = String(params.get(key) || '').trim()
    if (value) return value
  }
  return ''
}

export function GstOrderInvoice() {
  const searchParams = useSearchParams()
  const orderId = resolveOrderIdFromParams(searchParams)

  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentNotice, setSentNotice] = useState<string | null>(null)
  const [status, setStatus] = useState<OrderInvoiceStatus | null>(null)
  const [email, setEmail] = useState('')

  const fetchStatus = useCallback(
    async (generate: boolean) => {
      if (!orderId) {
        setError('No order was provided. Open this page from an order via More actions → GST Invoice.')
        setLoading(false)
        return
      }
      setError(null)
      try {
        const res = await fetch('/api/gst/orders/by-shopify-id', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(await adminAuthHeaders()) },
          body: JSON.stringify({ shopifyOrderGid: orderId, generate }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || 'Unable to load GST invoice status')
        }
        const data = json.data as OrderInvoiceStatus
        setStatus(data)
        if (data.error) setError(data.error)
        setEmail((current) => current || String(data.customerEmail || ''))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
        setWorking(false)
      }
    },
    [orderId],
  )

  useEffect(() => {
    void fetchStatus(false)
  }, [fetchStatus])

  async function onGenerate() {
    setWorking(true)
    setSentNotice(null)
    await fetchStatus(true)
  }

  async function onDownloadPdf() {
    const invoiceId = status?.invoiceId
    if (!invoiceId || downloading) return
    setDownloading(true)
    setError(null)
    try {
      const response = await fetch(`/api/gst/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
        credentials: 'include',
        headers: await adminAuthHeaders(),
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok || !contentType.toLowerCase().includes('application/pdf')) {
        const json = await response.json().catch(() => null)
        throw new Error(json?.error || 'Unable to download the invoice PDF')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${status?.documentNumber || `gst-invoice-${invoiceId}`}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, '-')
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  async function onSendEmail() {
    const invoiceId = status?.invoiceId
    const recipient = email.trim()
    if (!invoiceId || !recipient || sending) return
    setSending(true)
    setError(null)
    setSentNotice(null)
    try {
      const res = await fetch(`/api/gst/invoices/${encodeURIComponent(invoiceId)}/send-email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(await adminAuthHeaders()) },
        body: JSON.stringify({ to: recipient }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to send invoice email')
      }
      setSentNotice(`Invoice emailed to ${json.data?.to || recipient}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const hasInvoice = Boolean(status?.invoiceId)
  const readinessErrors = Array.isArray(status?.readinessErrors)
    ? status!.readinessErrors!.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  return (
    <div className="mk-card" style={{ maxWidth: 640 }}>
      {status?.orderName ? (
        <p className="mk-section-subtitle">Order {status.orderName}</p>
      ) : null}

      {loading ? (
        <p>Loading GST invoice status…</p>
      ) : (
        <>
          <p className="mk-section-title" style={{ marginTop: 4 }}>
            {hasInvoice
              ? `GST invoice ${status?.documentNumber || ''} is ready.`
              : 'No GST invoice has been generated for this order yet.'}
          </p>

          {readinessErrors.length > 0 ? (
            <div className="mk-alert mk-alert-error" style={{ marginTop: 12 }}>
              <strong>
                This order has {readinessErrors.length} unresolved GST issue(s). Generation may fail until they are
                fixed in the GST app.
              </strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {readinessErrors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="mk-alert mk-alert-error" style={{ marginTop: 12 }}>
              {error}
            </div>
          ) : null}

          {sentNotice ? (
            <div className="mk-alert mk-alert-info" style={{ marginTop: 12 }}>
              {sentNotice}
            </div>
          ) : null}

          {hasInvoice ? (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <button className="mk-btn mk-btn-primary" onClick={onDownloadPdf} disabled={downloading}>
                  {downloading ? 'Downloading PDF…' : 'Download PDF'}
                </button>
              </div>

              <div className="mk-field">
                <label className="mk-label" htmlFor="gst-invoice-email">
                  Send invoice to
                </label>
                <input
                  id="gst-invoice-email"
                  className="mk-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="customer@example.com"
                />
                <div style={{ marginTop: 8 }}>
                  <button className="mk-btn" onClick={onSendEmail} disabled={sending || !email.trim()}>
                    {sending ? 'Sending…' : 'Send invoice email'}
                  </button>
                </div>
              </div>

              <div>
                <button className="mk-btn mk-btn-ghost mk-btn-sm" onClick={onGenerate} disabled={working}>
                  {working ? 'Refreshing…' : 'Refresh status'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <button className="mk-btn mk-btn-primary" onClick={onGenerate} disabled={working}>
                {working ? 'Generating…' : 'Generate GST invoice'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
