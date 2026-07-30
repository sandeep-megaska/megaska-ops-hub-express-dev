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
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">Create a Credit / Debit Note</h2>
        <p className="mt-1 text-sm text-gray-600">
          Pick a tax invoice below. The note is generated as a full reversal that inherits the
          invoice&apos;s exact HSN, GST rate, and CGST/SGST/IGST split.
        </p>

        <label className="mt-4 block text-sm text-gray-700">
          <span className="mb-1 block">Reason (optional, stored on the note)</span>
          <input
            type="text"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
            placeholder="e.g. Customer return - order #1234"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {success ? <p className="mt-4 text-sm text-green-700">{success}</p> : null}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">Invoice</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="py-3 text-gray-500" colSpan={6}>
                    Loading invoices…
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td className="py-3 text-gray-500" colSpan={6}>
                    No tax invoices found. Generate invoices from the Orders tab first.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-medium text-gray-900">{invoice.documentNumber}</td>
                    <td className="py-2 pr-4 text-gray-700">{formatDate(invoice.documentDate)}</td>
                    <td className="py-2 pr-4 text-gray-700">{invoice.sourceOrderNumber || '—'}</td>
                    <td className="py-2 pr-4 text-gray-700">{formatAmount(invoice.totalAmount)}</td>
                    <td className="py-2 pr-4 text-gray-700">{invoice.status}</td>
                    <td className="py-2 pr-4">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                          disabled={busyId === invoice.id}
                          onClick={() => void onCreateNote(invoice, 'CREDIT_NOTE')}
                        >
                          {busyId === invoice.id ? '…' : 'Credit Note'}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 disabled:opacity-60"
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

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">Recent Credit / Debit Notes</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">Note</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">View</th>
              </tr>
            </thead>
            <tbody>
              {notes.length === 0 ? (
                <tr>
                  <td className="py-3 text-gray-500" colSpan={7}>
                    No credit or debit notes yet.
                  </td>
                </tr>
              ) : (
                notes.map((note) => (
                  <tr key={note.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-medium text-gray-900">{note.documentNumber}</td>
                    <td className="py-2 pr-4 text-gray-700">
                      {note.documentType === 'CREDIT_NOTE' ? 'Credit Note' : 'Debit Note'}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{formatDate(note.documentDate)}</td>
                    <td className="py-2 pr-4 text-gray-700">{note.sourceOrderNumber || '—'}</td>
                    <td className="py-2 pr-4 text-gray-700">{formatAmount(note.totalAmount)}</td>
                    <td className="py-2 pr-4 text-gray-700">{note.status}</td>
                    <td className="py-2 pr-4">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="text-blue-600 hover:underline"
                          onClick={() => openNoteDocument(note.id, 'html')}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="text-blue-600 hover:underline"
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
