import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type AdminFacilityStaffEntry, type FoundStaffInvitation } from './api'
import { failure } from './problems'
import { ResourceView, Status, Table, date, label, useResource } from './ui'
import { isLicenceBody, LICENCE_BODIES, roleLabel, roleLabels } from '../staff/staffAccess'

/**
 * Support's view of a facility's staff and licences (Novu, P4b SPEC 8.6 item 8): every member and invitation, with the
 * full licence numbers, who vouched for each and when, whether another account holds the same licence, and whether the
 * person vouched for has another name. Identity records every read in the audit log, so the panel reads only when
 * asked.
 */
export function FacilityStaffPanel({ facilityId }: { facilityId: string }) {
  const [shown, setShown] = useState(false)
  return <section className="admin-panel" aria-labelledby={`facility-staff-${facilityId}`}>
    <div className="admin-panel-head"><div><h2 id={`facility-staff-${facilityId}`}>Staff and licences</h2>
      <p>Every member and invitation of this facility, with the full licence numbers, who vouched for them and when. Each time
        you open it, Health ID records it in the audit log.</p></div></div>
    {shown ? <FacilityStaffTables facilityId={facilityId} />
      : <button type="button" className="admin-secondary" onClick={() => setShown(true)}>Show staff and licences</button>}
  </section>
}

const REVIEW_STATES: Readonly<Record<string, string>> = {
  pending: 'Signed itself up; waiting for Health ID support’s review.',
  reviewed: 'Signed itself up; reviewed, with full access.',
  released: 'Signed itself up; released.',
}

/** "MDCN 12345 (Medical and Dental Council of Nigeria)", or None. */
function licence(entry: AdminFacilityStaffEntry): string {
  if (!entry.licenceBody) return 'None'
  const regulator = isLicenceBody(entry.licenceBody) ? ` (${LICENCE_BODIES[entry.licenceBody].regulator})` : ''
  return `${entry.licenceBody} ${entry.licenceNumber ?? ''}`.trim() + regulator
}

/** Who vouched, and when: the facility's administrator, or Health ID support at its review. */
function vouched(entry: AdminFacilityStaffEntry): string {
  if (!entry.attestedAt && !entry.attestedByName) return 'Not recorded'
  const by = entry.verificationMethod === 'platform_review' ? 'Health ID support' : entry.attestedByName ?? 'Unknown'
  return `${by}, ${date(entry.attestedAt)}`
}

/** What support should look at more closely. */
function checks(entry: AdminFacilityStaffEntry): string {
  const found: string[] = []
  if (entry.sameLicenceElsewhere > 0) found.push(`Same licence on ${entry.sameLicenceElsewhere} other `
    + `${entry.sameLicenceElsewhere === 1 ? 'account' : 'accounts'}`)
  if (entry.nameMismatch) found.push('Name differs from the name vouched for')
  return found.length ? found.join('. ') : 'None'
}

