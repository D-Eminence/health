import { useCallback, useState, type FormEvent } from 'react'
import { FilterTabs } from '../kasuwa/ui'
import { adminApi, type AdminActor, type OutreachOrganiser, type OutreachRegistrationFound } from './api'
import { Page, Refresh, ResourceView, Table, date, has, useGovernedSubmit, useResource, useUrlFilters } from './ui'

/**
 * Support's "Outreach organisers" (open sign-up on outreach., owner decisions of 11 November 2026). Anyone can sign up to
 * run outreach, and Health ID does not check a group before its campaigns go live (decision Q38): a new group can open a
 * campaign at once, and the people it registers are told it is an "Unverified organiser". Support can pause a group,
 * close a campaign whose only admin has gone, or make another member its admin, and delete one person's details sooner
 * when they ask (as the registration notice and the organiser terms promise). There are no limits to raise (decision 2)
 * and nothing to bill (decision 6).
 */

type View = 'active' | 'suspended' | 'all'

/** Plain words for every refusal these tools can meet. */
const PROBLEMS: Readonly<Record<string, string>> = {
  OUTREACH_ORGANISER_NOT_FOUND: 'That outreach group was not found. Refresh the list.',
  OUTREACH_ORGANISER_VERSION_CONFLICT: 'Someone else changed this outreach group just now. Refresh the list and try again.',
  OUTREACH_ORGANISER_ALREADY_SUSPENDED: 'This outreach group is already paused.',
  OUTREACH_ADMIN_VERSION_REQUIRED: 'Refresh the list, then try again.',
  OUTREACH_CAMPAIGN_NOT_FOUND: 'No campaign at an outreach group has that reference. Check it with the organiser.',
  OUTREACH_CAMPAIGN_VERSION_CONFLICT: 'That campaign has changed since its version was read. Ask the organiser for the version shown now, then try again.',
  OUTREACH_CAMPAIGN_CLOSED: 'That campaign is already closed.',
  OUTREACH_CAMPAIGN_ADMIN_NOT_ELIGIBLE: 'That person is not an active member of this outreach group.',
  OUTREACH_ORGANISERS_UNAVAILABLE: 'Outreach groups are not available from this Identity yet.',
  ADMIN_OUTREACH_UNAVAILABLE: 'Outreach groups could not be loaded or changed right now. Please try again.',
  VALIDATION_FAILED: 'Check the details: a reason needs 8 to 500 characters, and references must be complete.',
  PERMISSION_DENIED: 'Your roles don’t allow this. Ask a Super Admin.',
  OUTREACH_REGISTRATION_NOT_REDACTABLE: 'This person’s details can’t be deleted: they were deleted already, or the registration was not found. Search again.',
  OUTREACH_REDACTION_INVALID: 'Write why the details are being deleted, in 8 to 500 characters.',
  OUTREACH_REGISTRATION_LOOKUP_INVALID: 'Choose the group, then enter the temporary ID (it starts tmp_) or the phone number the person gives.',
}

