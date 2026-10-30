import type { EhrBluePageStatus } from '../types'
import { Workspace } from '../parts/Workspace'

export const registrationStatus: EhrBluePageStatus = 'live'

/** Placeholder until this workspace is built. */
export function RegistrationWorkspace() {
  return <Workspace path="registration" title="Patient registration"><p>Patient registration</p></Workspace>
}
