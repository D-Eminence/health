import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, EmptyState, Field, Input, PasswordInput, Select, Textarea } from '@hid/ui'
import {
  facilityStaffApi, type FacilityStaff, type FacilityStaffInvitation, type FacilityStaffMember, type StaffDeliveryOutcome,
} from '../api'
import { useStaff } from '../App'
import { BUSY, UNAVAILABLE, useFocusById } from '../focus'
import {
  announceFacilityStaffChanged, isLicenceBody, LICENCE_BODIES, LICENCE_NUMBER_HINT, licenceBodyForRole, licenceNumberAcceptable,
  normalizeLicenceNumber, roleInSentence, roleLabel, roleLabels, selfServiceReview,
} from '../staffAccess'
import { isRouteMissing, isUnavailable, STAFF_REFRESHING, staffProblemText, type StaffProblemContext } from '../staffProblems'

/**
 * The Staff page of a facility that signed itself up (Novu, P4b SPEC 8.1): its administrator sees who works there,
 * invites staff and vouches for their licences, resends or revokes invitations, changes a member's role and removes a
 * member. Before Health ID support has checked the facility it shows the administrator alone, and lets them record
 * their own licence so that support can give them clinical access. Identity decides everything: the page only says
 * what it answered, and never whether an email has a Health ID account.
 */

