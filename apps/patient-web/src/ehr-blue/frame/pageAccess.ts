import type { StaffSession } from '../../staff/api'
import { ownProductPage, siteOf } from '../../productSites'
import { basePath, pageHrefOf } from './pageHref'
import type { DemoRole } from './roleView'
import { designRolesOf, samplePageOpen } from './sampleAccess'
import type { EhrBluePage } from './types'

/**
 * Whether a page is open to this session: its own visible() first, then, for a live or partial page, its live
 * permission; a sample page follows the design's role mapping instead (sampleAccess.ts), for the person's roles or the
 * demo role whose Home is being viewed.
 */
export function pageAllowed(page: EhrBluePage, session: StaffSession | null, viewing: DemoRole | null = null): boolean {
  if (!session || (page.visible && !page.visible(session))) return false
  if (page.status === 'sample') return samplePageOpen(page, designRolesOf(session, viewing))
  const permissions = session.actor.facility?.permissions ?? []
  return !page.permission || permissions.includes(page.permission)
}

/**
 * Whether this session may use the product of the staff site it is on, at its active facility: it may open at least
 * one live or partial page that the site serves as its own (productSites.ts ownProductPage) and that asks for
 * something, a permission or its own visible(). A page every session opens (Home, a menu that only sends on) says
 * nothing about the product. The person's own roles decide, never a demo role being viewed. Any host that is not a
 * staff site serves every product, as before.
 */
export function productUsable(pages: readonly EhrBluePage[], session: StaffSession, hostname: string): boolean {
  const here = siteOf(hostname)
  if (!here || here.key === 'web') return true
  return pages.some(page => page.status !== 'sample' && (Boolean(page.permission) || page.visible !== undefined)
    && ownProductPage(pageHrefOf(page), hostname) && pageAllowed(page, session))
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
