import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import { lagosDay } from '@hid/ui/display'
import {
  DRAFT, EXPORT_NOT_AVAILABLE, EXPORT_REFUSED, NOT_AVAILABLE, RANGE_INVALID, RANGE_TOO_LONG, READ_REFUSED, SMALL_COUNTS, TOO_SLOW,
  addDays, canExportReports, canReadReports, comparisonText, coverageText, daysIn, downloadsOffAt, earliestDay, forgetReportsServed,
  holdsReportRole, lastDays, learnDownloads, learnReportsServed, notServed, rangeProblem, refusalWords, reportsServedAt, sampleText,
  shownSections, FIGURES,
} from '../../../../ehr-blue/departments/reports/reportRules'
import { HIDDEN_COUNT, HIDDEN_MEDIAN, reportCsv, reportFileContent, reportFileName } from '../../../../ehr-blue/departments/reports/reportFile'
import { dailySummary } from '../../../../ehr-blue/departments/reports/DailyLine'
import { exportOf, reportOf } from './fixtures'

/*
 * Reports & Analytics' rules (hid-system REP-1): the range of Lagos days whatever the device's zone, the comparison and
 * coverage words, the refusals in plain words, what the page learns about the switch, and the downloaded file built from
 * the download's own answer with small counts hidden. Every figure is made up.
 */

const problem = (status: number, code: string) => new HidApiError(status, 'Refused', { code, retryable: false })

const originalZone = process.env.TZ
beforeEach(() => {
  // A device far from Lagos: 23:30 UTC on 30 Nov is already 1 Dec in Lagos (UTC+1), but still 30 Nov here.
  process.env.TZ = 'America/Los_Angeles'
  forgetReportsServed()
})
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

describe('the range of Lagos days', () => {
  it('counts days as calendar days, both ends included, across months and a leap day', () => {
    expect(daysIn('2026-11-01', '2026-11-30')).toBe(30)
    expect(daysIn('2026-11-30', '2026-11-30')).toBe(1)
    expect(daysIn('2028-02-28', '2028-03-01')).toBe(3)
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(earliestDay('2028-02-29')).toBe('2026-02-28')
    expect(earliestDay('2026-11-25')).toBe('2024-11-25')
  })

  it('opens on the last 30 Lagos days, today included, when the device is still on the day before', () => {
    const lateNight = Date.UTC(2026, 10, 30, 23, 30)
    expect(new Date(lateNight).getDate()).toBe(30)
    expect(lagosDay(lateNight)).toBe('2026-12-01')
    expect(lastDays(30, lagosDay(lateNight))).toEqual({ from: '2026-11-02', to: '2026-12-01' })
    expect(lastDays(7, '2026-12-01')).toEqual({ from: '2026-11-25', to: '2026-12-01' })
  })

  it('accepts 92 days and refuses 93, a reversed range, a future end and a start over 2 years back', () => {
    const today = '2026-12-01'
    expect(rangeProblem({ from: '2026-09-01', to: '2026-12-01' }, today)).toBe('')
    expect(rangeProblem({ from: '2026-08-31', to: '2026-12-01' }, today)).toBe(RANGE_TOO_LONG)
    expect(rangeProblem({ from: '2026-11-30', to: '2026-11-01' }, today)).toBe(RANGE_INVALID)
    expect(rangeProblem({ from: '2026-11-30', to: '2026-12-02' }, today)).toBe(RANGE_INVALID)
    expect(rangeProblem({ from: '2024-11-30', to: '2024-12-31' }, today)).toBe(RANGE_INVALID)
    expect(rangeProblem({ from: '2024-12-01', to: '2024-12-31' }, today)).toBe('')
    expect(rangeProblem({ from: '2026-02-30', to: '2026-03-01' }, today)).toBe(RANGE_INVALID)
    expect(rangeProblem({ from: '', to: '2026-11-01' }, today)).toBe(RANGE_INVALID)
  })
})

