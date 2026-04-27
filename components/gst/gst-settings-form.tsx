'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { createOrUpdateGstSettings, getGstSettings } from '../../lib/gst-client'
import { GstResponseViewer } from './gst-response-viewer'

type SettingsFormState = {
  legalName: string
  tradeName: string
  gstin: string
  pan: string
  stateCode: string
  invoicePrefix: string
  creditNotePrefix: string
  debitNotePrefix: string
  priceIncludesTax: boolean
}

const initialState: SettingsFormState = {
  legalName: '',
  tradeName: '',
  gstin: '',
  pan: '',
  stateCode: '',
  invoicePrefix: 'INV',
  creditNotePrefix: 'CN',
  debitNotePrefix: 'DN',
  priceIncludesTax: true,
}

export function GstSettingsForm() {
  const [form, setForm] = useState<SettingsFormState>(initialState)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    void (async () => {
      const res = await getGstSettings()
      if (!res.ok || !res.data) return
      setForm((prev) => ({
        ...prev,
        legalName: String(res.data.legalName || ''),
        tradeName: String(res.data.tradeName || ''),
        gstin: String(res.data.gstin || ''),
        pan: String(res.data.pan || ''),
        stateCode: String(res.data.stateCode || ''),
        invoicePrefix: String(res.data.invoicePrefix || 'INV'),
        creditNotePrefix: String(res.data.creditNotePrefix || 'CN'),
        debitNotePrefix: String(res.data.debitNotePrefix || 'DN'),
        priceIncludesTax: res.data.priceIncludesTax !== false,
      }))
      setResult(res.data)
    })()
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(undefined)

    const res = await createOrUpdateGstSettings({
      ...form,
      tradeName: form.tradeName || null,
      pan: form.pan || null,
      defaultCurrency: 'INR',
      invoiceNumberStrategy: 'FINANCIAL_YEAR_SEQUENCE',
      isActive: true,
      einvoiceEnabled: false,
    })

    if (res.ok) {
      setResult(res.data)
    } else {
      setError(res.error)
    }

    setLoading(false)
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <form onSubmit={onSubmit} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-900">GST Settings</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Legal Name" value={form.legalName} onChange={(e) => setForm((p) => ({ ...p, legalName: e.target.value }))} />
          <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Trade Name" value={form.tradeName} onChange={(e) => setForm((p) => ({ ...p, tradeName: e.target.value }))} />
          <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm uppercase" placeholder="GSTIN" value={form.gstin} onChange={(e) => setForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))} />
          <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm uppercase" placeholder="PAN" value={form.pan} onChange={(e) => setForm((p) => ({ ...p, pan: e.target.value.toUpperCase() }))} />
          <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="State Code" value={form.stateCode} onChange={(e) => setForm((p) => ({ ...p, stateCode: e.target.value }))} />
        </div>

        <h3 className="text-sm font-semibold text-gray-900">Numbering Prefixes</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm uppercase" placeholder="Invoice Prefix" value={form.invoicePrefix} onChange={(e) => setForm((p) => ({ ...p, invoicePrefix: e.target.value.toUpperCase() }))} />
          <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm uppercase" placeholder="Credit Note Prefix" value={form.creditNotePrefix} onChange={(e) => setForm((p) => ({ ...p, creditNotePrefix: e.target.value.toUpperCase() }))} />
          <input className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm uppercase" placeholder="Debit Note Prefix" value={form.debitNotePrefix} onChange={(e) => setForm((p) => ({ ...p, debitNotePrefix: e.target.value.toUpperCase() }))} />
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.priceIncludesTax}
            onChange={(e) => setForm((p) => ({ ...p, priceIncludesTax: e.target.checked }))}
          />
          Selling price includes tax (default true)
        </label>

        <button type="submit" className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm text-white" disabled={loading}>
          {loading ? 'Saving...' : 'Save GST Settings'}
        </button>
      </form>

      <GstResponseViewer title="Settings API Response" data={result} error={error} />
    </div>
  )
}
