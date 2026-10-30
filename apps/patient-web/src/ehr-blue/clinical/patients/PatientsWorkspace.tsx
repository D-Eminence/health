import type { EhrBluePageStatus } from '../types'
import { Workspace } from '../parts/Workspace'

export const patientsStatus: EhrBluePageStatus = 'live'

/** Placeholder until this workspace is built. */
export function PatientsWorkspace() {
  return <Workspace path="patients"><p>Patients</p></Workspace>
}
