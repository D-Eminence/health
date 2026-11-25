import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { formatDateTime, formatPhone } from '@hid/ui/display'
import { EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { startPrint, type PaperPrint, type PrintJob } from '../../../print/printPaper'
import { appointmentsApi, type AppointmentCallListItem } from '../../../staff/api'
import { PrintHeader } from '../../frame/PrintHeader'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import {
  BASE, CALL_LIST_FOOTER, NOT_AVAILABLE, WRITE_REFUSED, canWrite, clinicianText, dayText, healthIdEnding, isDay, lagosTime,
  learnFrom, notServed, refusalWords,
} from './appointmentRules'
import { useBookingChoices } from './Appointments'
import { useStaffNames } from './staffNames'

/**
 * The printable call list (APPT-1 route 11, identity-api, Q-APPT-7 A): a day's booked appointments with the phone this
 * facility recorded for each patient, so the desk can call to confirm. Front desk, clinicians and doctors only (the same
 * code as booking). No reason, visit type or date of birth is on it. Print prints it as a paper of its own (as every
 * paper this website prints, printPaper.ts: a PDF in Safari, so no browser adds its web address): the shared print header
 * (the Health ID logo and the facility), the day and clinic, the list, and the footer: it holds patient phone numbers, so
 * it stays at the desk and is shredded after use. Reminders by text message are built but switched off (Q-APPT-3 A), so
 * nothing here sends one.
 *
 * Only the latest read is shown: changing the day or clinic cancels the read before it, and every list is kept with the
 * day and clinic it was read for, so a slow answer for another day never shows (or prints) under this day's heading.
 */
export function CallList({ facilityId, day }: { readonly facilityId: string; readonly day: string }) {
  const { permissions } = useDeptAccess()
  if (!canWrite(permissions)) return <DeptUnavailable title="Call list" message={WRITE_REFUSED} />
  return <CallListPage facilityId={facilityId} initialDay={day} />
}

/** The call list's paper: A4, titled with the facility and what it is, never a patient's name. */
const CALL_LIST_PAPER: PaperPrint = { size: 'A4', kind: 'Call list' }

/**
 * Prints the call list's paper: it is put under <body> (appointments.css hides it on screen and prints it alone), it
 * prints in the commit that shows it, and it goes once it has printed.
 */
function useCallListPrint() {
  const [paper, setPaper] = useState<{ node: ReactNode; round: number; job: PrintJob } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!paper) return
    return paper.job.run(area.current, () => setPaper(current => current?.round === paper.round ? null : current))
  }, [paper])
  const print = useCallback((node: ReactNode) => {
    const job = startPrint(CALL_LIST_PAPER)
    setPaper(current => ({ node, round: (current?.round ?? 0) + 1, job }))
  }, [])
  const portal = paper && typeof document !== 'undefined'
    ? createPortal(<div ref={area} data-call-list-print="" aria-hidden="true">{paper.node}</div>, document.body)
    : null
  return { print, area: portal }
}

