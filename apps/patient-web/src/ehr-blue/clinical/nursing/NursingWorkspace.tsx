import type { EhrBluePageStatus } from '../types'
import { Workspace } from '../parts/Workspace'

export const nursingStatus: EhrBluePageStatus = 'partial'

/** Placeholder until this workspace is built. */
export function NursingWorkspace() {
  return <Workspace path="nursing"><p>Nursing</p></Workspace>
}
