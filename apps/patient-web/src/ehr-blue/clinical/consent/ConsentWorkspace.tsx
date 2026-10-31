import { ChevronRight, Inbox, KeyRound, RotateCcw, Search, SearchX, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { PageState } from '../../../kasuwa/parts'
import { Button, Card, Field, Input, ListRow, PageHeader, Select } from '../../../kasuwa/ui'
import { ACCESS_OUTCOME_FILTERS, ACCESS_REQUEST_STATUSES, type AccessRequestStatus } from '../../../staff/api'
import { outcome } from '../../../staff/routes/AccessRequests'
import { formatWhen } from '../parts/format'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { PinAccess } from './PinAccess'
import { RequestAccess } from './RequestAccess'
import { OutcomeBadge, RequestDetail } from './RequestDetail'
import { FILTER_LABELS, SCOPE_LABELS, latest, patientContext, statusNote, useAccessRequests } from './requests'

/** Every part is on today's Health ID API: access requests, their outcomes, closing a grant and the patient PIN. */
export const consentStatus: EhrBluePageStatus = 'live'

export const TITLE = 'Access requests'

/**
 * Access requests: the requests this clinician sent at this facility, asking a patient ("Ask a patient"), the patient's
 * Access PIN, and one request's page. Reached from Patients.
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
  const { facility, can } = useClinical()
  const href = useWorkspaceHref()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AccessRequestStatus | ''>('')
  const { requests, loading, error, outcomesReported, load } = useAccessRequests(status)

  const filters: readonly AccessRequestStatus[] = outcomesReported || (ACCESS_OUTCOME_FILTERS as readonly string[]).includes(status)
    ? [...ACCESS_REQUEST_STATUSES, ...ACCESS_OUTCOME_FILTERS] : ACCESS_REQUEST_STATUSES
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    const all = requests ?? []
    if (!words) return all
    // A request is also found by its own status in today's filter words, so "approved" finds every approved request,
    // whatever came of it (today's "Approved (any outcome)").
    return all.filter(request => [request.reason, patientContext(request), SCOPE_LABELS[request.scope], outcome(request).label, statusNote(request),
      FILTER_LABELS[request.status as AccessRequestStatus]].join(' ').toLowerCase().includes(words))
  }, [requests, search])
  const empty = !requests || shown.length > 0 ? null
    : requests.length === 0
      ? { icon: Inbox, title: status ? `No requests: ${FILTER_LABELS[status].toLowerCase()}` : 'No access requests yet', description: 'Requests you send from this facility show here.' }
      : { icon: SearchX, title: 'No matching requests', description: 'Try a different word.' }

  return (
    <div className="flex flex-col gap-6">
      {/* One primary: ask a patient. The PIN is the quieter second way in. */}
      <PageHeader title={TITLE} description="The requests you sent to patients from this facility."
        actions={can('identity.consent.write') || can('identity.patient-access-pin.verify') ? <>
          {can('identity.patient-access-pin.verify') ? <Button to={href('pin')} icon={KeyRound}>Use an Access PIN</Button> : null}
          {can('identity.consent.write') ? <Button to={href('new')} variant="primary" icon={Send}>Ask a patient</Button> : null}
        </> : undefined} />
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-end">
        <Field label="Search" htmlFor="consent-search" className="min-w-0 flex-1">
          <Input id="consent-search" type="search" icon={Search} autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} />
        </Field>
        <Field label="Status" htmlFor="consent-status" className="@xl:w-60">
          <Select id="consent-status" value={status} onChange={event => setStatus(event.target.value as AccessRequestStatus | '')}>
            <option value="">Any status</option>
            {filters.map(value => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
          </Select>
        </Field>
        {/* Focusable while the list is read, when a second press does nothing. */}
        <Button icon={RotateCcw} aria-busy={loading || undefined} onClick={() => { if (!loading) void load() }}>Refresh</Button>
      </div>
      {!facility ? null : <PageState loading={loading} error={error} hasData={requests !== null} onRetry={() => void load()} what="access requests" empty={empty}>
        <Card>
          <ul className="m-0 list-none divide-y divide-line p-0" aria-label="Access requests">
            {shown.map(request => <li key={request.accessRequestId}>
              {/* A request found through a filter is read with it on its page too: the address names the filter, not the patient. */}
              <ListRow to={status ? `${href(request.accessRequestId)}?status=${status}` : href(request.accessRequestId)} title={request.reason}
                subtitle={[patientContext(request), SCOPE_LABELS[request.scope] ?? request.scope, `updated ${formatWhen(latest(request))}`].join(' · ')}
                trailing={<><OutcomeBadge request={request} /><ChevronRight className="size-4 text-ink-3" aria-hidden /></>} />
            </li>)}
          </ul>
          {requests && requests.length === 100 ? <p className="m-0 border-t border-line px-5 py-3 text-[13px] text-ink-3">Showing the 100 most recent.</p> : null}
        </Card>
      </PageState>}
    </div>
  )
}
