'use client'

import { useEffect, useState } from 'react'

const DEFAULT_TEXT = 'You need to pay to the delivery agent at the time of delivery. In case of any refund, the refund amount will be issued as Megaska store credit which you can utilize for future purchases. However, for card and UPI payments, the refund amount will be directly transferred to your original payment method.'

function paiseToRupees(value: unknown) {
  const paise = Number(value || 0)
  return Number.isFinite(paise) ? String(paise / 100) : '100'
}

export function ExpressCheckoutSettingsForm() {
  const [form, setForm] = useState({ codFeeAmountRupees: '100', codInformationText: DEFAULT_TEXT })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    const res = await fetch('/api/admin/express-checkout/settings')
    const data = await res.json().catch(() => ({}))
    if (data.settings) setForm({ codFeeAmountRupees: paiseToRupees(data.settings.codFeeAmountPaise), codInformationText: String(data.settings.codInformationText || DEFAULT_TEXT) })
  })() }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setMessage('')
    const res = await fetch('/api/admin/express-checkout/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json().catch(() => ({})); setLoading(false)
    if (!res.ok || !data.ok) setError(data.error || 'Failed to save settings')
    else setMessage('Express checkout settings saved.')
  }

  return <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
    <div><h2 className="text-base font-semibold text-gray-900">Express checkout COD settings</h2><p className="text-sm text-gray-600">Configure COD charge and COD/refund copy shown in the checkout modal.</p></div>
    {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    {message ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p> : null}
    <label className="block text-sm text-gray-700">COD charge (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" value={form.codFeeAmountRupees} onChange={(e) => setForm((p) => ({ ...p, codFeeAmountRupees: e.target.value }))} inputMode="decimal" /></label>
    <label className="block text-sm text-gray-700">COD/refund information text<textarea className="mt-1 min-h-32 w-full rounded-xl border border-gray-300 px-3 py-2.5" value={form.codInformationText} onChange={(e) => setForm((p) => ({ ...p, codInformationText: e.target.value }))} /></label>
    <button type="submit" className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm text-white" disabled={loading}>{loading ? 'Saving...' : 'Save settings'}</button>
  </form>
}
