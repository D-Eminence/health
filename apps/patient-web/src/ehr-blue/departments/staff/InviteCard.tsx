import { useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { toast } from '@hid/ui'
import { EhrInput, EhrSelect } from '@hid/ui/ehr'
import { facilityStaffApi } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { normalizePersonName, personNameProblem } from '../../../staff/routes/Staff'
import {
  announceFacilityStaffChanged, isLicenceBody, LICENCE_BODIES, licenceBodyForRole, licenceNumberAcceptable,
  normalizeLicenceNumber, roleLabel,
} from '../../../staff/staffAccess'
import { DeptSection } from '../parts/DeptPage'
import { DeptNotice } from '../parts/DeptNotice'
import type { StaffShared } from './shared'
import { fieldAria, FormFooter, StaffCheck, StaffField, StaffPassword } from './StaffFields'
import {
  attestationText, deliveryNotice, EMAIL, EMAIL_PROBLEM, holders, licenceNumberProblem, REQUIRED, type StaffNotice,
} from './staffText'

/** The role, and the licence number its regulator issues (none for a receptionist), as the target's form fields. */
export function RoleFields({ idPrefix, roleLabelText, roles, role, onRole, number, onNumber, errors }: {
  readonly idPrefix: string
  readonly roleLabelText: string
  readonly roles: ReadonlyArray<{ code: string }>
  readonly role: string
  readonly onRole: (role: string) => void
  readonly number: string
  readonly onNumber: (value: string) => void
  readonly errors: { role?: string; number?: string }
}) {
  const body = licenceBodyForRole(role)
  return <>
    <StaffField id={`${idPrefix}-role`} label={roleLabelText} required error={errors.role}>
      <EhrSelect id={`${idPrefix}-role`} value={role} required {...fieldAria(`${idPrefix}-role`, { error: errors.role })}
        onChange={event => onRole(event.target.value)}>
        <option value="">Select…</option>
        {roles.map(option => <option key={option.code} value={option.code}>{roleLabel(option.code)}</option>)}
      </EhrSelect>
    </StaffField>
    {body ? (
      <StaffField id={`${idPrefix}-licence`} label="Licence number" required error={errors.number}
        hint={`${body}: ${LICENCE_BODIES[body].regulator}`}>
        <EhrInput id={`${idPrefix}-licence`} value={number} autoComplete="off" spellCheck={false} maxLength={100} required
          {...fieldAria(`${idPrefix}-licence`, { error: errors.number, hint: true })} onChange={event => onNumber(event.target.value)} />
      </StaffField>
    ) : null}
  </>
}

const INVITE_FIELDS = ['name', 'email', 'role', 'licence', 'attested', 'password'] as const

/**
 * "Invite a staff member" (the target's card under "Invite staff"): name, email and assigned role as on the target;
 * the licence the role needs, the facility's confirmation and the administrator's password, which Identity asks for.
 */
export function InviteCard({ shared, onSent }: { readonly shared: StaffShared; readonly onSent: (notice: StaffNotice | null) => void }) {
  const { staff, facilityId, facilityName, actorEmail, refused } = shared
  // One key per invitation form, kept for its retries: Identity answers a repeated key and request with the same invitation.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [number, setNumber] = useState('')
  const [attested, setAttested] = useState(false)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Partial<Record<(typeof INVITE_FIELDS)[number], string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useFocusById()
  const body = licenceBodyForRole(role)
  const limits = staff.limits
  const edit = <T,>(field: (typeof INVITE_FIELDS)[number], set: (value: T) => void) => (value: T) => {
    set(value)
    setErrors(({ [field]: _cleared, ...rest }) => rest)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const found: typeof errors = {}
    if (!name.trim()) found.name = REQUIRED
    else {
      const problem = personNameProblem(name)
      if (problem) found.name = problem
    }
    if (!email.trim()) found.email = REQUIRED
    else if (!EMAIL.test(email.trim())) found.email = EMAIL_PROBLEM
    if (!role) found.role = REQUIRED
    if (body && !number.trim()) found.licence = REQUIRED
    else if (body && !licenceNumberAcceptable(number)) found.licence = licenceNumberProblem(body)
    if (!attested) found.attested = REQUIRED
    if (!password) found.password = REQUIRED
    setErrors(found)
    const first = INVITE_FIELDS.find(field => found[field])
    if (first) { focus(`ehr-staff-invite-${first}`); return }
    setBusy(true)
    const address = email.trim().toLowerCase()
    try {
      const created = await facilityStaffApi.invite(facilityId, {
        name: normalizePersonName(name), email: address, role,
        ...(body ? { licenceBody: body, licenceNumber: normalizeLicenceNumber(number) } : {}), currentPassword: password,
      }, idempotencyKey)
      // A toast carries a generic title only; what the administrator must know about this address stays in a banner.
      const notice: StaffNotice | null = created.replayed ? { tone: 'info', text: `This invitation was already sent to ${address}.` }
        : deliveryNotice(created.deliveryOutcome, address, false)
      if (!notice) toast.success('Invitation created')
      onSent(notice)
    } catch (caught) {
      setPassword('')
      // A reused key belongs to another request: a new one sends this one.
      if (isHidApiError(caught) && caught.code === 'IDEMPOTENCY_KEY_REUSED') setIdempotencyKey(crypto.randomUUID())
      setError(refused(caught))
    } finally { setBusy(false) }
  }

  return (
    <DeptSection title="Invite a staff member" id="ehr-staff-invite-card" headingId="ehr-staff-invite-title">
      <p className="hid-ehr-dept-muted">They get an email with a link to join {facilityName}. The invitation lasts 7 days.
        {' '}Today: {limits.invitationsToday} of {limits.invitationsPerDay} invitations and {limits.emailsToday} of
        {' '}{limits.emailsPerDay} emails. Waiting: {limits.pendingInvitations} of {limits.pendingLimit}.</p>
      <form className="hid-ehr-dept-staff-form" noValidate onSubmit={event => void submit(event)} aria-labelledby="ehr-staff-invite-title">
        <div className="hid-ehr-dept-form-grid">
          <StaffField id="ehr-staff-invite-name" label="Name" required error={errors.name}>
            <EhrInput id="ehr-staff-invite-name" value={name} autoComplete="off" maxLength={80} required
              {...fieldAria('ehr-staff-invite-name', { error: errors.name })} onChange={event => edit('name', setName)(event.target.value)} />
          </StaffField>
          <StaffField id="ehr-staff-invite-email" label="Email" required error={errors.email}>
            <EhrInput id="ehr-staff-invite-email" type="email" value={email} autoComplete="off" maxLength={254} required
              {...fieldAria('ehr-staff-invite-email', { error: errors.email })} onChange={event => edit('email', setEmail)(event.target.value)} />
          </StaffField>
          <RoleFields idPrefix="ehr-staff-invite" roleLabelText="Assigned role" roles={staff.inviteOptions.roles} role={role}
            onRole={value => { edit('role', setRole)(value); setErrors(({ licence: _cleared, ...rest }) => rest) }}
            number={number} onNumber={edit('licence', setNumber)} errors={{ role: errors.role, number: errors.licence }} />
          <StaffCheck id="ehr-staff-invite-attested" checked={attested} onChange={edit('attested', setAttested)} error={errors.attested}>
            {attestationText(staff.inviteOptions.attestation?.text, normalizePersonName(name), facilityName)}
          </StaffCheck>
          <StaffPassword id="ehr-staff-invite-password" value={password} onChange={edit('password', setPassword)}
            error={errors.password} actorEmail={actorEmail} />
        </div>
        <FormFooter busy={busy} label="Create invitation" error={error} />
      </form>
    </DeptSection>
  )
}

/**
 * The administrator's own licence, before Health ID support's check (P4b SPEC 3.4): support gives them their facility
 * type's clinical role only with a licence recorded, and checks it when it reviews the facility. Not on the target,
 * which has no review: drawn as its cards and forms.
 */
export function OwnLicenceCard({ shared }: { readonly shared: StaffShared }) {
  const { staff, facilityId, facilityName, done, refused } = shared
  const bodies = staff.administratorLicenceBodies.filter(isLicenceBody)
  const saved = staff.administratorLicence
  const [body, setBody] = useState<string>(saved && bodies.includes(saved.body as never) ? saved.body : bodies[0] ?? '')
  const [number, setNumber] = useState('')
  const [errors, setErrors] = useState<{ body?: string; number?: string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useFocusById()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const found: typeof errors = {}
    if (!body) found.body = REQUIRED
    if (!number.trim()) found.number = REQUIRED
    else if (!licenceNumberAcceptable(number)) found.number = isLicenceBody(body) ? licenceNumberProblem(body) : REQUIRED
    setErrors(found)
    if (found.body || found.number) { focus(found.body ? 'ehr-staff-own-licence-body' : 'ehr-staff-own-licence-number'); return }
    setBusy(true)
    try {
      await facilityStaffApi.recordAdministratorLicence(facilityId, body, normalizeLicenceNumber(number))
      setNumber('')
      // The card itself says what was saved once the list is read again ("Saved: NMCN ending 4321…"): the toast is generic.
      toast.success('Licence saved')
      announceFacilityStaffChanged()
      done()
    } catch (caught) { setError(refused(caught)) }
    finally { setBusy(false) }
  }

  return (
    <DeptSection title="Your own clinical access" headingId="ehr-staff-own-licence-title">
      <p>If you are a licensed {holders(bodies)} and will treat patients yourself, enter your licence. Health ID support
        {' '}checks it when it reviews {facilityName}. Leave it empty to manage the facility and its staff without clinical
        {' '}access yourself.</p>
      {saved ? <DeptNotice>Saved: {saved.body}{saved.numberHint ? ` ending ${saved.numberHint}` : ''}. You can change it until
        {' '}Health ID support’s check.</DeptNotice> : null}
      <form className="hid-ehr-dept-staff-form" noValidate onSubmit={event => void submit(event)} aria-labelledby="ehr-staff-own-licence-title">
        <div className="hid-ehr-dept-form-grid">
          <StaffField id="ehr-staff-own-licence-body" label="Licence" required error={errors.body}>
            <EhrSelect id="ehr-staff-own-licence-body" value={body} required {...fieldAria('ehr-staff-own-licence-body', { error: errors.body })}
              onChange={event => { setBody(event.target.value); setErrors(({ body: _cleared, ...rest }) => rest) }}>
              <option value="">Select…</option>
              {bodies.map(option => <option key={option} value={option}>{option} ({LICENCE_BODIES[option].holder})</option>)}
            </EhrSelect>
          </StaffField>
          <StaffField id="ehr-staff-own-licence-number" label="Licence number" required error={errors.number}>
            <EhrInput id="ehr-staff-own-licence-number" value={number} autoComplete="off" spellCheck={false} maxLength={100} required
              {...fieldAria('ehr-staff-own-licence-number', { error: errors.number })}
              onChange={event => { setNumber(event.target.value); setErrors(({ number: _cleared, ...rest }) => rest) }} />
          </StaffField>
        </div>
        <FormFooter busy={busy} label={saved ? 'Save new licence' : 'Save licence'} error={error} />
      </form>
    </DeptSection>
  )
}

