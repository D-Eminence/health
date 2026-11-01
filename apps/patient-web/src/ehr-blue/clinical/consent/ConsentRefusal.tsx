import { HidApiError } from '@hid/http'
import { Navigate, Route, Routes } from 'react-router-dom'
import { FormPage } from '../../../kasuwa/parts'
import { Alert, PageHeader } from '../../../kasuwa/ui'
import { accessRequestsError } from '../../../staff/routes/AccessRequests'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import { METHOD_ROUTES, actionUnavailable, administratorOf } from './access'
import { TITLE } from './ConsentWorkspace'
import { REQUEST_TITLE } from './RequestAccess'

/**
 * Access requests opened without identity.consent.write, from a link or a typed address (the sidebar does not offer
 * it). Today's portal has no gate there: its list read is refused, and it says why (AccessRequests.tsx:33-43,118); its
 * Request method names the permission the role lacks (Patients.tsx:122,244). This stands in for the page, so nothing is
 * read, and it says the same. The patient PIN needs no identity.consent.write: its address here opens it at Patients.
 */
export function ConsentRefusal() {
  return (
    <Workspace path="consent" title={TITLE}>
      <Routes>
        <Route path="new" element={<RequestRefused />} />
        <Route path="pin" element={<PinAtPatients />} />
        <Route path="*" element={<ListRefused />} />
      </Routes>
    </Workspace>
  )
}

/** Today's words for a list read refused for the role (AccessRequests.tsx:35-36, PERMISSION_DENIED). */
function listRefused(): string {
  return accessRequestsError(new HidApiError(403, 'Forbidden', { code: 'PERMISSION_DENIED' }))
}

function ListRefused() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} />
      <Alert intent="error">{listRefused()}</Alert>
    </div>
  )
}

function RequestRefused() {
  const { facility, permissions } = useClinical()
  const unavailable = actionUnavailable(METHOD_ROUTES.request, permissions, administratorOf(facility, permissions))
  return (
    <FormPage title={REQUEST_TITLE}>
      <Alert intent="warning" live={false}>{unavailable ?? listRefused()}</Alert>
    </FormPage>
  )
}

function PinAtPatients() {
  const href = useWorkspaceHref()
  return <Navigate replace to={href.to('patients', 'pin')} />
}
