'use client'

import { useState } from 'react'
import { generateB2cSalesRegisterRun } from '../../lib/gst-client'

type ReportWarning = {
  code: string
  message: string
  documentId: string
  documentNumber: string
  lineNumber?: number
}

function isReportWarning(value: unknown): value is ReportWarning {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.code === 'string' &&
    typeof record.message === 'string' &&
    typeof record.documentId === 'string' &&
    typeof record.documentNumber === 'string' &&
    (typeof record.lineNumber === 'undefined' || typeof record.lineNumber === 'number')
  )
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

export function GstReportsAdmin() {
  const [from, setFrom] = useState(dateMonthStart)
  const [to, setTo] = useState(dateToday)
  const [isCreatingReport, setIsCreatingReport] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<{
    rowCount: number
    warnings: ReportWarning[]
    csv: string
  }>()

  async function onCreateReport() {
    setIsCreatingReport(true)
    setError(undefined)
    setResult(undefined)

    const res = await generateB2cSalesRegisterRun({ from, to })
    if (!res.ok || !res.data) {
      setError(res.error || 'Failed to create B2C report')
      setIsCreatingReport(false)
      return
    }

    const csv = typeof (res.data as Record<string, unknown>).csv === 'string' ? String((res.data as Record<string, unknown>).csv) : ''
    if (!csv) {
      setError('Report generated, but no downloadable CSV was returned')
      setIsCreatingReport(false)
      return
    }

    setResult({
      rowCount: Number((res.data as Record<string, unknown>).rowCount || 0),
      warnings: Array.isArray(res.data.warnings) ? res.data.warnings.filter(isReportWarning) : [],
      csv,
    })

    setIsCreatingReport(false)
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">B2C Sales Register</h2>
      <p className="mt-1 text-sm text-gray-600">Create B2C GST CSV for a selected date range.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-sm text-gray-700">
          <span className="mb-1 block">From date</span>
          <input
            type="date"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setResult(undefined)
            }}
          />
        </label>

        <label className="text-sm text-gray-700">
          <span className="mb-1 block">To date</span>
          <input
            type="date"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setResult(undefined)
            }}
          />
        </label>

        <div className="flex items-end">
          <button
            type="button"
            className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onCreateReport()}
            disabled={isCreatingReport}
          >
            {isCreatingReport ? 'Creating Report...' : 'Create Report'}
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Report ready</p>
          <p className="mt-2">Invoice rows included: {result.rowCount}</p>

          {result.warnings.length > 0 ? (
            <div className="mt-3 text-amber-700">
              <p className="font-medium">Warnings ({result.warnings.length})</p>
              <ul className="list-disc pl-5">
                {result.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.documentId}-${warning.lineNumber ?? 'na'}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4">
            <button
              type="button"
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white"
              onClick={() => downloadCsv(`gst-b2c-sales-register-${from}-to-${to}.csv`, result.csv)}
            >
              Download CSV
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