function FacilityStaffTables({ facilityId }: { facilityId: string }) {
  const load = useCallback((signal?: AbortSignal) => adminApi.facilityStaff(facilityId, signal), [facilityId])
  const resource = useResource(load, 'This facility’s staff could not be loaded.')
  return <ResourceView resource={resource}>{staff => <>
    <p className="admin-note">{staff.facility.selfService ? REVIEW_STATES[staff.facility.selfService.review]
      ?? `Signed itself up: ${label(staff.facility.selfService.review)}.` : 'Health ID support manages this facility’s staff.'}</p>
    <h3>Members</h3>
    {staff.members.length === 0 ? <p className="admin-state">No members.</p>
      : <Table headings={['Member', 'Roles', 'Status', 'Licence', 'Vouched by', 'Checks']}>
        {staff.members.map(member => <tr key={member.membershipId ?? `${member.accountId}-${member.createdAt}`}>
          <td>{member.name ?? 'Not shown'}<small>{member.email}</small></td>
          <td>{roleLabels(member.roles) || 'None'}</td>
          <td>{member.status ? <Status value={member.status} /> : 'Not available'}</td>
          <td>{licence(member)}</td>
          <td>{vouched(member)}</td>
          <td>{checks(member)}</td>
        </tr>)}
      </Table>}
    <h3>Invitations</h3>
    {staff.invitations.length === 0 ? <p className="admin-state">No invitations.</p>
      : <Table headings={['Invitation', 'Role', 'Status', 'Licence', 'Vouched by', 'Checks']}>
        {staff.invitations.map(invitation => <tr key={invitation.invitationId ?? invitation.reference}>
          <td>{invitation.name ?? 'Not shown'}<small>{invitation.email}</small><small>Reference {invitation.reference}</small></td>
          <td>{roleLabels(invitation.roles) || 'Not shown'}</td>
          <td>{invitation.status ? <Status value={invitation.status} /> : 'Not available'}</td>
          <td>{licence(invitation)}</td>
          <td>{vouched(invitation)}</td>
          <td>{checks(invitation)}</td>
        </tr>)}
      </Table>}
  </>}</ResourceView>
}

const REFERENCE = /^[0-9A-Fa-f]{8}$/
const REFERENCE_INVALID = 'Enter the 8-character reference from the invitation email, for example 3F2A9C1B.'

/**
 * Finds an invitation by the reference its email quotes (P4b SPEC 8.6 item 9), for someone who reports an invitation
 * they did not expect. Only the reference is sent, never an email address.
 */
export function StaffInvitationLookup() {
  const [input, setInput] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ reference: string; items: FoundStaffInvitation[] } | null>(null)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const reference = input.trim().toUpperCase()
    if (!REFERENCE.test(reference)) { setInvalid(true); return }
    setInvalid(false); setError(''); setBusy(true)
    try { setFound({ reference, items: (await adminApi.findStaffInvitations(reference)).items }) }
    catch (caught) { setFound(null); setError(failure(caught, 'The invitation could not be looked up. Try again.')) }
    finally { setBusy(false) }
  }

  return <section className="admin-panel" aria-labelledby="staff-invitation-lookup-title">
    <div className="admin-panel-head"><div><h2 id="staff-invitation-lookup-title">Find an invitation</h2>
      <p>Every invitation email quotes a reference. Someone who reports an invitation they didn’t expect can give it to you.</p></div></div>
    <form className="admin-search" onSubmit={event => void submit(event)} role="search" aria-label="Invitations by reference">
      <label htmlFor="staff-invitation-reference">Invitation reference (8 characters)</label>
      <div><input id="staff-invitation-reference" value={input} autoComplete="off" spellCheck={false} maxLength={8}
        aria-invalid={invalid} aria-describedby={invalid ? 'staff-invitation-reference-error' : undefined}
        onChange={event => { setInput(event.target.value); setInvalid(false) }} placeholder="For example 3F2A9C1B" />
        <button className="admin-primary" type="submit" disabled={busy || !input.trim()}>{busy ? 'Finding…' : 'Find'}</button></div>
      {invalid && <p id="staff-invitation-reference-error" role="alert" className="admin-error">{REFERENCE_INVALID}</p>}
    </form>
    {error && <p role="alert" className="admin-error">{error}</p>}
    <div role="status">{found && (found.items.length === 0 ? <p className="admin-state">No invitation has the reference {found.reference}.</p>
      : <ul className="admin-stack">{found.items.map(item => <li key={item.invitationId}>
        <Link to={`/admin/facilities/${encodeURIComponent(item.facilityId)}`}>{item.facilityName}</Link>: {roleLabel(item.roleCode)},
        {' '}<Status value={item.status} />, sent {date(item.createdAt)}, expires {date(item.expiresAt)} (reference {item.reference})</li>)}
      </ul>)}</div>
  </section>
}
