import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { appointmentsApi, type AppointmentClinic, type AppointmentSettings } from '../../../staff/api'
import { DEPARTMENTS } from '../../collected/facilityProfile'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptSection } from '../parts/DeptPage'
import { canManageClinics, departmentText, learnFrom, notServed, refusalWords } from './appointmentRules'
import { useIdempotencyKeys } from './useIdempotencyKeys'
import './appointments.css'

const LENGTH_MIN = 5
const LENGTH_MAX = 240

/** A length typed in minutes: 5 to 240 in steps of 5, as the server takes it; null when it is not one. */
function lengthOf(text: string): number | null {
  const value = Number(text.trim())
  return Number.isInteger(value) && value >= LENGTH_MIN && value <= LENGTH_MAX && value % 5 === 0 ? value : null
}
const LENGTH_PROBLEM = `Enter minutes from ${LENGTH_MIN} to ${LENGTH_MAX}, in steps of 5.`

/**
 * Appointment clinics and the default appointment length (hid-system APPT-1 route 9), on Facility profile, for the
 * hospital administrator (organization.manage). A clinic is never deleted: making it inactive keeps its bookings. Shown
 * wherever Health ID serves appointments: a 404 or 503 (not served, or switched off) shows nothing.
 */
export function AppointmentClinics({ facilityId, permissions }: { readonly facilityId: string; readonly permissions: readonly string[] }) {
  const allowed = canManageClinics(permissions)
  const keyFor = useIdempotencyKeys()
  const [clinics, setClinics] = useState<readonly AppointmentClinic[] | null>(null)
  const [settings, setSettings] = useState<AppointmentSettings | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, length] = await Promise.all([appointmentsApi.clinics(facilityId, true), appointmentsApi.settings(facilityId)])
      learnFrom()
      setClinics(list.items); setSettings(length); setLoadError('')
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      if (notServed(caught)) { setHidden(true); return }
      setLoadError(refusalWords(caught, 'The appointment clinics could not be loaded. Try again.', 'settings'))
    }
  }, [facilityId])
  useEffect(() => { if (allowed) void load() }, [allowed, load])

  if (!allowed || hidden) return null

  async function save(action: string, send: () => Promise<unknown>, done: string): Promise<boolean> {
    setError(''); setNotice('')
    try {
      await send()
      setNotice(done)
      void load()
      return true
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return false
      setError(refusalWords(caught, `The ${action} could not be saved. Try again.`, 'settings'))
      if (isHidApiError(caught) && caught.status === 412) void load()
      return false
    }
  }

  return (
    <DeptSection title="Appointment clinics" headingId="appointment-clinics-title">
      <p className="hid-ehr-dept-appointments-hint">The clinics the front desk books patients into, and how long an appointment usually is.
        Patients see a clinic’s name in their own Health ID, so name clinics plainly.</p>
      {loadError ? <DeptNotice role="alert" tone="critical">{loadError}</DeptNotice> : null}
      {loadError && clinics === null ? <EhrButton variant="secondary" onClick={() => void load()}>Try again</EhrButton> : null}
      {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
      {notice ? <DeptNotice role="status" tone="positive">{notice}</DeptNotice> : null}
      {settings ? (
        <DefaultLength settings={settings} onSave={minutes => save('default length', () => appointmentsApi.saveSettings(facilityId, settings, minutes,
          keyFor('settings', [settings.rowVersion, minutes])), 'Default length saved.')} />
      ) : null}
      {clinics === null && !loadError ? <p className="hid-ehr-state-message" role="status">Loading the clinics…</p> : null}
      {clinics && clinics.length === 0 ? <p className="hid-ehr-state-message">No clinics yet. Patients can still be booked to a department.</p> : null}
      {clinics && clinics.length > 0 ? (
        <ul className="hid-ehr-dept-appointments-list" aria-label="Clinics">
          {clinics.map(clinic => (
            <ClinicRow key={clinic.clinicId} clinic={clinic} onSave={(change, done) => save('clinic', () => appointmentsApi.updateClinic(facilityId, clinic,
              change, keyFor('clinic', [clinic.clinicId, clinic.rowVersion, change])), done)} />
          ))}
        </ul>
      ) : null}
      {clinics ? <NewClinic onSave={clinic => save('clinic', () => appointmentsApi.createClinic(facilityId, clinic, keyFor('new-clinic', clinic)),
        `${clinic.name} added.`)} /> : null}
    </DeptSection>
  )
}

function DefaultLength({ settings, onSave }: { readonly settings: AppointmentSettings; readonly onSave: (minutes: number) => Promise<boolean> }) {
  const [text, setText] = useState(String(settings.defaultLengthMinutes))
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setText(String(settings.defaultLengthMinutes)) }, [settings.defaultLengthMinutes])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minutes = lengthOf(text)
    if (minutes === null) { setProblem(LENGTH_PROBLEM); return }
    setProblem(''); setBusy(true)
    try { await onSave(minutes) } finally { setBusy(false) }
  }
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={event => void submit(event)} aria-label="Default appointment length">
      <EhrField label="Default length (minutes)" controlId="appointment-default-length" error={problem || undefined}
        hint="Used when a booking and its clinic give no length.">
        <EhrInput inputMode="numeric" value={text} onChange={event => setText(event.target.value)} maxLength={3} />
      </EhrField>
      <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" variant="secondary" busy={busy}>Save length</EhrButton></div>
    </form>
  )
}