describe('who reads and downloads', () => {
  it('follows 0204’s two codes, and knows the two roles that hold them', () => {
    expect(canReadReports(['reports.read'])).toBe(true)
    expect(canExportReports(['reports.read'])).toBe(false)
    expect(canExportReports(['reports.export'])).toBe(false)
    expect(canExportReports(['reports.read', 'reports.export'])).toBe(true)
    expect(holdsReportRole(['org_admin'])).toBe(true)
    expect(holdsReportRole(['admin'])).toBe(true)
    expect(holdsReportRole(['org_admin_awaiting_review', 'doctor', 'cashier', 'billing_officer'])).toBe(false)
  })
})

describe('the words of a figure', () => {
  it('compares with the same number of days before in neutral words, never as better or worse', () => {
    expect(comparisonText({ kind: 'count', current: 412, previous: 380 }, 30)).toBe('Up 32 from 380 in the previous 30 days.')
    expect(comparisonText({ kind: 'count', current: 1200, previous: 1284 }, 30)).toBe('Down 84 from 1,284 in the previous 30 days.')
    expect(comparisonText({ kind: 'count', current: 120, previous: 120 }, 1)).toBe('Same as the previous day (120).')
    expect(comparisonText({ kind: 'median_minutes', current: 34, previous: null }, 7)).toBe('No median for the previous 7 days.')
    expect(comparisonText({ kind: 'median_minutes', current: 95, previous: 110 }, 7)).toBe('Down 15 minutes from 110 minutes in the previous 7 days.')
    for (const text of [comparisonText({ kind: 'count', current: 1, previous: 9 }, 30)]) expect(text).not.toMatch(/better|worse|good|bad|rate|%/i)
  })

  it('says what a median is worked out from, and how many check-ins the tracked figures cover', () => {
    expect(sampleText({ kind: 'median_minutes', sampleSize: 290 }, FIGURES.waitingList.medianWaitMinutes!)).toBe('From 290 check-ins.')
    expect(sampleText({ kind: 'median_minutes', sampleSize: 1 }, FIGURES.lab.medianTurnaroundMinutes!)).toBe('From 1 result.')
    expect(sampleText({ kind: 'count', sampleSize: 4 }, FIGURES.lab.requested!)).toBe('')
    expect(coverageText({ coverage: { tracked: 300, previousTracked: 0 } }, { current: 412, previous: 380 }, 30))
      .toBe('Counted for 300 of 412 check-ins (the previous 30 days: 0 of 380 check-ins).')
    expect(coverageText({}, { current: 412, previous: 380 }, 30)).toBe('')
  })

  it('shows the five sections and their figures in the contract’s order, leaving out what it has no words for', () => {
    const report = reportOf('2026-11-01', '2026-11-30')
    report.sections.unshift({ key: 'finance' as never, figures: [] })
    report.sections[1]!.figures.push({ key: 'futureFigure', kind: 'count', current: 1, previous: 1, daily: [] })
    const shown = shownSections(report)
    expect(shown.map(section => section.title)).toEqual(['Waiting list', 'Registrations', 'Visits', 'Laboratory', 'Pharmacy'])
    expect(shown[0]!.figures.map(figure => figure.words.label)).toEqual(['Patients checked in', 'Seen by a clinician',
      'Left without being seen', 'Check-ins cancelled', 'Median wait to see a clinician'])
    expect(shown.flatMap(section => section.figures)).toHaveLength(16)
  })

  it('says a daily line in words', () => {
    expect(dailySummary('Patients checked in', 'count', [{ day: '2026-11-01', value: 12 }, { day: '2026-11-02', value: 3 }]))
      .toBe('Patients checked in, day by day: highest 12 on 1 Nov 2026, lowest 3 on 2 Nov 2026.')
    expect(dailySummary('Median wait to see a clinician', 'median_minutes', [{ day: '2026-11-01', value: null, sampleSize: 0 }]))
      .toBe('Median wait to see a clinician, day by day: no values in this range.')
  })
})

