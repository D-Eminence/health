import type { EhrBluePageStatus } from '../types'
import { Workspace } from '../parts/Workspace'

export const inPersonCheckStatus: EhrBluePageStatus = 'live'

/** Placeholder until this workspace is built. */
export function InPersonCheckWorkspace() {
  return <Workspace path="in-person-check" title="In-person check"><p>In-person check</p></Workspace>
}
