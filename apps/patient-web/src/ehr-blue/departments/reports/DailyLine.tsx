import { formatDate } from '@hid/ui/display'
import type { ReportDay, ReportFigure } from '../../../staff/api'
import { valueText } from './reportRules'

/*
 * One figure's day-by-day line (the contract's "simple daily trend line"; no chart library): a 2px line in the page's
 * brand ink from the first day of the range to the last, on a baseline at 0, so a quiet day sits on the floor and a busy
 * one rises. A median day with no sample is a gap in the line, never a 0. Pointing at a day names it and its value; the
 * line itself is one image whose name says the range's highest and lowest days, and every value is also in the section's
 * Daily values table, so none is reached by hover alone.
 */

const WIDTH = 240
const HEIGHT = 44
const PAD = 4

const numberOf = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/** What the line shows, said in words: its highest and lowest days. */
export function dailySummary(label: string, kind: ReportFigure['kind'], daily: readonly ReportDay[]): string {
  const known = daily.flatMap(day => {
    const value = numberOf(day.value)
    return value === null ? [] : [{ day: day.day, value }]
  })
  if (known.length === 0) return `${label}, day by day: no values in this range.`
  const highest = known.reduce((best, day) => (day.value > best.value ? day : best))
  const lowest = known.reduce((best, day) => (day.value < best.value ? day : best))
  if (highest.value === lowest.value) return `${label}, day by day: ${valueText(kind, highest.value)} each day.`
  return `${label}, day by day: highest ${valueText(kind, highest.value)} on ${formatDate(highest.day)}, `
    + `lowest ${valueText(kind, lowest.value)} on ${formatDate(lowest.day)}.`
}

export function DailyLine({ label, kind, daily }: {
  readonly label: string
  readonly kind: ReportFigure['kind']
  readonly daily: readonly ReportDay[]
}) {
  if (daily.length === 0) return null
  const values = daily.map(day => numberOf(day.value))
  const highest = Math.max(0, ...values.filter((value): value is number => value !== null))
  const x = (index: number) => (daily.length === 1 ? WIDTH / 2 : PAD + (index * (WIDTH - 2 * PAD)) / (daily.length - 1))
  const y = (value: number) => (highest === 0 ? HEIGHT - PAD : HEIGHT - PAD - (value / highest) * (HEIGHT - 2 * PAD))
  // Runs of days with a value: a median's day without one breaks the line.
  const runs: { index: number; value: number }[][] = []
  values.forEach((value, index) => {
    if (value === null) return
    const run = runs[runs.length - 1]
    if (run && run[run.length - 1]!.index === index - 1) run.push({ index, value })
    else runs.push([{ index, value }])
  })
  const step = daily.length === 1 ? WIDTH : (WIDTH - 2 * PAD) / (daily.length - 1)
  return (
    <svg className="hid-ehr-dept-reports-line" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img"
      aria-label={dailySummary(label, kind, daily)} focusable="false">
      <line className="hid-ehr-dept-reports-line-base" x1={0} x2={WIDTH} y1={HEIGHT - PAD} y2={HEIGHT - PAD} vectorEffect="non-scaling-stroke" />
      {runs.map(run => run.length === 1
        // A day alone (its neighbours have no median) is a short dash, so it still shows.
        ? <line key={run[0]!.index} className="hid-ehr-dept-reports-line-mark" x1={x(run[0]!.index) - 1.5} x2={x(run[0]!.index) + 1.5}
            y1={y(run[0]!.value)} y2={y(run[0]!.value)} vectorEffect="non-scaling-stroke" />
        : <polyline key={run[0]!.index} className="hid-ehr-dept-reports-line-mark" vectorEffect="non-scaling-stroke"
            points={run.map(point => `${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ')} />)}
      {daily.map((day, index) => (
        // A target as wide as the day's share of the line, the full height: pointing anywhere above a day names it.
        <rect key={day.day} className="hid-ehr-dept-reports-line-day" x={Math.max(0, x(index) - step / 2)} y={0} width={step} height={HEIGHT}>
          <title>{`${formatDate(day.day)}: ${day.suppressed ? 'fewer than 5' : valueText(kind, values[index])}`}</title>
        </rect>
      ))}
    </svg>
  )
}
