import { useEffect, useState } from 'react'
import { toast } from '@hid/ui'
import { EhrButton, EhrDialog, EhrDrawer, EhrEmptyState } from '@hid/ui/ehr'
import { facilityStaffApi, type FacilityStaffInvitation } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { roleLabel } from '../../../staff/staffAccess'
import { DeptSection } from '../parts/DeptPage'
import { DeptFacts, type DeptFact } from '../parts/DeptRecord'
import type { StaffShared } from './shared'
import { ErrorBox } from './StaffFields'
import {
  dateText, DELIVERY_WORDS, deliveryToast, IDS, invitationStatus, licenceNumberText, plural, resendTime,
} from './staffText'

const nameId = (id: string) => `ehr-staff-invitation-${id}`
const detailsButton = (id: string) => `ehr-staff-invitation-${id}-details`

/** Pending and expired invitations can be sent again or revoked; accepted and revoked ones only read. */
const actionable = (invitation: FacilityStaffInvitation) => invitation.status === 'pending' || invitation.status === 'expired'

/**
 * "Invitation lifecycle" (admin/staff.png): each invitation with "Invitation details", its name and "email · role ·
 * status", and Resend and Revoke while it can still be used; a row's tick box selects it for the target's bulk bar.
 * Identity decides every send: a resend waits for the time it gives, and a refusal is said where it happened.
 */
export function InvitationLifecycle({ shared, reviewed }: { readonly shared: StaffShared; readonly reviewed: boolean }) {
  const { staff, facilityId, facilityName, done, reload, refused } = shared
  const [details, setDetails] = useState<string | null>(null)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [bulkError, setBulkError] = useState('')
  const [bulkBusy, setBulkBusy] = useState<'resend' | 'revoke' | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const focus = useFocusById()
  // Waiting invitations first, then the last 30 days' others, as today. Before support's check none can be sent.
  const list = reviewed ? [...staff.invitations.filter(entry => entry.status === 'pending'),
    ...staff.invitations.filter(entry => entry.status !== 'pending')] : []
  // A selection holds only rows that can still be acted on, once the list is read again.
  const chosen = selected.filter(id => list.some(entry => entry.invitationId === id && actionable(entry)))
  const detail = list.find(entry => entry.invitationId === details)

  async function resendSelected() {
    if (bulkBusy) return
    setBulkError('')
    setBulkBusy('resend')
    let sent = 0
    let failed = false
    try {
      for (const id of chosen) {
        const invitation = list.find(entry => entry.invitationId === id)
        if (!invitation) continue
        // Today's check: not sent again before the time Identity gives.
        if (resendTime(invitation) > Date.now()) {
          setBulkError(`You can resend the invitation to ${invitation.email} at ${dateText(invitation.resendAvailableAt)}.`)
          failed = true
          break
        }
        try {
          const result = await facilityStaffApi.resend(facilityId, invitation)
          sent += 1
          setSelected(old => old.filter(entry => entry !== id))
          if (result.deliveryOutcome !== 'accepted') deliveryToast(result.deliveryOutcome, invitation.email, true)
        } catch (caught) {
          setBulkError(refused(caught))
          failed = true
          break
        }
      }
    } finally { setBulkBusy(null) }
    if (sent > 0) {
      toast.success(`${plural(sent, 'invitation')} sent again`)
      if (failed) reload()
      else done()
    }
    focus(IDS.invitations, true)
  }

  async function revokeSelected() {
    if (bulkBusy) return
    setBulkError('')
    setBulkBusy('revoke')
    let revoked = 0
    let failed = false
    try {
      for (const id of chosen) {
        const invitation = list.find(entry => entry.invitationId === id)
        if (!invitation) continue
        try {
          await facilityStaffApi.revoke(facilityId, invitation)
          revoked += 1
          setSelected(old => old.filter(entry => entry !== id))
        } catch (caught) {
          setBulkError(refused(caught))
          failed = true
          break
        }
      }
    } finally {
      setBulkBusy(null)
      setRevokingAll(false)
    }
    if (revoked > 0) {
      toast.success(`${plural(revoked, 'invitation')} revoked`)
      if (failed) reload()
      else done()
    }
    focus(IDS.invitations, true)
  }

  return <>
    <DeptSection title="Invitation lifecycle" headingId={IDS.invitations}>
      {chosen.length > 0 ? (
        <div className="hid-ehr-dept-staff-bulk" role="region" aria-label="Selected invitation actions">
          <strong>{chosen.length} selected</strong>
          <EhrButton busy={bulkBusy === 'resend'} disabled={bulkBusy === 'revoke'} onClick={() => void resendSelected()}>
            {bulkBusy === 'resend' ? 'Working…' : 'Resend selected'}</EhrButton>
          <EhrButton variant="secondary" disabled={bulkBusy !== null} aria-haspopup="dialog" onClick={() => setRevokingAll(true)}>
            Revoke selected</EhrButton>
          <EhrButton variant="secondary" disabled={bulkBusy !== null}
            onClick={() => { setSelected([]); setBulkError(''); focus(IDS.invitations) }}>Clear selection</EhrButton>
        </div>
      ) : null}
      {bulkError ? <ErrorBox>{bulkError}</ErrorBox> : null}
      {list.length === 0 ? (
        <EhrEmptyState title="No invitations yet" message={reviewed ? 'Invite staff to give them access to this facility.'
          : `You can invite staff once Health ID support has checked ${facilityName}.`} />
      ) : (
        <ul className="hid-ehr-dept-staff-invitations">
          {list.map(invitation => (
            <InvitationRow key={invitation.invitationId} invitation={invitation} shared={shared}
              selected={chosen.includes(invitation.invitationId)}
              onSelect={on => setSelected(old => on ? [...old.filter(id => id !== invitation.invitationId), invitation.invitationId]
                : old.filter(id => id !== invitation.invitationId))}
              onDetails={() => setDetails(invitation.invitationId)} />
          ))}
        </ul>
      )}
    </DeptSection>
    <EhrDrawer open={detail !== undefined} title="Invitation details" onClose={() => setDetails(null)}>
      {detail ? <InvitationDetails invitation={detail} /> : null}
    </EhrDrawer>
    <EhrDialog open={revokingAll} title="Revoke selected invitations?" description="These invitation links will stop working."
      confirmLabel="Revoke invitations" confirmWord="REVOKE" confirmVariant="danger" busy={bulkBusy === 'revoke'}
      onConfirm={revokeSelected} onCancel={() => setRevokingAll(false)} />
  </>
}

