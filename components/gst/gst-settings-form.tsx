'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { createOrUpdateGstSettings, getGstSettings } from '../../lib/gst-client'
import {
  buildFormattedDocumentNumber,
  counterPeriodLabel,
  type DocNumberFormat,
  type GstNumberingConfig,
  type GstNumberingDocKey,
  type GstResetPeriod,
} from '../../services/gst/numbering-config'
import type { GstNumberingStrategy } from '../../services/gst/constants'

type SettingsFormState = {
  legalName: string
  tradeName: string
  gstin: string
  pan: string
  stateCode: string
  priceIncludesTax: boolean
  autoGenerateOnOrderCreate: boolean
  gstModuleEnabled: boolean
  numbering: GstNumberingConfig
}

function defaultDocFormat(prefix: string): DocNumberFormat {
  return {
    prefix,
    suffix: '',
    separator: '/',
    minDigits: 5,
    startNumber: 1,
    resetPeriod: 'FINANCIAL_YEAR',
    yearDisplay: 'FINANCIAL_YEAR',
  }
}

const initialState: SettingsFormState = {
  legalName: '',
  tradeName: '',
  gstin: '',
  pan: '',
  stateCode: '',
  priceIncludesTax: true,
  autoGenerateOnOrderCreate: true,
  gstModuleEnabled: true,
  numbering: {
    invoice: defaultDocFormat('INV'),
    creditNote: defaultDocFormat('CN'),
    debitNote: defaultDocFormat('DN'),
  },
}

const RESET_PERIOD_OPTIONS: Array<{ value: GstResetPeriod; label: string }> = [
  { value: 'FINANCIAL_YEAR', label: 'Every financial year (Apr–Mar)' },
  { value: 'CALENDAR_YEAR', label: 'Every calendar year (Jan–Dec)' },
  { value: 'MONTHLY', label: 'Every month' },
  { value: 'CONTINUOUS', label: 'Never reset (continuous)' },
]

const YEAR_DISPLAY_OPTIONS: Array<{ value: DocNumberFormat['yearDisplay']; label: string }> = [
  { value: 'NONE', label: 'No date segment' },
  { value: 'FINANCIAL_YEAR', label: 'Financial year (e.g. 26-27)' },
  { value: 'CALENDAR_YEAR', label: 'Calendar year (e.g. 2026)' },
  { value: 'MONTHLY', label: 'Year-month (e.g. 2026-07)' },
]

const DOC_LABELS: Record<GstNumberingDocKey, string> = {
  invoice: 'Tax Invoice',
  creditNote: 'Credit Note',
  debitNote: 'Debit Note',
}

// numberingConfig supersedes the legacy strategy field, but keep the stored
// strategy in sync with the invoice reset period so any legacy reader stays sane.
function resetPeriodToStrategy(resetPeriod: GstResetPeriod): GstNumberingStrategy {
  switch (resetPeriod) {
    case 'CALENDAR_YEAR':
      return 'CALENDAR_YEAR_SEQUENCE'
    case 'MONTHLY':
      return 'MONTHLY_SEQUENCE'
    case 'FINANCIAL_YEAR':
    case 'CONTINUOUS':
    default:
      return 'FINANCIAL_YEAR_SEQUENCE'
  }
}

