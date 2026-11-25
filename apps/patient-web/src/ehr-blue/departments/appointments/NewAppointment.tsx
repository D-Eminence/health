import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { appointmentsApi, type AppointmentBooking, type AppointmentPatient, type AppointmentVisitType } from '../../../staff/api'
import type { PatientSearchCard } from '../../../staff/patientSearch'
import { useFocusById } from '../../../staff/focus'
import { refusedFields } from '../../../staff/fieldProblem'
import { DEPARTMENTS } from '../../collected/facilityProfile'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import {
  APPOINTMENT_REFUSALS, BASE, LENGTHS, REASON_HINT, REASON_MAX, VISIT_TYPES, VISIT_TYPE_WORDS, WRITE_REFUSED, canSearch,
  canWrite, clinicianText, dayText, departmentText, isDay, lagosStartsAt, learnFrom, refusalWords,
  takeHandedPatient, timeProblem,
} from './appointmentRules'
import { useBookingChoices } from './Appointments'
import { PatientFinder } from './PatientFinder'
import { useStaffNames } from './staffNames'
import { useIdempotencyKeys } from './useIdempotencyKeys'

/** The patient being booked: a search card (its matchRef, 10 minutes) or this facility's own patient (its id). */
type Chosen =
  | { readonly kind: 'search'; readonly card: PatientSearchCard }
  | { readonly kind: 'own'; readonly patientId: string; readonly fullName: string }

interface Values {
  clinicId: string
  departmentCode: string
  clinicianMembershipId: string
  day: string
  time: string
  lengthMinutes: string
  visitType: AppointmentVisitType | ''
  reason: string
}

type FieldProblems = Partial<Record<'patient' | 'departmentCode' | 'day' | 'time' | 'visitType' | 'reason', string>>

/** Refusals said at the field they are about, so it can be fixed there. */
const AT_FIELD: Readonly<Record<string, keyof FieldProblems>> = {
  APPOINTMENT_TIME_INVALID: 'time',
  APPOINTMENT_CLINICIAN_CLASH: 'time',
  APPOINTMENT_PATIENT_CLASH: 'time',
}

/**
 * New appointment (the design's create: Appointment time, Clinician, Department, Reason), on the live route: the patient
 * from a staff search card or handed over from this facility's patient page, then the clinic, department, clinician, day
 * and time (Lagos), length, visit type and reason. The server checks clashes (Q-APPT-2 A) and says so in plain words; a
 * search card older than 10 minutes, or a patient who is not this facility's own, asks for a new search. Nothing typed
 * goes to storage, the address or router state; the Idempotency-Key is the form's own, sent again with the same details.
 */
export function NewAppointment({ facilityId, day }: { readonly facilityId: string; readonly day: string }) {
  const { permissions } = useDeptAccess()
  if (!canWrite(permissions)) return <DeptUnavailable title="New appointment" message={WRITE_REFUSED} />
  return <BookingForm facilityId={facilityId} day={day} searches={canSearch(permissions)} />
}