/** A person's name as Identity takes it (P4b staff-names.ts): 2 to 6 words of letters, 2 to 80 characters. */
const PERSON_NAME = /^[\p{L}\p{M}]+(?:[ '-][\p{L}\p{M}]+){1,5}$/u
const RESERVED_WORDS = new Set(['healthid', 'hid', 'support', 'admin', 'administrator', 'ministry'])

/** The name as it is sent: a typographic apostrophe as a plain one, single spaces, trimmed. */
export function normalizePersonName(value: string): string {
  return value.replace(/[‘’ʼ]/g, '\'').replace(/\s+/g, ' ').trim()
}

/** Why Identity would refuse the name, or null. */
export function personNameProblem(value: string): string | null {
  const name = normalizePersonName(value)
  if (!name) return 'Enter the person’s full name.'
  const words = name.toLowerCase().split(/[ '-]+/).filter(Boolean)
  if (words.some((word, index) => RESERVED_WORDS.has(word) || (word === 'health' && words[index + 1] === 'id'))) {
    return 'A name can’t include the words Health ID, HID, support, admin, administrator or ministry.'
  }
  if (name.length > 80 || !PERSON_NAME.test(name)) {
    return 'Enter the person’s first name and surname, as on their licence: letters only, with no title, digits or '
      + 'punctuation other than an apostrophe or hyphen.'
  }
  return null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** "12 Oct 2026, 14:05", in the browser's time zone. */
function when(value: string | null | undefined): string {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Not available'
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return 'an unknown date'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'an unknown date' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(parsed)
}

const DELIVERY_LABELS: Readonly<Record<string, string>> = {
  accepted: 'Sent',
  definitive_failure: 'Not delivered: check the address',
  unknown: 'Delivery not confirmed',
  pending: 'Sending',
}

const INVITATION_STATUS: Readonly<Record<string, string>> = {
  pending: 'Waiting', accepted: 'Accepted', revoked: 'Revoked', expired: 'Expired',
}

/** What became of an invitation email just sent. */
function deliverySentence(outcome: StaffDeliveryOutcome | string, email: string, again = false): string {
  if (outcome === 'accepted') return again ? `Invitation sent again to ${email}.` : `Invitation sent to ${email}.`
  if (outcome === 'definitive_failure') return `The invitation to ${email} couldn’t be delivered. Check the address: if it’s `
    + 'wrong, revoke this invitation and invite the right one.'
  return `${again ? 'The invitation was renewed' : 'The invitation was created'}, but we couldn’t confirm that the email to `
    + `${email} was delivered. If it doesn’t arrive, send it again in a minute.`
}

/** The facility's confirmation, as Identity serves it, with the person and the facility named (P4b SPEC 4.2). */
const ATTESTATION_FALLBACK = 'I confirm that {name} works at {facility} and, for a clinical role, that I have seen their '
  + 'current practising licence with the number entered above. Health ID records this confirmation with my name, and '
  + 'Health ID support may check it.'

function attestationText(served: string | null | undefined, name: string, facility: string): string {
  return (served || ATTESTATION_FALLBACK).replaceAll('{name}', name || 'this person').replaceAll('{facility}', facility)
}

/** "MDCN ending 2345, vouched by Ada Obi on 12 Oct 2026". */
function licenceText(licence: FacilityStaffMember['licence'] | FacilityStaffInvitation['licence']): string {
  if (!licence) return 'None'
  const number = licence.numberHint ? `${licence.body} ending ${licence.numberHint}` : licence.body
  if (!('vouchedBy' in licence)) return number
  if (licence.method === 'platform_review') return `${number}, checked by Health ID support on ${dateOnly(licence.vouchedAt)}`
  return licence.vouchedBy ? `${number}, vouched by ${licence.vouchedBy} on ${dateOnly(licence.vouchedAt)}` : number
}

type Feedback = { text: string; tone: 'success' | 'error' } | null

type Loaded =
  | { facilityId: string; status: 'loading' }
  | { facilityId: string; status: 'ready'; staff: FacilityStaff }
  | { facilityId: string; status: 'failed'; caught: unknown }

export function StaffPage() {
  const { state } = useStaff()
  const actor = state.status === 'ready' ? state.session.actor : undefined
  const facility = actor?.facility
  const facilityId = facility?.id ?? ''
  const canManage = facility?.permissions.includes('workforce.manage') ?? false
  const selfService = selfServiceReview(facility) !== null
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [revision, setRevision] = useState(0)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const reload = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    if (!facilityId || !canManage || !selfService) return
    let active = true
    setLoaded(previous => previous?.facilityId === facilityId && previous.status === 'ready' ? previous
      : { facilityId, status: 'loading' })
    facilityStaffApi.read(facilityId).then(
      staff => { if (active) setLoaded({ facilityId, status: 'ready', staff }) },
      caught => { if (active) setLoaded({ facilityId, status: 'failed', caught }) })
    return () => { active = false }
  }, [facilityId, canManage, selfService, revision])

  if (!facility) return <EmptyState titleAs="h1" title="Staff" description="Choose the facility you are working at first." />
  if (!canManage) return <EmptyState titleAs="h1" title="Staff" description={`Only ${facility.name}’s administrator can manage its staff.`} />
  const notAvailable = <EmptyState titleAs="h1" title="Staff" description={`Health ID support manages who works at ${facility.name}. `
    + 'Contact Health ID support to add or remove staff.'} />
  if (!selfService) return notAvailable
  const current = loaded?.facilityId === facilityId ? loaded : null
  if (!current || current.status === 'loading') return <div role="status"><h1>Staff</h1><p>Loading your facility’s staff…</p></div>
  if (current.status === 'failed') {
    const { caught } = current
    if (isRouteMissing(caught)) return <EmptyState titleAs="h1" title="Staff" description="Adding staff isn’t set up for your facility. Contact support." />
    if (isHidApiError(caught) && caught.code === 'STAFF_MANAGEMENT_NOT_AVAILABLE') return notAvailable
    return <EmptyState titleAs="h1" title="Staff" description={isUnavailable(caught) ? staffProblemText(caught, { facility: facility.name })
      : `${facility.name}’s staff couldn’t be loaded. ${staffProblemText(caught, { facility: facility.name })}`}
      action={<Button onClick={reload}>Try again</Button>} />
  }
  return <StaffView key={facilityId} staff={current.staff} facilityId={facilityId} actorEmail={actor?.email ?? ''}
    feedback={feedback} onFeedback={setFeedback} reload={reload} />
}

function StaffView({ staff, facilityId, actorEmail, feedback, onFeedback, reload }: {
  staff: FacilityStaff; facilityId: string; actorEmail: string; feedback: Feedback; onFeedback: (next: Feedback) => void
  reload: () => void
}) {
  const facilityName = staff.facility.name
  const reviewed = staff.facility.reviewState === 'reviewed'
  const context: StaffProblemContext = { facility: facilityName, limits: staff.limits }
  const [inviting, setInviting] = useState(false)
  const focus = useFocusById()
  /** A command's outcome: said once at the top of the page; the list is read again after any success or stale refusal. */
  const done = (text: string) => { onFeedback({ text, tone: 'success' }); reload() }
  const refused = (caught: unknown): string => {
    const text = staffProblemText(caught, context)
    if (isHidApiError(caught) && STAFF_REFRESHING.includes(caught.code)) { onFeedback({ text, tone: 'error' }); reload() }
    return text
  }
  const shared = { facilityId, facilityName, context, actorEmail, done, refused }
  const waiting = staff.invitations.filter(invitation => invitation.status === 'pending')
  const others = staff.invitations.filter(invitation => invitation.status !== 'pending')

  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Facility administration</p><h1 id="staff-title" tabIndex={-1}>Staff</h1>
      <p>The people who work at {facilityName} on Health ID, and the invitations you have sent. You vouch for each clinician’s
        licence when you invite them.</p></div>
    <div role="status">{feedback?.tone === 'success' && <p className="staff-success">{feedback.text}</p>}</div>
    {feedback?.tone === 'error' && <p role="alert" className="staff-error">{feedback.text}</p>}

    {!reviewed && <>
      <p className="staff-notice">You can add staff once Health ID support has checked {facilityName}.</p>
      {staff.administratorLicenceBodies.some(isLicenceBody) && <OwnLicenceCard staff={staff} facilityId={facilityId}
        onSaved={text => { announceFacilityStaffChanged(); done(text) }} refused={refused} />}
    </>}

    {reviewed && <section className="staff-section" aria-labelledby="staff-invite-title">
      <h2 id="staff-invite-title">Invite staff</h2>
      {staff.facility.firstThirtyDaysEndAt && <p className="staff-notice">In its first 30 days on Health ID, {facilityName} can
        send {staff.limits.invitationsPerDay} invitations a day. Ask Health ID support if you need more.</p>}
      <p className="staff-muted">Today: {staff.limits.invitationsToday} of {staff.limits.invitationsPerDay} invitations and
        {' '}{staff.limits.emailsToday} of {staff.limits.emailsPerDay} invitation emails. Waiting: {staff.limits.pendingInvitations}
        {' '}of {staff.limits.pendingLimit}.</p>
      {!staff.canInvite && <p className="staff-notice">{cannotInvite(staff)}</p>}
      {staff.canInvite && !inviting && <Button onClick={() => { onFeedback(null); setInviting(true); focus('staff-invite-form-title') }}>
        Invite a member of staff</Button>}
      {staff.canInvite && inviting && <InviteForm staff={staff} {...shared}
        onClose={() => { setInviting(false); focus('staff-invite-title') }}
        onSent={text => { setInviting(false); done(text) }} />}
    </section>}

    <section className="staff-section" aria-labelledby="staff-members-title">
      <h2 id="staff-members-title">Members</h2>
      <div className="staff-list">{staff.members.map(member => <MemberRow key={`${member.membershipId}:${member.version}`}
        member={member} staff={staff} reviewed={reviewed} {...shared} />)}</div>
    </section>

    {reviewed && <section className="staff-section" aria-labelledby="staff-invitations-title">
      <h2 id="staff-invitations-title">Invitations</h2>
      {waiting.length === 0 && others.length === 0 && <p className="staff-muted">No invitations yet.</p>}
      <div className="staff-list">{[...waiting, ...others].map(invitation => <InvitationRow
        key={`${invitation.invitationId}:${invitation.version}`} invitation={invitation} {...shared} />)}</div>
    </section>}
  </>
}

/** Why the invite button is not offered, in the order Identity would refuse. */
function cannotInvite(staff: FacilityStaff): string {
  const name = staff.facility.name
  if (!staff.facility.invitationsOpen) return 'Adding staff is paused by Health ID. Try again later.'
  if (staff.facility.deliveryPaused) return `Too many invitations from ${name} could not be delivered in the last day. Check the `
    + 'addresses; you can send again later.'
  if (staff.limits.pendingInvitations >= staff.limits.pendingLimit) return `${name} already has ${staff.limits.pendingLimit} `
    + 'invitations waiting. Revoke the ones no longer needed before you invite anyone else.'
  return `${name} has sent as many invitations as it can for now (${staff.limits.invitationsPerDay} invitations and `
    + `${staff.limits.emailsPerDay} invitation emails a day). Try again later.`
}

interface Shared {
  facilityId: string
  facilityName: string
  context: StaffProblemContext
  actorEmail: string
  done: (text: string) => void
  refused: (caught: unknown) => string
}

/** The role, the licence its regulator issues (none for a receptionist), and the number. */
function RoleFields({ idPrefix, roles, role, onRole, number, onNumber, errors }: {
  idPrefix: string; roles: FacilityStaff['inviteOptions']['roles']; role: string; onRole: (role: string) => void
  number: string; onNumber: (value: string) => void; errors: { role?: string; number?: string }
}) {
  const body = licenceBodyForRole(role)
  return <>
    <Field label="Role" htmlFor={`${idPrefix}-role`} error={errors.role} required>
      <Select id={`${idPrefix}-role`} value={role} onChange={event => onRole(event.target.value)} required>
        <option value="">Choose a role</option>
        {roles.map(option => <option key={option.code} value={option.code}>{roleLabel(option.code)}</option>)}
      </Select>
    </Field>
    {body && <>
      <p className="staff-muted" id={`${idPrefix}-body`}>Licence: {body} ({LICENCE_BODIES[body].regulator})</p>
      <Field label="Licence number" htmlFor={`${idPrefix}-licence`} hint={LICENCE_NUMBER_HINT} error={errors.number} required>
        <Input id={`${idPrefix}-licence`} value={number} autoComplete="off" spellCheck={false} maxLength={100}
          onChange={event => onNumber(event.target.value)} required />
      </Field>
    </>}
    {role === 'receptionist' && <p className="staff-muted">A receptionist needs no licence.</p>}
  </>
}

/** The administrator's password, which Identity checks as a sign-in does (five wrong ones lock sign-in for 15 minutes). */
function PasswordConfirm({ id, value, onChange, error, actorEmail }: {
  id: string; value: string; onChange: (value: string) => void; error?: string; actorEmail: string
}) {
  return <>
    {/* Lets a password manager offer the administrator's own password. */}
    <input type="email" hidden readOnly autoComplete="username" value={actorEmail} />
    <Field label="Your password, to confirm" htmlFor={id} error={error} required>
      <PasswordInput id={id} value={value} autoComplete="current-password" maxLength={256}
        onChange={event => onChange(event.target.value)} required />
    </Field>
  </>
}

function InviteForm({ staff, facilityId, facilityName, actorEmail, onClose, onSent, refused }: Shared & {
  staff: FacilityStaff; onClose: () => void; onSent: (text: string) => void
}) {
  // One key per invitation form, kept for its retries: Identity answers a repeated key and request with the same invitation.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [number, setNumber] = useState('')
  const [attested, setAttested] = useState(false)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useFocusById()
  const body = licenceBodyForRole(role)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const found: Record<string, string> = {}
    const nameProblem = personNameProblem(name)
    if (nameProblem) found.name = nameProblem
    if (!EMAIL.test(email.trim())) found.email = 'Enter the person’s work email address.'
    if (!role) found.role = 'Choose the person’s role.'
    if (body && !licenceNumberAcceptable(number)) found.number = `Enter the ${body} licence number. ${LICENCE_NUMBER_HINT}`
    if (!attested) found.attested = 'Tick the box to confirm.'
    if (!password) found.password = 'Enter your password.'
    setErrors(found)
    const first = ['name', 'email', 'role', 'number', 'attested', 'password'].find(field => found[field])
    if (first) { focus(`staff-invite-${first}`); return }
    setBusy(true)
    const address = email.trim().toLowerCase()
    try {
      const created = await facilityStaffApi.invite(facilityId, {
        name: normalizePersonName(name), email: address, role,
        ...(body ? { licenceBody: body, licenceNumber: normalizeLicenceNumber(number) } : {}), currentPassword: password,
      }, idempotencyKey)
      onSent(created.replayed ? `This invitation was already sent to ${address}.` : deliverySentence(created.deliveryOutcome, address))
    } catch (caught) {
      setPassword('')
      // A reused key belongs to another request: a new one sends this one.
      if (isHidApiError(caught) && caught.code === 'IDEMPOTENCY_KEY_REUSED') setIdempotencyKey(crypto.randomUUID())
      setError(refused(caught))
    } finally { setBusy(false) }
  }

  return <Card className="staff-card"><form className="staff-form" noValidate onSubmit={event => void submit(event)}
    aria-labelledby="staff-invite-form-title">
    <h3 id="staff-invite-form-title" tabIndex={-1}>Invite a member of staff</h3>
    <p className="staff-muted">They get an email with a link to join {facilityName}. The invitation lasts 7 days.</p>
    <Field label="Full name" htmlFor="staff-invite-name" hint="As on their licence, for example Ngozi Okafor." error={errors.name} required>
      <Input id="staff-invite-name" value={name} autoComplete="off" maxLength={80} onChange={event => setName(event.target.value)} required />
    </Field>
    <Field label="Work email" htmlFor="staff-invite-email" hint="The address they will sign in with. Use their own work email, not a shared one."
      error={errors.email} required>
      <Input id="staff-invite-email" type="email" value={email} autoComplete="off" maxLength={254}
        onChange={event => setEmail(event.target.value)} required />
    </Field>
    <RoleFields idPrefix="staff-invite" roles={staff.inviteOptions.roles} role={role} onRole={setRole} number={number}
      onNumber={setNumber} errors={{ role: errors.role, number: errors.number }} />
    <label className="staff-choice"><input id="staff-invite-attested" type="checkbox" checked={attested}
      aria-describedby={errors.attested ? 'staff-invite-attested-error' : undefined}
      onChange={event => setAttested(event.target.checked)} /> {attestationText(staff.inviteOptions.attestation?.text,
      normalizePersonName(name), facilityName)}</label>
    {errors.attested && <p id="staff-invite-attested-error" className="staff-error">{errors.attested}</p>}
    <PasswordConfirm id="staff-invite-password" value={password} onChange={setPassword} error={errors.password} actorEmail={actorEmail} />
    {error && <p role="alert" className="staff-error">{error}</p>}
    <div className="staff-row">
      <Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Sending…' : 'Send invitation'}</Button>
      <Button type="button" tone="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
    </div>
  </form></Card>
}

function MemberRow({ member, staff, reviewed, facilityId, facilityName, actorEmail, done, refused, context }: Shared & {
  member: FacilityStaffMember; staff: FacilityStaff; reviewed: boolean
}) {
  const [open, setOpen] = useState<'role' | 'remove' | null>(null)
  const focus = useFocusById()
  const id = member.membershipId
  const manageable = reviewed && !member.isSelf && !member.isAdministrator
  return <div className="staff-list-item">
    <div className="staff-row"><strong id={`staff-member-${id}`} tabIndex={-1}>{member.name}</strong>
      <Badge tone="information">{roleLabels(member.roles) || 'Staff'}</Badge>{member.isSelf && <Badge tone="success">You</Badge>}</div>
    <p>{member.email}</p>
    <p>Licence: {licenceText(member.licence)}</p>
    <p>Joined {when(member.joinedAt)}</p>
    {manageable && !open && <div className="staff-row">
      <Button size="sm" tone="secondary" className={UNAVAILABLE} onClick={() => { setOpen('role'); focus(`staff-role-${id}-title`) }}>Change role</Button>
      <Button size="sm" tone="secondary" className={UNAVAILABLE} onClick={() => { setOpen('remove'); focus(`staff-remove-${id}-title`) }}>Remove</Button>
    </div>}
    {manageable && open === 'role' && <ChangeRoleForm member={member} staff={staff} facilityId={facilityId} facilityName={facilityName}
      actorEmail={actorEmail} context={context} refused={refused}
      onClose={() => { setOpen(null); focus(`staff-member-${id}`) }}
      done={text => { setOpen(null); done(text) }} />}
    {manageable && open === 'remove' && <RemoveForm member={member} facilityId={facilityId} facilityName={facilityName}
      actorEmail={actorEmail} context={context} refused={refused}
      onClose={() => { setOpen(null); focus(`staff-member-${id}`) }}
      done={text => { setOpen(null); done(text) }} />}
  </div>
}

function ChangeRoleForm({ member, staff, facilityId, facilityName, actorEmail, onClose, done, refused }: Shared & {
  member: FacilityStaffMember; staff: FacilityStaff; onClose: () => void
}) {
  const id = member.membershipId
  const [role, setRole] = useState('')
  const [number, setNumber] = useState('')
  const [attested, setAttested] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useFocusById()
  const body = licenceBodyForRole(role)
  const prefix = `staff-role-${id}`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const found: Record<string, string> = {}
    if (!role) found.role = 'Choose the new role.'
    if (body && !licenceNumberAcceptable(number)) found.number = `Enter the ${body} licence number. ${LICENCE_NUMBER_HINT}`
    if (!attested) found.attested = 'Tick the box to confirm.'
    const length = reason.trim().length
    if (length < 8 || length > 500) found.reason = 'Enter a reason of 8 to 500 characters.'
    if (!password) found.password = 'Enter your password.'
    setErrors(found)
    const first = ['role', 'number', 'attested', 'reason', 'password'].find(field => found[field])
    if (first) { focus(first === 'number' ? `${prefix}-licence` : `${prefix}-${first}`); return }
    setBusy(true)
    try {
      const changed = await facilityStaffApi.changeRole(facilityId, member, { role,
        ...(body ? { licenceBody: body, licenceNumber: normalizeLicenceNumber(number) } : {}), reason: reason.trim(),
        currentPassword: password })
      done(`${member.name} is now ${roleInSentence(changed.roleCode || role)} at ${facilityName}.`)
    } catch (caught) { setPassword(''); setError(refused(caught)) }
    finally { setBusy(false) }
  }

  return <form className="staff-form" noValidate onSubmit={event => void submit(event)} aria-labelledby={`${prefix}-title`}>
    <h3 id={`${prefix}-title`} tabIndex={-1}>Change {member.name}’s role</h3>
    <RoleFields idPrefix={prefix} roles={staff.inviteOptions.roles} role={role} onRole={setRole} number={number} onNumber={setNumber}
      errors={{ role: errors.role, number: errors.number }} />
    <label className="staff-choice"><input id={`${prefix}-attested`} type="checkbox" checked={attested}
      onChange={event => setAttested(event.target.checked)} /> {attestationText(staff.inviteOptions.attestation?.text, member.name,
      facilityName)}</label>
    {errors.attested && <p className="staff-error">{errors.attested}</p>}
    <Field label="Reason for the change" htmlFor={`${prefix}-reason`} error={errors.reason} required>
      <Textarea id={`${prefix}-reason`} value={reason} minLength={8} maxLength={500} onChange={event => setReason(event.target.value)} required />
    </Field>
    <PasswordConfirm id={`${prefix}-password`} value={password} onChange={setPassword} error={errors.password} actorEmail={actorEmail} />
    {error && <p role="alert" className="staff-error">{error}</p>}
    <div className="staff-row">
      <Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Saving…' : 'Change role'}</Button>
      <Button type="button" size="sm" tone="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
    </div>
  </form>
}

function RemoveForm({ member, facilityId, facilityName, actorEmail, onClose, done, refused }: Shared & {
  member: FacilityStaffMember; onClose: () => void
}) {
  const prefix = `staff-remove-${member.membershipId}`
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useFocusById()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const found: Record<string, string> = {}
    const length = reason.trim().length
    if (length < 8 || length > 500) found.reason = 'Enter a reason of 8 to 500 characters.'
    if (!password) found.password = 'Enter your password.'
    if (!confirmed) found.confirmed = 'Tick the box to confirm.'
    setErrors(found)
    const first = ['reason', 'password', 'confirmed'].find(field => found[field])
    if (first) { focus(`${prefix}-${first}`); return }
    setBusy(true)
    try {
      const ended = await facilityStaffApi.end(facilityId, member, reason.trim(), password)
      const consents = ended.grantsRevoked === 1 ? ' 1 patient consent to them ended.'
        : ended.grantsRevoked > 1 ? ` ${ended.grantsRevoked} patient consents to them ended.` : ''
      done(`${member.name} no longer has access to ${facilityName}.${consents}`)
    } catch (caught) { setPassword(''); setError(refused(caught)) }
    finally { setBusy(false) }
  }

  return <form className="staff-form" noValidate onSubmit={event => void submit(event)} aria-labelledby={`${prefix}-title`}>
    <h3 id={`${prefix}-title`} tabIndex={-1}>Remove {member.name}</h3>
    <p className="staff-notice">{member.name} will lose access to {facilityName} at once. Their patients’ consents to this facility
      end, and Lab or Pharmacy work they accepted stays assigned to them.</p>
    <Field label="Reason for removing them" htmlFor={`${prefix}-reason`} error={errors.reason} required>
      <Textarea id={`${prefix}-reason`} value={reason} minLength={8} maxLength={500} onChange={event => setReason(event.target.value)} required />
    </Field>
    <PasswordConfirm id={`${prefix}-password`} value={password} onChange={setPassword} error={errors.password} actorEmail={actorEmail} />
    <label className="staff-choice"><input id={`${prefix}-confirmed`} type="checkbox" checked={confirmed}
      onChange={event => setConfirmed(event.target.checked)} /> Remove {member.name} from {facilityName}</label>
    {errors.confirmed && <p className="staff-error">{errors.confirmed}</p>}
    {error && <p role="alert" className="staff-error">{error}</p>}
    <div className="staff-row">
      <Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Removing…' : 'Remove from facility'}</Button>
      <Button type="button" size="sm" tone="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
    </div>
  </form>
}

