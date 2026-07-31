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
    <section className="mk-card space-y-4">
      <div>
        <h2 className="mk-section-title">B2C Sales Register</h2>
        <p className="mk-section-subtitle">
          Create a B2C GST CSV for a selected date range. Includes tax invoices and nets credit / debit
          notes (credit notes appear as negative rows) so the totals match GSTR-1.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="mk-field">
          <label className="mk-label">From date</label>
          <input
            type="date"
            className="mk-input"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setResult(undefined)
            }}
          />
        </div>

        <div className="mk-field">
          <label className="mk-label">To date</label>
          <input
            type="date"
            className="mk-input"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setResult(undefined)
            }}
          />
        </div>

        <div className="mk-field">
          <label className="mk-label">&nbsp;</label>
          <button
            type="button"
            className="mk-btn mk-btn-primary"
            onClick={() => void onCreateReport()}
            disabled={isCreatingReport}
          >
            {isCreatingReport ? 'Creating Report...' : 'Create Report'}
          </button>
        </div>
      </div>

      {error ? <div className="mk-alert mk-alert-error">{error}</div> : null}

      {result ? (
        <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4 text-sm">
          <p className="font-medium text-[color:var(--text)]">Report ready</p>
          <p className="mt-2 text-[color:var(--muted)]">Rows included: {result.rowCount}</p>

          {result.warnings.length > 0 ? (
            <div className="mt-3 text-[color:var(--warning-text)]">
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
              className="mk-btn mk-btn-primary"
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
