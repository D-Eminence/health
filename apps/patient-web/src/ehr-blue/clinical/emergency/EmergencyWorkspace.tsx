import type { EhrBluePageStatus } from '../types'
import { Workspace } from '../parts/Workspace'

export const emergencyStatus: EhrBluePageStatus = 'partial'

/** Placeholder until this workspace is built. */
export function EmergencyWorkspace() {
  return <Workspace path="emergency"><p>Emergency</p></Workspace>
}
