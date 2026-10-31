import { EhrButton, EhrCard, EhrField, EhrSelect } from '@hid/ui/ehr'
import { useEffect, useMemo, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ACCESS_OUTCOME_FILTERS, ACCESS_REQUEST_STATUSES, type AccessRequestStatus } from '../../../staff/api'
import { Step } from '../parts/Detail'
import { ErrorBox, ListHeading, Loading } from '../parts/Notices'
import { RecordTable, SearchField } from '../parts/RecordTable'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { PinAccess } from './PinAccess'
import { RequestAccess } from './RequestAccess'
import { RequestDetail } from './RequestDetail'
import { FILTER_LABELS, requestRow, useAccessRequests } from './requests'

/** Every part is on today's Health ID API: access requests, their outcomes, closing a grant and the patient PIN. */
export const consentStatus: EhrBluePageStatus = 'live'

export const TITLE = 'External record access'

/**
 * "External record access": the access requests this clinician sent at this facility (today's Access requests), a
 * new request ("Create record"), the patient PIN, and one request's page. Reached from Patients.
 */
export function ConsentWorkspace() {
  return (
    <Workspace path="consent" title="External record access">
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
  // Every status is read (the design's list has no status filter); the search matches each row's status. The backend
  // sends only the 100 newest requests and has no paging, so once a read holds 100, today's Status select is offered
  // too, the one way to reach an older request; it stays while the page is open.
  const { requests, loading, error, outcomesReported, load } = useAccessRequests(status)
  const capped = requests?.length === 100
  const [filtering, setFiltering] = useState(false)
  useEffect(() => { if (capped) setFiltering(true) }, [capped])

  const filters: readonly AccessRequestStatus[] = outcomesReported || (ACCESS_OUTCOME_FILTERS as readonly string[]).includes(status)
    ? [...ACCESS_REQUEST_STATUSES, ...ACCESS_OUTCOME_FILTERS] : ACCESS_REQUEST_STATUSES
  // A row is also found by its request's own status in today's filter words, so "approved" finds every approved
  // request, whatever came of it (today's "Approved (any outcome)").
  const rows = useMemo(() => (requests ?? []).map(request => {
    const row = requestRow(request)
    return { row, words: [row.name, row.context, row.contextSub, row.status, row.statusNote, FILTER_LABELS[request.status as AccessRequestStatus]].join(' ').toLowerCase() }
  }), [requests])
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    return rows.filter(item => !words || item.words.includes(words)).map(item => item.row)
  }, [rows, search])

  return (
    <>
      {/* The design's one primary action (audit 5). The patient PIN is reached from Patients' refused lookup. */}
      <ListHeading title={TITLE} createHref={can('identity.consent.write') ? href('new') : undefined} />
      <EhrCard>
        <SearchField label={`Search ${TITLE}`} value={search} onChange={setSearch} />
        {filtering || capped ? (
          <div className="hid-ehr-clinical-consent-toolbar">
            <EhrField label="Status">
              <EhrSelect value={status} onChange={event => setStatus(event.target.value as AccessRequestStatus | '')}>
                <option value="">Any status</option>
                {filters.map(value => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
              </EhrSelect>
            </EhrField>
          </div>
        ) : null}
        {error ? (
          <>
            <ErrorBox>{error}</ErrorBox>
            {/* Today's Refresh, kept only where the list could not be read: the one way to read it again here. Focusable
                while the list is read, when a second press does nothing. */}
            <Step><EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void load() }}>Refresh</EhrButton></Step>
          </>
        ) : null}
        {!facility ? null : loading && !requests ? <Loading label="Loading requests…" /> : requests ? (
          <RecordTable
            caption="Access requests"
            rows={shown}
            // A request found through a filter is read with it on its page too: the address names the filter, not the patient.
            hrefFor={row => status ? `${href(row.id)}?status=${status}` : href(row.id)}
            emptyTitle={requests.length === 0
              ? status ? `No access requests: ${FILTER_LABELS[status].toLowerCase()}` : 'No access requests'
              : 'No matching records'}
            emptyMessage={requests.length === 0 ? 'Requests you send for this facility will appear here.' : 'Change your search.'}
          />
        ) : null}
        {capped ? <p className="hid-ehr-clinical-note">Showing the 100 most recent requests.</p> : null}
      </EhrCard>
    </>
  )
}
