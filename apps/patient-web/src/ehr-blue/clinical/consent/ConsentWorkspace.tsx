import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useMemo, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Step } from '../parts/Detail'
import { ErrorBox, ListHeading, Loading } from '../parts/Notices'
import { RecordTable, SearchField } from '../parts/RecordTable'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { PinAccess } from './PinAccess'
import { RequestAccess } from './RequestAccess'
import { RequestDetail } from './RequestDetail'
import { requestRow, useAccessRequests } from './requests'

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
  // Every status is read (no status filter, as the design's list has none); the search matches each row's status.
  const { requests, loading, error, load } = useAccessRequests('')

  const rows = useMemo(() => (requests ?? []).map(requestRow), [requests])
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    if (!words) return rows
    return rows.filter(row => [row.name, row.context, row.contextSub, row.status, row.statusNote].join(' ').toLowerCase().includes(words))
  }, [rows, search])

  return (
    <>
      {/* The design's one primary action (audit 5). The patient PIN is reached from Patients' refused lookup. */}
      <ListHeading title={TITLE} createHref={can('identity.consent.write') ? href('new') : undefined} />
      <EhrCard>
        <SearchField label={`Search ${TITLE}`} value={search} onChange={setSearch} />
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
            hrefFor={row => href(row.id)}
            emptyTitle={requests.length === 0 ? 'No access requests' : 'No matching records'}
            emptyMessage={requests.length === 0 ? 'Requests you send for this facility will appear here.' : 'Change your search.'}
          />
        ) : null}
        {requests && requests.length === 100 ? <p className="hid-ehr-clinical-note">Showing the 100 most recent requests.</p> : null}
      </EhrCard>
    </>
  )
}
