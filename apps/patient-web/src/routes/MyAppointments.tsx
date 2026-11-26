import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { isHidApiError, plainErrorText } from '@hid/http'
import { formatDateTime, formatTime, formatWeekday } from '@hid/ui/display'
import { Badge, Button, Card, EmptyState, PageHeader, type Tone } from '../kasuwa/ui'
import { LoadingRows } from '../kasuwa/parts'
import type { MyAppointment } from '../api'
import { useSession } from '../session'
import { learnMyAppointmentsServed, useMyAppointmentsServed } from '../appointmentsServed'
import { LoadProblem } from './profileParts'

/**
 * "My appointments" (hid-system APPT-1 route 12, 0161): the patient's own appointments at every facility, read only
 * (Q-APPT-4 A, not yet answered by the owner: staff book, patients see). Upcoming soonest first, past newest first, each
 * with its facility, clinic, clinician, day and time in Lagos whatever the device's zone, and its status. To change one,
 * the patient contacts the facility. An ehr-api before it answers 404, and while appointments are switched off 503: the
 * page then says they are not available yet.
 */

type When = 'upcoming' | 'past'

/** "Thursday 3 Dec 2026, 09:00 to 09:30", in Lagos (@hid/ui/display, Q181 A and Q182 A). */
export function appointmentWhen(item: Pick<MyAppointment, 'startsAt' | 'endsAt'>): string {
  const start = formatDateTime(item.startsAt)
  if (!start) return 'Time not known'
  const end = formatTime(item.endsAt)
  return `${formatWeekday(item.startsAt)} ${start}${end ? ` to ${end}` : ''}`
}

