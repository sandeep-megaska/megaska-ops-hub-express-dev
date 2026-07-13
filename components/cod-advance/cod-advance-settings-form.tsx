'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { buildCodAdvancePreview, DEFAULT_CUSTOMER_MESSAGE, DEFAULT_CUSTOMER_TITLE, parsePercentageToBasisPoints, parseRupeesToPaise } from '../../services/cod-advance/settings-shared'

type AdvanceType = 'FIXED' | 'PERCENTAGE'
type FormState = { enabled: boolean; advanceType: AdvanceType; fixedAdvanceAmountRupees: string; percentage: string; minimumAdvanceRupees: string; maximumAdvanceRupees: string; minOrderRupees: string; maxOrderRupees: string; customerTitle: string; customerMessage: string; version: number }
const initial: FormState = { enabled: false, advanceType: 'FIXED', fixedAdvanceAmountRupees: '300', percentage: '', minimumAdvanceRupees: '', maximumAdvanceRupees: '', minOrderRupees: '', maxOrderRupees: '', customerTitle: '', customerMessage: '', version: 0 }
function paiseToRupees(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? (value / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1') : '' }
function bpsToPercent(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? (value / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1') : '' }
function formatPaise(value: number) { return `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` }

export function CodAdvanceSettingsForm() {
  const [form, setForm] = useState<FormState>(initial)
  const [saved, setSaved] = useState<FormState>(initial)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  useEffect(() => { void (async () => {
    setLoading(true); setError('')
    const res = await fetch('/api/admin/cod-advance/settings')
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) setError(data.error || 'Failed to load Partial COD settings')
    else if (data.settings) {
      const s = data.settings
      const next = { enabled: Boolean(s.enabled), advanceType: s.advanceType === 'PERCENTAGE' ? 'PERCENTAGE' as const : 'FIXED' as const, fixedAdvanceAmountRupees: paiseToRupees(s.fixedAdvanceAmountPaise) || '300', percentage: bpsToPercent(s.percentageBasisPoints), minimumAdvanceRupees: paiseToRupees(s.minimumAdvanceAmountPaise), maximumAdvanceRupees: paiseToRupees(s.maximumAdvanceAmountPaise), minOrderRupees: paiseToRupees(s.minOrderAmountPaise), maxOrderRupees: paiseToRupees(s.maxOrderAmountPaise), customerTitle: String(s.customerTitle || ''), customerMessage: String(s.customerMessage || ''), version: Number(s.version || 0) }
      setForm(next); setSaved(next)
    }
    setLoading(false)
  })() }, [])

  useEffect(() => { const handler = (e: BeforeUnloadEvent) => { if (!dirty) return; e.preventDefault(); e.returnValue = '' }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler) }, [dirty])

  const preview = useMemo(() => {
    try {
      const fixedAdvanceAmountPaise = parseRupeesToPaise(form.fixedAdvanceAmountRupees || '0') || 0
      const percentageBasisPoints = form.advanceType === 'PERCENTAGE' ? parsePercentageToBasisPoints(form.percentage || '0') : null
      const minimumAdvanceAmountPaise = parseRupeesToPaise(form.minimumAdvanceRupees, { optional: true })
      const maximumAdvanceAmountPaise = parseRupeesToPaise(form.maximumAdvanceRupees, { optional: true })
      return buildCodAdvancePreview({ advanceType: form.advanceType, fixedAdvanceAmountPaise, percentageBasisPoints, minimumAdvanceAmountPaise, maximumAdvanceAmountPaise })
    } catch { return buildCodAdvancePreview({ advanceType: 'FIXED', fixedAdvanceAmountPaise: 30000, percentageBasisPoints: null, minimumAdvanceAmountPaise: null, maximumAdvanceAmountPaise: null }) }
  }, [form])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError(''); setMessage('')
    try {
      const payload = { enabled: form.enabled, advanceType: form.advanceType, fixedAdvanceAmountPaise: parseRupeesToPaise(form.fixedAdvanceAmountRupees || '0') || 0, percentageBasisPoints: form.advanceType === 'PERCENTAGE' ? parsePercentageToBasisPoints(form.percentage) : null, minimumAdvanceAmountPaise: parseRupeesToPaise(form.minimumAdvanceRupees, { optional: true }), maximumAdvanceAmountPaise: parseRupeesToPaise(form.maximumAdvanceRupees, { optional: true }), minOrderAmountPaise: parseRupeesToPaise(form.minOrderRupees, { optional: true }), maxOrderAmountPaise: parseRupeesToPaise(form.maxOrderRupees, { optional: true }), customerTitle: form.customerTitle.trim() || null, customerMessage: form.customerMessage.trim() || null, version: form.version, shopId: 'browser-supplied-values-are-ignored' }
      const res = await fetch('/api/admin/cod-advance/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save settings')
      const next = { ...form, version: Number(data.settings.version || form.version + 1) }
      setForm(next); setSaved(next); setMessage('Partial COD settings saved.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save settings') }
    setSubmitting(false)
  }

  if (loading) return <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-sm">Loading Partial COD settings…</div>

  return <form onSubmit={submit} className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-6 max-w-4xl ${form.enabled ? '' : 'opacity-90'}`}>
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-gray-900">Status</h2><p className="text-sm text-gray-600">When enabled, eligible Cash on Delivery orders can require a small online advance before the order is confirmed.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${form.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{form.enabled ? 'Enabled' : 'Disabled'}</span></div>
    <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} /> Enable Partial COD</label>

    <section className="space-y-3"><h3 className="text-sm font-semibold text-gray-900">Advance calculation</h3><div className="flex flex-wrap gap-4 text-sm"><label><input type="radio" checked={form.advanceType === 'FIXED'} onChange={() => setForm((p) => ({ ...p, advanceType: 'FIXED' }))} /> Fixed amount</label><label><input type="radio" checked={form.advanceType === 'PERCENTAGE'} onChange={() => setForm((p) => ({ ...p, advanceType: 'PERCENTAGE' }))} /> Percentage of payable amount</label></div>{form.advanceType === 'FIXED' ? <label className="block text-sm text-gray-700">Advance amount (₹)<input className="mt-1 w-full max-w-xs rounded-xl border border-gray-300 px-3 py-2.5" inputMode="decimal" value={form.fixedAdvanceAmountRupees} onChange={(e) => setForm((p) => ({ ...p, fixedAdvanceAmountRupees: e.target.value }))} /><span className="mt-1 block text-xs text-gray-500">Customer pays this amount online before the remaining amount is collected on delivery.</span></label> : <label className="block text-sm text-gray-700">Advance percentage<input className="mt-1 w-full max-w-xs rounded-xl border border-gray-300 px-3 py-2.5" inputMode="decimal" placeholder="12.5" value={form.percentage} onChange={(e) => setForm((p) => ({ ...p, percentage: e.target.value }))} /><span className="mt-1 block text-xs text-gray-500">The percentage is calculated on the customer cash liability after Store Credit.</span></label>}</section>

    <section className="space-y-3"><h3 className="text-sm font-semibold text-gray-900">Optional safeguards</h3><div className="grid gap-3 md:grid-cols-2"><label className="text-sm text-gray-700">Minimum advance amount (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" inputMode="decimal" value={form.minimumAdvanceRupees} onChange={(e) => setForm((p) => ({ ...p, minimumAdvanceRupees: e.target.value }))} /></label><label className="text-sm text-gray-700">Maximum advance amount (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" inputMode="decimal" value={form.maximumAdvanceRupees} onChange={(e) => setForm((p) => ({ ...p, maximumAdvanceRupees: e.target.value }))} /></label><label className="text-sm text-gray-700">Minimum eligible order value (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" inputMode="decimal" value={form.minOrderRupees} onChange={(e) => setForm((p) => ({ ...p, minOrderRupees: e.target.value }))} /></label><label className="text-sm text-gray-700">Maximum eligible order value (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" inputMode="decimal" value={form.maxOrderRupees} onChange={(e) => setForm((p) => ({ ...p, maxOrderRupees: e.target.value }))} /></label></div></section>

    <section className="space-y-3"><h3 className="text-sm font-semibold text-gray-900">Customer communication</h3><label className="block text-sm text-gray-700">Customer title<input maxLength={120} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" value={form.customerTitle} placeholder={DEFAULT_CUSTOMER_TITLE} onChange={(e) => setForm((p) => ({ ...p, customerTitle: e.target.value }))} /></label><label className="block text-sm text-gray-700">Customer message<textarea maxLength={500} className="mt-1 min-h-24 w-full rounded-xl border border-gray-300 px-3 py-2.5" value={form.customerMessage} placeholder={DEFAULT_CUSTOMER_MESSAGE} onChange={(e) => setForm((p) => ({ ...p, customerMessage: e.target.value }))} /></label></section>

    <section className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-700"><h3 className="font-semibold text-gray-900">Preview</h3><p className="mt-1 font-medium">{form.customerTitle.trim() || DEFAULT_CUSTOMER_TITLE}</p><p>{form.customerMessage.trim() || DEFAULT_CUSTOMER_MESSAGE}</p><dl className="mt-3 grid gap-1 md:grid-cols-2"><div>Example order total: {formatPaise(preview.orderTotalPaise)}</div><div>Store Credit: {formatPaise(preview.storeCreditAppliedPaise)}</div><div>Payable amount: {formatPaise(preview.customerCashLiabilityPaise)}</div><div>Pay now: {formatPaise(preview.advanceAmountPaise)}</div><div>Pay on delivery: {formatPaise(preview.codBalanceAmountPaise)}</div></dl></section>

    {message ? <p className="text-sm text-green-700">{message}</p> : null}{error ? <p className="text-sm text-red-700">{error}</p> : null}{dirty ? <p className="text-xs text-amber-700">You have unsaved changes.</p> : null}
    <button type="submit" className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm text-white disabled:opacity-60" disabled={submitting}>{submitting ? 'Saving…' : 'Save settings'}</button>
  </form>
}
