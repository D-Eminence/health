import { HidApiError } from '@hid/http'
import { Navigate, Route, Routes } from 'react-router-dom'
import { FormPage } from '../../../kasuwa/parts'
import { Alert, PageHeader } from '../../../kasuwa/ui'
import { accessRequestsError } from '../../../staff/routes/AccessRequests'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import { administratorOf, whoToAsk } from './access'
import { TITLE } from './ConsentWorkspace'
import { REQUEST_TITLE } from './RequestAccess'

/**
 * Access requests opened without identity.consent.write, from a link or a typed address (the sidebar does not offer
 * it). Today's portal has no gate there: its list read is refused, and it says why (AccessRequests.tsx:33-43,118). This
 * stands in for the page, so nothing is read: the list says today's refusal, and a new request says in plain words that
 * the role can't ask patients for access, never the permission's name. The patient PIN needs no identity.consent.write:
 * its address here opens it at Patients.
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

/** A new request refused for the role: why, without the permission's name, and who to ask. */
const REQUEST_REFUSED = 'Your role at this facility can’t ask patients for access.'

function RequestRefused() {
  const { facility, permissions } = useClinical()
  // A self-signed-up facility's own administrator is never told to ask the facility administrator: today's words say
  // who gives their role clinical access (access.ts whoToAsk).
  const administrator = administratorOf(facility, permissions)
  return (
    <FormPage title={REQUEST_TITLE}>
      <Alert intent="warning" live={false}>
        {`${REQUEST_REFUSED} ${administrator ? whoToAsk(administrator) : 'Ask your facility administrator.'}`}
      </Alert>
    </FormPage>
  )
}

function PinAtPatients() {
  const href = useWorkspaceHref()
  return <Navigate replace to={href.to('patients', 'pin')} />
}
