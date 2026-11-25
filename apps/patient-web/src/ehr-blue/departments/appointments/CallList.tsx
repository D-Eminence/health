import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { appointmentsApi, type AppointmentCallListItem } from '../../../staff/api'
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
 * code as booking). No reason, visit type or date of birth is on it. Printed, it carries the frame's facility header and
 * this list's footer: it holds patient phone numbers, so it stays at the desk and is shredded after use. Reminders by
 * text message are built but switched off (Q-APPT-3 A), so nothing here sends one.
 */
export function CallList({ facilityId, day }: { readonly facilityId: string; readonly day: string }) {
  const { permissions } = useDeptAccess()
  if (!canWrite(permissions)) return <DeptUnavailable title="Call list" message={WRITE_REFUSED} />
  return <CallListPage facilityId={facilityId} initialDay={day} />
}

function CallListPage({ facilityId, initialDay }: { readonly facilityId: string; readonly initialDay: string }) {
  const navigate = useNavigate()
  const { membershipId, facility } = useDeptAccess()
  const facilityName = facility?.name ?? ''
  const { clinics } = useBookingChoices(facilityId)
  const [day, setDay] = useState(initialDay)
  const [clinicId, setClinicId] = useState('')
  const [items, setItems] = useState<readonly AppointmentCallListItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!isDay(day)) return
    setLoading(true); setError('')
    try {
      const answer = await appointmentsApi.callList(facilityId, { day, clinicId: clinicId || undefined })
      learnFrom()
      setItems(answer.items)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      setItems(null)
      setError(notServed(caught) ? NOT_AVAILABLE : refusalWords(caught, 'The call list could not be loaded. Try again.', 'write'))
    } finally { setLoading(false) }
  }, [facilityId, day, clinicId])
  useEffect(() => { void load() }, [load])

  const names = useStaffNames(facilityId, (items ?? []).map(item => item.clinicianMembershipId))

  return (
    <DeptPage eyebrow="Appointments" title="Call list" description="Booked patients for one day, with the phone this facility recorded, to call and confirm."
      onBack={() => navigate(BASE)} backLabel="Back to appointments" className="hid-ehr-dept-appointments hid-ehr-dept-appointments-call"
      secondaryActions={<EhrButton variant="secondary" disabled={!items || items.length === 0} onClick={() => window.print()}>Print</EhrButton>}>
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
          <div className="hid-ehr-dept-appointments-call-paper" data-call-list-print="">
          <p className="hid-ehr-dept-appointments-print-heading">{[facilityName, `Call list for ${dayText(day)}`].filter(Boolean).join(' · ')}</p>
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
                  <td>{clinicianText(item.clinicianMembershipId, names, membershipId)}</td>
                  <td>{item.phone ? <a href={`tel:${item.phone}`}>{item.phone}</a> : 'No phone recorded'}</td>
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
    </DeptPage>
  )
}
