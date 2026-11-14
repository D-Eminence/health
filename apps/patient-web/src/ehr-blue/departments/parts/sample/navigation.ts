import { useCallback, useLayoutEffect, useState, type MouseEvent, type RefObject } from 'react'
import { useHref, useLocation, useNavigate } from 'react-router-dom'

/**
 * Where the pages sit (the frame's '/provider'): the address up to this page's own base. The base, not '..', as the
 * page also takes the addresses below it (/provider/insurance/<id>), where '..' would be the page itself.
 */
function mountOf(pathname: string, base: string) {
  const segments = pathname.split('/')
  // The router matches an address in any case: /provider/Insurance opens Insurance & Claims too.
  const at = segments.findIndex(segment => segment.toLowerCase() === base)
  return at > 0 ? segments.slice(0, at).join('/') : ''
}

/**
 * The sample workspaces' sibling pages (the other workspaces about a patient, for "Connected hospital history"),
 * resolved from this page's own base ('insurance'): each sibling is a page beside it. Only the page is put in the
 * address: never a record or a patient.
 */
export function useSiblingPages(base: string) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const mount = mountOf(pathname, base)
  const root = useHref(mount || '/')
  const href = useCallback((page: string) => `${root.endsWith('/') ? root : `${root}/`}${page}`, [root])
  const follow = useCallback((page: string, event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window, as the browser does it.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(`${mount}/${page}`)
  }, [mount, navigate])
  return { href, follow }
}

/** Where focus goes after a change of view: an element by id or a selector within the page, else the view's heading. */
export interface SampleFocusRequest {
  readonly id?: string
  readonly selector?: string
}

/**
 * Moves focus in the commit that shows the new view (a layout effect, never a task later): to the element asked for,
 * or to the view's h1, made focusable for it.
 */
export function useSampleFocus(root: RefObject<HTMLElement | null>) {
  const [request, setRequest] = useState<SampleFocusRequest | null>(null)
  useLayoutEffect(() => {
    if (!request) return
    setRequest(null)
    const asked = request.id ? document.getElementById(request.id)
      : request.selector ? root.current?.querySelector<HTMLElement>(request.selector) ?? null : null
    const heading = root.current?.querySelector<HTMLElement>('h1') ?? null
    if (!asked && heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    const target = asked ?? heading
    target?.focus()
  }, [request, root])
  return useCallback((target?: string | { readonly selector: string }) =>
    setRequest(typeof target === 'object' ? { selector: target.selector } : { id: target }), [])
}