describe('refusals and the switch', () => {
  it('says each refusal in the contract’s plain words, and never the guard’s', () => {
    expect(refusalWords(problem(503, 'REPORTS_NOT_AVAILABLE'), 'x')).toBe(NOT_AVAILABLE)
    expect(refusalWords(problem(404, 'API_ROUTE_NOT_FOUND'), 'x')).toBe(NOT_AVAILABLE)
    expect(refusalWords(problem(403, 'REPORTS_NOT_ALLOWED'), 'x')).toBe(READ_REFUSED)
    expect(refusalWords(problem(403, 'FORBIDDEN'), 'x')).toBe(READ_REFUSED)
    expect(refusalWords(problem(403, 'FORBIDDEN'), 'x', 'download')).toBe(EXPORT_REFUSED)
    expect(refusalWords(problem(403, 'REPORTS_EXPORT_NOT_ALLOWED'), 'x', 'download')).toBe(EXPORT_REFUSED)
    expect(refusalWords(problem(503, 'REPORTS_EXPORT_NOT_AVAILABLE'), 'x', 'download')).toBe(EXPORT_NOT_AVAILABLE)
    expect(refusalWords(problem(503, 'REPORTS_NOT_AVAILABLE'), 'x', 'download')).toBe(NOT_AVAILABLE)
    expect(refusalWords(problem(400, 'REPORT_RANGE_INVALID'), 'x')).toBe(RANGE_INVALID)
    expect(refusalWords(problem(400, 'REPORT_RANGE_TOO_LONG'), 'x')).toBe(RANGE_TOO_LONG)
    expect(refusalWords(problem(503, 'REPORT_TOO_SLOW'), 'x')).toBe(TOO_SLOW)
    expect(refusalWords(problem(500, 'INTERNAL'), 'Fallback.')).toBe('Fallback.')
    for (const code of ['REPORTS_NOT_ALLOWED', 'REPORTS_EXPORT_NOT_ALLOWED', 'FORBIDDEN', 'PURPOSE_OF_USE_REQUIRED', 'VALIDATION_FAILED']) {
      expect(refusalWords(problem(403, code), 'x', 'download')).not.toMatch(/permission/i)
    }
    expect(notServed(problem(404, 'REPORT_SOMETHING'))).toBe(false)
  })

  it('learns the switch for each facility apart, so a sealed demo facility’s answer is not taken for a clinic’s', () => {
    expect(reportsServedAt('demo')).toBeNull()
    learnReportsServed('demo')
    learnReportsServed('clinic', problem(503, 'REPORTS_NOT_AVAILABLE'))
    expect(reportsServedAt('demo')).toBe(true)
    expect(reportsServedAt('clinic')).toBe(false)
    // A refusal that says nothing about the switch changes nothing.
    learnReportsServed('demo', problem(400, 'REPORT_RANGE_INVALID'))
    expect(reportsServedAt('demo')).toBe(true)
    learnDownloads('clinic', problem(503, 'REPORTS_EXPORT_NOT_AVAILABLE'))
    expect(downloadsOffAt('clinic')).toBe(true)
    expect(downloadsOffAt('demo')).toBe(false)
    learnDownloads('clinic')
    expect(downloadsOffAt('clinic')).toBe(false)
  })
})

