'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/admin/gst', label: 'Overview' },
  { href: '/admin/gst/settings', label: 'Settings' },
  { href: '/admin/gst/invoice-preview', label: 'Invoice' },
  { href: '/admin/gst/note-preview', label: 'Notes' },
  { href: '/admin/gst/documents', label: 'Documents' },
  { href: '/admin/gst/products', label: 'Products' },
  { href: '/admin/gst/orders', label: 'Orders' },
  { href: '/admin/gst/templates', label: 'Templates' },
  { href: '/admin/gst/exports', label: 'Reports' },
  { href: '/admin/gst/reconcile', label: 'Reconcile' },
]

function getModeLabel(mode: string): string {
  const value = String(mode || '').toLowerCase()
  if (value === 'true' || value === 'test') return 'Test'
  if (value === 'live') return 'Live'
  if (value === 'disabled') return 'Disabled'
  return mode
}

function getModeClasses(mode: string): string {
  const value = String(mode || '').toLowerCase()
  if (value === 'true' || value === 'test') {
    return 'bg-amber-100 text-amber-800 border-amber-200'
  }
  if (value === 'live') {
    return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  }
  return 'bg-gray-100 text-gray-700 border-gray-200'
}

export function GstShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const enabled = process.env.NEXT_PUBLIC_ENABLE_GST_UI === 'true'
  const mode = process.env.NEXT_PUBLIC_GST_UI_MODE || 'disabled'

  if (!enabled) {
    return (
      <div className="min-h-screen bg-[#f6f6f7] p-6">
        <div className="mx-auto max-w-5xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">GST admin disabled</h1>
          <p className="mt-2 text-sm text-gray-600">
            Enable NEXT_PUBLIC_ENABLE_GST_UI to access GST admin screens.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f6f6f7]">
      <div className="border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-4 px-6 py-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-gray-200 bg-black px-2.5 py-1.5 text-sm font-semibold text-white">
                GST
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
                <p className="mt-1 text-sm text-gray-600">
                  {subtitle || 'Internal GST operations console powered by backend APIs.'}
                </p>
              </div>
            </div>
          </div>

          <div
            className={`rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-wide ${getModeClasses(
              mode
            )}`}
          >
            Mode: {getModeLabel(mode)}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
          <nav className="flex flex-wrap gap-2">
            {nav.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    'rounded-xl px-4 py-2 text-sm font-medium transition',
                    active
                      ? 'bg-gray-900 text-white shadow-sm'
                      : 'text-gray-700 hover:bg-gray-100',
                  ].join(' ')}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
