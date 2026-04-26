'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { createOrUpdateGstSettings, getGstSettings } from '../../lib/gst-client'
import { GST_DEFAULT_NUMBERING_STRATEGY } from '../../services/gst/constants'
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
  invoiceNumberStrategy: string
  defaultCurrency: string
  priceIncludesTax: boolean
  einvoiceEnabled: boolean
  isActive: boolean
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
  invoiceNumberStrategy: GST_DEFAULT_NUMBERING_STRATEGY,
  defaultCurrency: 'INR',
  priceIncludesTax: true,
  einvoiceEnabled: false,
  isActive: true,
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  upper = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  upper?: boolean
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium text-gray-700">{label}</div>
      <input
        className={`w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 ${
          upper ? 'uppercase' : ''
        }`}
        value={value}
        onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
      />
    </label>
  )
}

export function GstSettingsForm() {
  const [form, setForm] = useState<SettingsFormState>(initialState)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    void (async () => {
      const res = await getGstSettings()
      if (!res.ok) return
      const record = (res.data as { settings?: Partial<SettingsFormState> })?.settings
      if (!record) return
      setForm((prev) => ({
        ...prev,
        ...record,
        tradeName: record.tradeName || '',
        pan: record.pan || '',
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
      <form onSubmit={onSubmit} className="space-y-5">
        <Section
          title="Registration"
          subtitle="Store the active GST registration profile used by invoice and note workflows."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Legal Name"
              value={form.legalName}
              onChange={(value) => setForm((p) => ({ ...p, legalName: value }))}
            />
            <Input
              label="Trade Name"
              value={form.tradeName}
              onChange={(value) => setForm((p) => ({ ...p, tradeName: value }))}
            />
            <Input
              label="GSTIN"
              value={form.gstin}
              upper
              onChange={(value) => setForm((p) => ({ ...p, gstin: value }))}
            />
            <Input
              label="PAN"
              value={form.pan}
              upper
              onChange={(value) => setForm((p) => ({ ...p, pan: value }))}
            />
            <Input
              label="State Code"
              value={form.stateCode}
              onChange={(value) => setForm((p) => ({ ...p, stateCode: value }))}
            />
            <Input
              label="Default Currency"
              value={form.defaultCurrency}
              upper
              onChange={(value) => setForm((p) => ({ ...p, defaultCurrency: value }))}
            />
          </div>
        </Section>

        <Section
          title="Numbering Controls"
          subtitle="Configure document prefixes and strategy used by backend number reservation."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Invoice Prefix"
              value={form.invoicePrefix}
              upper
              onChange={(value) => setForm((p) => ({ ...p, invoicePrefix: value }))}
            />
            <Input
              label="Credit Note Prefix"
              value={form.creditNotePrefix}
              upper
              onChange={(value) => setForm((p) => ({ ...p, creditNotePrefix: value }))}
            />
            <Input
              label="Debit Note Prefix"
              value={form.debitNotePrefix}
              upper
              onChange={(value) => setForm((p) => ({ ...p, debitNotePrefix: value }))}
            />

            <label className="block">
              <div className="mb-1.5 text-sm font-medium text-gray-700">Numbering Strategy</div>
              <select
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                value={form.invoiceNumberStrategy}
                onChange={(e) =>
                  setForm((p) => ({ ...p, invoiceNumberStrategy: e.target.value }))
                }
              >
                <option value="FINANCIAL_YEAR_SEQUENCE">Financial Year Sequence</option>
                <option value="CALENDAR_YEAR_SEQUENCE">Calendar Year Sequence</option>
                <option value="MONTHLY_SEQUENCE">Monthly Sequence</option>
                <option value="MANUAL">Manual</option>
              </select>
            </label>
          </div>
        </Section>

        <Section
          title="Operational Controls"
          subtitle="Enable production behavior intentionally and keep settings state explicit."
        >
          <div className="flex flex-wrap gap-6">
            <label className="inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={form.priceIncludesTax}
                onChange={(e) => setForm((p) => ({ ...p, priceIncludesTax: e.target.checked }))}
              />
              Selling prices include tax
            </label>

            <label className="inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={form.einvoiceEnabled}
                onChange={(e) => setForm((p) => ({ ...p, einvoiceEnabled: e.target.checked }))}
              />
              E-invoice enabled
            </label>

            <label className="inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
              />
              Active settings
            </label>
          </div>
        </Section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Saving...' : 'Save GST Settings'}
          </button>
          <p className="text-sm text-gray-500">
            These values drive seller state, numbering, and document generation defaults.
          </p>
        </div>
      </form>

      <GstResponseViewer title="Settings API Response" data={result} error={error} />
    </div>
  )
}