function InvitationRow({ invitation, facilityId, done, refused }: Shared & { invitation: FacilityStaffInvitation }) {
  const [now, setNow] = useState(() => Date.now())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const focus = useFocusById()
  const id = invitation.invitationId
  const resendAt = invitation.resendAvailableAt ? new Date(invitation.resendAvailableAt).getTime() : 0
  const waiting = Number.isFinite(resendAt) && resendAt > now
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(resendAt - now + 250, 60_000))
    return () => clearTimeout(timer)
  }, [waiting, resendAt, now])
  const open = invitation.status === 'pending' || invitation.status === 'expired'
  const revocable = invitation.status === 'pending' || invitation.status === 'expired'

  async function resend() {
    if (busy || waiting) return
    setError(''); setBusy(true)
    try {
      const sent = await facilityStaffApi.resend(facilityId, invitation)
      done(deliverySentence(sent.deliveryOutcome, invitation.email, true))
    } catch (caught) { setError(refused(caught)) }
    finally { setBusy(false) }
  }

  async function revoke() {
    if (busy) return
    setError(''); setBusy(true)
    try {
      await facilityStaffApi.revoke(facilityId, invitation)
      done(`The invitation to ${invitation.email} was revoked. Its link and code no longer work.`)
    } catch (caught) { setError(refused(caught)) }
    finally { setBusy(false) }
  }

  return <div className="staff-list-item">
    <div className="staff-row"><strong id={`staff-invitation-${id}`} tabIndex={-1}>{invitation.name}</strong>
      <Badge tone={invitation.status === 'pending' ? 'information' : invitation.status === 'accepted' ? 'success' : 'warning'}>
        {INVITATION_STATUS[invitation.status] ?? invitation.status}</Badge></div>
    <p>{invitation.email} · {roleLabel(invitation.roleCode)}{invitation.licence ? ` · ${licenceText(invitation.licence)}` : ''}</p>
    <p>Reference {invitation.reference} · Sent {when(invitation.lastSentAt)}{invitation.status === 'pending'
      ? ` · Expires ${when(invitation.expiresAt)}` : invitation.status === 'expired' ? ` · Expired ${when(invitation.expiresAt)}` : ''}</p>
    {invitation.status === 'pending' && <p>Delivery: {DELIVERY_LABELS[invitation.deliveryOutcome] ?? DELIVERY_LABELS.unknown}</p>}
    {open && <div className="staff-row">
      <Button size="sm" tone="secondary" onClick={() => void resend()} disabled={waiting} aria-disabled={busy || undefined}
        className={UNAVAILABLE} aria-describedby={waiting ? `staff-invitation-${id}-wait` : undefined}>Send again</Button>
      {revocable && !confirming && <Button size="sm" tone="quiet" onClick={() => { setConfirming(true); focus(`staff-invitation-${id}-revoke`) }}
        disabled={busy}>Revoke</Button>}
    </div>}
    {waiting && <p id={`staff-invitation-${id}-wait`} className="staff-muted">You can send it again at {when(invitation.resendAvailableAt)}.</p>}
    {confirming && <div className="staff-row" role="group" aria-labelledby={`staff-invitation-${id}-revoke`}>
      <p id={`staff-invitation-${id}-revoke`} tabIndex={-1}>Revoke the invitation to {invitation.email}? The link and code in the email
        will stop working.</p>
      <Button size="sm" onClick={() => void revoke()} aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Revoking…' : 'Revoke invitation'}</Button>
      <Button size="sm" tone="quiet" onClick={() => { setConfirming(false); focus(`staff-invitation-${id}`) }} disabled={busy}>Keep it</Button>
    </div>}
    {error && <p role="alert" className="staff-error">{error}</p>}
  </div>
}

