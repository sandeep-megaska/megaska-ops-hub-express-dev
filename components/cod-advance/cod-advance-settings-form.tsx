'use client'

import { useEffect, useState, type FormEvent } from 'react'

type FormState = { enabled: boolean; fixedAdvanceAmountRupees: string; minOrderAmountRupees: string; maxOrderAmountRupees: string; policyText: string }

const initial: FormState = { enabled: false, fixedAdvanceAmountRupees: '120', minOrderAmountRupees: '', maxOrderAmountRupees: '', policyText: '' }

function paiseToRupees(value: unknown) { const n = Number(value || 0); return n ? String(n / 100) : '' }

export function CodAdvanceSettingsForm() {
  const [form, setForm] = useState<FormState>(initial)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { void (async () => {
    const res = await fetch('/api/admin/cod-advance/settings')
    const data = await res.json().catch(() => ({}))
    const settings = data.settings
    if (settings) setForm({ enabled: Boolean(settings.enabled), fixedAdvanceAmountRupees: paiseToRupees(settings.fixedAdvanceAmountPaise) || '120', minOrderAmountRupees: paiseToRupees(settings.minOrderAmountPaise), maxOrderAmountRupees: paiseToRupees(settings.maxOrderAmountPaise), policyText: String(settings.policyText || '') })
  })() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(''); setMessage('')
    const res = await fetch('/api/admin/cod-advance/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) setError(data.error || 'Failed to save settings')
    else setMessage('Fixed COD Advance settings saved.')
    setLoading(false)
  }

  return <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4 max-w-3xl">
    <div>
      <h2 className="text-base font-semibold text-gray-900">Fixed COD Advance</h2>
      <p className="text-sm text-gray-600">Collect a fixed online advance for Partial COD orders and leave the remaining balance for delivery collection.</p>
    </div>
    <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} /> Enable module</label>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="text-sm text-gray-700">Fixed advance (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" type="number" min="1" step="0.01" value={form.fixedAdvanceAmountRupees} onChange={(e) => setForm((p) => ({ ...p, fixedAdvanceAmountRupees: e.target.value }))} /></label>
      <label className="text-sm text-gray-700">Min order value (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" type="number" min="0" step="0.01" value={form.minOrderAmountRupees} onChange={(e) => setForm((p) => ({ ...p, minOrderAmountRupees: e.target.value }))} /></label>
      <label className="text-sm text-gray-700">Max order value (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" type="number" min="0" step="0.01" value={form.maxOrderAmountRupees} onChange={(e) => setForm((p) => ({ ...p, maxOrderAmountRupees: e.target.value }))} /></label>
    </div>
    <label className="block text-sm text-gray-700">Policy text<textarea className="mt-1 min-h-28 w-full rounded-xl border border-gray-300 px-3 py-2.5" value={form.policyText} onChange={(e) => setForm((p) => ({ ...p, policyText: e.target.value }))} placeholder="Example: Pay ₹120 now. Remaining COD balance is collected at delivery." /></label>
    {message ? <p className="text-sm text-green-700">{message}</p> : null}{error ? <p className="text-sm text-red-700">{error}</p> : null}
    <button type="submit" className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm text-white" disabled={loading}>{loading ? 'Saving...' : 'Save settings'}</button>
  </form>
}
