import type { EhrBluePageStatus } from '../types'
import { Workspace } from '../parts/Workspace'

export const consultStatus: EhrBluePageStatus = 'partial'

/** Placeholder until this workspace is built. */
export function ConsultWorkspace() {
  return <Workspace path="consult"><p>Consult</p></Workspace>
}