/** "doctor or nurse", from the licences support can accept for this facility's administrator. */
function holders(bodies: readonly string[]): string {
  const names = bodies.filter(isLicenceBody).map(body => LICENCE_BODIES[body].holder)
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

/**
 * The administrator's own licence, before Health ID support's check (P4b SPEC 3.4): support gives them their facility
 * type's clinical role only with a licence recorded, and checks it when it reviews the facility.
 */
function OwnLicenceCard({ staff, facilityId, onSaved, refused }: {
  staff: FacilityStaff; facilityId: string; onSaved: (text: string) => void; refused: (caught: unknown) => string
}) {
  const bodies = staff.administratorLicenceBodies.filter(isLicenceBody)
  const saved = staff.administratorLicence
  const [body, setBody] = useState<string>(saved && bodies.includes(saved.body as never) ? saved.body : bodies[0] ?? '')
  const [number, setNumber] = useState('')
  const [problem, setProblem] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useFocusById()
  const facilityName = staff.facility.name

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (!licenceNumberAcceptable(number)) {
      setProblem(`Enter your licence number. ${LICENCE_NUMBER_HINT}`); focus('staff-own-licence-number'); return
    }
    setProblem('')
    setBusy(true)
    try {
      const recorded = await facilityStaffApi.recordAdministratorLicence(facilityId, body, normalizeLicenceNumber(number))
      setNumber('')
      onSaved(`Saved: ${recorded.licenceBody}${recorded.numberHint ? ` ending ${recorded.numberHint}` : ''}. Health ID support `
        + `checks it when it reviews ${facilityName}.`)
    } catch (caught) { setError(refused(caught)) }
    finally { setBusy(false) }
  }

  return <Card className="staff-card"><form className="staff-form" noValidate onSubmit={event => void submit(event)}
    aria-labelledby="staff-own-licence-title">
    <h2 id="staff-own-licence-title">Your own clinical access</h2>
    <p>If you are a licensed {holders(bodies)} and will treat patients yourself, enter your licence. Health ID support checks it
      when it reviews {facilityName}. If you leave it empty, you’ll manage the facility and its staff without clinical access
      yourself.</p>
    {saved && <p className="staff-success">Saved: {saved.body}{saved.numberHint ? ` ending ${saved.numberHint}` : ''}. You can
      change it until Health ID support’s check.</p>}
    <Field label="Licence" htmlFor="staff-own-licence-body">
      <Select id="staff-own-licence-body" value={body} onChange={event => setBody(event.target.value)}>
        {bodies.map(option => <option key={option} value={option}>{option} ({LICENCE_BODIES[option].holder})</option>)}
      </Select>
    </Field>
    <Field label="Licence number" htmlFor="staff-own-licence-number" hint={LICENCE_NUMBER_HINT} error={problem || undefined} required>
      <Input id="staff-own-licence-number" value={number} autoComplete="off" spellCheck={false} maxLength={100}
        onChange={event => setNumber(event.target.value)} required />
    </Field>
    {error && <p role="alert" className="staff-error">{error}</p>}
    <Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Saving…' : saved ? 'Save new licence' : 'Save licence'}</Button>
  </form></Card>
}
