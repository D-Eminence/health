import type { OutreachCase } from '../../../staff/api'

/**
 * Today's numbers (owner, 14 Nov 2026: the frontend-only part of the campaign dashboard in the Outreach backend handover):
 * counted on this phone from the registrations it has read, so they need nothing new from Outreach. A count Outreach
 * does not send yet (health checks before 0118, Health IDs before 0119) is left out, never shown as 0.
 */
export interface OutreachNumbersCount {
  readonly registered: number
  readonly healthChecks?: number
  readonly healthIds?: number
}

export function outreachNumbers(cases: readonly OutreachCase[]): OutreachNumbersCount {
  const checksKnown = cases.some(item => 'hasScreening' in item)
  const idsKnown = cases.some(item => 'healthId' in item)
  return {
    registered: cases.length,
    ...(checksKnown ? { healthChecks: cases.filter(item => item.hasScreening === true).length } : {}),
    ...(idsKnown ? { healthIds: cases.filter(item => Boolean(item.healthId)).length } : {}),
  }
}

export function OutreachNumbers({ cases, more, waitingOnPhone, label }: {
  /** The registrations read so far; nothing is shown until they are read. */
  readonly cases: readonly OutreachCase[] | null
  /** Older registrations are left to read ("Show more"): the counts say they cover only those read. */
  readonly more: boolean
  /** Registrations kept on this phone, waiting for signal (an outreach group's queue). */
  readonly waitingOnPhone?: number
  readonly label: string
}) {
  if (!cases || cases.length === 0 && !waitingOnPhone) return null
  const counted = outreachNumbers(cases)
  const tiles: Array<readonly [string, number]> = [['Registered', counted.registered]]
  if (counted.healthChecks !== undefined) tiles.push(['Health checks done', counted.healthChecks])
  if (counted.healthIds !== undefined) tiles.push(['Health IDs made', counted.healthIds])
  if (waitingOnPhone !== undefined) tiles.push(['Waiting on this phone', waitingOnPhone])
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <dl className="m-0 grid grid-cols-2 gap-3 @xl:grid-cols-4">
        {tiles.map(([title, value]) => (
          <div key={title} className="flex flex-col gap-0.5 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
            <dt className="text-[13px] text-ink-3">{title}</dt>
            <dd className="m-0 text-[24px] font-semibold leading-tight text-ink tabular">{value}</dd>
          </div>
        ))}
      </dl>
      {more ? <p className="m-0 text-[13px] text-ink-3">Counted from the {counted.registered} registrations loaded. Press “Show more” below to count older ones.</p> : null}
    </section>
  )
}
