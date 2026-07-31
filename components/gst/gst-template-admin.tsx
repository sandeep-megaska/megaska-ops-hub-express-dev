'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { getDefaultGstTemplate, saveDefaultGstTemplate } from '../../lib/gst-client'

type TemplatePreset = 'compact' | 'detailed' | 'dispatch'
type FieldOption = 'showHeaderLogo' | 'showFooterLogo' | 'showSku' | 'showVariant' | 'showProductTitle' | 'showHsn' | 'showTaxBreakup' | 'showAmountInWords' | 'showDeclaration' | 'showFooterNote'
type InvoiceTemplateConfig = Record<FieldOption, boolean> & { preset: TemplatePreset }
type ThemeConfig = {
  headerLogoUrl?: string | null
  footerLogoUrl?: string | null
  invoiceTemplate?: Partial<InvoiceTemplateConfig> | null
}

const PRESETS: Array<{ value: TemplatePreset; label: string; description: string }> = [
  { value: 'compact', label: 'Compact GST Invoice', description: 'Condensed layout with compliant invoice essentials.' },
  { value: 'detailed', label: 'Detailed GST Invoice', description: 'Full GST invoice with tax breakup, notes, declaration, and logos.' },
  { value: 'dispatch', label: 'Dispatch Friendly Invoice', description: 'Packing/dispatch focused layout while retaining GST identifiers.' },
]

const FIELD_OPTIONS: Array<{ key: FieldOption; label: string; locked?: boolean }> = [
  { key: 'showHeaderLogo', label: 'Header logo' },
  { key: 'showFooterLogo', label: 'Footer logo' },
  { key: 'showSku', label: 'SKU' },
  { key: 'showVariant', label: 'Variant' },
  { key: 'showProductTitle', label: 'Product title', locked: true },
  { key: 'showHsn', label: 'HSN/SAC', locked: true },
  { key: 'showTaxBreakup', label: 'Tax breakup' },
  { key: 'showAmountInWords', label: 'Amount in words' },
  { key: 'showDeclaration', label: 'Declaration' },
  { key: 'showFooterNote', label: 'Footer note' },
]

const DEFAULT_TEMPLATE_CONFIG: InvoiceTemplateConfig = {
  preset: 'detailed',
  showHeaderLogo: true,
  showFooterLogo: true,
  showSku: true,
  showVariant: true,
  showProductTitle: true,
  showHsn: true,
  showTaxBreakup: true,
  showAmountInWords: true,
  showDeclaration: true,
  showFooterNote: true,
}


const PRESET_DEFAULTS: Record<TemplatePreset, InvoiceTemplateConfig> = {
  compact: {
    ...DEFAULT_TEMPLATE_CONFIG,
    preset: 'compact',
    showFooterLogo: false,
    showVariant: false,
    showDeclaration: false,
    showFooterNote: false,
  },
  detailed: DEFAULT_TEMPLATE_CONFIG,
  dispatch: {
    ...DEFAULT_TEMPLATE_CONFIG,
    preset: 'dispatch',
    showTaxBreakup: false,
    showAmountInWords: false,
    showDeclaration: false,
  },
}

function normalizeTemplateConfig(value: ThemeConfig['invoiceTemplate']): InvoiceTemplateConfig {
  return { ...DEFAULT_TEMPLATE_CONFIG, ...(value || {}), showProductTitle: true, showHsn: true }
}

const DEFAULT_HEADER = '/logos/header-logo.png'
const DEFAULT_FOOTER = '/logos/footer-logo.avif'

