import { useState, type FormEvent } from 'react'
import { toast } from '@hid/ui'
import { EhrButton, EhrDialog, EhrDrawer, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { facilityStaffApi, type FacilityStaffMember } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { licenceBodyForRole, licenceNumberAcceptable, normalizeLicenceNumber, roleLabels } from '../../../staff/staffAccess'
import { DeptSection } from '../parts/DeptPage'
import { DeptFacts, type DeptFact } from '../parts/DeptRecord'
import { RoleFields } from './InviteCard'
import type { StaffShared } from './shared'
import { fieldAria, FormFooter, StaffCheck, StaffField, StaffPassword } from './StaffFields'
import { attestationText, dateText, IDS, initials, licenceNumberProblem, licenceNumberText, licenceVouch, reasonProblem, REQUIRED } from './staffText'

const memberName = (id: string) => `ehr-staff-member-${id}`
const editButton = (id: string) => `ehr-staff-member-${id}-edit`

/**
 * "Memberships" (admin/staff.png): each member with their initials, name and "Role · status", and "Edit access" for the
 * members this administrator may change. Identity lets them change neither themselves nor a facility administrator,
 * and no one before Health ID support has checked the facility.
 */
export function Memberships({ shared, reviewed }: { readonly shared: StaffShared; readonly reviewed: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const manageable = (member: FacilityStaffMember) => reviewed && !member.isSelf && !member.isAdministrator
  // Closed by itself when the member is no longer manageable or listed once the list is read again.
  const member = shared.staff.members.find(entry => entry.membershipId === editing && manageable(entry))
  const close = () => { setEditing(null); setDirty(false) }

  return <>
    <DeptSection title="Memberships" headingId={IDS.members}>
      <ul className="hid-ehr-dept-staff-members">
        {shared.staff.members.map(entry => {
          const id = entry.membershipId
          return (
            <li key={id} className="hid-ehr-dept-staff-member">
              <div className="hid-ehr-dept-staff-row">
                <div className="hid-ehr-dept-staff-row-main">
                  <p className="hid-ehr-dept-staff-name">
                    <span className="hid-ehr-dept-avatar" aria-hidden="true">{initials(entry.name)}</span>
                    <strong id={memberName(id)}>{entry.name}</strong>
                  </p>
                  <p className="hid-ehr-dept-staff-sub">{roleLabels(entry.roles) || 'Staff'} · active</p>
                </div>
                {manageable(entry) ? (
                  <EhrButton id={editButton(id)} variant="secondary" aria-haspopup="dialog" aria-describedby={memberName(id)}
                    onClick={() => { setDirty(false); setEditing(id) }}>Edit access</EhrButton>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </DeptSection>
    <EhrDrawer open={member !== undefined} title="Staff details and access" dirty={dirty} onClose={close}>
      {member ? <MemberAccess key={member.membershipId} member={member} shared={shared} onDirty={setDirty} onClose={close} /> : null}
    </EhrDrawer>
  </>
}

const ACCESS_FIELDS = ['role', 'licence', 'access', 'reason', 'attested', 'password'] as const
type AccessField = (typeof ACCESS_FIELDS)[number]

/**
 * The drawer's record and form (prototype Staff "Staff details and access"): the member's role and licence, then one
 * form: Role, Account access, and what Identity asks for a change. "active" changes the role (with its licence and the
 * facility's confirmation); "ended" removes the member, after the target's typed DEACTIVATE decision. Both carry a
 * reason and the administrator's password, as today.
 */
function MemberAccess({ member, shared, onDirty, onClose }: {
  readonly member: FacilityStaffMember
  readonly shared: StaffShared
  readonly onDirty: (dirty: boolean) => void
  readonly onClose: () => void
}) {
  const { staff, facilityId, facilityName, actorEmail, done, refused } = shared
  const id = member.membershipId
  const prefix = `ehr-staff-access-${id}`
  const current = member.roles.find(code => staff.inviteOptions.roles.some(option => option.code === code)) ?? ''
  const [role, setRole] = useState(current)
  const [access, setAccess] = useState<'active' | 'ended'>('active')
  const [number, setNumber] = useState('')
  const [attested, setAttested] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Partial<Record<AccessField, string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const focus = useFocusById()
  const ending = access === 'ended'
  const body = ending ? null : licenceBodyForRole(role)
  const edit = <T,>(field: AccessField, set: (value: T) => void) => (value: T) => {
    set(value)
    onDirty(true)
    setErrors(({ [field]: _cleared, ...rest }) => rest)
  }

  const facts: DeptFact[] = [
    { label: 'Licence', value: licenceNumberText(member.licence) },
    ...(licenceVouch(member.licence) ? [{ label: 'Details', value: licenceVouch(member.licence) }] : []),
    { label: 'Joined', value: dateText(member.joinedAt) },
  ]

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const found: Partial<Record<AccessField, string>> = {}
    if (!ending) {
      if (!role) found.role = REQUIRED
      if (body && !number.trim()) found.licence = REQUIRED
      else if (body && !licenceNumberAcceptable(number)) found.licence = licenceNumberProblem(body)
      if (!attested) found.attested = REQUIRED
    }
    const reasonText = reasonProblem(reason)
    if (reasonText) found.reason = reasonText
    if (!password) found.password = REQUIRED
    setErrors(found)
    const first = ACCESS_FIELDS.find(field => found[field])
    if (first) { focus(`${prefix}-${first}`); return }
    if (ending) setDeciding(true)
    else void changeRole()
  }

  async function changeRole() {
    setBusy(true)
    try {
      await facilityStaffApi.changeRole(facilityId, member, { role,
        ...(body ? { licenceBody: body, licenceNumber: normalizeLicenceNumber(number) } : {}), reason: reason.trim(),
        currentPassword: password })
      toast.success('Access updated')
      onClose()
      done([editButton(id), IDS.members])
    } catch (caught) { setPassword(''); setError(refused(caught)) }
    finally { setBusy(false) }
  }

  async function end() {
    if (busy) return
    setBusy(true)
    try {
      const ended = await facilityStaffApi.end(facilityId, member, reason.trim(), password)
      const consents = ended.grantsRevoked === 1 ? ' 1 patient consent to them ended.'
        : ended.grantsRevoked > 1 ? ` ${ended.grantsRevoked} patient consents to them ended.` : ''
      // Ended consents are a fact to keep on the page: said in the banner, with no toast. Otherwise a generic toast.
      if (!consents) toast.success('Staff member deactivated')
      setDeciding(false)
      onClose()
      done([IDS.members], consents ? { tone: 'info', text: `${member.name} no longer has access to ${facilityName}.${consents}` } : null)
    } catch (caught) { setPassword(''); setDeciding(false); setError(refused(caught)) }
    finally { setBusy(false) }
  }

  return <>
    <div className="hid-ehr-dept-staff-drawer">
      <h3>{member.name}</h3>
      <p>{roleLabels(member.roles) || 'Staff'} / {member.email}</p>
      <DeptFacts facts={facts} />
      <form className="hid-ehr-dept-staff-form" noValidate onSubmit={submit} aria-label={`Access for ${member.name}`}>
        <div className="hid-ehr-dept-form-grid">
          {ending ? null : (
            <RoleFields idPrefix={prefix} roleLabelText="Role" roles={staff.inviteOptions.roles} role={role}
              onRole={value => { edit('role', setRole)(value); setErrors(({ licence: _cleared, ...rest }) => rest) }}
              number={number} onNumber={edit('licence', setNumber)} errors={{ role: errors.role, number: errors.licence }} />
          )}
          <StaffField id={`${prefix}-access`} label="Account access" required error={errors.access}>
            <EhrSelect id={`${prefix}-access`} value={access} required {...fieldAria(`${prefix}-access`, { error: errors.access })}
              onChange={event => edit('access', setAccess)(event.target.value === 'ended' ? 'ended' : 'active')}>
              <option value="active">active</option>
              <option value="ended">ended</option>
            </EhrSelect>
          </StaffField>
          <StaffField id={`${prefix}-reason`} label="Reason" required error={errors.reason} full>
            <EhrTextarea id={`${prefix}-reason`} value={reason} rows={3} maxLength={500} required
              {...fieldAria(`${prefix}-reason`, { error: errors.reason })} onChange={event => edit('reason', setReason)(event.target.value)} />
          </StaffField>
          {ending ? null : (
            <StaffCheck id={`${prefix}-attested`} checked={attested} onChange={edit('attested', setAttested)} error={errors.attested}>
              {attestationText(staff.inviteOptions.attestation?.text, member.name, facilityName)}
            </StaffCheck>
          )}
          <StaffPassword id={`${prefix}-password`} value={password} onChange={edit('password', setPassword)} error={errors.password}
            actorEmail={actorEmail} />
        </div>
        <FormFooter busy={busy && !deciding} label="Save" error={error} />
      </form>
    </div>
    <EhrDialog open={deciding} title="Deactivate this staff membership?" confirmLabel="Deactivate staff member" confirmWord="DEACTIVATE"
      confirmVariant="danger" busy={busy}
      description={`${member.name} will lose access to ${facilityName} at once. Their patients’ consents to this facility end, `
        + 'and Lab or Pharmacy work they accepted stays assigned to them. Saved records remain available to authorized staff.'}
      onConfirm={end} onCancel={() => setDeciding(false)} />
  </>
}
