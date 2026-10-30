import { matchPath } from 'react-router-dom'
import type { BluePageMatch } from './frame/pageContext'
import { basePath, pageHrefOf } from './frame/pageHref'
import type { EhrBluePage } from './frame/types'

/**
 * The blue EHR's pages: every `pages` export of a `./<folder>/pages.ts`, found at build time. The frame's own list
 * (frame/pages.ts) holds the design's whole registry, each workspace live, partial or a sample stand-in; a page another
 * folder exports with the same path replaces the stand-in in its place, and a new path joins the end of its group.
 */
type PagesModule = { readonly pages?: readonly EhrBluePage[] }

const FRAME_MODULE = './frame/pages.ts'

export { basePath, pageHrefOf }

export function collectPages(modules: Readonly<Record<string, PagesModule>>): EhrBluePage[] {
  const frame = modules[FRAME_MODULE]?.pages ?? []
  const others = Object.keys(modules).filter(key => key !== FRAME_MODULE).sort()
    .flatMap(key => modules[key]?.pages ?? [])
  const replacing = new Map(others.map(page => [basePath(page.path), page]))
  const pages = frame.map(page => replacing.get(basePath(page.path)) ?? page)
  const placed = new Set(pages.map(page => basePath(page.path)))
  for (const page of others) {
    const base = basePath(page.path)
    if (placed.has(base)) continue
    placed.add(base)
    // After the last page of its group, or at the end for a new group.
    const last = pages.map(existing => existing.group).lastIndexOf(page.group)
    pages.splice(last < 0 ? pages.length : last + 1, 0, page)
  }
  return pages
}

const found = import.meta.glob<PagesModule>('./*/pages.ts', { eager: true })

/** Every page of the blue EHR, in sidebar order. */
export const BLUE_PAGES: readonly EhrBluePage[] = collectPages(found)

/** Live and partial pages need their permission; a sample page never does. */
export function pageAllowed(page: EhrBluePage, permissions: readonly string[]): boolean {
  return page.status === 'sample' || !page.permission || permissions.includes(page.permission)
}

/** The page an address under /provider opens: an exact path first, then the deepest '/*' page that takes it. */
export function matchBluePage(pages: readonly EhrBluePage[], pathname: string): BluePageMatch | null {
  for (const page of pages) {
    if (page.path.endsWith('/*')) continue
    if (matchPath({ path: pageHrefOf(page), end: true }, pathname)) return { page, rest: '' }
  }
  const splats = pages.filter(page => page.path.endsWith('/*')).sort((a, b) => b.path.length - a.path.length)
  for (const page of splats) {
    const match = matchPath({ path: `${pageHrefOf(page)}/*`, end: true }, pathname)
    if (match) return { page, rest: match.params['*'] ?? '' }
  }
  return null
}

/**
 * Today's provider routes no page lists, opened from links elsewhere (the migration notice, a staff invitation): the
 * frame shows today's page for them.
 */
export const LIVE_ONLY_PATHS: readonly string[] = ['/provider/migrate', '/provider/staff/join']

export function isLiveOnlyPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '').toLowerCase()
  return LIVE_ONLY_PATHS.includes(path)
}
