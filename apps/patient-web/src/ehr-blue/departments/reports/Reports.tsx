import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatDate, formatDateTime, lagosDay } from '@hid/ui/display'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { reportsApi, type OperationsReport, type ReportExportFormat } from '../../../staff/api'
import { saveFile } from '../../../download'
import { isDemoFacility } from '../../blueFacilities'
import { ReportsSample } from '../../frame/admin/AdminSamples'
import { useSampleCan } from '../../frame/sampleAccess'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { DailyLine } from './DailyLine'
import { reportBlob, reportFileContent, reportFileName } from './reportFile'
import {
  DEFAULT_DAYS, DESCRIPTION, DOWNLOAD_FAILED, DRAFT, EXPORT_NOT_AVAILABLE, EYEBROW, FIGURES, MAX_DAYS, NOT_AVAILABLE, READ_FAILED,
  READ_REFUSED, SCOPE, SECTION_ORDER, SECTION_WORDS, SMALL_COUNTS, TITLE, canExportReports, canReadReports, comparisonText, countText, coverageText, daysText, earliestDay,
  holdsReportRole, isDay, isReport, lastDays, learnDownloads, learnReportsServed, notServed, previousPeriod, rangeProblem, rangeText,
  reasonText, refusalWords, sampleText, shownSections, useDownloadsOff, useReportsServed, valueText,
  type DayRange, type ShownSection,
} from './reportRules'
import './reports.css'

/**
 * Reports & Analytics in the blue EHR (hid-system REP-1, 0203 and 0204), in place of Akos's sample
 * (frame/admin/AdminSamples.tsx ReportsSample) for the facility's administrators: a range of Lagos days (the last 30 by
 * default, at most 92), the facility's operations figures from its own live records in five sections (waiting list,
 * registrations, visits, laboratory, pharmacy), each against the same number of days before and with a daily line, and,
 * for those who may, CSV and PDF downloads built from the download's own answer, in which small counts are hidden.
 *
 * Built but switched off: while ehr-api answers 404 (before REP-1) or 503 REPORTS_NOT_AVAILABLE (REPORTS_ENABLED off at
 * a real facility), a demo facility keeps today's sample and any other says "Reports are not available yet."; the sidebar
 * stops listing the page there. Members without reports.read keep today's sample at a demo facility, under the design's
 * roles; elsewhere they are told who can see reports. Totals only: no patient name, list or link, and the address holds
 * nothing but the two days.
 */
export function ReportsPage() {
  const { facility, permissions } = useDeptAccess()
  const sampleCan = useSampleCan()
  if (!facility) return <ReportsUnavailable />
  if (canReadReports(permissions)) return <LiveReports key={facility.id} facilityId={facility.id} facilityName={facility.name} />
  if (isDemoFacility(facility.id) && sampleCan('reports')) return <ReportsSample />
  return <ReportsUnavailable />
}

/**
 * The page's own refusal, which reads nothing. An administrator without the code is on a backend before 0204, where
 * reports are not available yet; anyone else is told who can see them. Never the word the backend's guard uses.
 */
export function ReportsUnavailable() {
  const { facility } = useDeptAccess()
  return <DeptUnavailable title={TITLE} message={facility && holdsReportRole(facility.roles) ? NOT_AVAILABLE : READ_REFUSED} />
}

/** The range the address asks for (?from=…&to=…), or the last 30 days when it asks for none. */
function useRange(): [DayRange, (range: DayRange) => void] {
  const [params, setParams] = useSearchParams()
  const from = params.get('from')
  const to = params.get('to')
  const range = from !== null || to !== null ? { from: from ?? '', to: to ?? '' } : lastDays(DEFAULT_DAYS)
  const choose = useCallback((next: DayRange) => setParams({ from: next.from, to: next.to }, { replace: true }), [setParams])
  return [range, choose]
}

function LiveReports({ facilityId, facilityName }: { readonly facilityId: string; readonly facilityName: string }) {
  const { permissions } = useDeptAccess()
  const served = useReportsServed(facilityId)
  const [range, choose] = useRange()
  const problem = rangeProblem(range)
  const loader = useCallback((id: string) => reportsApi.operations(id, range.from, range.to).then(answer => {
    if (!isReport(answer)) throw new Error('Not a report')
    learnReportsServed(id)
    return answer
  }, (caught: unknown) => {
    learnReportsServed(id, caught)
    throw caught
  }), [range.from, range.to])
  const read = useFacilityRead<OperationsReport>(facilityId, problem === '' && served !== false, loader, READ_FAILED)
  const { refresh } = read

  // Not served here: the demo's sample at a demo facility (as before REP-1), "not available yet" anywhere else.
  if (served === false || (read.caught !== null && notServed(read.caught))) {
    return isDemoFacility(facilityId) ? <ReportsSample /> : <DeptUnavailable title={TITLE} message={NOT_AVAILABLE} />
  }

  const report = read.value
  const error = read.error ? refusalWords(read.caught, READ_FAILED) : ''
  const draft = report !== null && report.definitions?.signedOff !== true

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-reports"
      secondaryActions={problem === '' ? <EhrButton variant="secondary" onClick={() => void refresh()} busy={read.loading && report !== null}>Refresh</EhrButton> : undefined}>
      {draft ? <DeptNotice tone="caution" title="Draft">{DRAFT}</DeptNotice> : null}
      <RangeForm key={`${range.from}|${range.to}`} range={range} onChoose={choose} />
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
      {problem === '' && report === null && read.loading ? <p className="hid-ehr-state-message" role="status">Loading the report…</p> : null}
      {report !== null && problem === '' ? (
        <>
          <ReportSummary report={report} loading={read.loading} />
          {canExportReports(permissions) ? <Downloads facilityId={facilityId} facilityName={facilityName} report={report} /> : null}
          {shownSections(report).map(section => <ReportSectionView key={section.key} section={section} days={report.days} />)}
          <Definitions />
        </>
      ) : null}
    </DeptPage>
  )
}

