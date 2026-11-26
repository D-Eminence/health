import type { OperationsReport, OperationsReportExport, ReportFigure, ReportSection } from '../../../../staff/api'

/*
 * Reports as hid-system REP-1 answers them (EHR_PLANNED_CONTRACT.md "REP-1", route 1 and route 2), for the Reports &
 * Analytics tests. Every figure is made up; no report names a patient.
 */

export const FACILITY_ID = 'f0000000-0000-4000-8000-000000000001'

/** The days from `from` to `to`, both included, as the report's daily entries carry them. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    out.push(day.toISOString().slice(0, 10))
  }
  return out
}

function count(key: string, current: number, previous: number, days: readonly string[], extra: Partial<ReportFigure> = {}): ReportFigure {
  return { key, kind: 'count', current, previous, daily: days.map((day, index) => ({ day, value: index === 0 ? current : 0 })), ...extra }
}

function median(key: string, current: number | null, previous: number | null, sampleSize: number, previousSampleSize: number,
  days: readonly string[], extra: Partial<ReportFigure> = {}): ReportFigure {
  return { key, kind: 'median_minutes', current, previous, sampleSize, previousSampleSize,
    daily: days.map((day, index) => (index === 0 && current !== null ? { day, value: current, sampleSize } : { day, value: null, sampleSize: 0 })),
    ...extra }
}

const REASONS = ['out_of_stock', 'medicine_unavailable', 'needs_prescriber_review', 'controlled_requirements', 'cannot_meet_priority',
  'patient_declined', 'patient_did_not_return', 'other']

/** A report of route 1 for the range, with the contract's five sections and every figure. */
export function reportOf(from: string, to: string, overrides: Partial<OperationsReport> = {}): OperationsReport {
  const days = daysOf(from, to)
  const previousTo = new Date(`${from}T00:00:00Z`)
  previousTo.setUTCDate(previousTo.getUTCDate() - 1)
  const previousFrom = new Date(previousTo)
  previousFrom.setUTCDate(previousFrom.getUTCDate() - (days.length - 1))
  const sections: ReportSection[] = [
    { key: 'waitingList', figures: [
      count('checkedIn', 412, 380, days),
      count('seen', 290, 0, days, { coverage: { tracked: 300, previousTracked: 0 } }),
      count('leftWithoutBeingSeen', 6, 0, days, { coverage: { tracked: 300, previousTracked: 0 } }),
      count('cancelled', 9, 11, days),
      median('medianWaitMinutes', 34, null, 290, 0, days, { coverage: { tracked: 300, previousTracked: 0 } }),
    ] },
    { key: 'registrations', figures: [count('newHealthIds', 57, 61, days), count('existingHealthIds', 120, 120, days)] },
    { key: 'visits', figures: [count('opened', 388, 350, days), count('completed', 1284, 1200, days)] },
    { key: 'lab', figures: [
      count('requested', 140, 150, days), count('specimensCollected', 133, 140, days), count('resultsReleased', 128, 101, days),
      median('medianTurnaroundMinutes', 95, 110, 128, 101, days),
    ] },
    { key: 'pharmacy', figures: [
      count('dispensed', 210, 190, days), count('dispensingsReversed', 3, 1, days),
      count('notCompleted', 4, 2, days, { byReason: REASONS.map(reason => ({ reason, current: reason === 'out_of_stock' ? 3 : reason === 'patient_declined' ? 1 : 0,
        previous: reason === 'out_of_stock' ? 2 : 0 })) }),
    ] },
  ]
  return {
    report: 'operations', facilityId: FACILITY_ID, from, to, days: days.length,
    previousFrom: previousFrom.toISOString().slice(0, 10), previousTo: previousTo.toISOString().slice(0, 10),
    includesToday: false, timeZone: 'Africa/Lagos', generatedAt: '2026-12-01T08:00:00.000Z',
    definitions: { version: 'rep1-draft-1', signedOff: false }, sections, ...overrides,
  }
}

/**
 * A download's answer (route 2): small counts hidden as the database hides them, null and marked, plus the record of the
 * download. Left without being seen (6) and every 0 stay; the reversals (3 and 1), could not complete (4 and 2) and its
 * reasons from 1 to 4 are hidden, and so is the turnaround median, worked out here from 3 results.
 */
export function exportOf(from: string, to: string, format: 'csv' | 'pdf' = 'csv'): OperationsReportExport {
  const report = reportOf(from, to)
  const hideDay = (day: ReportFigure['daily'][number]) => (day.value !== null && day.value > 0 && day.value < 5
    ? { day: day.day, value: null, suppressed: true } : day)
  const sections = report.sections.map(section => ({ ...section, figures: section.figures.map((figure): ReportFigure => {
    if (figure.key === 'dispensingsReversed' || figure.key === 'notCompleted') {
      return { ...figure, current: null, previous: null, currentSuppressed: true, previousSuppressed: true, daily: figure.daily.map(hideDay),
        ...(figure.byReason ? { byReason: figure.byReason.map(reason => {
          const hide = (value: number | null) => (value !== null && value > 0 && value < 5 ? null : value)
          const hidden = hide(reason.current) !== reason.current || hide(reason.previous) !== reason.previous
          return { ...reason, current: hide(reason.current), previous: hide(reason.previous), ...(hidden ? { suppressed: true } : {}) }
        }) } : {}) }
    }
    if (figure.key === 'medianTurnaroundMinutes') {
      return { ...figure, current: null, currentSuppressed: true, sampleSize: null,
        daily: figure.daily.map(day => (day.value !== null ? { day: day.day, value: null, sampleSize: null, suppressed: true } : day)) }
    }
    return figure
  }) }))
  return { ...report, sections, export: { format, minimumCount: 5, suppressedValues: 11, recordedAt: '2026-12-01T08:00:05.000Z' } }
}
