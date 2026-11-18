import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { UNSAFE_LocationContext, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom'
import { Drawer } from '../../kasuwa/interactive'

/**
 * Short forms and single records open in a side drawer over the page they were opened from (owner, 18 Nov 2026: "instead
 * of opening another page, it's supposed to be the side drawer"), so the list or the consultation stays where it was.
 *
 * Each keeps its own address: opened by its link or after a refresh it is a full page as before, and Back closes the
 * drawer. Only these addresses open in a drawer; long step-by-step work (registration, lab work, dispensing, scanning
 * records) stays a page of its own.
 */
const DRAWER_PATHS: readonly RegExp[] = [
  /^\/provider\/clinical\/new$/,
  /^\/provider\/clinical\/[^/]+\/orders\/new\/(pharmacy|laboratory)$/,
  /^\/provider\/clinical\/[^/]+\/orders\/(pharmacy|laboratory)\/[^/]+$/,
  /^\/provider\/triage\/new$/,
  /^\/provider\/triage\/[^/]+~[^/]+$/,
  /^\/provider\/nursing\/new$/,
  /^\/provider\/nursing\/[^/]+~[^/]+$/,
  /^\/provider\/requests\/(new|pin)$/,
  /^\/provider\/patients\/pin$/,
  /^\/provider\/pharmacy\/prescriptions\/paper$/,
  /^\/provider\/pharmacy\/stock\/receive$/,
]

/** Whether an address opens in a drawer when it is reached from another page. */
export function opensInDrawer(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '')
  return DRAWER_PATHS.some(pattern => pattern.test(path))
}

export interface RouteDrawerState {
  /** The page the drawer sits over: what the frame shows. */
  readonly background: Location
  /** The address in the drawer. */
  readonly drawn: Location
  /** Closes the drawer, back to the page under it. */
  readonly close: () => void
}

/**
 * The page under a drawer for this address, worked out from where it was opened: a drawer address reached from a page
 * sits over that page; one reached from another drawer (a form, then the record it saved) sits over the same page.
 * A refresh, a typed address or a link from outside the app opens it as a page. Remembered per history entry, so Back and
 * Forward find it again. `closed` counts the drawers closed, so the page under one is read again (it may have changed).
 */
export function useRouteDrawer(): { readonly drawer: RouteDrawerState | null; readonly closed: number; readonly location: Location } {
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const backgrounds = useRef(new Map<string, { background: Location; direct: boolean }>())
  const previous = useRef<Location | null>(null)
  const [closed, setClosed] = useState(0)

  let entry = backgrounds.current.get(location.key)
  if (!entry && opensInDrawer(location.pathname) && navigationType !== 'POP' && previous.current && previous.current.key !== location.key) {
    const before = previous.current
    const under = opensInDrawer(before.pathname) ? backgrounds.current.get(before.key)?.background : before
    if (under) {
      entry = { background: under, direct: under.key === before.key && navigationType === 'PUSH' }
      backgrounds.current.set(location.key, entry)
    }
  }
  const open = entry !== undefined
  const wasOpen = useRef(open)
  useEffect(() => { previous.current = location })
  useEffect(() => {
    if (wasOpen.current && !open) setClosed(count => count + 1)
    wasOpen.current = open
  }, [open])

  if (!entry) return { drawer: null, closed, location }
  const { background, direct } = entry
  return {
    closed,
    location,
    drawer: {
      background,
      drawn: location,
      close: () => {
        if (direct && window.history.length > 1) navigate(-1)
        else navigate({ pathname: background.pathname, search: background.search, hash: background.hash }, { state: background.state })
      },
    },
  }
}

/** Shows `location` to everything inside: the page under a drawer, or the drawer's own address inside it. */
export function AtLocation({ location, children }: { location: Location; children: ReactNode }) {
  const navigationType = useNavigationType()
  return <UNSAFE_LocationContext.Provider value={{ location, navigationType }}>{children}</UNSAFE_LocationContext.Provider>
}

/**
 * The drawer itself. Its title is the page's own heading, which the drawer's header shows in place of the page's (and
 * its Back arrow: the drawer closes instead). The page inside keeps its own address, buttons and messages.
 */
export function RouteDrawerPanel({ drawer, fallbackTitle, children }: { drawer: RouteDrawerState; fallbackTitle: string; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(fallbackTitle)
  // The page's heading may come after its data loads: read it whenever the drawer's content changes.
  useLayoutEffect(() => {
    const node = body.current
    if (!node) return
    const read = () => {
      const text = node.querySelector('h1')?.textContent?.trim()
      setTitle(text || fallbackTitle)
    }
    read()
    const watcher = new MutationObserver(read)
    watcher.observe(node, { childList: true, subtree: true, characterData: true })
    return () => watcher.disconnect()
  }, [fallbackTitle, drawer.drawn.key])
  return (
    <Drawer open size="lg" onClose={drawer.close} title={title}>
      <div ref={body} className="hid-route-drawer">{children}</div>
    </Drawer>
  )
}
