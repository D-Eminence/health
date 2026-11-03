import type { StaffSession } from '../../staff/api'
import { basePath } from './pageHref'
import type { DemoRole } from './roleView'
import { designRolesOf, samplePageOpen, samplesShownAt } from './sampleAccess'
import type { EhrBluePage } from './types'

/**
 * Whether a page shows at this session's facility at all: its own visible(), and a sample only at a demo facility
 * (samplesShownAt). Where it does not, its address gives the frame's demo-only words (DeniedPage), not the page.
 */
export function pageShownHere(page: EhrBluePage, session: StaffSession): boolean {
  return (page.visible?.(session) ?? true) && (page.status !== 'sample' || samplesShownAt(session))
}

/**
 * Whether a page is open to this session: whether it shows here (pageShownHere) first, then, for a live or partial
 * page, its live permission; a sample page follows the design's role mapping instead (sampleAccess.ts), for the
 * person's roles or the demo role whose Home is being viewed.
 */
export function pageAllowed(page: EhrBluePage, session: StaffSession | null, viewing: DemoRole | null = null): boolean {
  if (!session || !pageShownHere(page, session)) return false
  if (page.status === 'sample') return samplePageOpen(page, designRolesOf(session, viewing))
  const permissions = session.actor.facility?.permissions ?? []
  return !page.permission || permissions.includes(page.permission)
}

/**
 * The tabs a page shows above its heading: the page the tabs belong to, then each page that joins it (tabOf), in
 * registry order. None when the page has no tabs.
 */
export function pageTabs(pages: readonly EhrBluePage[], page: EhrBluePage): readonly EhrBluePage[] {
  const home = page.tabOf ?? basePath(page.path)
  const owner = pages.find(candidate => basePath(candidate.path) === home)
  const joined = pages.filter(candidate => candidate.tabOf === home)
  return owner && joined.length > 0 ? [owner, ...joined] : []
}
