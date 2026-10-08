import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type AdminActor, type ApplicationStatus, type Facility, type OrganizationApplication } from './api'
import { failure } from './problems'
import {
  Page, Refresh, ResourceView, Status, date, has, label, useGovernedSubmit, useResource, useUrlFilters,
} from './ui'

/** `ListOrganizationApplicationsDto` statuses. */
const APPLICATION_STATUSES: readonly ApplicationStatus[] = ['pending_verification', 'ready_for_review', 'approved', 'rejected']
const OPEN = new Set(['pending_verification', 'ready_for_review'])
/** The backend's approve command needs all three (identity organization-applications controller). */
const APPROVE_PERMISSIONS = ['platform.facility.manage', 'platform.principal.manage', 'platform.role.manage']

/** Plain explanations for the review refusals the backend can return. */
const REVIEW_PROBLEMS: Readonly<Record<string, string>> = {
  APPLICATION_CLOSED: 'This application is already closed. Reload to see its outcome.',
  ORGANIZATION_REVIEW_REQUIRED: 'This application conflicts with existing records and needs separate administrator resolution.',
  ORGANIZATION_LINK_INVALID: 'Choose both the existing organization and facility, or neither.',
  QOREID_DISABLED: 'CAC verification is not enabled in this environment.',
  CAC_IDENTITY_MISMATCH: 'The CAC registry record does not match this application.',
  VERIFICATION_EVIDENCE_UNAVAILABLE: 'The verification evidence could not be read. Try again later.',
  ORGANIZATION_APPLICATION_NOT_FOUND: 'This application no longer exists. Reload the list.',
  INTEGRATION_PAUSED: 'The CAC verification provider is paused. Enable it in Integrations first.',
  VERIFICATION_QUOTA_EXCEEDED: 'The verification quota has been reached. Try again later.',
}

function Evidence({ application }: { application: OrganizationApplication }) {
  const rows: Array<[string, string | null, string | null, string | null | undefined]> = [
    ['Company name', application.verifiedOrganizationName, application.profileCompanyName, application.fieldSources?.companyName],
    ['Entity type', application.verifiedEntityType, application.profileEntityType, application.fieldSources?.entityType],
    ['Registration date', application.verifiedRegistrationDate, application.profileRegistrationDate, application.fieldSources?.registrationDate],
    ['Address', application.verifiedAddress, application.profileAddress, application.fieldSources?.address],
    ['Registry status', application.verifiedRegistryStatus, application.profileRegistryStatus, application.fieldSources?.registryStatus],
  ]
  if (rows.every(([, verified, profile]) => !verified && !profile)) {
    return <p className="admin-note">No registry or profile evidence has been recorded yet.</p>
  }
  return <div className="admin-table-scroll"><table className="admin-table">
    <thead><tr><th scope="col">Field</th><th scope="col">CAC registry</th><th scope="col">Completed profile</th><th scope="col">Source used</th></tr></thead>
    <tbody>{rows.map(([field, verified, profile, source]) => <tr key={field}>
      <td>{field}</td><td>{verified ?? 'Not recorded'}</td><td>{profile ?? 'Not provided'}</td><td>{source ? label(source) : 'Not decided'}</td>
    </tr>)}</tbody>
  </table></div>
}

