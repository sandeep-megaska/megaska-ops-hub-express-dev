'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  createGstNote,
  gstDocumentViewUrl,
  listGstDocuments,
  type GstDocumentListItem,
} from '../../lib/gst-client'
import { adminAuthHeaders } from '../../lib/admin-fetch'

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10)
}

function formatAmount(value: unknown): string {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(2) : String(value ?? '')
}

export function GstNotesAdmin() {
  const [invoices, setInvoices] = useState<GstDocumentListItem[]>([])
  const [notes, setNotes] = useState<GstDocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string>()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()

  // The document HTML/PDF route now requires a verified session token, so it can
  // no longer be a plain <a href> (a top-level navigation can't carry the
  // Authorization header). Fetch it with the token and open the result as a blob.
  const openNoteDocument = useCallback(async (noteId: string, format: 'html' | 'pdf') => {
    setError(undefined)
    // Open the tab synchronously to keep the user activation; fill it after fetch.
    const win = format === 'html' ? window.open('about:blank', '_blank') : null
    try {
      const res = await fetch(gstDocumentViewUrl(noteId, format), {
        cache: 'no-store',
        credentials: 'include',
        headers: await adminAuthHeaders(),
      })
      if (!res.ok) {
        win?.close()
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error || `Unable to open ${format.toUpperCase()} (status ${res.status})`)
        return
      }

      if (format === 'html') {
        const html = await res.text()
        if (win) {
          win.document.open()
          win.document.write(html)
          win.document.close()
        }
        return
      }

      const blob = await res.blob()
      const fileUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = fileUrl
      anchor.download = `gst-note-${noteId}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(fileUrl)
    } catch (fetchError) {
      win?.close()
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to open the document')
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    const [invoiceRes, creditRes, debitRes] = await Promise.all([
      listGstDocuments({ documentType: 'TAX_INVOICE', limit: 50 }),
      listGstDocuments({ documentType: 'CREDIT_NOTE', limit: 50 }),
      listGstDocuments({ documentType: 'DEBIT_NOTE', limit: 50 }),
    ])

    if (!invoiceRes.ok) setError(invoiceRes.error)
    setInvoices(invoiceRes.ok ? invoiceRes.data : [])

    const creditNotes = creditRes.ok ? creditRes.data : []
    const debitNotes = debitRes.ok ? debitRes.data : []
    setNotes(
      [...creditNotes, ...debitNotes].sort((a, b) => b.documentDate.localeCompare(a.documentDate)),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onCreateNote(invoice: GstDocumentListItem, noteType: 'CREDIT_NOTE' | 'DEBIT_NOTE') {
    setBusyId(invoice.id)
    setError(undefined)
    setSuccess(undefined)

    const res = await createGstNote({
      noteType,
      originalDocumentId: invoice.id,
      reason: reason.trim() || undefined,
      sourceOrderNumber: invoice.sourceOrderNumber || undefined,
    })

    if (!res.ok || !res.data) {
      setError(res.error || 'Failed to create note')
      setBusyId(undefined)
      return
    }

    const label = noteType === 'CREDIT_NOTE' ? 'Credit note' : 'Debit note'
    setSuccess(`${label} ${res.data.documentNumber} created against ${invoice.documentNumber}.`)
    setReason('')
    setBusyId(undefined)
    void refresh()
  }

  return (
    <div className="mk-page">
      <section className="mk-card space-y-4">
        <div>
          <h2 className="mk-section-title">Create a Credit / Debit Note</h2>
          <p className="mk-section-subtitle">
            Pick a tax invoice below. The note is generated as a full reversal that inherits the
            invoice&apos;s exact HSN, GST rate, and CGST/SGST/IGST split.
          </p>
        </div>

        <div className="mk-field">
          <label className="mk-label">Reason (optional, stored on the note)</label>
          <input
            type="text"
            className="mk-input"
            placeholder="e.g. Customer return - order #1234"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error ? <div className="mk-alert mk-alert-error">{error}</div> : null}
        {success ? <div className="mk-alert mk-alert-success">{success}</div> : null}

        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Order</th>
                <th>Total</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="text-[color:var(--muted)]" colSpan={6}>
                    Loading invoices…
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td className="text-[color:var(--muted)]" colSpan={6}>
                    No tax invoices found. Generate invoices from the Orders tab first.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="font-medium">{invoice.documentNumber}</td>
                    <td>{formatDate(invoice.documentDate)}</td>
                    <td>{invoice.sourceOrderNumber || '—'}</td>
                    <td>{formatAmount(invoice.totalAmount)}</td>
                    <td>{invoice.status}</td>
                    <td>
                      <div className="mk-header-actions">
                        <button
                          type="button"
                          className="mk-btn mk-btn-sm mk-btn-primary"
                          disabled={busyId === invoice.id}
                          onClick={() => void onCreateNote(invoice, 'CREDIT_NOTE')}
                        >
                          {busyId === invoice.id ? '…' : 'Credit Note'}
                        </button>
                        <button
                          type="button"
                          className="mk-btn mk-btn-sm"
                          disabled={busyId === invoice.id}
                          onClick={() => void onCreateNote(invoice, 'DEBIT_NOTE')}
                        >
                          {busyId === invoice.id ? '…' : 'Debit Note'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mk-card space-y-4">
        <h2 className="mk-section-title">Recent Credit / Debit Notes</h2>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Note</th>
                <th>Type</th>
                <th>Date</th>
                <th>Order</th>
                <th>Total</th>
                <th>Status</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {notes.length === 0 ? (
                <tr>
                  <td className="text-[color:var(--muted)]" colSpan={7}>
                    No credit or debit notes yet.
                  </td>
                </tr>
              ) : (
                notes.map((note) => (
                  <tr key={note.id}>
                    <td className="font-medium">{note.documentNumber}</td>
                    <td>
                      {note.documentType === 'CREDIT_NOTE' ? 'Credit Note' : 'Debit Note'}
                    </td>
                    <td>{formatDate(note.documentDate)}</td>
                    <td>{note.sourceOrderNumber || '—'}</td>
                    <td>{formatAmount(note.totalAmount)}</td>
                    <td>{note.status}</td>
                    <td>
                      <div className="mk-header-actions">
                        <button
                          type="button"
                          className="mk-btn mk-btn-sm mk-btn-ghost"
                          onClick={() => openNoteDocument(note.id, 'html')}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="mk-btn mk-btn-sm mk-btn-ghost"
                          onClick={() => openNoteDocument(note.id, 'pdf')}
                        >
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