describe('the downloaded file', () => {
  const content = reportFileContent(exportOf('2026-11-01', '2026-11-30'), 'Fictional Riverside Hospital')

  it('states the facility, the Lagos days, the Lagos time it was made, the small-count rule and the draft', () => {
    expect(content.title).toBe('Reports & Analytics: operations figures, 1 Nov 2026 to 30 Nov 2026')
    expect(content.lines).toEqual([
      'Facility: Fictional Riverside Hospital',
      'Days: 1 Nov 2026 to 30 Nov 2026 (30 days, Lagos days)',
      'Compared with: 2 Oct 2026 to 31 Oct 2026',
      // 08:00:05 UTC is 09:00 in Lagos, whatever the device's zone.
      'Made: 1 Dec 2026, 09:00 (Lagos time). This download is recorded.',
      `${SMALL_COUNTS} Medians from fewer than 5 are not shown.`,
      'Totals only: no patient is named.',
      `Draft: ${DRAFT}`,
    ])
    expect(content.draft).toBe(true)
    expect(reportFileName({ from: '2026-11-01', to: '2026-11-30' }, 'csv')).toBe('reports-operations-2026-11-01-to-2026-11-30.csv')
  })

  it('writes hidden counts as fewer than 5 and a hidden median as not shown, and keeps 0 and counts of 5 or more', () => {
    const totals = content.tables[0]!
    const row = (figure: string) => totals.rows.find(cells => cells[1] === figure)
    expect(totals.headings).toEqual(['Section', 'Figure', 'This period', 'Previous period', 'Notes'])
    expect(row('Left without being seen')?.slice(2, 4)).toEqual(['6', '0'])
    expect(row('Dispensings reversed')?.slice(2, 4)).toEqual([HIDDEN_COUNT, HIDDEN_COUNT])
    expect(row('Prescriptions this pharmacy could not complete: Out of stock')?.slice(2, 4)).toEqual([HIDDEN_COUNT, HIDDEN_COUNT])
    expect(row('Prescriptions this pharmacy could not complete: Patient chose not to go ahead')?.slice(2, 4)).toEqual([HIDDEN_COUNT, '0'])
    expect(row('Prescriptions this pharmacy could not complete: Another reason')?.slice(2, 4)).toEqual(['0', '0'])
    expect(row('Median time from sample to result (minutes)')?.slice(2)).toEqual([HIDDEN_MEDIAN, '110',
      `In minutes. From ${HIDDEN_COUNT} results (previous period: 101).`])
    expect(row('Median wait to see a clinician (minutes)')?.slice(2)).toEqual(['34', 'none',
      'In minutes. From 290 check-ins (previous period: 0). Counted for 300 of 412 check-ins (previous period: 0 of 380).'])
    const pharmacyDaily = content.tables.find(table => table.title === 'Pharmacy, day by day')!
    expect(pharmacyDaily.headings).toEqual(['Day', 'Prescriptions dispensed', 'Dispensings reversed', 'Prescriptions this pharmacy could not complete'])
    expect(pharmacyDaily.rows[0]).toEqual(['1 Nov 2026', '210', HIDDEN_COUNT, HIDDEN_COUNT])
    expect(pharmacyDaily.rows[1]).toEqual(['2 Nov 2026', '0', '0', '0'])
    expect(pharmacyDaily.rows).toHaveLength(30)
    const labDaily = content.tables.find(table => table.title === 'Laboratory, day by day')!
    expect(labDaily.rows[0]!.at(-1)).toBe(HIDDEN_MEDIAN)
    expect(labDaily.rows[1]!.at(-1)).toBe('none')
  })

  it('is a CSV a spreadsheet opens as UTF-8, with no formula and no patient', () => {
    const csv = reportCsv(content)
    expect(csv.startsWith('\uFEFF"Reports & Analytics: operations figures, 1 Nov 2026 to 30 Nov 2026"\r\n')).toBe(true)
    expect(csv).toContain('\r\nFacility: Fictional Riverside Hospital\r\n')
    expect(csv).toContain('\r\nPharmacy,Dispensings reversed,fewer than 5,fewer than 5,\r\n')
    expect(csv).toContain('\r\nVisits,Visits completed,1284,1200,\r\n')
    expect(csv).toContain(',34,none,In minutes. From 290 check-ins (previous period: 0). Counted for 300 of 412 check-ins (previous period: 0 of 380).\r\n')
    const hostile = reportCsv({ title: '=HYPERLINK("x")', lines: ['+1', '-1', '@x'], draft: false, tables: [] })
    expect(hostile).toContain('"\'=HYPERLINK(""x"")"')
    expect(hostile).toContain("\r\n'+1\r\n'-1\r\n'@x\r\n")
    expect(csv).not.toMatch(/HID-|patientId|facilityId|f0000000-/)
  })
})
