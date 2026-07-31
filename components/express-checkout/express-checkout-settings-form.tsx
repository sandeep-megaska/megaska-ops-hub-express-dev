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

  return <form onSubmit={submit} className="mk-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div className="mk-card" style={{ background: 'var(--panel-2)', display: 'flex', flexDirection: 'column', gap: 12 }}><h2 className="mk-section-title" style={{ margin: 0 }}>Express Checkout</h2><dl className="mk-list"><div className="mk-list-row" style={{ padding: 12 }}><span>Payment provider</span><span style={{ fontWeight: 600 }}>Razorpay</span></div><div className="mk-list-row" style={{ padding: 12 }}><span>Razorpay status</span><span className={`mk-badge ${!readiness?.providerConfigured ? 'mk-badge-neutral' : readiness.providerValidated ? 'mk-badge-success' : 'mk-badge-danger'}`}>{!readiness?.providerConfigured ? 'Not configured' : readiness.providerValidated ? 'Connected' : 'Validation failed'}</span></div><div className="mk-list-row" style={{ padding: 12 }}><span>Checkout status</span><span className={`mk-badge ${readiness?.ready ? 'mk-badge-success' : 'mk-badge-neutral'}`}>{readiness?.ready ? 'Ready' : 'Disabled'}</span></div></dl><label className="mk-check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable Express Checkout</label>{readiness?.expressCheckoutEnabled && !readiness.ready ? <div className="mk-alert mk-alert-info">Express Checkout is enabled in saved settings but is inactive because Razorpay is not ready.</div> : null}<p className="mk-help">LoopD2C Express Checkout currently supports Razorpay for online payments. Configure and validate your Razorpay credentials before enabling Express Checkout. When Express Checkout is disabled, customers continue through Shopify Checkout.</p></div>
    <div><h2 className="mk-section-title">Express checkout COD settings</h2><p className="mk-section-subtitle" style={{ margin: 0 }}>Configure COD charge and COD/refund copy shown in the checkout modal.</p></div>
    {error ? <div className="mk-alert mk-alert-error">{error}</div> : null}
    {message ? <div className="mk-alert mk-alert-success">{message}</div> : null}
    <div className="mk-field"><label className="mk-label" htmlFor="ec-cod-fee">COD charge (₹)</label><input id="ec-cod-fee" className="mk-input" value={form.codFeeAmountRupees} onChange={(e) => setForm((p) => ({ ...p, codFeeAmountRupees: e.target.value }))} inputMode="decimal" min="0" step="0.01" /><span className="mk-help">Set 0 to disable the COD fee. This charge is separate from Partial COD advance.</span></div>
    <div className="mk-field"><label className="mk-label" htmlFor="ec-cod-text">COD/refund information text</label><textarea id="ec-cod-text" className="mk-textarea" value={form.codInformationText} onChange={(e) => setForm((p) => ({ ...p, codInformationText: e.target.value }))} /></div>
    <div><button type="submit" className="mk-btn mk-btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save settings'}</button></div>
  </form>
}
