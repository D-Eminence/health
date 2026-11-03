import { ChevronRight, Inbox, KeyRound, RotateCcw, Search, SearchX, Send } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { PageState } from '../../../kasuwa/parts'
import { Alert, Button, Card, Field, Input, ListRow, PageHeader, Select } from '../../../kasuwa/ui'
import { ACCESS_OUTCOME_FILTERS, ACCESS_REQUEST_STATUSES, staffApi, type AccessRequest, type AccessRequestStatus } from '../../../staff/api'
import { outcome } from '../../../staff/routes/AccessRequests'
import { accessLevelLabel } from '../../../plainLabels'
import { ACCESS_ENDED } from '../parts/chart'
import { formatWhen } from '../parts/format'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { ShareInvitationsForMe, SharedWithYou } from '../patients/SharingCards'
import { ACCESS_CLOSED, CLOSE_GRANT, CLOSE_REASON, OPEN_SHARED, actionUnavailable, administratorOf } from './access'
import { PinAccess } from './PinAccess'
import { RequestAccess } from './RequestAccess'
import { OutcomeBadge, RequestDetail } from './RequestDetail'
import { FILTER_LABELS, closable, closeError, patientContext, statusNote, useAccessRequests } from './requests'

/** Every part is on today's Health ID API: access requests, their outcomes, closing a grant and the patient PIN. */
export const consentStatus: EhrBluePageStatus = 'live'

export const TITLE = 'Access requests'

/**
 * Access requests: the requests this clinician sent at this facility, asking a patient ("Request"), the patient's
 * Access PIN ("Patient PIN"), and one request's page. Reached from Patients.
 */
export function ConsentWorkspace() {
  return (
    <Workspace path="consent" title={TITLE}>
      <Routes>
        <Route index element={<RequestList />} />
        <Route path="new" element={<RequestAccess />} />
        <Route path="pin" element={<PinAccess />} />
        <Route path=":recordId" element={<RequestDetail />} />
      </Routes>
    </Workspace>
  )
}

