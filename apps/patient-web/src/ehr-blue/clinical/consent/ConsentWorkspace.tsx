import { EhrButton, EhrCard, EhrField, EhrPageHeading, EhrSelect } from '@hid/ui/ehr'
import { useMemo, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { ACCESS_OUTCOME_FILTERS, ACCESS_REQUEST_STATUSES, type AccessRequestStatus } from '../../../staff/api'
import { ErrorBox, Loading } from '../parts/Notices'
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
    <Workspace path="consent">
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
  const navigate = useNavigate()
  const [status, setStatus] = useState<AccessRequestStatus | ''>('')
  const [search, setSearch] = useState('')
  const { requests, loading, error, outcomesReported, load } = useAccessRequests(status)

  const filters: readonly AccessRequestStatus[] = outcomesReported || (ACCESS_OUTCOME_FILTERS as readonly string[]).includes(status)
    ? [...ACCESS_REQUEST_STATUSES, ...ACCESS_OUTCOME_FILTERS] : ACCESS_REQUEST_STATUSES
  const rows = useMemo(() => (requests ?? []).map(requestRow), [requests])
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    if (!words) return rows
    return rows.filter(row => [row.name, row.context, row.contextSub, row.status, row.statusNote].join(' ').toLowerCase().includes(words))
  }, [rows, search])

  return (
    <>
      <EhrPageHeading
        title={TITLE}
        secondaryActions={can('identity.patient-access-pin.verify')
          ? <EhrButton variant="secondary" onClick={() => navigate(href('pin'))}>Verify patient PIN</EhrButton> : undefined}
        primaryAction={can('identity.consent.write') ? <EhrButton onClick={() => navigate(href('new'))}>Create record</EhrButton> : undefined}
      />
      <EhrCard>
        <SearchField label={`Search ${TITLE}`} value={search} onChange={setSearch} />
        <div className="hid-ehr-clinical-consent-toolbar">
          <EhrField label="Status">
            <EhrSelect value={status} onChange={event => setStatus(event.target.value as AccessRequestStatus | '')}>
              <option value="">Any status</option>
              {filters.map(value => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
            </EhrSelect>
          </EhrField>
          {/* Focusable while the list is read, when a second press does nothing. */}
          <EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void load() }}>Refresh</EhrButton>
        </div>
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {!facility ? null : loading && !requests ? <Loading label="Loading requests…" /> : requests ? (
          <RecordTable
            caption="Access requests"
            rows={shown}
            hrefFor={row => href(row.id)}
            emptyTitle={requests.length === 0
              ? status ? `No access requests: ${FILTER_LABELS[status].toLowerCase()}` : 'No access requests'
              : 'No matching records'}
            emptyMessage={requests.length === 0 ? 'Requests you send for this facility will appear here.' : 'Change your search.'}
          />
        ) : null}
        {requests && requests.length === 100 ? <p className="hid-ehr-clinical-note">Showing the 100 most recent requests.</p> : null}
      </EhrCard>
    </>
  )
}
