import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import {
  appointmentsApi, type AppointmentCard, type AppointmentClinic, type AppointmentList, type AppointmentStatus,
} from '../../../staff/api'
import { useBluePage } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { birthDateText } from '../parts/format'
import { sexText } from '../waiting/waitingRules'
import { AppointmentDetail } from './AppointmentDetail'
import {
  APPOINTMENT_ID, BASE, DEFAULT_STATUSES, DESCRIPTION, EYEBROW, NOT_AVAILABLE, READ_REFUSED, STATUSES, STATUS_WORDS, TITLE,
  addDays, canRead, canWrite, clinicianText, dayText, departmentText, healthIdEnding, isDay, lagosToday, learnFrom,
  notServed, refusalWords, statusText, statusTone, timeRangeText, visitTypeText,
} from './appointmentRules'
import { CallList } from './CallList'
import { NewAppointment } from './NewAppointment'
import { useStaffNames } from './staffNames'
import './appointments.css'

/**
 * Appointments in the blue EHR (hid-system APPT-1): the day list with its filters, New appointment, one appointment with
 * the design's four actions (Reschedule, Check in, Cancel appointment, Mark no-show) and its history, and the printable
 * call list. Every day and time is Lagos's, whatever the device's zone. A card shows identity details only (name, sex,
 * date of birth, the last 4 characters of the Health ID) and the booking, never clinical content, and gives no access to
 * the chart: that still needs the patient's consent. No Health ID or patient name in any address.
 */
export function Appointments() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canRead(permissions)) return <AppointmentsUnavailable />
  return <AppointmentsDesk key={facility.id} facilityId={facility.id} />
}

export function AppointmentsUnavailable() {
  return <DeptUnavailable title={TITLE} message={READ_REFUSED} />
}

/** What the day list shows, kept while an appointment below it is open (the page keeps its state). */
export interface DayFilters {
  readonly day: string
  readonly clinicId: string
  readonly clinicianMembershipId: string
  readonly statuses: readonly AppointmentStatus[]
}

function AppointmentsDesk({ facilityId }: { readonly facilityId: string }) {
  const { rest } = useBluePage()
  const [filters, setFilters] = useState<DayFilters>(() => ({ day: lagosToday(), clinicId: '', clinicianMembershipId: '', statuses: DEFAULT_STATUSES }))
  const below = rest.replace(/\/+$/, '')
  if (below === '') return <DayList facilityId={facilityId} filters={filters} onFilters={setFilters} />
  if (below === 'new') return <NewAppointment facilityId={facilityId} day={filters.day} />
  if (below === 'call-list') return <CallList facilityId={facilityId} day={filters.day} />
  if (APPOINTMENT_ID.test(below)) return <AppointmentDetail key={below} facilityId={facilityId} appointmentId={below.toLowerCase()} />
  // Anything else (a sample record's id from the frame's own store, a mistyped address): the list.
  return <Navigate replace to={BASE} />
}

/** The clinics and who can be booked, read once for the filters and forms; a failed read leaves the choices out. */
export function useBookingChoices(facilityId: string) {
  const [clinics, setClinics] = useState<readonly AppointmentClinic[]>([])
  const [staff, setStaff] = useState<readonly string[]>([])
  useEffect(() => {
    let alive = true
    appointmentsApi.clinics(facilityId).then(answer => { if (alive) setClinics(answer.items.filter(clinic => clinic.active)) }, () => {})
    appointmentsApi.bookableStaff(facilityId).then(answer => { if (alive) setStaff(answer.items.map(item => item.membershipId)) }, () => {})
    return () => { alive = false }
  }, [facilityId])
  return { clinics, staff }
}

