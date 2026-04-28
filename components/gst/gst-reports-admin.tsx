'use client'

import { useState } from 'react'
import { downloadReportRunFile, generateB2cSalesRegisterRun, getB2cInvoiceAvailability, syncOrders } from '../../lib/gst-client'

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
  const [isSyncingRange, setIsSyncingRange] = useState(false)
  const [isExportingB2c, setIsExportingB2c] = useState(false)
  const [b2cError, setB2cError] = useState<string>()
  const [b2cWarnings, setB2cWarnings] = useState<ReportWarning[]>([])
  const [rangeSyncSummary, setRangeSyncSummary] = useState<{
    syncedOrderCount?: number
    importedOrderCount?: number
    invoiceCount: number
    warnings: string[]
    errors: string[]
  }>()

  async function onSyncOrdersForRange() {
    setIsSyncingRange(true)
    setB2cError(undefined)
    setB2cWarnings([])
    setRangeSyncSummary(undefined)

    const syncRes = await syncOrders({ from, to })
    if (!syncRes.ok) {
      setB2cError(syncRes.error || 'Failed to sync orders for selected range')
      setIsSyncingRange(false)
      return
    }

    const syncData = (syncRes.data || {}) as Record<string, unknown>
    const syncWarnings = Array.isArray(syncData.warnings) ? syncData.warnings.map((entry) => String(entry || '').trim()).filter(Boolean) : []
    const syncErrors = Array.isArray(syncData.perOrder)
      ? syncData.perOrder
          .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
          .filter((entry) => String(entry.status || '').toUpperCase() === 'FAILED')
          .map((entry) => String(entry.error || `Order ${String(entry.orderName || entry.shopifyOrderId || '').trim()} failed`))
          .filter(Boolean)
      : []

    const availabilityRes = await getB2cInvoiceAvailability({ from, to })
    if (!availabilityRes.ok) {
      setB2cError(availabilityRes.error || 'Failed to check GST invoice availability for selected range')
      setRangeSyncSummary({
        syncedOrderCount: typeof syncData.fetched === 'number' ? syncData.fetched : undefined,
        importedOrderCount: typeof syncData.imported === 'number' ? syncData.imported : undefined,
        invoiceCount: 0,
        warnings: syncWarnings,
        errors: syncErrors,
      })
      setIsSyncingRange(false)
      return
    }

    const invoiceCount = Number(availabilityRes.data?.invoiceCount || 0)
    const combinedWarnings = [...syncWarnings]
    if (invoiceCount === 0) {
      combinedWarnings.push('No GST invoices found for this range. Generate GST invoices from Orders first.')
    }

    setRangeSyncSummary({
      syncedOrderCount: typeof syncData.fetched === 'number' ? syncData.fetched : undefined,
      importedOrderCount: typeof syncData.imported === 'number' ? syncData.imported : undefined,
      invoiceCount,
      warnings: combinedWarnings,
      errors: syncErrors,
    })
    setIsSyncingRange(false)
  }

  async function onDownloadB2cCsv() {
    setIsExportingB2c(true)
    setB2cError(undefined)
    setB2cWarnings([])

    const filename = from && to ? `gst-b2c-sales-register-${from}-to-${to}.csv` : 'gst-b2c-sales-register.csv'
    const runRes = await generateB2cSalesRegisterRun({ from, to })
    console.log('B2C generate run response:', runRes)

    if (!runRes.ok) {
      setB2cError(runRes.error || 'Failed to generate B2C export')
      setIsExportingB2c(false)
      return
    }

    if (!runRes.data) {
      setB2cError('Failed to generate B2C export')
      setIsExportingB2c(false)
      return
    }

    const warnings = Array.isArray(runRes.data.warnings) ? runRes.data.warnings.filter(isReportWarning) : []
    setB2cWarnings(warnings)

    if (typeof (runRes.data as Record<string, unknown>).csv === 'string' && String((runRes.data as Record<string, unknown>).csv).length > 0) {
      downloadCsv(filename, String((runRes.data as Record<string, unknown>).csv))
      setIsExportingB2c(false)
      return
    }

    const runRecord = ((runRes.data as Record<string, unknown>).run as Record<string, unknown> | undefined) || {}
    const runFileUrl = typeof runRecord.fileUrl === 'string' ? runRecord.fileUrl : ''

    if (runFileUrl.length > 0) {
      downloadFileUrl(runFileUrl, filename)
      setIsExportingB2c(false)
      return
    }

    const runResRecord: Record<string, unknown> = typeof runRes === 'object' && runRes !== null ? runRes : {}
    const runData = runRecord
    const runDataRecord: Record<string, unknown> = typeof runData === 'object' && runData !== null ? runData : {}
    const runId =
      (typeof runDataRecord.id === 'string' && runDataRecord.id.length > 0 ? runDataRecord.id : '') ||
      (typeof runDataRecord.runId === 'string' && runDataRecord.runId.length > 0 ? runDataRecord.runId : '') ||
      (typeof runResRecord.id === 'string' && runResRecord.id.length > 0 ? runResRecord.id : '') ||
      (typeof runResRecord.runId === 'string' && runResRecord.runId.length > 0 ? runResRecord.runId : '')

    if (!runId) {
      setB2cError('Failed to generate B2C export')
      setIsExportingB2c(false)
      return
    }

    const fileRes = await downloadReportRunFile(runId)
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

    if (typeof fileRes.data?.fileUrl === 'string' && fileRes.data.fileUrl.length > 0) {
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

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            type="date"
            className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setRangeSyncSummary(undefined)
            }}
          />
          <input
            type="date"
            className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setRangeSyncSummary(undefined)
            }}
          />
          <button
            type="button"
            className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onSyncOrdersForRange()}
            disabled={isSyncingRange || isExportingB2c}
          >
            {isSyncingRange ? 'Syncing Orders...' : 'Sync Orders for Range'}
          </button>
          <button
            type="button"
            className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onDownloadB2cCsv()}
            disabled={isExportingB2c || isSyncingRange || !rangeSyncSummary || rangeSyncSummary.invoiceCount <= 0}
          >
            {isExportingB2c ? 'Downloading B2C CSV...' : 'Download B2C CSV'}
          </button>
        </div>

        {rangeSyncSummary ? (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            <p className="font-medium text-gray-900">Range sync summary</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {typeof rangeSyncSummary.syncedOrderCount === 'number' ? <li>Synced orders fetched: {rangeSyncSummary.syncedOrderCount}</li> : null}
              {typeof rangeSyncSummary.importedOrderCount === 'number' ? <li>Imported orders: {rangeSyncSummary.importedOrderCount}</li> : null}
              <li>GST invoice documents in range: {rangeSyncSummary.invoiceCount}</li>
            </ul>
            {rangeSyncSummary.errors.length > 0 ? (
              <div className="mt-3 text-red-600">
                <p className="font-medium">Errors ({rangeSyncSummary.errors.length})</p>
                <ul className="list-disc pl-5">
                  {rangeSyncSummary.errors.map((error, index) => (
                    <li key={`${error}-${index}`}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {rangeSyncSummary.warnings.length > 0 ? (
              <div className="mt-3 text-amber-700">
                <p className="font-medium">Warnings ({rangeSyncSummary.warnings.length})</p>
                <ul className="list-disc pl-5">
                  {rangeSyncSummary.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
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