export function GstTemplateAdmin() {
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>({ invoiceTemplate: DEFAULT_TEMPLATE_CONFIG })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    void (async () => {
      const result = await getDefaultGstTemplate()
      if (!result.ok) {
        setError(result.error || 'Failed to load template')
        return
      }
      const data = result.data || {}
      const cfg = (data.themeConfig || {}) as ThemeConfig
      setThemeConfig({ headerLogoUrl: cfg.headerLogoUrl || null, footerLogoUrl: cfg.footerLogoUrl || null, invoiceTemplate: normalizeTemplateConfig(cfg.invoiceTemplate) })
    })()
  }, [])

  async function uploadLogo(slot: 'header' | 'footer', file: File | null) {
    if (!file) return
    const formData = new FormData()
    formData.append('slot', slot)
    formData.append('file', file)
    setLoading(true)
    setError('')
    setMessage('')

    const res = await fetch('/api/gst/templates/assets', { method: 'POST', body: formData })
    const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; url?: string }
    if (!res.ok || !payload.ok || !payload.url) {
      setError(payload.error || 'Upload failed')
      setLoading(false)
      return
    }

    const nextConfig = { ...themeConfig, [slot === 'header' ? 'headerLogoUrl' : 'footerLogoUrl']: payload.url }
    const save = await saveDefaultGstTemplate({ themeConfig: nextConfig })
    if (!save.ok) {
      setError(save.error || 'Failed to save template')
      setLoading(false)
      return
    }

    setThemeConfig(nextConfig)
    setMessage(`${slot} logo updated`) 
    setLoading(false)
  }

  async function clearLogo(slot: 'header' | 'footer') {
    setLoading(true)
    setError('')
    setMessage('')
    const nextConfig = { ...themeConfig, [slot === 'header' ? 'headerLogoUrl' : 'footerLogoUrl']: null }
    const save = await saveDefaultGstTemplate({ themeConfig: nextConfig })
    if (!save.ok) {
      setError(save.error || 'Failed to save template')
      setLoading(false)
      return
    }
    setThemeConfig(nextConfig)
    setMessage(`${slot} logo reset to default`) 
    setLoading(false)
  }

  async function saveTemplateConfig(nextInvoiceTemplate: InvoiceTemplateConfig) {
    setLoading(true)
    setError('')
    setMessage('')
    const nextConfig = { ...themeConfig, invoiceTemplate: nextInvoiceTemplate }
    const save = await saveDefaultGstTemplate({ themeConfig: nextConfig })
    if (!save.ok) {
      setError(save.error || 'Failed to save template')
      setLoading(false)
      return
    }
    setThemeConfig(nextConfig)
    setMessage('Invoice template settings updated')
    setLoading(false)
  }

  const invoiceTemplate = normalizeTemplateConfig(themeConfig.invoiceTemplate)
  const headerSrc = themeConfig.headerLogoUrl || DEFAULT_HEADER
  const footerSrc = themeConfig.footerLogoUrl || DEFAULT_FOOTER

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="mk-card space-y-5">
        <div>
          <h2 className="mk-section-title">GST Invoice Template</h2>
          <p className="mk-section-subtitle">Choose an app-level preset and safe field visibility options. Arbitrary HTML editing is not supported.</p>
        </div>

        <div className="space-y-3">
          <h3 className="mk-section-title" style={{ marginBottom: 0 }}>Preset</h3>
          <div className="grid gap-3 md:grid-cols-3">
            {PRESETS.map((preset) => (
              <button key={preset.value} type="button" disabled={loading} onClick={() => void saveTemplateConfig(PRESET_DEFAULTS[preset.value])} className={`rounded-xl border p-3 text-left text-sm transition ${invoiceTemplate.preset === preset.value ? 'border-[color:var(--primary)] bg-[color:var(--primary-soft)]' : 'border-[color:var(--line)] hover:border-[color:var(--line-strong)]'}`}>
                <span className="font-semibold">{preset.label}</span>
                <span className="mt-1 block text-xs text-[color:var(--muted)]">{preset.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="mk-section-title" style={{ marginBottom: 0 }}>Controlled fields</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {FIELD_OPTIONS.map((option) => (
              <label key={option.key} className="flex items-center justify-between rounded-lg border border-[color:var(--line)] px-3 py-2 text-sm">
                <span>{option.label}{option.locked ? ' (required)' : ''}</span>
                <input type="checkbox" className="h-4 w-4 accent-[color:var(--primary)]" checked={Boolean(invoiceTemplate[option.key])} disabled={loading || option.locked} onChange={(event) => void saveTemplateConfig({ ...invoiceTemplate, [option.key]: event.target.checked })} />
              </label>
            ))}
          </div>
        </div>

        <p className="mk-section-subtitle">Upload header/footer logos for GST invoices (PNG, JPG, WEBP, AVIF, SVG up to 2MB).</p>

        <div className="grid gap-5 md:grid-cols-2">
          {(['header', 'footer'] as const).map((slot) => (
            <div key={slot} className="rounded-xl border border-[color:var(--line)] p-4 space-y-3">
              <h3 className="mk-section-title capitalize" style={{ marginBottom: 0 }}>{slot} logo</h3>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml" onChange={(e) => void uploadLogo(slot, e.target.files?.[0] || null)} disabled={loading} className="text-xs" />
              <button type="button" className="mk-btn mk-btn-sm" onClick={() => void clearLogo(slot)} disabled={loading}>Reset</button>
            </div>
          ))}
        </div>

        {message ? <div className="mk-alert mk-alert-success">{message}</div> : null}
        {error ? <div className="mk-alert mk-alert-error">{error}</div> : null}
      </div>

      <div className="mk-card">
        <h2 className="mk-section-title">Preview</h2>
        <div className="space-y-4">
          <div>
            <div className="mk-help mb-1">Header</div>
            <Image src={headerSrc} alt="Header logo preview" width={260} height={60} className="h-16 w-auto object-contain border rounded bg-white" />
          </div>
          <div>
            <div className="mk-help mb-1">Footer</div>
            <Image src={footerSrc} alt="Footer logo preview" width={180} height={48} className="h-12 w-auto object-contain border rounded bg-white" />
          </div>
        </div>
      </div>
    </div>
  )
}
