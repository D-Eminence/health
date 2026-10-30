import type { EhrBluePage } from './types'

/** A page's path without its '/*': the address its sidebar link opens. */
export function basePath(path: string): string {
  return path.replace(/\/\*$/, '').replace(/^\/+|\/+$/g, '')
}

/** The address of a page under /provider. */
export function pageHrefOf(page: Pick<EhrBluePage, 'path'>): string {
  const base = basePath(page.path)
  return base ? `/provider/${base}` : '/provider'
}
