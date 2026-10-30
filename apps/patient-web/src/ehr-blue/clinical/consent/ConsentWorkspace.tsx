import type { EhrBluePageStatus } from '../types'
import { Workspace } from '../parts/Workspace'

export const consentStatus: EhrBluePageStatus = 'live'

/** Placeholder until this workspace is built. */
export function ConsentWorkspace() {
  return <Workspace path="consent"><p>Consent</p></Workspace>
}
