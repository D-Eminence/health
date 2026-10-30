import { Route, Routes } from 'react-router-dom'
import { RecordNotFound } from '../parts/Notices'
import { Workspace, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { RegistrationCasePage } from './RegistrationCase'
import { RegistrationHome } from './RegistrationHome'
import { TITLE } from './registration'

/** Every part is on today's Health ID API: registration capabilities, NIN verification and the registration case steps. */
export const registrationStatus: EhrBluePageStatus = 'live'

/**
 * Patient registration (today's staff/routes/Registration.tsx at today's address, /provider/registration): the NIN
 * form and "Resume a registration case" at `registration`, and one case at `registration/:caseId`. Nothing identifying
 * is put in an address, in router state or in the title: the NIN is a password field read once from the form and
 * cleared, and a case is named by its case ID only.
 */
export function RegistrationWorkspace() {
  return (
    <Workspace path="registration" title={TITLE}>
      <Routes>
        <Route index element={<RegistrationHome />} />
        <Route path=":caseId" element={<RegistrationCasePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Workspace>
  )
}

function NotFound() {
  const href = useWorkspaceHref()
  return <RecordNotFound backHref={href()} />
}
