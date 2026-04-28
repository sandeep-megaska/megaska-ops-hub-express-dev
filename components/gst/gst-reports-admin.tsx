'use client'

import { useState } from 'react'
import { downloadReportRunFile, generateB2cSalesRegisterRun } from '../../lib/gst-client'

type ReportWarning = {
  code: string
  message: string
  documentId: string
  documentNumber: string
  lineNumber?: number
}

const dateToday = new Date().toISOString().slice(0, 10)
const monthStart = new Date()
monthStart.setUTCDate(1)
const dateMonthStart = monthStart.toISOString().slice(0, 10)

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function downloadFileUrl(fileUrl: string, filename: string) {
  const link = document.createElement('a')
  link.href = fileUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function GstReportsAdmin() {
  const [from, setFrom] = useState(dateMonthStart)
  const [to, setTo] = useState(dateToday)
  const [isExportingB2c, setIsExportingB2c] = useState(false)
  const [b2cError, setB2cError] = useState<string>()
  const [b2cWarnings, setB2cWarnings] = useState<ReportWarning[]>([])

  async function onDownloadB2cCsv() {
    setIsExportingB2c(true)
    setB2cError(undefined)
    setB2cWarnings([])

    const filename = from && to ? `gst-b2c-sales-register-${from}-to-${to}.csv` : 'gst-b2c-sales-register.csv'
    const runRes = await generateB2cSalesRegisterRun({ from, to })

    if (!runRes.ok || !runRes.data) {
      setB2cError(runRes.error || 'Failed to generate B2C export')
      setIsExportingB2c(false)
      return
    }

    const warnings = Array.isArray(runRes.data.warnings) ? runRes.data.warnings : []
    setB2cWarnings(warnings)

    if (runRes.data.fileUrl) {
      downloadFileUrl(runRes.data.fileUrl, filename)
      setIsExportingB2c(false)
      return
    }

    const fileRes = await downloadReportRunFile(runRes.data.id)
    if (!fileRes.ok) {
      setB2cError(fileRes.error || 'Failed to download B2C export')
      setIsExportingB2c(false)
      return
    }

    if (typeof fileRes.data?.csv === 'string' && fileRes.data.csv.length > 0) {
      downloadCsv(filename, fileRes.data.csv)
      setIsExportingB2c(false)
      return
    }

    if (fileRes.data?.fileUrl) {
      downloadFileUrl(fileRes.data.fileUrl, filename)
      setIsExportingB2c(false)
      return
    }

    setB2cError('Report generated, but no downloadable file was returned')
    setIsExportingB2c(false)
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">Reports</h2>
        <p className="mt-1 text-sm text-gray-600">Download GST exports without rebuilding report history.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input type="date" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          <button
            type="button"
            className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onDownloadB2cCsv()}
            disabled={isExportingB2c}
          >
            {isExportingB2c ? 'Downloading B2C CSV...' : 'Download B2C CSV'}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">B2C Sales Register</h3>
          <p className="mt-2 text-sm text-gray-600">Export GST B2C invoice data as CSV for CA submission.</p>
          {b2cError ? <p className="mt-3 text-sm text-red-600">{b2cError}</p> : null}
          {b2cWarnings.length > 0 ? (
            <div className="mt-3 text-sm text-amber-700">
              <p className="font-medium">Warnings ({b2cWarnings.length})</p>
              <ul className="list-disc pl-5">
                {b2cWarnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.documentId}-${warning.lineNumber ?? 'na'}-${index}`}>
                    {warning.message} (Doc: {warning.documentNumber}{warning.lineNumber != null ? `, Line ${warning.lineNumber}` : ''})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700">Credit Note Register</h3>
          <p className="mt-2 text-sm text-gray-500">Coming soon.</p>
          <button type="button" disabled className="mt-4 rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-500">
            Coming Soon
          </button>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700">Debit Note Register</h3>
          <p className="mt-2 text-sm text-gray-500">Coming soon.</p>
          <button type="button" disabled className="mt-4 rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-500">
            Coming Soon
          </button>
        </article>
      </section>
    </div>
  )
}