function ClinicRow({ clinic, onSave }: {
  readonly clinic: AppointmentClinic
  readonly onSave: (change: { name?: string; defaultLengthMinutes?: number | null; active?: boolean }, done: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(clinic.name)
  const [length, setLength] = useState(clinic.defaultLengthMinutes === null ? '' : String(clinic.defaultLengthMinutes))
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const headingId = `clinic-${clinic.clinicId}`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if ([...trimmed].length < 2 || [...trimmed].length > 80) { setProblem('Give the clinic a name of 2 to 80 characters.'); return }
    const minutes = length.trim() === '' ? null : lengthOf(length)
    if (length.trim() !== '' && minutes === null) { setProblem(LENGTH_PROBLEM); return }
    const change: { name?: string; defaultLengthMinutes?: number | null } = {}
    if (trimmed !== clinic.name) change.name = trimmed
    if (minutes !== clinic.defaultLengthMinutes) change.defaultLengthMinutes = minutes
    if (Object.keys(change).length === 0) { setEditing(false); return }
    setProblem(''); setBusy(true)
    try { if (await onSave(change, `${trimmed} saved.`)) setEditing(false) } finally { setBusy(false) }
  }

  async function toggleActive() {
    setBusy(true)
    try { await onSave({ active: !clinic.active }, clinic.active ? `${clinic.name} is closed to new bookings.` : `${clinic.name} is open for bookings.`) }
    finally { setBusy(false) }
  }

  return (
    <li className="hid-ehr-dept-appointments-card" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-appointments-main">
        <h3 id={headingId} className="hid-ehr-dept-appointments-name">{clinic.name}</h3>
        <p className="hid-ehr-dept-appointments-identity">
          <span>{departmentText(clinic.departmentCode)}</span>
          <span>{clinic.defaultLengthMinutes ? `${clinic.defaultLengthMinutes} minutes` : 'The facility’s default length'}</span>
        </p>
        <div className="hid-ehr-dept-appointments-badges">
          <EhrBadge tone={clinic.active ? 'positive' : 'neutral'}>{clinic.active ? 'Open for bookings' : 'Closed to new bookings'}</EhrBadge>
        </div>
      </div>
      <div className="hid-ehr-dept-appointments-actions">
        <EhrButton size="sm" variant="secondary" aria-expanded={editing} onClick={() => setEditing(value => !value)}>{editing ? 'Close' : 'Change'}</EhrButton>
        <EhrButton size="sm" variant="secondary" busy={busy && !editing} onClick={() => void toggleActive()}>
          {clinic.active ? 'Close to new bookings' : 'Open for bookings'}
        </EhrButton>
      </div>
      {editing ? (
        <form className="hid-ehr-dept-form hid-ehr-dept-appointments-row-form" noValidate onSubmit={event => void submit(event)} aria-label={`Change ${clinic.name}`}>
          <div className="hid-ehr-dept-form-grid">
            <EhrField label="Name" controlId={`${headingId}-name`}>
              <EhrInput value={name} onChange={event => setName(event.target.value)} maxLength={80} />
            </EhrField>
            <EhrField label="Usual length (minutes)" controlId={`${headingId}-length`} hint="Leave empty for the facility’s default.">
              <EhrInput inputMode="numeric" value={length} onChange={event => setLength(event.target.value)} maxLength={3} />
            </EhrField>
          </div>
          {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
          <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={busy}>Save clinic</EhrButton></div>
        </form>
      ) : null}
    </li>
  )
}

function NewClinic({ onSave }: { readonly onSave: (clinic: { name: string; departmentCode: string; defaultLengthMinutes?: number }) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [departmentCode, setDepartmentCode] = useState('')
  const [length, setLength] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    const minutes = length.trim() === '' ? undefined : lengthOf(length)
    const issue = [...trimmed].length < 2 || [...trimmed].length > 80 ? 'Give the clinic a name of 2 to 80 characters.'
      : !departmentCode ? 'Choose the clinic’s department.' : minutes === null ? LENGTH_PROBLEM : ''
    if (issue) { setProblem(issue); return }
    setProblem(''); setBusy(true)
    try {
      if (await onSave({ name: trimmed, departmentCode, ...(minutes ? { defaultLengthMinutes: minutes } : {}) })) {
        setName(''); setDepartmentCode(''); setLength('')
      }
    } finally { setBusy(false) }
  }
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={event => void submit(event)} aria-label="Add a clinic">
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="New clinic name" controlId="appointment-clinic-new-name">
          <EhrInput value={name} onChange={event => setName(event.target.value)} maxLength={80} />
        </EhrField>
        <EhrField label="Department" controlId="appointment-clinic-new-department">
          <EhrSelect value={departmentCode} onChange={event => setDepartmentCode(event.target.value)}>
            <option value="">Choose…</option>
            {DEPARTMENTS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Usual length (minutes)" controlId="appointment-clinic-new-length" hint="Optional.">
          <EhrInput inputMode="numeric" value={length} onChange={event => setLength(event.target.value)} maxLength={3} />
        </EhrField>
      </div>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={busy}>Add clinic</EhrButton></div>
    </form>
  )
}
