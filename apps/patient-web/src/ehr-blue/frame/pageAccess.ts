import type { StaffSession } from '../../staff/api'
import { ownProductPage, siteOf } from '../../productSites'
import { basePath, pageHrefOf } from './pageHref'
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
 * Whether this session can use a page, not only open its address. A page with no permission of its own and pages of its
 * own below it (Pharmacy's own address, pharmacy/*) is only a way in: it sends each visitor on to one of them, so every
 * session may open it. It is of use only when this session may open one of the pages below it, each behind its own
 * permission; otherwise it leads to a refusal. Any other page is of use where it opens (pageAllowed). Only the menu's
 * links to the other Health ID sites ask this (BlueFrame.tsx otherSitesGroup): which pages open, where a site lands,
 * and what each page reads stay pageAllowed's and the page's own.
 */
export function pageUsable(page: EhrBluePage, pages: readonly EhrBluePage[], session: StaffSession | null,
  viewing: DemoRole | null = null): boolean {
  if (!pageAllowed(page, session, viewing)) return false
  const base = basePath(page.path)
  if (page.permission || page.status === 'sample' || base === '') return true
  const below = pages.filter(other => other !== page && basePath(other.path).startsWith(`${base}/`))
  return below.length === 0 || below.some(other => other.permission !== undefined && pageAllowed(other, session, viewing))
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