function coerceDocFormat(raw: unknown, fallback: DocNumberFormat): DocNumberFormat {
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Record<string, unknown>
  const resetPeriod = (['CONTINUOUS', 'FINANCIAL_YEAR', 'CALENDAR_YEAR', 'MONTHLY'] as const).includes(
    value.resetPeriod as GstResetPeriod,
  )
    ? (value.resetPeriod as GstResetPeriod)
    : fallback.resetPeriod
  const yearDisplay = (['NONE', 'FINANCIAL_YEAR', 'CALENDAR_YEAR', 'MONTHLY'] as const).includes(
    value.yearDisplay as DocNumberFormat['yearDisplay'],
  )
    ? (value.yearDisplay as DocNumberFormat['yearDisplay'])
    : fallback.yearDisplay
  const migrationRaw = value.migration as Record<string, unknown> | null | undefined
  const migration =
    migrationRaw && typeof migrationRaw === 'object' && String(migrationRaw.periodLabel ?? '').trim() && Number(migrationRaw.nextNumber) >= 1
      ? { periodLabel: String(migrationRaw.periodLabel).trim(), nextNumber: Math.floor(Number(migrationRaw.nextNumber)) }
      : null
  return {
    prefix: typeof value.prefix === 'string' ? value.prefix : fallback.prefix,
    suffix: typeof value.suffix === 'string' ? value.suffix : fallback.suffix,
    separator: typeof value.separator === 'string' ? value.separator : fallback.separator,
    minDigits: Number.isFinite(Number(value.minDigits)) ? Number(value.minDigits) : fallback.minDigits,
    startNumber: Number.isFinite(Number(value.startNumber)) ? Number(value.startNumber) : fallback.startNumber,
    resetPeriod,
    yearDisplay,
    migration,
  }
}

// Build the numbering config from a loaded settings row: prefer a stored
// numberingConfig, otherwise derive sensible defaults from the legacy prefixes.
function numberingFromLoaded(data: Record<string, unknown>): GstNumberingConfig {
  const stored = data.numberingConfig as Record<string, unknown> | null | undefined
  const invoiceDefault = defaultDocFormat(String(data.invoicePrefix || 'INV'))
  const creditDefault = defaultDocFormat(String(data.creditNotePrefix || 'CN'))
  const debitDefault = defaultDocFormat(String(data.debitNotePrefix || 'DN'))
  if (!stored || typeof stored !== 'object') {
    return { invoice: invoiceDefault, creditNote: creditDefault, debitNote: debitDefault }
  }
  return {
    invoice: coerceDocFormat(stored.invoice, invoiceDefault),
    creditNote: coerceDocFormat(stored.creditNote, creditDefault),
    debitNote: coerceDocFormat(stored.debitNote, debitDefault),
  }
}

