import { useCallback, useState } from 'react'
import { Activity, ChevronRight } from 'lucide-react'
import { lagosDay } from '@hid/ui/display'
import { reportsApi, type OperationsReport } from '../../staff/api'
import { Alert, Badge, Button, Card, CardHeader, Select } from '../../kasuwa/ui'
import { LoadingRows } from '../../kasuwa/parts'
import { useFacilityRead } from '../departments/parts/useFacilityRead'
import {
  BASE, DRAFT, READ_FAILED, isReport, lastDays, learnReportsServed, notServed, refusalWords, shownSections, valueText,
} from '../departments/reports/reportRules'

/**
 * Home's Activity card from the facility's own figures (hid-system REP-1, route 1), for a session holding reports.read,
 * in place of the sample's fictional counts: patients checked in, visits opened, results released and prescriptions
 * dispensed over the last 7 or 30 Lagos days (today included), each against the same number of days before. Read when
 * Home opens and when the period changes; never polled. Where reports are not served (404, or 503 REPORTS_NOT_AVAILABLE
 * at a real facility while the switch is off) the card is not drawn and Home keeps what it showed before.
 */

const SHOWN: readonly (readonly [string, string])[] = [
  ['waitingList', 'checkedIn'], ['visits', 'opened'], ['lab', 'resultsReleased'], ['pharmacy', 'dispensed'],
]

export function HomeReportsActivity({ facilityId }: { readonly facilityId: string }) {
  const [period, setPeriod] = useState<'7' | '30'>('7')
  const days = Number(period)
  const loader = useCallback((id: string) => {
    const range = lastDays(days, lagosDay())
    return reportsApi.operations(id, range.from, range.to).then(answer => {
      if (!isReport(answer)) throw new Error('Not a report')
      learnReportsServed(id)
      return answer
    }, (caught: unknown) => {
      learnReportsServed(id, caught)
      throw caught
    })
  }, [days])
  const read = useFacilityRead<OperationsReport>(facilityId, true, loader, READ_FAILED)
  if (read.caught !== null && notServed(read.caught)) return null

  const report = read.value && read.value.days === days ? read.value : null
  const figures = report ? SHOWN.flatMap(([section, key]) => shownSections(report).find(shown => shown.key === section)?.figures
    .filter(shown => shown.figure.key === key) ?? []) : []
  return <Card aria-label="Activity in period">
    <CardHeader as="h2" title="Activity" description="Lagos days" icon={Activity}
      actions={<Select controlSize="sm" aria-label="Reporting period" value={period} onChange={event => setPeriod(event.target.value === '30' ? '30' : '7')}>
        <option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select>} />
    {report && report.definitions?.signedOff !== true
      ? <div className="px-5 pb-3"><Badge tone="warn" size="sm">Draft</Badge> <span className="text-xs text-ink-3">{DRAFT}</span></div> : null}
    {read.error ? <div className="px-5 pb-4"><Alert intent="error" size="sm">{refusalWords(read.caught, READ_FAILED)}</Alert></div> : null}
    {!report && read.loading ? <LoadingRows rows={2} label="Loading activity" /> : null}
    {report ? <div className="grid grid-cols-2 gap-px bg-line">
      {figures.map(({ figure, words }) => <div key={figure.key} className="bg-surface px-5 py-4">
        <p className="m-0 text-[22px] font-semibold text-ink tabular">{valueText(figure.kind, figure.current)}</p>
        <p className="m-0 text-xs text-ink-2">{words.label}</p>
        <p className="m-0 text-xs text-ink-3">vs {valueText(figure.kind, figure.previous)} previous {days} days</p>
      </div>)}
    </div> : null}
    <div className="px-5 py-4"><Button to={BASE} variant="link" size="sm" iconRight={ChevronRight}>Open reports</Button></div>
  </Card>
}