const KIND_WORDS: Readonly<Record<string, string>> = { individual: 'A volunteer on their own', group: 'A group, NGO or community organisation' }
/** Health ID never verifies an outreach group, so a group that is not paused is an "Unverified organiser". */
const STATUS_WORDS: Readonly<Record<string, string>> = { active: 'Unverified organiser', suspended: 'Paused' }
/** "1 campaign", "3 campaigns"; a number Identity left out reads as 0. */
const count = (value: number | undefined, word: string) => { const n = Number.isFinite(value) ? Number(value) : 0; return `${n} ${word}${n === 1 ? '' : 's'}` }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function OutreachOrganisersPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilters] = useUrlFilters(['view'] as const)
  const view: View = filters.view === 'suspended' || filters.view === 'all' ? filters.view : 'active'
  const load = useCallback((signal?: AbortSignal) => adminApi.outreachOrganisers(view, signal), [view])
  const resource = useResource(load, 'Outreach groups could not be loaded.')
  const [notice, setNotice] = useState<string | null>(null)
  // Identity asks for both on every one of these commands (pause, close, make admin).
  const canManage = has(actor, 'platform.facility.unlock') && has(actor, 'platform.facility.manage')
  const done = (text: string) => { setNotice(text); resource.reload() }

  return <Page eyebrow="Organizations" title="Outreach organisers"
    description="Volunteers, NGOs and community groups that signed up to run outreach. Health ID does not check them before their campaigns start."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <section className="admin-panel" aria-labelledby="outreach-organisers-what-title">
      <div className="admin-panel-head"><div><h2 id="outreach-organisers-what-title">What to look out for</h2>
        <p>A new group can open a campaign and register people straight away. The people it registers are told it is an
          unverified organiser. Pause a group if something is wrong.</p></div></div>
      <ul className="admin-notes">
        <li>If people report a group, call the organiser on the phone number they gave. Ask what events they run, where, and who helps them.</li>
        <li>A group whose name pretends to be a hospital, a ministry or another official body: pause it and write down why.</li>
        <li>A group collecting phone numbers for marketing, politics or anything but outreach: pause it and write down why.</li>
        <li>A group whose campaign has lost its only admin: close the campaign, or make another member its admin.</li>
      </ul>
    </section>
    <FilterTabs label="Outreach groups" value={view as string} onChange={value => { setNotice(null); setFilters({ view: value === 'active' ? '' : value }) }}
      options={[{ value: 'active', label: 'Running' }, { value: 'suspended', label: 'Paused' }, { value: 'all', label: 'All' }]} />
    <div role="status">{notice && <p className="admin-success">{notice}</p>}</div>
    <ResourceView resource={resource}>{({ organisers }) => organisers.length === 0
      ? <p className="admin-state">{view === 'active' ? 'No outreach group is running.' : view === 'suspended'
        ? 'No outreach group is paused.' : 'No outreach group has signed up yet.'}</p>
      : <Table headings={['Group', 'Organiser', 'Signed up', 'So far', 'Status', 'Actions']}>
        {organisers.map(organiser => <OrganiserRow key={`${organiser.organizationId}-${organiser.status}`} organiser={organiser}
          canManage={canManage} onDone={done} />)}
      </Table>}</ResourceView>
    {canManage ? <CampaignRescue onDone={text => setNotice(text)} /> : null}
    {canManage && resource.data ? <RegistrationDeletion organisers={resource.data.organisers} onDone={text => setNotice(text)} /> : null}
  </Page>
}

function OrganiserRow({ organiser, canManage, onDone }: {
  organiser: OutreachOrganiser; canManage: boolean; onDone: (text: string) => void
}) {
  const name = organiser.displayName?.trim() || organiser.groupName
  const paused = organiser.status === 'suspended'
  return <tr>
    <td><strong>{name}</strong>
      {organiser.displayName && organiser.displayName !== organiser.groupName ? <small>Signed up as {organiser.groupName}</small> : null}
      <small>{KIND_WORDS[organiser.kind] ?? 'Kind not given'}</small>
      <small>{organiser.registrationNumber ? `CAC or IT number ${organiser.registrationNumber} (not checked)` : 'No CAC or IT number given'}</small></td>
    <td>{organiser.organiserName ?? 'Name not given'}<small>{organiser.organiserEmail ?? 'No email'}</small>
      <small>{organiser.phone ?? 'Phone not available'}</small></td>
    <td>{date(organiser.createdAt)}<small>Terms {organiser.termsVersion ?? 'not recorded'}</small></td>
    <td>{count(organiser.campaigns, 'campaign')}<small>{organiser.activeCampaigns} open now</small>
      <small>{count(organiser.members, 'team member')}</small><small>{count(organiser.pendingInvitations, 'invitation')} waiting</small></td>
    <td>{STATUS_WORDS[organiser.status] ?? organiser.label ?? 'Status not known'}
      {organiser.suspendedAt ? <small>Paused {date(organiser.suspendedAt)}</small> : null}
      {paused && organiser.suspensionReason ? <small>{organiser.suspensionReason}</small> : null}</td>
    <td>
      {!paused && canManage ? <SuspendAction organiser={organiser} name={name} onDone={onDone} /> : null}
      {!canManage ? 'Pausing a group needs platform.facility.manage and platform.facility.unlock.' : null}
    </td>
  </tr>
}

/** Pauses the group, with a reason kept in the audit log: its roles are taken away until support restores them. */
function SuspendAction({ organiser, name, onDone }: { organiser: OutreachOrganiser; name: string; onDone: (text: string) => void }) {
  const governed = useGovernedSubmit()
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const id = `outreach-suspend-${organiser.organizationId}`
  const length = reason.trim().length
  const ready = length >= 8 && length <= 500 && confirmed

  async function suspend(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    const paused = await governed.submit(() => adminApi.suspendOutreachOrganiser(organiser, reason.trim()),
      'The group could not be paused. Try again.', PROBLEMS, `pause ${name}`)
    if (paused) onDone(`${name} is paused. Nobody in it can register people or change campaigns.`)
  }

  return <details className="admin-action">
    <summary>Pause group</summary>
    <form className="admin-action-form" onSubmit={event => void suspend(event)}>
      <label htmlFor={`${id}-reason`}>Why</label>
      <textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} aria-describedby={`${id}-hint`} onChange={event => setReason(event.target.value)} />
      <small id={`${id}-hint`} className="admin-note">8 to 500 characters, kept in the audit log. Everyone in the group loses access to it at once.</small>
      <label className="admin-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Pause {name}</label>
      <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>{governed.busy ? 'Saving…' : 'Pause group'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}