const STATUS: Readonly<Record<string, { label: string; tone: Tone }>> = {
  booked: { label: 'Booked', tone: 'brand' },
  checked_in: { label: 'You checked in', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  no_show: { label: 'Missed', tone: 'warn' },
}

export function appointmentStatus(status: string): { label: string; tone: Tone } {
  return STATUS[status] ?? { label: 'Booked', tone: 'neutral' }
}

const VISIT: Readonly<Record<string, string>> = {
  new_visit: 'New visit', follow_up: 'Follow-up', results_review: 'Results review', antenatal: 'Antenatal', procedure: 'Procedure', other: 'Visit',
}

/** Whether an answer says appointments are not served here: an ehr-api before 0161, or switched off. */
function notServed(caught: unknown): boolean {
  return isHidApiError(caught) && ((caught.status === 503 && caught.code === 'APPOINTMENTS_NOT_AVAILABLE')
    || (caught.status === 404 && !caught.code.startsWith('APPOINTMENT_')))
}

/**
 * Whether "My appointments" is served, asked once per page load (for one upcoming appointment, as the page reads them) while
 * nothing has said either: on a Novu build only (`asks`; hid-system main has no such route). Until an answer says it
 * is served, the menu does not list it: today's backend answers 404, and one with appointments switched off 503. A
 * failed read (no connection) says nothing, and it is asked again the next time the portal opens.
 */
export function useMyAppointmentsProbe(asks: boolean): boolean | null {
  const { api } = useSession()
  const served = useMyAppointmentsServed()
  useEffect(() => {
    if (!asks || served !== null) return
    const controller = new AbortController()
    api.myAppointments('upcoming', null, controller.signal, 1).then(() => learnMyAppointmentsServed(true), (caught: unknown) => {
      if (!controller.signal.aborted && notServed(caught)) learnMyAppointmentsServed(false)
    })
    return () => controller.abort()
  }, [api, asks, served])
  return served
}

export function MyAppointments() {
  const { api } = useSession()
  const [when, setWhen] = useState<When>('upcoming')
  const [state, setState] = useState<{ when: When; items: MyAppointment[]; nextCursor: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const retry = useRef<HTMLButtonElement>(null)
  /**
   * The read in flight. A newer one (the other tab, Show more, Try again) cancels it, so a slow answer for the tab left
   * behind never replaces the one shown (which would leave it blank) and its error is never said under the other tab.
   */
  const reading = useRef<AbortController | null>(null)

  const load = useCallback(async (which: When, cursor?: string | null) => {
    reading.current?.abort()
    const controller = new AbortController()
    reading.current = controller
    const { signal } = controller
    if (cursor) setMore(true); else setLoading(true)
    setError(null)
    try {
      const answer = await api.myAppointments(which, cursor, signal)
      if (signal.aborted) return
      learnMyAppointmentsServed(true)
      setState(previous => ({ when: which, items: cursor && previous?.when === which ? [...previous.items, ...answer.items] : answer.items,
        nextCursor: answer.nextCursor }))
    } catch (caught) {
      if (signal.aborted) return
      if (notServed(caught)) { learnMyAppointmentsServed(false); setUnavailable(true); return }
      setError(plainErrorText(caught, 'We couldn’t load your appointments right now. Check your connection and try again.'))
    } finally {
      if (!signal.aborted) { setLoading(false); setMore(false) }
      if (reading.current === controller) reading.current = null
    }
  }, [api])

  useEffect(() => {
    void load(when)
    return () => { reading.current?.abort() }
  }, [load, when])

  const items = state?.when === when ? state.items : []

  return <div className="flex flex-col gap-5">
    <PageHeader title="My appointments" description="Appointments hospitals and clinics booked for you. To change or cancel one, contact the facility." />
    {unavailable ? <Card><EmptyState icon={CalendarDays} title="Appointments are not available yet"
      description="When hospitals and clinics book appointments for you on Health ID, you will see them here." /></Card> : <>
      <div role="group" aria-label="Which appointments" className="flex gap-2">
        {(['upcoming', 'past'] as const).map(value => <Button key={value} size="sm" variant={when === value ? 'primary' : 'secondary'}
          aria-pressed={when === value} onClick={() => setWhen(value)}>{value === 'upcoming' ? 'Upcoming' : 'Past'}</Button>)}
      </div>
      {error ? <LoadProblem what="your appointments" error={error} buttonRef={retry} onRetry={() => void load(when)} /> : null}
      <Card aria-busy={loading || undefined}>
        {loading && state?.when !== when ? <div className="px-5 py-4"><LoadingRows rows={3} /></div> : null}
        {!loading && !error && state?.when === when && items.length === 0
          ? <EmptyState compact icon={CalendarDays} title={when === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}
              description={when === 'upcoming' ? 'When a hospital or clinic books an appointment for you, it shows here.' : undefined} />
          : null}
        {items.length > 0 ? <ul className="m-0 list-none divide-y divide-line p-0" aria-label={when === 'upcoming' ? 'Upcoming appointments' : 'Past appointments'}>
          {items.map(item => {
            const status = appointmentStatus(item.status)
            const where = [item.clinicName, item.facilityName].filter(Boolean).join(', ')
            return <li key={item.appointmentId} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 flex-[1_1_16rem]">
                <p className="m-0 text-sm font-semibold text-ink">{appointmentWhen(item)}</p>
                <p className="m-0 mt-0.5 text-[13px] text-ink-2">{where}</p>
                <p className="m-0 mt-0.5 text-[13px] text-ink-3">{[VISIT[item.visitType] ?? 'Visit', item.clinicianName ? `with ${item.clinicianName}` : null,
                  `${item.lengthMinutes} minutes`].filter(Boolean).join(' · ')}</p>
                {item.reason?.trim() ? <p className="m-0 mt-0.5 text-[13px] text-ink-3">Reason: {item.reason.trim()}</p> : null}
              </div>
              <Badge tone={status.tone} size="sm">{status.label}</Badge>
            </li>
          })}
        </ul> : null}
      </Card>
      {state?.when === when && state.nextCursor ? <div>
        <Button variant="secondary" size="sm" loading={more} onClick={() => void load(when, state.nextCursor)}>Show more</Button>
      </div> : null}
    </>}
  </div>
}
