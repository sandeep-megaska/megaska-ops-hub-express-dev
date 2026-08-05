'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { adminAuthHeaders } from '../../lib/admin-fetch'
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
    const res = await fetch('/api/admin/cod-advance/settings', { headers: await adminAuthHeaders() })
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
      const res = await fetch('/api/admin/cod-advance/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(await adminAuthHeaders()) }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save settings')
      const next = { ...form, version: Number(data.settings.version || form.version + 1) }
      setForm(next); setSaved(next); setMessage('Partial COD settings saved.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save settings') }
    setSubmitting(false)
  }

  if (loading) return <div className="mk-card" style={{ maxWidth: 896 }}>Loading Partial COD settings…</div>

  return <form onSubmit={submit} className="mk-card" style={{ maxWidth: 896, display: 'flex', flexDirection: 'column', gap: 24 }}>
    <div className="mk-page-header" style={{ alignItems: 'center' }}><div><h2 className="mk-section-title">Status</h2><p className="mk-section-subtitle" style={{ margin: 0 }}>When enabled, eligible Cash on Delivery orders can require a small online advance before the order is confirmed.</p></div><span className={`mk-badge ${form.enabled ? 'mk-badge-success' : 'mk-badge-neutral'}`}>{form.enabled ? 'Enabled' : 'Disabled'}</span></div>
    <label className="mk-check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} /> Enable Partial COD</label>

    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><h3 className="mk-section-title" style={{ fontSize: 15, margin: 0 }}>Advance calculation</h3><div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}><label className="mk-check"><input type="radio" checked={form.advanceType === 'FIXED'} onChange={() => setForm((p) => ({ ...p, advanceType: 'FIXED' }))} /> Fixed amount</label><label className="mk-check"><input type="radio" checked={form.advanceType === 'PERCENTAGE'} onChange={() => setForm((p) => ({ ...p, advanceType: 'PERCENTAGE' }))} /> Percentage of payable amount</label></div>{form.advanceType === 'FIXED' ? <div className="mk-field" style={{ maxWidth: 320 }}><label className="mk-label" htmlFor="cod-fixed-advance">Advance amount (₹)</label><input id="cod-fixed-advance" className="mk-input" inputMode="decimal" value={form.fixedAdvanceAmountRupees} onChange={(e) => setForm((p) => ({ ...p, fixedAdvanceAmountRupees: e.target.value }))} /><span className="mk-help">Customer pays this amount online before the remaining amount is collected on delivery.</span></div> : <div className="mk-field" style={{ maxWidth: 320 }}><label className="mk-label" htmlFor="cod-percentage">Advance percentage</label><input id="cod-percentage" className="mk-input" inputMode="decimal" placeholder="12.5" value={form.percentage} onChange={(e) => setForm((p) => ({ ...p, percentage: e.target.value }))} /><span className="mk-help">The percentage is calculated on the customer cash liability after Store Credit.</span></div>}</section>

    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><h3 className="mk-section-title" style={{ fontSize: 15, margin: 0 }}>Optional safeguards</h3><div className="mk-form-grid"><div className="mk-field"><label className="mk-label" htmlFor="cod-min-advance">Minimum advance amount (₹)</label><input id="cod-min-advance" className="mk-input" inputMode="decimal" value={form.minimumAdvanceRupees} onChange={(e) => setForm((p) => ({ ...p, minimumAdvanceRupees: e.target.value }))} /></div><div className="mk-field"><label className="mk-label" htmlFor="cod-max-advance">Maximum advance amount (₹)</label><input id="cod-max-advance" className="mk-input" inputMode="decimal" value={form.maximumAdvanceRupees} onChange={(e) => setForm((p) => ({ ...p, maximumAdvanceRupees: e.target.value }))} /></div><div className="mk-field"><label className="mk-label" htmlFor="cod-min-order">Minimum eligible order value (₹)</label><input id="cod-min-order" className="mk-input" inputMode="decimal" value={form.minOrderRupees} onChange={(e) => setForm((p) => ({ ...p, minOrderRupees: e.target.value }))} /></div><div className="mk-field"><label className="mk-label" htmlFor="cod-max-order">Maximum eligible order value (₹)</label><input id="cod-max-order" className="mk-input" inputMode="decimal" value={form.maxOrderRupees} onChange={(e) => setForm((p) => ({ ...p, maxOrderRupees: e.target.value }))} /></div></div></section>

    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><h3 className="mk-section-title" style={{ fontSize: 15, margin: 0 }}>Customer communication</h3><div className="mk-field"><label className="mk-label" htmlFor="cod-customer-title">Customer title</label><input id="cod-customer-title" maxLength={120} className="mk-input" value={form.customerTitle} placeholder={DEFAULT_CUSTOMER_TITLE} onChange={(e) => setForm((p) => ({ ...p, customerTitle: e.target.value }))} /></div><div className="mk-field"><label className="mk-label" htmlFor="cod-customer-message">Customer message</label><textarea id="cod-customer-message" maxLength={500} className="mk-textarea" value={form.customerMessage} placeholder={DEFAULT_CUSTOMER_MESSAGE} onChange={(e) => setForm((p) => ({ ...p, customerMessage: e.target.value }))} /></div></section>

    <section className="mk-card" style={{ background: 'var(--panel-2)' }}><h3 className="mk-section-title" style={{ fontSize: 15 }}>Preview</h3><p style={{ margin: '4px 0 0', fontWeight: 600 }}>{form.customerTitle.trim() || DEFAULT_CUSTOMER_TITLE}</p><p className="mk-help" style={{ marginTop: 4 }}>{form.customerMessage.trim() || DEFAULT_CUSTOMER_MESSAGE}</p><dl className="mk-grid-2" style={{ marginTop: 12, gap: 4 }}><div>Example order total: {formatPaise(preview.orderTotalPaise)}</div><div>Store Credit: {formatPaise(preview.storeCreditAppliedPaise)}</div><div>Payable amount: {formatPaise(preview.customerCashLiabilityPaise)}</div><div>Pay now: {formatPaise(preview.advanceAmountPaise)}</div><div>Pay on delivery: {formatPaise(preview.codBalanceAmountPaise)}</div></dl></section>

    {message ? <div className="mk-alert mk-alert-success">{message}</div> : null}{error ? <div className="mk-alert mk-alert-error">{error}</div> : null}{dirty ? <p className="mk-help" style={{ color: 'var(--warning-text)' }}>You have unsaved changes.</p> : null}
    <div><button type="submit" className="mk-btn mk-btn-primary" disabled={submitting}>{submitting ? 'Saving…' : 'Save settings'}</button></div>
  </form>
}