function RequestList() {
  const { facility, can, permissions, activePatient, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AccessRequestStatus | ''>('')
  const { requests, loading, error, outcomesReported, load } = useAccessRequests(status)
  const administrator = administratorOf(facility, permissions)
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions, administrator)
  const [closing, setClosing] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState('')
  const [ended, setEnded] = useState(false)
  const [settled, setSettled] = useState(0)
  // A close already on its way is not sent again by a second press.
  const sending = useRef(false)
  const statusRef = useRef<HTMLDivElement>(null)

  // Closing takes its row's Close access away: focus goes to what happened, unless it is somewhere already.
  useLayoutEffect(() => {
    if (!settled) return
    const focused = document.activeElement
    if (!focused || focused === document.body || !focused.isConnected) statusRef.current?.focus()
  }, [settled])

  /** Today's Close access from the list (AccessRequests.tsx:83-98): the same close as the request's page, at once. */
  async function closeAccess(request: AccessRequest) {
    if (!facility || !request.consentGrantId || closeUnavailable || sending.current) return
    const grantId = request.consentGrantId
    sending.current = true
    setClosing(request.accessRequestId)
    setFailure('')
    setNotice('')
    setEnded(false)
    let refused = ''
    let endedOpen = false
    try {
      await staffApi.closeGrant(facility.id, grantId, CLOSE_REASON)
      // The open record, if this grant opened it, has ended too.
      if (activePatient?.lookup.authorization.consentGrantId === grantId) {
        setActivePatient(null)
        endedOpen = true
      }
    } catch (caught) {
      refused = closeError(caught)
    }
    // Read again either way, then say what happened.
    try {
      await load()
    } finally {
      sending.current = false
      setClosing(null)
    }
    if (refused) setFailure(refused)
    else { setNotice(ACCESS_CLOSED); setEnded(endedOpen) }
    setSettled(value => value + 1)
  }

  function changeStatus(value: AccessRequestStatus | '') {
    setNotice('')
    setFailure('')
    setEnded(false)
    setStatus(value)
  }

  const filters: readonly AccessRequestStatus[] = outcomesReported || (ACCESS_OUTCOME_FILTERS as readonly string[]).includes(status)
    ? [...ACCESS_REQUEST_STATUSES, ...ACCESS_OUTCOME_FILTERS] : ACCESS_REQUEST_STATUSES
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    const all = requests ?? []
    if (!words) return all
    // A request is also found by its own status in today's filter words, so "approved" finds every approved request,
    // whatever came of it (today's "Approved (any outcome)").
    return all.filter(request => [request.reason, patientContext(request), accessLevelLabel(request.scope), outcome(request).label, statusNote(request),
      FILTER_LABELS[request.status as AccessRequestStatus]].join(' ').toLowerCase().includes(words))
  }, [requests, search])
  const empty = !requests || shown.length > 0 ? null
    : requests.length === 0
      ? { icon: Inbox, title: status ? `No access requests: ${FILTER_LABELS[status].toLowerCase()}` : 'No access requests', description: 'Requests you send for this facility will appear here.' }
      : { icon: SearchX, title: 'No matching requests', description: 'Try a different word.' }

  return (
    <div className="flex flex-col gap-6">
      {/* One primary: ask a patient. The PIN is the quieter second way in. Today's PIN name and lede (Patients.tsx:238,
          AccessRequests.tsx:108); the request button says "Ask for access", as the Start menu asks (owner, 2 Nov). */}
      <PageHeader title={TITLE} description="Requests are scoped to your active facility and staff account. A pending request never grants record access."
        actions={can('identity.consent.write') || can('identity.patient-access-pin.verify') ? <>
          {can('identity.patient-access-pin.verify') ? <Button to={href('pin')} icon={KeyRound}>Patient PIN</Button> : null}
          {can('identity.consent.write') ? <Button to={href('new')} variant="primary" icon={Send}>Ask for access</Button> : null}
        </> : undefined} />
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-end">
        <Field label="Search" htmlFor="consent-search" className="min-w-0 flex-1">
          <Input id="consent-search" type="search" icon={Search} autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} />
        </Field>
        <Field label="Status" htmlFor="consent-status" className="@xl:w-60">
          <Select id="consent-status" value={status} onChange={event => changeStatus(event.target.value as AccessRequestStatus | '')}>
            <option value="">Any status</option>
            {filters.map(value => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
          </Select>
        </Field>
        {/* Focusable while the list is read, when a second press does nothing. */}
        <Button icon={RotateCcw} aria-busy={loading || undefined} onClick={() => { if (!loading) void load() }}>Refresh</Button>
      </div>
      {ended ? <Alert intent="error" title="Access to this patient ended"
        action={<Button size="sm" to={href.to('patients')}>Find a patient</Button>}>{ACCESS_ENDED}</Alert> : null}
      {/* Mounted throughout, so what a close says is announced. */}
      <div ref={statusRef} tabIndex={-1} role="status" className="outline-none empty:hidden">
        {notice ? <Alert intent="success" live={false}>{notice}</Alert> : null}
      </div>
      {failure ? <Alert intent="error" title="Couldn’t close access">{failure}</Alert> : null}
      {!facility ? null : <PageState loading={loading} error={error} hasData={requests !== null} onRetry={() => void load()} what="requests" empty={empty}>
        <Card>
          <ul className="m-0 list-none divide-y divide-line p-0" aria-label="Access requests">
            {shown.map(request => <li key={request.accessRequestId} className="flex flex-wrap items-center">
              {/* A request found through a filter is read with it on its page too: the address names the filter, not the patient.
                  The row shows when it was requested, as today's list does (AccessRequests.tsx:123). */}
              <ListRow className="min-w-0 flex-[1_1_18rem]" to={status ? `${href(request.accessRequestId)}?status=${status}` : href(request.accessRequestId)} title={request.reason}
                subtitle={[patientContext(request), accessLevelLabel(request.scope), `requested ${formatWhen(request.requestedAt)}`, statusNote(request)].filter(Boolean).join(' · ')}
                trailing={<><OutcomeBadge request={request} /><ChevronRight className="size-4 text-ink-3" aria-hidden /></>} />
              {/* Today's row action (AccessRequests.tsx:127-129), beside the row's link rather than inside it. */}
              {closable(request) && !closeUnavailable ? <div className="px-5 pb-3 @md:py-3 @md:pl-0">
                <Button size="sm" aria-label={`${closing === request.accessRequestId ? 'Closing access' : 'Close access'}: ${request.reason}`} loading={closing === request.accessRequestId}
                  disabled={closing !== null && closing !== request.accessRequestId} onClick={() => void closeAccess(request)}>
                  {closing === request.accessRequestId ? 'Closing…' : 'Close access'}</Button>
              </div> : null}
            </li>)}
          </ul>
          {requests && requests.length === 100 ? <p className="m-0 border-t border-line px-5 py-3 text-[13px] text-ink-3">Showing the 100 most recent requests.</p> : null}
        </Card>
      </PageState>}
      {/* Patient sharing lives on Patients; a role that cannot open Patients (identity.patient.read) has it here, so
          nobody sees it twice. Each card keeps its own permission checks; opening a shared record needs a patient
          lookup, which such a role cannot make, so Open says why and does nothing. */}
      {facility && !can('identity.patient.read') ? <div className="flex flex-col gap-6 empty:hidden">
        <SharedWithYou facilityId={facility.id} permissions={permissions} busy={false}
          openUnavailable={actionUnavailable(OPEN_SHARED, permissions, administrator)} onOpen={() => {}} />
        <ShareInvitationsForMe facilityId={facility.id} permissions={permissions} />
      </div> : null}
    </div>
  )
}
