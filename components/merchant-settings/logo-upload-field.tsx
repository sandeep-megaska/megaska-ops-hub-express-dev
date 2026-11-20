'use client'

import { useRef, useState } from 'react'
import { adminAuthHeaders } from '../../lib/admin-fetch'

// Logo picker for Merchant Settings: the image is uploaded to the store's Shopify Files
// and only its cdn.shopify.com URL is saved (in a hidden input submitted with the form).
// There is no URL box: storefront apps may only load from servers they declare.
export function LogoUploadField({ name, label, help, defaultValue }: { name: string; label: string; help?: string; defaultValue?: string | null }) {
  const [url, setUrl] = useState(defaultValue || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const id = `${name}-file`

  async function upload(file: File) {
    setBusy(true); setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/admin/merchant-settings/logo', { method: 'POST', headers: await adminAuthHeaders(), body })
      const data = await response.json().catch(() => null) as { ok?: boolean; url?: string; error?: string } | null
      if (data?.ok && data.url) setUrl(data.url)
      else setError(data?.error || 'The upload didn\'t work. Please try again.')
    } catch {
      setError('The upload didn\'t work. Please try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <input type="hidden" name={name} value={url} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-14 w-28 place-items-center overflow-hidden rounded-lg border border-[var(--line,#e5e7eb)] bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- Shopify CDN image chosen by the merchant. */}
          {url ? <img src={url} alt="" className="max-h-12 max-w-24 object-contain" /> : <span className="text-xs text-gray-500">No logo</span>}
        </div>
        <input ref={input} id={id} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={busy}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
        <button type="button" className="mk-btn" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}
        </button>
        {url && !busy ? <button type="button" className="mk-btn" onClick={() => setUrl('')}>Remove</button> : null}
      </div>
      <p className="text-xs text-gray-500">{help ?? 'PNG, JPG, WebP or GIF, up to 2 MB. Saved to your Shopify Files.'}</p>
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
