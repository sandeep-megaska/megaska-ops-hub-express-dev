'use client'

import { useEffect, useState } from 'react'
import { adminAuthHeaders } from '../../lib/admin-fetch'

const DEFAULT_TEXT = 'You need to pay to the delivery agent at the time of delivery. In case of any refund, the refund amount will be issued as store credit which you can utilize for future purchases. However, for card and UPI payments, the refund amount will be directly transferred to your original payment method.'

function paiseToRupees(value: unknown) {
  const paise = Number(value || 0)
  return Number.isFinite(paise) ? String(paise / 100) : '0'
}

type PrepaidDiscount = { enabled?: boolean; type?: string; value?: number; maxPaise?: number | null; minSubtotalPaise?: number | null; offerMessage?: string | null }

export function ExpressCheckoutSettingsForm() {
  const [form, setForm] = useState({
    codFeeAmountRupees: '0',
    codInformationText: DEFAULT_TEXT,
    prepaidDiscountEnabled: false,
    prepaidDiscountType: 'PERCENTAGE',
    prepaidDiscountPercent: '0',
    prepaidDiscountFixedRupees: '0',
    prepaidDiscountMaxRupees: '0',
    prepaidDiscountMinSubtotalRupees: '0',
    prepaidOfferMessage: '',
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [readiness, setReadiness] = useState<{ ready: boolean; expressCheckoutEnabled: boolean; providerConfigured: boolean; providerValidated: boolean; reason: string } | null>(null)

  useEffect(() => { (async () => {
    const res = await fetch('/api/admin/express-checkout/settings', { headers: await adminAuthHeaders() })
    const data = await res.json().catch(() => ({}))
    if (data.settings) {
      const prepaid: PrepaidDiscount = data.settings.prepaidDiscount || {}
      const type = prepaid.type === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' : 'PERCENTAGE'
      setForm({
        codFeeAmountRupees: paiseToRupees(data.settings.codFeeAmountPaise),
        codInformationText: String(data.settings.codInformationText || DEFAULT_TEXT),
        prepaidDiscountEnabled: prepaid.enabled === true,
        prepaidDiscountType: type,
        prepaidDiscountPercent: type === 'PERCENTAGE' ? String(prepaid.value ?? 0) : '0',
        prepaidDiscountFixedRupees: type === 'FIXED_AMOUNT' ? paiseToRupees(prepaid.value) : '0',
        prepaidDiscountMaxRupees: paiseToRupees(prepaid.maxPaise),
        prepaidDiscountMinSubtotalRupees: paiseToRupees(prepaid.minSubtotalPaise),
        prepaidOfferMessage: String(prepaid.offerMessage || ''),
      })
    }
    if (data.readiness) { setReadiness(data.readiness); setEnabled(data.readiness.expressCheckoutEnabled) }
  })() }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setMessage('')
    const res = await fetch('/api/admin/express-checkout/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await adminAuthHeaders()) }, body: JSON.stringify({ ...form, enabled }) })
    const data = await res.json().catch(() => ({})); setLoading(false)
    if (data.readiness) setReadiness(data.readiness)
    if (!res.ok || !data.ok) { setError(data.error || 'Failed to save settings'); if (data.readiness) setEnabled(data.readiness.expressCheckoutEnabled) }
    else setMessage('Express checkout settings saved.')
  }

  return <form onSubmit={submit} className="mk-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div className="mk-card" style={{ background: 'var(--panel-2)', display: 'flex', flexDirection: 'column', gap: 12 }}><h2 className="mk-section-title" style={{ margin: 0 }}>Express Checkout</h2><dl className="mk-list"><div className="mk-list-row" style={{ padding: 12 }}><span>Payment provider</span><span style={{ fontWeight: 600 }}>Razorpay</span></div><div className="mk-list-row" style={{ padding: 12 }}><span>Razorpay status</span><span className={`mk-badge ${!readiness?.providerConfigured ? 'mk-badge-neutral' : readiness.providerValidated ? 'mk-badge-success' : 'mk-badge-danger'}`}>{!readiness?.providerConfigured ? 'Not configured' : readiness.providerValidated ? 'Connected' : 'Validation failed'}</span></div><div className="mk-list-row" style={{ padding: 12 }}><span>Checkout status</span><span className={`mk-badge ${readiness?.ready ? 'mk-badge-success' : 'mk-badge-neutral'}`}>{readiness?.ready ? 'Ready' : 'Disabled'}</span></div></dl><label className="mk-check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable Express Checkout</label><p className="mk-help">Prepaid and Cash on Delivery both complete on the native Shopify Checkout, so Express Checkout no longer requires Razorpay. Enable the in-drawer Prepaid/COD choice under Cart settings to drive the flow; the prepaid discount and COD hiding are applied by Shopify Functions at checkout. Razorpay is used only by the legacy in-app payment modal.</p></div>
    <div><h2 className="mk-section-title">Express checkout COD settings</h2><p className="mk-section-subtitle" style={{ margin: 0 }}>Configure the COD charge and the COD/refund copy shown at checkout.</p></div>
    {error ? <div className="mk-alert mk-alert-error">{error}</div> : null}
    {message ? <div className="mk-alert mk-alert-success">{message}</div> : null}
    <div className="mk-field"><label className="mk-label" htmlFor="ec-cod-fee">COD charge (₹)</label><input id="ec-cod-fee" className="mk-input" value={form.codFeeAmountRupees} onChange={(e) => setForm((p) => ({ ...p, codFeeAmountRupees: e.target.value }))} inputMode="decimal" min="0" step="0.01" /><span className="mk-help">Set 0 to disable the COD fee. This charge is separate from Partial COD advance.</span></div>
    <div className="mk-field"><label className="mk-label" htmlFor="ec-cod-text">COD/refund information text</label><textarea id="ec-cod-text" className="mk-textarea" value={form.codInformationText} onChange={(e) => setForm((p) => ({ ...p, codInformationText: e.target.value }))} /></div>
    <div><h2 className="mk-section-title">Prepaid discount offer</h2><p className="mk-section-subtitle" style={{ margin: 0 }}>Reward shoppers who pay online. The discount applies only to prepaid methods at express checkout — COD prices stay unchanged. The offer is calculated on the product subtotal and reduces the taxable value on the GST invoice.</p></div>
    <label className="mk-check"><input type="checkbox" checked={form.prepaidDiscountEnabled} onChange={(e) => setForm((p) => ({ ...p, prepaidDiscountEnabled: e.target.checked }))} /> Enable prepaid discount</label>
    <div className="mk-field"><label className="mk-label" htmlFor="ec-prepaid-type">Discount type</label><select id="ec-prepaid-type" className="mk-input" value={form.prepaidDiscountType} onChange={(e) => setForm((p) => ({ ...p, prepaidDiscountType: e.target.value }))}><option value="PERCENTAGE">Percentage of subtotal</option><option value="FIXED_AMOUNT">Fixed amount</option></select></div>
    {form.prepaidDiscountType === 'PERCENTAGE'
      ? <div className="mk-field"><label className="mk-label" htmlFor="ec-prepaid-percent">Discount percentage (%)</label><input id="ec-prepaid-percent" className="mk-input" value={form.prepaidDiscountPercent} onChange={(e) => setForm((p) => ({ ...p, prepaidDiscountPercent: e.target.value }))} inputMode="decimal" min="0" max="100" step="0.01" /><span className="mk-help">For example, 15 gives a 15% prepaid discount on the product subtotal.</span></div>
      : <div className="mk-field"><label className="mk-label" htmlFor="ec-prepaid-fixed">Discount amount (₹)</label><input id="ec-prepaid-fixed" className="mk-input" value={form.prepaidDiscountFixedRupees} onChange={(e) => setForm((p) => ({ ...p, prepaidDiscountFixedRupees: e.target.value }))} inputMode="decimal" min="0" step="0.01" /></div>}
    <div className="mk-field"><label className="mk-label" htmlFor="ec-prepaid-max">Maximum discount cap (₹)</label><input id="ec-prepaid-max" className="mk-input" value={form.prepaidDiscountMaxRupees} onChange={(e) => setForm((p) => ({ ...p, prepaidDiscountMaxRupees: e.target.value }))} inputMode="decimal" min="0" step="0.01" /><span className="mk-help">Set 0 for no cap. Caps the discount (useful with a percentage), e.g. 15% up to ₹200.</span></div>
    <div className="mk-field"><label className="mk-label" htmlFor="ec-prepaid-min">Minimum order subtotal (₹)</label><input id="ec-prepaid-min" className="mk-input" value={form.prepaidDiscountMinSubtotalRupees} onChange={(e) => setForm((p) => ({ ...p, prepaidDiscountMinSubtotalRupees: e.target.value }))} inputMode="decimal" min="0" step="0.01" /><span className="mk-help">Set 0 to apply to all orders. The offer only applies when the product subtotal is at least this amount.</span></div>
    <div className="mk-field"><label className="mk-label" htmlFor="ec-prepaid-msg">Cart drawer / checkout teaser (optional)</label><input id="ec-prepaid-msg" className="mk-input" value={form.prepaidOfferMessage} maxLength={160} placeholder="🎉 Exciting {percent} offer waiting at checkout!" onChange={(e) => setForm((p) => ({ ...p, prepaidOfferMessage: e.target.value }))} /><span className="mk-help">Shown in the cart drawer and express checkout when the offer applies. Leave blank for the default. Placeholders: <b>{'{percent}'}</b> (e.g. 15%), <b>{'{amount}'}</b> (the shopper&apos;s saving on this cart), <b>{'{cap}'}</b> (the max cap).</span></div>
    <div><button type="submit" className="mk-btn mk-btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save settings'}</button></div>
  </form>
}