/**
 * A campaign whose only admin has gone (field critique 5): close it, or make another active member of the group its
 * admin. Both need the campaign's reference, and closing needs its version too: the organiser or a member reads both from
 * the campaign's page ("For Health ID support"). Identity refuses a close whose version is not the campaign's current one.
 */
function CampaignRescue({ onDone }: { onDone: (text: string) => void }) {
  const governed = useGovernedSubmit()
  const [campaignId, setCampaignId] = useState('')
  const [membershipId, setMembershipId] = useState('')
  const [version, setVersion] = useState('')
  const [reason, setReason] = useState('')
  const campaign = campaignId.trim()
  const campaignVersion = /^[0-9]{1,9}$/.test(version.trim()) ? Number(version.trim()) : 0
  const member = membershipId.trim()
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 500

  async function close() {
    if (!UUID.test(campaign) || campaignVersion < 1 || !reasonOk) {
      governed.setError('Enter the campaign’s full reference, its version and a reason of 8 to 500 characters.')
      return
    }
    const closed = await governed.submit(() => adminApi.closeOutreachCampaign({ campaignId: campaign, version: campaignVersion }, reason.trim()),
      'The campaign could not be closed. Try again.', PROBLEMS, 'close an outreach campaign')
    if (closed) { onDone('The campaign is closed. Nobody can register people in it any more.'); setReason('') }
  }

  async function appoint() {
    if (!UUID.test(campaign) || !UUID.test(member) || !reasonOk) {
      governed.setError('Enter the campaign’s full reference, the member’s full reference and a reason of 8 to 500 characters.')
      return
    }
    const appointed = await governed.submit(() => adminApi.appointOutreachCampaignAdmin(campaign, member, reason.trim()),
      'The admin could not be added. Try again.', PROBLEMS, 'make a member a campaign admin')
    if (appointed) { onDone('That member is now one of the campaign’s admins.'); setReason('') }
  }

  return <section className="admin-panel" aria-labelledby="outreach-rescue-title">
    <div className="admin-panel-head"><div><h2 id="outreach-rescue-title">A campaign has lost its admin</h2>
      <p>Close the campaign, or make another active member of the group its admin. Each change is kept in the audit log.</p></div></div>
    <form className="admin-action-form" onSubmit={event => event.preventDefault()}>
      <label htmlFor="outreach-rescue-campaign">Campaign reference</label>
      <input id="outreach-rescue-campaign" autoComplete="off" spellCheck={false} value={campaignId} onChange={event => setCampaignId(event.target.value)} />
      <label htmlFor="outreach-rescue-version">Campaign version (to close it)</label>
      <input id="outreach-rescue-version" inputMode="numeric" autoComplete="off" maxLength={9} value={version}
        aria-describedby="outreach-rescue-version-hint" onChange={event => setVersion(event.target.value.replace(/\D/g, ''))} />
      <small id="outreach-rescue-version-hint" className="admin-note">The number shown with the reference on the campaign’s page, under “For Health ID support”.</small>
      <label htmlFor="outreach-rescue-member">Member reference (to make them admin)</label>
      <input id="outreach-rescue-member" autoComplete="off" spellCheck={false} value={membershipId} onChange={event => setMembershipId(event.target.value)} />
      <label htmlFor="outreach-rescue-reason">Why</label>
      <textarea id="outreach-rescue-reason" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
      <div className="admin-stack">
        <button type="button" className="admin-primary" disabled={governed.busy} onClick={() => void appoint()}>Make admin</button>
        <button type="button" className="admin-primary" disabled={governed.busy} onClick={() => void close()}>Close campaign</button>
      </div>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </section>
}

/**
 * A person asks Health ID support to delete their details sooner than the yearly sweep (the registration notice and the
 * organiser terms say they can). Support finds the registration from the group and the temporary ID or phone number the
 * person gives, sees only where and when it was made, and deletes the person's details with a reason kept in the audit log.
 */
