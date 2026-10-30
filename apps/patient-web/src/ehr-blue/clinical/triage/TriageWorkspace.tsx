import type { EhrBluePageStatus } from '../types'
import { Workspace } from '../parts/Workspace'

export const triageStatus: EhrBluePageStatus = 'partial'

/** Placeholder until this workspace is built. */
export function TriageWorkspace() {
  return <Workspace path="triage"><p>Triage</p></Workspace>
}