/** "From" and "Through", Lagos days, with the usual ranges a press away. Nothing is read until a range is shown. */
function RangeForm({ range, onChoose }: { readonly range: DayRange; readonly onChoose: (range: DayRange) => void }) {
  const today = lagosDay()
  const [values, setValues] = useState<DayRange>(range)
  const [missing, setMissing] = useState<{ from?: string; to?: string }>({})
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = { ...(isDay(values.from) ? {} : { from: 'Enter the first day.' }), ...(isDay(values.to) ? {} : { to: 'Enter the last day.' }) }
    setMissing(found)
    if (Object.keys(found).length === 0) onChoose(values)
  }
  return (
    <DeptSection title="Days to report on" headingId="reports-range">
      <form className="hid-ehr-dept-form" onSubmit={submit} noValidate aria-labelledby="reports-range">
        <div className="hid-ehr-dept-form-grid">
          <EhrField label="From" error={missing.from}>
            <EhrInput type="date" value={values.from} min={earliestDay(today)} max={today}
              onChange={event => setValues(previous => ({ ...previous, from: event.target.value }))} />
          </EhrField>
          <EhrField label="Through" hint={`Up to ${MAX_DAYS} days, ending today or earlier.`} error={missing.to}>
            <EhrInput type="date" value={values.to} min={earliestDay(today)} max={today}
              onChange={event => setValues(previous => ({ ...previous, to: event.target.value }))} />
          </EhrField>
        </div>
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit">Show figures</EhrButton>
          {[7, 30, MAX_DAYS].map(days => (
            <EhrButton key={days} type="button" variant="secondary" size="sm" icon={null} onClick={() => onChoose(lastDays(days, today))}>
              Last {days} days
            </EhrButton>
          ))}
        </div>
      </form>
    </DeptSection>
  )
}

/** What the figures below cover: the days shown, the days compared with, and when they were worked out (Lagos time). */
function ReportSummary({ report, loading }: { readonly report: OperationsReport; readonly loading: boolean }) {
  return (
    <div className="hid-ehr-dept-reports-summary">
      <p className="hid-ehr-dept-strong">{rangeText(report.from, report.to)} ({daysText(report.days)})</p>
      <p className="hid-ehr-dept-muted">
        Compared with {rangeText(report.previousFrom, report.previousTo)}.{' '}
        {report.includesToday ? 'Today is counted so far. ' : ''}
        Worked out {formatDateTime(report.generatedAt)}.
      </p>
      <p className="hid-ehr-dept-muted">{SCOPE}</p>
      <p className="hid-ehr-dept-muted" role="status">{loading ? 'Loading the report again…' : ''}</p>
    </div>
  )
}