function CallListPage({ facilityId, initialDay }: { readonly facilityId: string; readonly initialDay: string }) {
  const navigate = useNavigate()
  const { membershipId, facility } = useDeptAccess()
  const facilityName = facility?.name ?? ''
  const { clinics } = useBookingChoices(facilityId)
  const [day, setDay] = useState(initialDay)
  const [clinicId, setClinicId] = useState('')
  const [list, setList] = useState<{ key: string; items: readonly AppointmentCallListItem[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const reading = useRef<AbortController | null>(null)
  const key = JSON.stringify([day, clinicId])
  const { print, area } = useCallListPrint()

  const load = useCallback(async () => {
    reading.current?.abort()
    reading.current = null
    if (!isDay(day)) { setLoading(false); setError(''); return }
    const controller = new AbortController()
    reading.current = controller
    const { signal } = controller
    setLoading(true); setError('')
    try {
      const answer = await appointmentsApi.callList(facilityId, { day, clinicId: clinicId || undefined, signal })
      if (signal.aborted) return
      learnFrom()
      setList({ key, items: answer.items })
    } catch (caught) {
      if (signal.aborted || (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED')) return
      learnFrom(caught)
      setList(null)
      setError(notServed(caught) ? NOT_AVAILABLE : refusalWords(caught, 'The call list could not be loaded. Try again.', 'write'))
    } finally {
      if (!signal.aborted) setLoading(false)
      if (reading.current === controller) reading.current = null
    }
  }, [facilityId, day, clinicId, key])
  useEffect(() => {
    void load()
    return () => { reading.current?.abort() }
  }, [load])

  // Only the list read for the day and clinic chosen now: never another's, even for a moment.
  const items = list?.key === key ? list.items : null
  const names = useStaffNames(facilityId, (items ?? []).map(item => item.clinicianMembershipId))
  const clinicName = clinicId ? clinics.find(clinic => clinic.clinicId === clinicId)?.name ?? null : null

  function printList() {
    if (!items || items.length === 0) return
    print(<CallListPaper facility={facilityName} day={day} clinic={clinicName} items={items} names={names} me={membershipId}
      printedAt={formatDateTime(new Date().toISOString())} />)
  }

  return (
    <DeptPage eyebrow="Appointments" title="Call list" description="Booked patients for one day, with the phone this facility recorded, to call and confirm."
      onBack={() => navigate(BASE)} backLabel="Back to appointments" className="hid-ehr-dept-appointments hid-ehr-dept-appointments-call"
      secondaryActions={<EhrButton variant="secondary" disabled={!items || items.length === 0} onClick={printList}>Print</EhrButton>}>
      <DeptSection title="Which day" headingId="call-list-filters-title">
        <div className="hid-ehr-dept-form-grid" role="group" aria-labelledby="call-list-filters-title">
          <EhrField label="Day" controlId="call-list-day" hint={isDay(day) ? dayText(day) : 'Choose a day.'}>
            <EhrInput type="date" value={day} onChange={event => setDay(event.target.value)} />
          </EhrField>
          <EhrField label="Clinic" controlId="call-list-clinic">
            <EhrSelect value={clinicId} onChange={event => setClinicId(event.target.value)}>
              <option value="">Every clinic</option>
              {clinics.map(clinic => <option key={clinic.clinicId} value={clinic.clinicId}>{clinic.name}</option>)}
            </EhrSelect>
          </EhrField>
        </div>
      </DeptSection>

      <DeptSection title={isDay(day) ? `Booked for ${dayText(day)}` : 'Booked patients'} headingId="call-list-title">
        {error ? <DeptNotice role="alert" tone={error === NOT_AVAILABLE ? 'info' : 'critical'}>{error}</DeptNotice> : null}
        {loading && items === null ? <p className="hid-ehr-state-message" role="status">Loading the call list…</p> : null}
        {items && items.length === 0 ? <EhrEmptyState title="No one to call" message="No patients are booked for this day." /> : null}
        {items && items.length > 0 ? (
          <div className="hid-ehr-dept-appointments-call-paper">
          <table className="hid-ehr-dept-appointments-call-table" aria-labelledby="call-list-title">
            <thead>
              <tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col">Clinic</th><th scope="col">With</th><th scope="col">Phone</th><th scope="col" className="hid-ehr-dept-appointments-called">Called</th></tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.appointmentId}>
                  <td>{lagosTime(item.startsAt)}</td>
                  <th scope="row">{item.fullName}<span className="hid-ehr-dept-appointments-hint"> {healthIdEnding(item.healthIdLast4)}</span></th>
                  <td>{item.clinicName ?? '—'}</td>
                  <td>{clinicianText(item.clinicianMembershipId, names, membershipId, { inClinic: item.clinicName !== null })}</td>
                  <td>{item.phone ? <a href={`tel:${item.phone}`}>{formatPhone(item.phone)}</a> : 'No phone recorded'}</td>
                  <td className="hid-ehr-dept-appointments-called" aria-label="Called (tick on paper)" />
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hid-ehr-dept-appointments-footer" role="note">{CALL_LIST_FOOTER}</p>
          </div>
        ) : null}
        {items && items.length > 0 && items.length >= 500 ? (
          <DeptNotice tone="caution">The list stops at 500 patients. Choose a clinic to see the rest.</DeptNotice>
        ) : null}
      </DeptSection>
      {area}
    </DeptPage>
  )
}

/**
 * The call list on paper: the shared print header (the Health ID logo and the facility, no web address), the day and
 * clinic it is for and when it was printed, one row per booked patient with a box to tick once called, and the footer.
 * Built only from the list on screen when Print was pressed; nothing is read again to print.
 */
export function CallListPaper({ facility, day, clinic, items, names, me, printedAt }: {
  readonly facility: string
  readonly day: string
  readonly clinic: string | null
  readonly items: readonly AppointmentCallListItem[]
  readonly names: ReadonlyMap<string, string | null>
  readonly me: string | undefined
  readonly printedAt: string
}) {
  return (
    <div className="hid-ehr-dept-appointments-paper">
      <PrintHeader facility={facility || null} />
      <div className="hid-ehr-dept-appointments-paper-head">
        <p className="hid-ehr-dept-appointments-paper-kind">Call list for {dayText(day)}</p>
        <p>{clinic ?? 'Every clinic'}{printedAt ? ` · Printed ${printedAt}` : ''}</p>
      </div>
      <table>
        <thead>
          <tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col">Clinic</th><th scope="col">With</th><th scope="col">Phone</th>
            <th scope="col" className="hid-ehr-dept-appointments-paper-called">Called</th></tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.appointmentId}>
              <td>{lagosTime(item.startsAt)}</td>
              <td>{item.fullName}{item.healthIdLast4 ? <span className="hid-ehr-dept-appointments-paper-ending"> {healthIdEnding(item.healthIdLast4)}</span> : null}</td>
              <td>{item.clinicName ?? '—'}</td>
              <td>{clinicianText(item.clinicianMembershipId, names, me, { inClinic: item.clinicName !== null })}</td>
              <td>{item.phone ? formatPhone(item.phone) : 'No phone recorded'}</td>
              <td className="hid-ehr-dept-appointments-paper-called"><span className="hid-ehr-dept-appointments-paper-box" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hid-ehr-dept-appointments-paper-foot">{CALL_LIST_FOOTER}</p>
    </div>
  )
}