/** Approving can link the application to an existing organization through one of its facilities. */
function ExistingFacilityPicker({ selected, onSelect }: { selected: Facility | null; onSelect: (facility: Facility | null) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Facility[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function search(event: FormEvent) {
    event.preventDefault()
    if (query.trim().length < 2) return
    setError(null)
    try { setResults((await adminApi.facilities({ query: query.trim(), pageSize: 10 })).items) }
    catch (caught) { setError(failure(caught, 'Facilities could not be searched.')) }
  }

  if (selected) return <p className="admin-note">Linking to <strong>{selected.name}</strong> ({selected.organizationName}).{' '}
    <button type="button" className="admin-link" onClick={() => onSelect(null)}>Create a new organization instead</button></p>
  return <div className="admin-picker">
    <label>Existing facility (optional)<input type="search" value={query} onChange={event => setQuery(event.target.value)}
      placeholder="Facility name or code" onKeyDown={event => { if (event.key === 'Enter') void search(event) }} /></label>
    <button type="button" className="admin-secondary" disabled={query.trim().length < 2} onClick={event => void search(event)}>Find facility</button>
    {error && <p role="alert" className="admin-error">{error}</p>}
    {results && (results.length === 0 ? <p className="admin-note">No facilities match.</p> :
      <ul className="admin-pick-list">{results.map(facility => <li key={facility.id}>
        <button type="button" className="admin-link" onClick={() => onSelect(facility)}>{facility.name}</button>
        <span>{facility.organizationName} · {facility.code}</span></li>)}</ul>)}
  </div>
}

function ApplicationReview({ application, actor, onReviewed }: {
  application: OrganizationApplication; actor: AdminActor; onReviewed: (message: string) => void
}) {
  const [reason, setReason] = useState('')
  const [existing, setExisting] = useState<Facility | null>(null)
  const [pending, setPending] = useState<'verify' | 'approve' | 'reject' | null>(null)
  const governed = useGovernedSubmit()
  const canVerify = has(actor, 'platform.facility.manage')
  const canApprove = APPROVE_PERMISSIONS.every(code => has(actor, code))
  const canReject = has(actor, 'platform.facility.manage')
  if (!canVerify && !canApprove && !canReject) return <p className="admin-note">View only.</p>

  async function run(kind: 'verify' | 'approve' | 'reject') {
    if (governed.busy || (kind !== 'verify' && reason.trim().length < 8)) return
    setPending(kind)
    const result = await governed.submit<string>(async () => {
      if (kind === 'verify') {
        const verified = await adminApi.verifyApplicationCac(application)
        return `CAC verification recorded: ${label(verified.state)}. The application is now ${label(verified.status).toLowerCase()}.`
      }
      if (kind === 'reject') {
        await adminApi.rejectApplication(application, reason.trim())
        return 'Application rejected. The applicant was not given access.'
      }
      const approved = await adminApi.approveApplication(application, reason.trim(),
        existing ? { organizationId: existing.organizationId, facilityId: existing.id } : undefined)
      return approved.organizationReused
        ? 'Application approved and linked to the existing organization. The administrator account was created or linked.'
        : 'Application approved. A new organization, facility and administrator account were created.'
    }, 'The review could not be completed.', REVIEW_PROBLEMS)
    setPending(null)
    if (result) { setReason(''); onReviewed(result) }
  }

  return <div className="admin-action-form">
    <p className="admin-note">Each review step is checked again by the server, needs your authenticator confirmation and is
      recorded in the audit log.</p>
    {canVerify && application.status === 'pending_verification' && <button type="button" className="admin-secondary"
      disabled={governed.busy} onClick={() => void run('verify')}>{pending === 'verify' ? 'Verifying…' : 'Verify CAC with the registry'}</button>}
    {(canApprove || canReject) && <>
      <label>Reason for your decision<textarea minLength={8} maxLength={500} rows={2} value={reason}
        onChange={event => setReason(event.target.value)} /></label>
      {canApprove && <ExistingFacilityPicker selected={existing} onSelect={setExisting} />}
      <div className="admin-action-row">
        {canApprove && <button type="button" className="admin-primary" disabled={governed.busy || reason.trim().length < 8}
          onClick={() => void run('approve')}>{pending === 'approve' ? 'Approving…' : 'Approve application'}</button>}
        {canReject && <button type="button" className="admin-secondary" disabled={governed.busy || reason.trim().length < 8}
          onClick={() => void run('reject')}>{pending === 'reject' ? 'Rejecting…' : 'Reject application'}</button>}
      </div>
    </>}
    {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
  </div>
}

function ApplicationCard({ application, actor, onReviewed }: {
  application: OrganizationApplication; actor: AdminActor; onReviewed: (message: string) => void
}) {
  return <article className="admin-tile">
    <div className="admin-panel-head"><h2>{application.organizationName || 'Name pending'}</h2><Status value={application.status} /></div>
    <dl className="admin-detail-grid">
      <div><dt>Product</dt><dd>{label(application.productCode)}</dd></div>
      <div><dt>Organization type</dt><dd>{application.organizationType ? label(application.organizationType) : 'Not provided'}</dd></div>
      <div><dt>CAC number</dt><dd>{application.cacHint ?? 'Not shown'}</dd></div>
      <div><dt>Administrator</dt><dd>{application.administratorName ?? 'Name pending'}<small>{application.administratorEmail}</small></dd></div>
      <div><dt>Verification</dt><dd>{application.verificationResult ? label(application.verificationResult) : 'Not verified yet'}</dd></div>
      <div><dt>Profile</dt><dd>{application.profileState ? label(application.profileState) : 'Not started'}</dd></div>
      <div><dt>Submitted</dt><dd>{date(application.createdAt)}</dd></div>
      <div><dt>Verified</dt><dd>{date(application.verifiedAt)}</dd></div>
      <div><dt>Reviewed</dt><dd>{date(application.reviewedAt)}</dd></div>
    </dl>
    <details className="admin-evidence"><summary>Registry and profile evidence</summary><Evidence application={application} /></details>
    {OPEN.has(application.status) && <ApplicationReview application={application} actor={actor} onReviewed={onReviewed} />}
  </article>
}

/** Organization applications. The backend has no organization directory, so organizations are reached through these and facilities. */
export function ApplicationsPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilters] = useUrlFilters(['status'] as const)
  const status = APPLICATION_STATUSES.find(value => value === filters.status)
  const load = useCallback((signal?: AbortSignal) => adminApi.applications(status, signal), [status])
  const resource = useResource(load, 'Organization applications could not be loaded.')
  const [notice, setNotice] = useState<string | null>(null)

  return <Page eyebrow="Organizations" title="Applications"
    description="Organizations apply to use Health ID. Verify their CAC registration, then approve or reject them."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <div className="admin-filter" role="group" aria-label="Application status">
      {[{ value: '', title: 'All' }, ...APPLICATION_STATUSES.map(value => ({ value, title: label(value) }))].map(item =>
        <button key={item.title} type="button" aria-pressed={filters.status === item.value}
          className={filters.status === item.value ? 'admin-primary' : 'admin-secondary'}
          onClick={() => { setNotice(null); setFilters({ status: item.value }) }}>{item.title}</button>)}
    </div>
    {notice && <p role="status" className="admin-success">{notice}</p>}
    <p className="admin-note">Approved organizations appear through their <Link to="/admin/facilities">facilities</Link>.
      There is no separate organization directory yet.</p>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{result => <div className="admin-stack">
      {result.items.map(application => <ApplicationCard key={`${application.applicationId}:${application.version}`}
        application={application} actor={actor} onReviewed={message => { setNotice(message); resource.reload() }} />)}
    </div>}</ResourceView>
  </Page>
}
