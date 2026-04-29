'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { getDefaultGstTemplate, saveDefaultGstTemplate } from '../../lib/gst-client'

type ThemeConfig = {
  headerLogoUrl?: string | null
  footerLogoUrl?: string | null
}

const DEFAULT_HEADER = '/logos/header-logo.png'
const DEFAULT_FOOTER = '/logos/footer-logo.avif'

export function GstTemplateAdmin() {
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>({})
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
      setThemeConfig({ headerLogoUrl: cfg.headerLogoUrl || null, footerLogoUrl: cfg.footerLogoUrl || null })
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

  const headerSrc = themeConfig.headerLogoUrl || DEFAULT_HEADER
  const footerSrc = themeConfig.footerLogoUrl || DEFAULT_FOOTER

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Invoice Template Logos</h2>
        <p className="text-sm text-gray-600">Upload header/footer logos for GST invoices (PNG, JPG, WEBP, AVIF, SVG up to 2MB).</p>

        <div className="grid gap-5 md:grid-cols-2">
          {(['header', 'footer'] as const).map((slot) => (
            <div key={slot} className="rounded-xl border border-gray-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold capitalize">{slot} logo</h3>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml" onChange={(e) => void uploadLogo(slot, e.target.files?.[0] || null)} disabled={loading} className="text-xs" />
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs" onClick={() => void clearLogo(slot)} disabled={loading}>Reset</button>
            </div>
          ))}
        </div>

        {message ? <p className="text-sm text-green-700">{message}</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Preview</h2>
        <div className="space-y-4">
          <div>
            <div className="text-xs text-gray-500 mb-1">Header</div>
            <Image src={headerSrc} alt="Header logo preview" width={260} height={60} className="h-16 w-auto object-contain border rounded bg-white" />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Footer</div>
            <Image src={footerSrc} alt="Footer logo preview" width={180} height={48} className="h-12 w-auto object-contain border rounded bg-white" />
          </div>
        </div>
      </div>
    </div>
  )
}
