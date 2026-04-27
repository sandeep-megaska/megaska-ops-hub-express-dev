'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/admin/gst/settings', label: 'Settings' },
  { href: '/admin/gst/products', label: 'Products' },
  { href: '/admin/gst/orders', label: 'Orders' },
  { href: '/admin/gst/templates', label: 'Templates' },
  { href: '/admin/gst/exports', label: 'Reports' },
]

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

  return (
    <div className="min-h-screen bg-[#f6f6f7]">
      <div className="border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-gray-200 bg-black px-2.5 py-1.5 text-sm font-semibold text-white">
              GST
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
              <p className="mt-1 text-sm text-gray-600">{subtitle || 'GST operations console.'}</p>
            </div>
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
                    active ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100',
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