function DocFormatEditor({
  docKey,
  format,
  onChange,
}: {
  docKey: GstNumberingDocKey
  format: DocNumberFormat
  onChange: (next: DocNumberFormat) => void
}) {
  const now = new Date()
  const currentPeriod = counterPeriodLabel(format.resetPeriod, now)
  const migrationActive = !!format.migration && format.migration.periodLabel === currentPeriod
  const firstSeq = migrationActive
    ? Math.max(1, Math.floor(format.migration!.nextNumber))
    : Math.max(1, Math.floor(format.startNumber) || 1)
  const first = buildFormattedDocumentNumber(format, now, firstSeq)
  const overLimit = first.length > 16
  const periodLabel = currentPeriod

  const set = (patch: Partial<DocNumberFormat>) => onChange({ ...format, ...patch })

  // "Continue from" is a one-time seed anchored to the current period, so it
  // stays anchored to whatever period the chosen reset rule produces today.
  const setContinueFrom = (raw: string) => {
    const n = Math.floor(Number(raw))
    if (!raw.trim() || !Number.isFinite(n) || n < 1) {
      set({ migration: null })
      return
    }
    set({ migration: { periodLabel: currentPeriod, nextNumber: n } })
  }

  return (
    <div className="rounded-xl border border-[color:var(--line)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="mk-section-title" style={{ marginBottom: 0 }}>{DOC_LABELS[docKey]}</h4>
        <span
          className={`mk-badge ${overLimit ? 'mk-badge-danger' : 'mk-badge-neutral'} font-mono`}
          title="First number for the current period"
        >
          {first || '—'}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="mk-field">
          <label className="mk-label">Prefix</label>
          <input
            className="mk-input uppercase"
            value={format.prefix}
            onChange={(e) => set({ prefix: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="mk-field">
          <label className="mk-label">Separator</label>
          <input
            className="mk-input"
            value={format.separator}
            maxLength={1}
            onChange={(e) => set({ separator: e.target.value })}
          />
        </div>
        <div className="mk-field">
          <label className="mk-label">Suffix</label>
          <input
            className="mk-input uppercase"
            value={format.suffix}
            onChange={(e) => set({ suffix: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="mk-field">
          <label className="mk-label">Start number</label>
          <input
            type="number"
            min={1}
            className="mk-input"
            value={format.startNumber}
            onChange={(e) => set({ startNumber: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          />
        </div>
        <div className="mk-field">
          <label className="mk-label">Min digits (padding)</label>
          <input
            type="number"
            min={0}
            max={12}
            className="mk-input"
            value={format.minDigits}
            onChange={(e) => set({ minDigits: Math.max(0, Math.min(12, Math.floor(Number(e.target.value) || 0))) })}
          />
        </div>
        <div className="mk-field">
          <label className="mk-label">Date segment</label>
          <select
            className="mk-select"
            value={format.yearDisplay}
            onChange={(e) => set({ yearDisplay: e.target.value as DocNumberFormat['yearDisplay'] })}
          >
            {YEAR_DISPLAY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-field">
          <label className="mk-label">Restart sequence</label>
          <select
            className="mk-select"
            value={format.resetPeriod}
            onChange={(e) => {
              const resetPeriod = e.target.value as GstResetPeriod
              // Re-anchor a pending "continue from" seed to the period this
              // reset rule produces today, so the seed lands on the right bucket.
              const migration = format.migration
                ? { ...format.migration, periodLabel: counterPeriodLabel(resetPeriod, now) }
                : format.migration
              onChange({ ...format, resetPeriod, migration })
            }}
          >
            {RESET_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-field">
          <label className="mk-label">Continue from (one-time)</label>
          <input
            type="number"
            min={1}
            placeholder="next number"
            className="mk-input"
            value={format.migration ? format.migration.nextNumber : ''}
            onChange={(e) => setContinueFrom(e.target.value)}
          />
        </div>
      </div>

      <p className="mk-help">
        First number this period: <span className="font-mono text-[color:var(--text)]">{first || '—'}</span>
        {format.resetPeriod !== 'CONTINUOUS' && (
          <>
            {' '}· current bucket <span className="font-mono text-[color:var(--text)]">{periodLabel}</span>
          </>
        )}
        {migrationActive && (
          <span className="ml-1 text-[color:var(--success-text)]">· continuing from your last number (one-time)</span>
        )}
        {overLimit && <span className="ml-2 text-[color:var(--danger-text)]">Exceeds the 16-character GST limit</span>}
      </p>
      {format.migration && !migrationActive && (
        <p className="text-xs text-[color:var(--warning-text)]">
          The “continue from” value is anchored to period {format.migration.periodLabel}, which isn’t the current
          period ({currentPeriod}). It will only apply when that period is first numbered.
        </p>
      )}
    </div>
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
      const data = (res.data ?? {}) as Record<string, unknown>
      setForm((prev) => ({
        ...prev,
        legalName: String(data.legalName || ''),
        tradeName: String(data.tradeName || ''),
        gstin: String(data.gstin || ''),
        pan: String(data.pan || ''),
        stateCode: String(data.stateCode || ''),
        priceIncludesTax: data.priceIncludesTax !== false,
        autoGenerateOnOrderCreate: data.autoGenerateOnOrderCreate === true,
        gstModuleEnabled: data.gstModuleEnabled !== false,
        numbering: numberingFromLoaded(data),
      }))
      setResult(data)
    })()
  }, [])

  function updateDoc(docKey: GstNumberingDocKey, next: DocNumberFormat) {
    setForm((p) => ({ ...p, numbering: { ...p.numbering, [docKey]: next } }))
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(undefined)

    const res = await createOrUpdateGstSettings({
      legalName: form.legalName,
      tradeName: form.tradeName || null,
      gstin: form.gstin,
      pan: form.pan || null,
      stateCode: form.stateCode,
      priceIncludesTax: form.priceIncludesTax,
      autoGenerateOnOrderCreate: form.autoGenerateOnOrderCreate,
      // Keep the legacy prefix + strategy fields aligned with the invoice format
      // so any code still reading them stays consistent with numberingConfig.
      invoicePrefix: form.numbering.invoice.prefix,
      creditNotePrefix: form.numbering.creditNote.prefix,
      debitNotePrefix: form.numbering.debitNote.prefix,
      invoiceNumberStrategy: resetPeriodToStrategy(form.numbering.invoice.resetPeriod),
      numberingConfig: form.numbering,
      gstModuleEnabled: form.gstModuleEnabled,
      defaultCurrency: 'INR',
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
    <div className="mk-page">
      {error ? <div className="mk-alert mk-alert-error">{error}</div> : null}

      <form onSubmit={onSubmit} className="mk-card space-y-5">
        <h2 className="mk-section-title">GST Settings</h2>

        <label className="mk-check items-start rounded-xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.gstModuleEnabled}
            onChange={(e) => setForm((p) => ({ ...p, gstModuleEnabled: e.target.checked }))}
          />
          <span>
            <span className="font-medium text-[color:var(--text)]">Enable GST invoicing in this app</span>
            <span className="block mk-help">
              Turn this off if another GST app already numbers your invoices — this app will then stop
              auto-generating GST documents so your invoice sequence stays with the other tool.
            </span>
          </span>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="mk-field">
            <label className="mk-label">Legal Name</label>
            <input className="mk-input" placeholder="Legal Name" value={form.legalName} onChange={(e) => setForm((p) => ({ ...p, legalName: e.target.value }))} />
          </div>
          <div className="mk-field">
            <label className="mk-label">Trade Name</label>
            <input className="mk-input" placeholder="Trade Name" value={form.tradeName} onChange={(e) => setForm((p) => ({ ...p, tradeName: e.target.value }))} />
          </div>
          <div className="mk-field">
            <label className="mk-label">GSTIN</label>
            <input className="mk-input uppercase" placeholder="GSTIN" value={form.gstin} onChange={(e) => setForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))} />
          </div>
          <div className="mk-field">
            <label className="mk-label">PAN</label>
            <input className="mk-input uppercase" placeholder="PAN" value={form.pan} onChange={(e) => setForm((p) => ({ ...p, pan: e.target.value.toUpperCase() }))} />
          </div>
          <div className="mk-field">
            <label className="mk-label">State Code</label>
            <input className="mk-input" placeholder="State Code" value={form.stateCode} onChange={(e) => setForm((p) => ({ ...p, stateCode: e.target.value }))} />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="mk-section-title" style={{ marginBottom: 0 }}>Document Numbering</h3>
            <p className="mk-help">
              Set the format, start number and reset cycle for each document type. <span className="font-medium text-[color:var(--text)]">Start number</span> is
              what each new period resets to. To migrate from another GST app without a gap, put the
              <span className="font-medium text-[color:var(--text)]"> next</span> number to issue in <span className="font-medium text-[color:var(--text)]">Continue from</span> —
              that applies once, to the current period only, and later periods still reset to the start number.
              Keep the composed number ≤ 16 characters (GST limit).
            </p>
          </div>
          <DocFormatEditor docKey="invoice" format={form.numbering.invoice} onChange={(next) => updateDoc('invoice', next)} />
          <DocFormatEditor docKey="creditNote" format={form.numbering.creditNote} onChange={(next) => updateDoc('creditNote', next)} />
          <DocFormatEditor docKey="debitNote" format={form.numbering.debitNote} onChange={(next) => updateDoc('debitNote', next)} />
        </div>

        <label className="mk-check">
          <input
            type="checkbox"
            checked={form.priceIncludesTax}
            onChange={(e) => setForm((p) => ({ ...p, priceIncludesTax: e.target.checked }))}
          />
          Selling price includes tax (default true)
        </label>

        <label className="mk-check items-start">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.autoGenerateOnOrderCreate}
            onChange={(e) => setForm((p) => ({ ...p, autoGenerateOnOrderCreate: e.target.checked }))}
          />
          <span>
            Automatically generate a GST invoice when an order is created
            <span className="block mk-help">
              Skips orders with unmapped SKUs or missing GST details — those stay available for manual generation on the Orders page.
            </span>
          </span>
        </label>

        <button type="submit" className="mk-btn mk-btn-primary" disabled={loading}>
          {loading ? 'Saving...' : 'Save GST Settings'}
        </button>
      </form>
    </div>
  )
}