function DayList({ facilityId, filters, onFilters }: {
  readonly facilityId: string
  readonly filters: DayFilters
  readonly onFilters: (next: DayFilters) => void
}) {
  const navigate = useNavigate()
  const { permissions, membershipId } = useDeptAccess()
  const writes = canWrite(permissions)
  const { clinics, staff } = useBookingChoices(facilityId)
  const [list, setList] = useState<{ key: string; items: readonly AppointmentCard[]; nextCursor: string | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ text: string; unavailable: boolean } | null>(null)
  const [more, setMore] = useState(false)
  const key = JSON.stringify(filters)

  const load = useCallback(async (cursor?: string) => {
    if (!isDay(filters.day)) return
    if (cursor) setMore(true); else setLoading(true)
    setError(null)
    try {
      const answer: AppointmentList = await appointmentsApi.list(facilityId, {
        day: filters.day, clinicId: filters.clinicId || undefined, clinicianMembershipId: filters.clinicianMembershipId || undefined,
        statuses: filters.statuses.length === STATUSES.length ? undefined : filters.statuses, cursor,
      })
      learnFrom()
      setList(previous => ({ key, items: cursor && previous?.key === key ? [...previous.items, ...answer.items] : answer.items,
        nextCursor: answer.nextCursor }))
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      if (isHidApiError(caught) && caught.code === 'INVALID_CURSOR') setList(null)
      setError({ text: refusalWords(caught, 'The appointments could not be loaded. Try again.'), unavailable: notServed(caught) })
    } finally { setLoading(false); setMore(false) }
  }, [facilityId, filters, key])

  useEffect(() => { void load() }, [load])

  const names = useStaffNames(facilityId, [...staff, ...(list?.items ?? []).map(card => card.clinicianMembershipId)])
  const items = list?.key === key ? list.items : []
  const today = lagosToday()

  function set(next: Partial<DayFilters>) { onFilters({ ...filters, ...next }) }
  function toggle(status: AppointmentStatus, on: boolean) {
    const statuses = on ? STATUSES.filter(value => value === status || filters.statuses.includes(value)) : filters.statuses.filter(value => value !== status)
    set({ statuses })
  }

  if (error?.unavailable) {
    return (
      <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-appointments">
        <DeptNotice tone="info" role="status" title={NOT_AVAILABLE}>
          Health ID will turn appointments on for your facility once they are ready. Until then, keep using your appointment book.
        </DeptNotice>
      </DeptPage>
    )
  }

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-appointments"
      primaryAction={writes ? <EhrButton onClick={() => navigate(`${BASE}/new`)}>New appointment</EhrButton> : undefined}
      secondaryActions={<>
        {writes ? <EhrButton variant="secondary" onClick={() => navigate(`${BASE}/call-list`)}>Call list</EhrButton> : null}
        <EhrButton variant="secondary" onClick={() => void load()} busy={loading && list !== null}>Refresh</EhrButton>
      </>}>
      <DeptSection title="Which appointments" headingId="appointments-filters-title">
        <div className="hid-ehr-dept-form-grid hid-ehr-dept-appointments-filters" role="group" aria-labelledby="appointments-filters-title">
          <EhrField label="Day" controlId="appointments-day" hint={isDay(filters.day) ? dayText(filters.day) : 'Choose a day.'}>
            <EhrInput type="date" value={filters.day} onChange={event => set({ day: event.target.value })} />
          </EhrField>
          <EhrField label="Clinic" controlId="appointments-clinic">
            <EhrSelect value={filters.clinicId} onChange={event => set({ clinicId: event.target.value })}>
              <option value="">Every clinic</option>
              {clinics.map(clinic => <option key={clinic.clinicId} value={clinic.clinicId}>{clinic.name}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label="Clinician" controlId="appointments-clinician">
            <EhrSelect value={filters.clinicianMembershipId} onChange={event => set({ clinicianMembershipId: event.target.value })}>
              <option value="">Everyone</option>
              {staff.map(id => <option key={id} value={id}>{clinicianText(id, names, membershipId)}</option>)}
            </EhrSelect>
          </EhrField>
        </div>
        <div className="hid-ehr-dept-appointments-day-steps">
          <EhrButton size="sm" variant="quiet" onClick={() => set({ day: addDays(isDay(filters.day) ? filters.day : today, -1) })}>Previous day</EhrButton>
          <EhrButton size="sm" variant="quiet" disabled={filters.day === today} onClick={() => set({ day: today })}>Today</EhrButton>
          <EhrButton size="sm" variant="quiet" onClick={() => set({ day: addDays(isDay(filters.day) ? filters.day : today, 1) })}>Next day</EhrButton>
        </div>
        <fieldset className="hid-ehr-dept-appointments-statuses">
          <legend>Show</legend>
          {STATUSES.map(status => (
            <label key={status}>
              <input type="checkbox" checked={filters.statuses.includes(status)} onChange={event => toggle(status, event.target.checked)} />
              <span>{STATUS_WORDS[status]}</span>
            </label>
          ))}
        </fieldset>
      </DeptSection>

      <DeptSection title={isDay(filters.day) ? `${filters.day === today ? 'Today' : dayText(filters.day)}${list?.key === key ? ` (${items.length}${list.nextCursor ? '+' : ''})` : ''}` : 'Appointments'}
        headingId="appointments-day-title">
        {error ? <DeptNotice role="alert" tone="critical">{error.text}</DeptNotice> : null}
        {!isDay(filters.day) ? <p className="hid-ehr-state-message">Choose a day to see its appointments.</p> : null}
        {loading && list?.key !== key ? <p className="hid-ehr-state-message" role="status">Loading appointments…</p> : null}
        {list?.key === key && items.length === 0 && filters.statuses.length > 0
          ? <EhrEmptyState title="No appointments" message="No appointments match this day and these choices." />
          : null}
        {filters.statuses.length === 0 ? <p className="hid-ehr-state-message">Choose at least one status to show.</p> : null}
        {items.length > 0 ? (
          <ul className="hid-ehr-dept-appointments-list" aria-label="Appointments on this day">
            {items.map(card => <DayCard key={card.appointmentId} card={card} names={names} membershipId={membershipId} />)}
          </ul>
        ) : null}
        {list?.key === key && list.nextCursor ? (
          <EhrButton variant="secondary" busy={more} onClick={() => void load(list.nextCursor ?? undefined)}>Show more</EhrButton>
        ) : null}
      </DeptSection>
    </DeptPage>
  )
}

/** One appointment on the day list: its time, who, where and with whom, and its status; the name opens it. */
function DayCard({ card, names, membershipId }: {
  readonly card: AppointmentCard
  readonly names: ReadonlyMap<string, string | null>
  readonly membershipId: string | undefined
}) {
  const headingId = `appointment-${card.appointmentId}`
  return (
    <li className="hid-ehr-dept-appointments-card" aria-labelledby={headingId}>
      <p className="hid-ehr-dept-appointments-time">{timeRangeText(card)}</p>
      <div className="hid-ehr-dept-appointments-main">
        <h3 id={headingId} className="hid-ehr-dept-appointments-name">
          <Link to={`${BASE}/${card.appointmentId}`}>{card.fullName}</Link>
        </h3>
        <Identity card={card} />
        <div className="hid-ehr-dept-appointments-badges">
          <EhrBadge tone={statusTone(card.status)}>{statusText(card.status)}</EhrBadge>
          {card.chartBlocked ? <EhrBadge tone="critical">Chart cannot be opened</EhrBadge> : null}
        </div>
        <dl className="hid-ehr-dept-appointments-facts">
          <div><dt>Clinic</dt><dd>{card.clinicName ?? departmentText(card.departmentCode)}</dd></div>
          <div><dt>With</dt><dd>{clinicianText(card.clinicianMembershipId, names, membershipId)}</dd></div>
          <div><dt>Visit</dt><dd>{visitTypeText(card.visitType)}</dd></div>
        </dl>
      </div>
    </li>
  )
}

/** Who the card is for: sex, date of birth and the Health ID's last 4 characters, never the whole Health ID. */
export function Identity({ card }: { readonly card: Pick<AppointmentCard, 'sex' | 'dateOfBirth' | 'healthIdLast4'> }) {
  const parts = [sexText(card.sex), card.dateOfBirth ? `Born ${birthDateText(card.dateOfBirth)}` : ''].filter(Boolean)
  return (
    <p className="hid-ehr-dept-appointments-identity">
      {parts.length > 0 ? <span>{parts.join(' · ')}</span> : null}
      {card.healthIdLast4 ? <span aria-label={`Health ID ending ${card.healthIdLast4}`}>{healthIdEnding(card.healthIdLast4)}</span> : null}
    </p>
  )
}