function RegistrationDeletion({ organisers, onDone }: { organisers: OutreachOrganiser[]; onDone: (text: string) => void }) {
  const search = useGovernedSubmit()
  const [organizationId, setOrganizationId] = useState('')
  const [lookFor, setLookFor] = useState('')
  const [found, setFound] = useState<OutreachRegistrationFound[] | null>(null)
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set())

  async function find(event: FormEvent) {
    event.preventDefault()
    const value = lookFor.trim()
    if (!organizationId || value.length < 3) {
      search.setError('Choose the group, then enter the temporary ID (it starts tmp_) or the phone number the person gives.')
      return
    }
    setFound(null)
    const lookup = /^tmp_/i.test(value) ? { organizationId, temporaryPatientId: value } : { organizationId, phone: value }
    const answer = await search.submit(() => adminApi.searchOutreachRegistrations(lookup),
      'The search did not work. Try again.', PROBLEMS, 'find an outreach registration')
    if (answer) setFound(answer.registrations)
  }

  return <section className="admin-panel" aria-labelledby="outreach-delete-title">
    <div className="admin-panel-head"><div><h2 id="outreach-delete-title">Someone asks for their details to be deleted</h2>
      <p>People registered at an outreach group can ask Health ID to delete their details sooner than the yearly clear-out.
        Find the registration, then delete it. You see only where and when it was made.</p></div></div>
    <form className="admin-action-form" onSubmit={event => void find(event)}>
      <label htmlFor="outreach-delete-group">Outreach group</label>
      <select id="outreach-delete-group" value={organizationId} aria-describedby="outreach-delete-group-hint"
        onChange={event => { setOrganizationId(event.target.value); setFound(null) }}>
        <option value="">Choose the group</option>
        {organisers.map(organiser => <option key={organiser.organizationId} value={organiser.organizationId}>
          {organiser.displayName?.trim() || organiser.groupName}</option>)}
      </select>
      <small id="outreach-delete-group-hint" className="admin-note">The groups listed above. Choose “All” to include paused groups.</small>
      <label htmlFor="outreach-delete-lookup">Temporary ID or phone number</label>
      <input id="outreach-delete-lookup" autoComplete="off" spellCheck={false} maxLength={64} value={lookFor}
        aria-describedby="outreach-delete-lookup-hint" onChange={event => { setLookFor(event.target.value); setFound(null) }} />
      <small id="outreach-delete-lookup-hint" className="admin-note">The temporary ID starts tmp_ and is on the slip the group
        gave them. Or the phone number the group took down.</small>
      <button type="submit" className="admin-primary" disabled={search.busy}>{search.busy ? 'Searching…' : 'Find registration'}</button>
      {search.error && <p role="alert" className="admin-error">{search.error}</p>}
    </form>
    {found === null ? null : found.length === 0
      ? <p className="admin-state" role="status">No registration at this group matches. Check the temporary ID or phone number with the person.</p>
      : <Table headings={['Registration', 'Campaign', 'Registered', 'Actions']}>
        {found.map(registration => <tr key={registration.caseId}>
          <td><strong>{registration.temporaryPatientId}</strong><small>{registration.groupName}</small></td>
          <td>{registration.campaignName ?? 'No campaign'}</td>
          <td>{date(registration.createdAt)}</td>
          <td>{registration.redacted || deleted.has(registration.caseId) ? 'Details deleted'
            : <DeleteAction registration={registration} onDone={() => {
              setDeleted(previous => new Set(previous).add(registration.caseId))
              onDone(`The details registered as ${registration.temporaryPatientId} are deleted.`)
            }} />}</td>
        </tr>)}
      </Table>}
  </section>
}

/** Deletes one person's details now, with a reason kept in the audit log. It can't be undone. */
function DeleteAction({ registration, onDone }: { registration: OutreachRegistrationFound; onDone: () => void }) {
  const governed = useGovernedSubmit()
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const id = `outreach-delete-${registration.caseId}`
  const length = reason.trim().length
  const ready = length >= 8 && length <= 500 && confirmed

  async function remove(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    const done = await governed.submit(() => adminApi.redactOutreachRegistration(registration.caseId, reason.trim()),
      'The details could not be deleted. Try again.', PROBLEMS, `delete the details registered as ${registration.temporaryPatientId}`)
    if (done) onDone()
  }

  return <details className="admin-action">
    <summary>Delete this person’s details</summary>
    <form className="admin-action-form" onSubmit={event => void remove(event)}>
      <label htmlFor={`${id}-reason`}>Why</label>
      <textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} aria-describedby={`${id}-hint`} onChange={event => setReason(event.target.value)} />
      <small id={`${id}-hint`} className="admin-note">8 to 500 characters, kept in the audit log. For example: “The person asked by phone on 11 November.” Don’t write their name or phone number.</small>
      <label className="admin-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Delete
        these details for good. This can’t be undone.</label>
      <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>{governed.busy ? 'Deleting…' : 'Delete details'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}