function InvitationRow({ invitation, shared, selected, onSelect, onDetails }: {
  readonly invitation: FacilityStaffInvitation
  readonly shared: StaffShared
  readonly selected: boolean
  readonly onSelect: (selected: boolean) => void
  readonly onDetails: () => void
}) {
  const { facilityId, done, refused } = shared
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<'resend' | 'revoke' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const id = invitation.invitationId
  const resendAt = resendTime(invitation)
  const waiting = resendAt > now
  // Today's wait: the button opens again at the time Identity gives.
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(resendAt - now + 250, 60_000))
    return () => clearTimeout(timer)
  }, [waiting, resendAt, now])
  const open = actionable(invitation)
  const waitId = `${nameId(id)}-wait`

  async function resend() {
    if (busy || waiting) return
    setError('')
    setBusy('resend')
    try {
      const sent = await facilityStaffApi.resend(facilityId, invitation)
      deliveryToast(sent.deliveryOutcome, invitation.email, true)
      done([detailsButton(id), IDS.invitations])
    } catch (caught) { setError(refused(caught)) }
    finally { setBusy(null) }
  }

  async function revoke() {
    if (busy) return
    setError('')
    setBusy('revoke')
    try {
      await facilityStaffApi.revoke(facilityId, invitation)
      toast.success('Invitation revoked', { description: `The link and code sent to ${invitation.email} no longer work.` })
      setConfirming(false)
      done([detailsButton(id), IDS.invitations])
    } catch (caught) {
      setConfirming(false)
      setError(refused(caught))
    } finally { setBusy(null) }
  }

  return (
    <li className="hid-ehr-dept-staff-invitation">
      {open ? (
        <input type="checkbox" className="hid-ehr-dept-staff-select" aria-label={`Select invitation for ${invitation.email}`}
          checked={selected} onChange={event => onSelect(event.target.checked)} />
      ) : <span className="hid-ehr-dept-staff-select" aria-hidden="true" />}
      <EhrButton id={detailsButton(id)} variant="secondary" aria-haspopup="dialog" aria-describedby={nameId(id)}
        onClick={onDetails}>Invitation details</EhrButton>
      <div className="hid-ehr-dept-staff-row-main">
        <strong id={nameId(id)}>{invitation.name}</strong>
        <p className="hid-ehr-dept-staff-sub">{invitation.email} · {roleLabel(invitation.roleCode)} · {invitationStatus(invitation.status)}</p>
        {open && waiting ? <p id={waitId} className="hid-ehr-dept-staff-note">You can resend it at {dateText(invitation.resendAvailableAt)}.</p> : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
      </div>
      {open ? (
        <div className="hid-ehr-dept-staff-actions">
          <EhrButton variant="secondary" disabled={waiting} busy={busy === 'resend'}
            aria-disabled={busy !== null || undefined} aria-describedby={waiting ? `${nameId(id)} ${waitId}` : nameId(id)}
            onClick={() => void resend()}>{busy === 'resend' ? 'Working…' : 'Resend'}</EhrButton>
          <EhrButton variant="secondary" disabled={busy !== null} aria-haspopup="dialog" aria-describedby={nameId(id)}
            onClick={() => setConfirming(true)}>Revoke</EhrButton>
        </div>
      ) : null}
      <EhrDialog open={confirming} title="Revoke this invitation?" confirmLabel="Revoke invitation" confirmVariant="danger"
        description={`The invitation link and code sent to ${invitation.email} will stop working.`} busy={busy === 'revoke'}
        onConfirm={revoke} onCancel={() => setConfirming(false)} />
    </li>
  )
}

/** The target's "Invitation details" drawer: name, "email / role / status" and expiry, with what Identity adds. */
function InvitationDetails({ invitation }: { readonly invitation: FacilityStaffInvitation }) {
  const status = invitationStatus(invitation.status)
  const facts: DeptFact[] = [
    { label: 'Reference', value: invitation.reference },
    { label: 'Licence', value: licenceNumberText(invitation.licence) },
    { label: 'Invited by', value: invitation.invitedBy ?? 'Not available' },
    { label: 'Last sent', value: dateText(invitation.lastSentAt) },
    { label: 'Times sent', value: String(invitation.sendCount) },
    ...(invitation.status === 'pending' ? [{ label: 'Delivery', value: DELIVERY_WORDS[invitation.deliveryOutcome] ?? DELIVERY_WORDS.unknown }] : []),
  ]
  return (
    <div className="hid-ehr-dept-staff-drawer">
      <h3>{invitation.name}</h3>
      <p>{invitation.email} / {roleLabel(invitation.roleCode)} / {status}</p>
      {invitation.status === 'pending' && invitation.expiresAt ? <p>Expires {dateText(invitation.expiresAt)}</p> : null}
      {invitation.status === 'expired' && invitation.expiresAt ? <p>Expired {dateText(invitation.expiresAt)}</p> : null}
      <DeptFacts facts={facts} />
    </div>
  )
}