function BookingForm({ facilityId, day, searches }: { readonly facilityId: string; readonly day: string; readonly searches: boolean }) {
  const navigate = useNavigate()
  const { membershipId } = useDeptAccess()
  const focus = useFocusById()
  const keyFor = useIdempotencyKeys()
  const [chosen, setChosen] = useState<Chosen | null>(() => {
    const handed = takeHandedPatient(facilityId)
    return handed ? { kind: 'own', patientId: handed.patientId, fullName: handed.fullName } : null
  })
  const [findNotice, setFindNotice] = useState('')
  const { clinics, staff } = useBookingChoices(facilityId)
  const names = useStaffNames(facilityId, staff)
  const [values, setValues] = useState<Values>({
    clinicId: '', departmentCode: '', clinicianMembershipId: '', day: isDay(day) ? day : '', time: '', lengthMinutes: '', visitType: '', reason: '',
  })
  const [problems, setProblems] = useState<FieldProblems>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const clinic = useMemo(() => clinics.find(item => item.clinicId === values.clinicId) ?? null, [clinics, values.clinicId])

  function change(next: Partial<Values>) { setValues(previous => ({ ...previous, ...next })) }

  function pick(card: PatientSearchCard) {
    setChosen({ kind: 'search', card }); setFindNotice(''); setProblems(previous => ({ ...previous, patient: undefined }))
    focus('appointment-new-patient')
  }

  /** Back to the search, with the reason said: the card expired, or the patient is not this facility's own. */
  function searchAgain(text: string) {
    setChosen(null); setFindNotice(text); setError('')
    focus('appointment-new-find-first-name')
  }

  function check(): { booking: AppointmentBooking; patient: AppointmentPatient } | null {
    const found: FieldProblems = {}
    if (!chosen) found.patient = 'Choose the patient first.'
    const departmentCode = clinic?.departmentCode ?? values.departmentCode
    if (!departmentCode) found.departmentCode = 'Choose the department.'
    if (!isDay(values.day)) found.day = 'Choose the day.'
    const timeIssue = timeProblem(values.time)
    if (timeIssue === 'missing') found.time = 'Choose the time.'
    else if (timeIssue === 'step') found.time = 'Choose a time on a 5-minute step (for example 09:05 or 09:10).'
    if (!values.visitType) found.visitType = 'Choose the type of visit.'
    if ([...values.reason.trim()].length > REASON_MAX) found.reason = `Keep the reason to ${REASON_MAX} characters or fewer.`
    const startsAt = lagosStartsAt(values.day, values.time)
    setProblems(found)
    if (Object.keys(found).length > 0 || !chosen || !startsAt || !values.visitType) return null
    const reason = values.reason.trim()
    return {
      patient: chosen.kind === 'search' ? { matchRef: chosen.card.matchRef } : { patientId: chosen.patientId },
      booking: {
        departmentCode,
        ...(clinic ? { clinicId: clinic.clinicId } : {}),
        ...(values.clinicianMembershipId ? { clinicianMembershipId: values.clinicianMembershipId } : {}),
        startsAt,
        ...(values.lengthMinutes ? { lengthMinutes: Number(values.lengthMinutes) } : {}),
        visitType: values.visitType,
        ...(reason ? { reason } : {}),
      },
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const ready = check()
    if (!ready) { focus('appointment-new-problems'); return }
    setBusy(true)
    try {
      const saved = await appointmentsApi.book(facilityId, ready.patient, ready.booking, keyFor('book', ready))
      learnFrom()
      navigate(`${BASE}/${saved.appointment.appointmentId}`, { state: { booked: true } })
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      if (isHidApiError(caught) && (caught.code === 'APPOINTMENT_NEEDS_SEARCH' || caught.code === 'APPOINTMENT_NEEDS_ONE_PATIENT')) {
        searchAgain(searches ? APPOINTMENT_REFUSALS.APPOINTMENT_NEEDS_SEARCH!
          : 'This patient can be booked here only after a patient search. Ask the front desk to book them.')
        return
      }
      if (isHidApiError(caught) && caught.code === 'APPOINTMENT_CLINIC_INVALID') { setProblems({ departmentCode: APPOINTMENT_REFUSALS.APPOINTMENT_CLINIC_INVALID }); return }
      if (isHidApiError(caught) && caught.code === 'APPOINTMENT_CLINICIAN_INVALID') { setError(APPOINTMENT_REFUSALS.APPOINTMENT_CLINICIAN_INVALID!); return }
      if (refusedFields(caught).some(field => field.field === 'departmentCode')) {
        setProblems({ departmentCode: 'Choose a department this facility runs (set in Facility profile).' })
        return
      }
      const field = isHidApiError(caught) ? AT_FIELD[caught.code] : undefined
      const text = refusalWords(caught, 'The appointment could not be booked. Try again.', 'write')
      if (field) { setProblems({ [field]: text }); focus(`appointment-new-${field}`); return }
      setError(text)
    } finally { setBusy(false) }
  }

  const problemList = Object.values(problems).filter(Boolean)

  return (
    <DeptPage eyebrow="Appointments" title="New appointment" onBack={() => navigate(BASE)} backLabel="Back to appointments"
      className="hid-ehr-dept-appointments">
      <DeptSection title="Patient" headingId="appointment-new-patient-title">
        {chosen ? (
          <div id="appointment-new-patient" tabIndex={-1} className="hid-ehr-dept-appointments-chosen">
            <p><strong>{chosen.kind === 'search' ? chosen.card.fullName : chosen.fullName}</strong>
              {chosen.kind === 'search' && chosen.card.healthIdLast4 ? <span> (Health ID ending {chosen.card.healthIdLast4})</span> : null}</p>
            {chosen.kind === 'search'
              ? <p className="hid-ehr-dept-appointments-hint">From your search. Book within 10 minutes of searching, or search again.</p>
              : <p className="hid-ehr-dept-appointments-hint">This facility’s patient, from their record.</p>}
            <EhrButton size="sm" variant="secondary" onClick={() => { setChosen(null); setFindNotice('') }}>Choose another patient</EhrButton>
          </div>
        ) : searches ? (
          <PatientFinder facilityId={facilityId} idPrefix="appointment-new-find" actionLabel="Choose" notice={findNotice || undefined} onPick={pick} />
        ) : (
          <DeptNotice tone="info" title="Choosing the patient">
            {findNotice || 'Your role here does not search for patients. Open the patient’s record and choose Book an appointment, or ask the front desk.'}
          </DeptNotice>
        )}
        {problems.patient ? <DeptNotice role="alert" tone="critical">{problems.patient}</DeptNotice> : null}
      </DeptSection>

      <form className="hid-ehr-dept-form" noValidate onSubmit={event => void save(event)} aria-labelledby="appointment-new-details-title">
        <DeptSection title="Appointment" headingId="appointment-new-details-title">
          {problemList.length > 0 ? (
            <DeptNotice id="appointment-new-problems" tabIndex={-1} role="alert" tone="critical" title="Check these details">
              <ul>{problemList.map(text => <li key={text}>{text}</li>)}</ul>
            </DeptNotice>
          ) : null}
          <div className="hid-ehr-dept-form-grid">
            <EhrField label="Clinic" controlId="appointment-new-clinic" hint={clinics.length === 0 ? 'No clinics are set up here: book to a department.' : 'Optional.'}>
              <EhrSelect value={values.clinicId} onChange={event => change({ clinicId: event.target.value })}>
                <option value="">No clinic</option>
                {clinics.map(item => <option key={item.clinicId} value={item.clinicId}>{item.name}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label="Department" controlId="appointment-new-departmentCode" error={problems.departmentCode}
              hint={clinic ? `The clinic’s department: ${departmentText(clinic.departmentCode)}.` : undefined}>
              <EhrSelect value={clinic?.departmentCode ?? values.departmentCode} disabled={clinic !== null}
                onChange={event => change({ departmentCode: event.target.value })}>
                <option value="">Choose…</option>
                {DEPARTMENTS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label="Clinician" controlId="appointment-new-clinician" hint="Optional: leave it to book the clinic or department.">
              <EhrSelect value={values.clinicianMembershipId} onChange={event => change({ clinicianMembershipId: event.target.value })}>
                <option value="">Any clinician</option>
                {staff.map(id => <option key={id} value={id}>{clinicianText(id, names, membershipId)}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label="Day" controlId="appointment-new-day" error={problems.day} hint={isDay(values.day) ? dayText(values.day) : undefined}>
              <EhrInput type="date" value={values.day} onChange={event => change({ day: event.target.value })} />
            </EhrField>
            <EhrField label="Time (Lagos)" controlId="appointment-new-time" error={problems.time} hint="On a 5-minute step, in Lagos time.">
              <EhrInput type="time" step={300} value={values.time} onChange={event => change({ time: event.target.value })} />
            </EhrField>
            <EhrField label="Length" controlId="appointment-new-length">
              <EhrSelect value={values.lengthMinutes} onChange={event => change({ lengthMinutes: event.target.value })}>
                <option value="">{clinic?.defaultLengthMinutes ? `The clinic’s usual (${clinic.defaultLengthMinutes} minutes)` : 'The usual length here'}</option>
                {LENGTHS.map(minutes => <option key={minutes} value={String(minutes)}>{minutes} minutes</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label="Visit type" controlId="appointment-new-visitType" error={problems.visitType}>
              <EhrSelect value={values.visitType} onChange={event => change({ visitType: event.target.value as AppointmentVisitType | '' })}>
                <option value="">Choose…</option>
                {VISIT_TYPES.map(type => <option key={type} value={type}>{VISIT_TYPE_WORDS[type]}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label="Reason" controlId="appointment-new-reason" error={problems.reason} hint={`Optional. ${REASON_HINT}`}>
              <EhrInput value={values.reason} onChange={event => change({ reason: event.target.value })} maxLength={REASON_MAX} autoComplete="off" />
            </EhrField>
          </div>
          {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
          <div className="hid-ehr-dept-form-actions">
            <EhrButton type="button" variant="quiet" onClick={() => navigate(BASE)}>Cancel</EhrButton>
            <EhrButton type="submit" busy={busy}>Book appointment</EhrButton>
          </div>
        </DeptSection>
      </form>
    </DeptPage>
  )
}

