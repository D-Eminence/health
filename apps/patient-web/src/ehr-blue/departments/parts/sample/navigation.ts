import { useCallback, useLayoutEffect, useState, type MouseEvent, type RefObject } from 'react'
import { useHref, useNavigate } from 'react-router-dom'

/**
 * The sample workspaces' sibling pages (Stock and Procurement, Claims and Policies, the other workspaces about a
 * patient), resolved against the current route: useHref('..', { relative: 'path' }) is the frame's base, and each
 * sibling is a page under it. Only the page is put in the address: never a record or a patient.
 */
export function useSiblingPages() {
  const base = useHref('..', { relative: 'path' })
  const navigate = useNavigate()
  const href = useCallback((page: string) => `${base.endsWith('/') ? base : `${base}/`}${page}`, [base])
  const follow = useCallback((page: string, event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window, as the browser does it.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(`../${page}`, { relative: 'path' })
  }, [navigate])
  return { href, follow }
}

/** Where focus goes after a change of view: an element by id, else the view's heading. */
export interface SampleFocusRequest {
  readonly id?: string
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
    const asked = request.id ? document.getElementById(request.id) : null
    const heading = root.current?.querySelector<HTMLElement>('h1') ?? null
    if (!asked && heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    const target = asked ?? heading
    target?.focus()
  }, [request, root])
  return useCallback((id?: string) => setRequest({ id }), [])
}