function ReportSectionView({ section, days }: { readonly section: ShownSection; readonly days: number }) {
  const headingId = `reports-${section.key}`
  const checkedIn = section.figures.find(shown => shown.figure.key === 'checkedIn')?.figure
  return (
    <DeptSection title={section.title} headingId={headingId}>
      <ul className="hid-ehr-dept-reports-figures" aria-labelledby={headingId}>
        {section.figures.map(({ figure, words }) => {
          const sample = sampleText(figure, words)
          const coverage = coverageText(figure, checkedIn, days)
          const reasons = (figure.byReason ?? []).flatMap(reason => {
            const text = reasonText(reason.reason)
            return text && ((reason.current ?? 0) > 0 || (reason.previous ?? 0) > 0) ? [{ ...reason, text }] : []
          })
          return (
            <li key={figure.key} className="hid-ehr-dept-reports-figure" aria-label={words.label}>
              <h3 className="hid-ehr-dept-reports-figure-label">{words.label}</h3>
              <p className="hid-ehr-dept-reports-figure-value">{valueText(figure.kind, figure.current)}</p>
              <p className="hid-ehr-dept-reports-figure-detail">{comparisonText(figure, days)}</p>
              {sample ? <p className="hid-ehr-dept-reports-figure-detail">{sample}</p> : null}
              {coverage ? <p className="hid-ehr-dept-reports-figure-detail">{coverage}</p> : null}
              {reasons.length > 0 ? (
                <dl className="hid-ehr-dept-reports-reasons" aria-label="By reason">
                  {reasons.map(reason => (
                    <div key={reason.reason}>
                      <dt>{reason.text}</dt>
                      <dd>{countText(reason.current ?? 0)} <span className="hid-ehr-dept-muted">({countText(reason.previous ?? 0)} in {previousPeriod(days)})</span></dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <DailyLine label={words.label} kind={figure.kind} daily={figure.daily} />
            </li>
          )
        })}
      </ul>
      <DailyValues section={section} />
    </DeptSection>
  )
}

/** The section's figures day by day, as a table: every value of the lines above as text. Drawn only once opened. */
function DailyValues({ section }: { readonly section: ShownSection }) {
  const [open, setOpen] = useState(false)
  const days = section.figures[0]?.figure.daily.map(day => day.day) ?? []
  if (days.length === 0) return null
  return (
    <details className="hid-ehr-dept-reports-daily" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Daily values: {section.title.toLowerCase()}</summary>
      {open ? (
        <div className="hid-ehr-table-scroll">
          <table className="hid-ehr-table hid-ehr-dept-reports-table">
            <caption className="hid-ehr-sr-only">{section.title}, day by day</caption>
            <thead>
              <tr><th scope="col">Day</th>{section.figures.map(({ figure, words }) => <th key={figure.key} scope="col">{words.label}</th>)}</tr>
            </thead>
            <tbody>
              {days.map(day => (
                <tr key={day}>
                  <th scope="row">{formatDate(day)}</th>
                  {section.figures.map(({ figure }) => {
                    const entry = figure.daily.find(candidate => candidate.day === day)
                    return <td key={figure.key}>{entry ? valueText(figure.kind, entry.value) : ''}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  )
}

/** The draft definitions, said once at the foot of the page, for the clinical lead's sign-off. */
function Definitions() {
  return (
    <details className="hid-ehr-dept-reports-definitions">
      <summary>What each figure counts</summary>
      {SECTION_ORDER.map(key => (
        <div key={key}>
          <h3>{SECTION_WORDS[key]}</h3>
          <dl>
            {Object.values(FIGURES[key]).map(words => <div key={words.label}><dt>{words.label}</dt><dd>{words.counts}</dd></div>)}
          </dl>
        </div>
      ))}
      <p className="hid-ehr-dept-muted">A figure counts each record once, on its Lagos day. Medians are in whole minutes. No figure is a rate
        or a measure of quality.</p>
    </details>
  )
}

/**
 * CSV and PDF, for those who may download (reports.export). Each press asks Health ID for the download (route 2), which
 * records it and answers the figures with small counts hidden; the file is made on this device from that answer alone.
 * No Idempotency-Key: one press, one download, one record. Where downloads are switched off (503
 * REPORTS_EXPORT_NOT_AVAILABLE) the buttons go, and the section says so.
 */
function Downloads({ facilityId, facilityName, report }: {
  readonly facilityId: string
  readonly facilityName: string
  readonly report: OperationsReport
}) {
  const id = useId()
  const off = useDownloadsOff(facilityId)
  const [busy, setBusy] = useState<ReportExportFormat | null>(null)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const busyRef = useRef(false)

  async function download(format: ReportExportFormat) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(format)
    setDone('')
    setError('')
    try {
      const answer = await reportsApi.exportOperations(facilityId, { from: report.from, to: report.to, format })
      learnDownloads(facilityId)
      if (!isReport(answer)) throw new Error('Not a report')
      const blob = await reportBlob(reportFileContent(answer, facilityName), format)
      saveFile(blob, reportFileName(answer, format))
      setDone(`The ${format.toUpperCase()} file for ${rangeText(answer.from, answer.to)} was saved. This download is recorded.`)
    } catch (caught) {
      learnDownloads(facilityId, caught)
      learnReportsServed(facilityId, caught)
      setError(refusalWords(caught, DOWNLOAD_FAILED, 'download'))
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  if (off) {
    return (
      <DeptSection title="Download" headingId={`${id}-download`}>
        <p className="hid-ehr-dept-muted" role="status">{EXPORT_NOT_AVAILABLE}</p>
      </DeptSection>
    )
  }
  return (
    <DeptSection title="Download" headingId={`${id}-download`}>
      <p className="hid-ehr-dept-muted" id={`${id}-about`}>
        The figures for {rangeText(report.from, report.to)} as a file. {SMALL_COUNTS} Each download is recorded.
      </p>
      <div className="hid-ehr-dept-form-actions">
        {(['csv', 'pdf'] as const).map(format => (
          <EhrButton key={format} variant="secondary" icon={null} busy={busy === format} aria-describedby={`${id}-about`}
            onClick={() => void download(format)}>
            Download {format.toUpperCase()}
          </EhrButton>
        ))}
      </div>
      <p className="hid-ehr-dept-muted" role="status">{done}</p>
      {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
    </DeptSection>
  )
}
