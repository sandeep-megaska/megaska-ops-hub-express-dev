'use client'

import { useEffect, useState } from 'react'

const DEFAULT_TEXT = 'You need to pay to the delivery agent at the time of delivery. In case of any refund, the refund amount will be issued as store credit which you can utilize for future purchases. However, for card and UPI payments, the refund amount will be directly transferred to your original payment method.'

function paiseToRupees(value: unknown) {
  const paise = Number(value || 0)
  return Number.isFinite(paise) ? String(paise / 100) : '0'
}

export function ExpressCheckoutSettingsForm() {
  const [form, setForm] = useState({ codFeeAmountRupees: '0', codInformationText: DEFAULT_TEXT })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [readiness, setReadiness] = useState<{ ready: boolean; expressCheckoutEnabled: boolean; providerConfigured: boolean; providerValidated: boolean; reason: string } | null>(null)

  useEffect(() => { (async () => {
    const res = await fetch('/api/admin/express-checkout/settings')
    const data = await res.json().catch(() => ({}))
    if (data.settings) setForm({ codFeeAmountRupees: paiseToRupees(data.settings.codFeeAmountPaise), codInformationText: String(data.settings.codInformationText || DEFAULT_TEXT) })
    if (data.readiness) { setReadiness(data.readiness); setEnabled(data.readiness.expressCheckoutEnabled) }
  })() }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setMessage('')
    const res = await fetch('/api/admin/express-checkout/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, enabled }) })
    const data = await res.json().catch(() => ({})); setLoading(false)
    if (data.readiness) setReadiness(data.readiness)
    if (!res.ok || !data.ok) { setError(data.error || 'Failed to save settings'); if (data.readiness) setEnabled(data.readiness.expressCheckoutEnabled) }
    else setMessage('Express checkout settings saved.')
  }

  return <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
    <div className="rounded-xl border border-gray-200 p-4 space-y-2"><h2 className="font-semibold text-gray-900">Express Checkout</h2><dl className="grid grid-cols-2 gap-2 text-sm"><dt>Payment provider</dt><dd className="font-medium">Razorpay</dd><dt>Razorpay status</dt><dd className="font-medium">{!readiness?.providerConfigured ? 'Not configured' : readiness.providerValidated ? 'Connected' : 'Validation failed'}</dd><dt>Checkout status</dt><dd className="font-medium">{readiness?.ready ? 'Ready' : 'Disabled'}</dd></dl><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable Express Checkout</label>{readiness?.expressCheckoutEnabled && !readiness.ready ? <p className="text-sm text-amber-700">Express Checkout is enabled in saved settings but is inactive because Razorpay is not ready.</p> : null}<p className="text-xs text-gray-600">LoopD2C Express Checkout currently supports Razorpay for online payments. Configure and validate your Razorpay credentials before enabling Express Checkout. When Express Checkout is disabled, customers continue through Shopify Checkout.</p></div>
    <div><h2 className="text-base font-semibold text-gray-900">Express checkout COD settings</h2><p className="text-sm text-gray-600">Configure COD charge and COD/refund copy shown in the checkout modal.</p></div>
    {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    {message ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p> : null}
    <label className="block text-sm text-gray-700">COD charge (₹)<input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" value={form.codFeeAmountRupees} onChange={(e) => setForm((p) => ({ ...p, codFeeAmountRupees: e.target.value }))} inputMode="decimal" min="0" step="0.01" /><span className="mt-1 block text-xs text-gray-500">Set 0 to disable the COD fee. This charge is separate from Partial COD advance.</span></label>
    <label className="block text-sm text-gray-700">COD/refund information text<textarea className="mt-1 min-h-32 w-full rounded-xl border border-gray-300 px-3 py-2.5" value={form.codInformationText} onChange={(e) => setForm((p) => ({ ...p, codInformationText: e.target.value }))} /></label>
    <button type="submit" className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm text-white" disabled={loading}>{loading ? 'Saving...' : 'Save settings'}</button>
  </form>
}
