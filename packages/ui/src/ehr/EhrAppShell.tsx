'use client'

/**
 * The EHR application shell, and the overlay machinery every EHR modal uses.
 *
 * The shell is the `.hid-ehr` root. Its workspace (skip link, sidebar, top bar
 * and main) sits beside an overlay layer, and modal overlays portal into that
 * layer. While one is open, everything beneath it (the workspace and any lower
 * overlay) carries `inert`, and only the topmost overlay is interactive.
 *
 * A browser ignores focus() inside an inert subtree, so the order matters: the
 * overlay stack clears `inert` from the layer that holds the opener,
 * synchronously and through refs, before it moves focus back to the opener.
 * Nothing here waits for React state to remove `inert`.
 */

import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../primitives'

interface OverlayEntry {
  /** The overlay's outermost element: the one that carries `inert` while a higher overlay is open. */
  readonly container: HTMLElement
  /** Where focus goes when this overlay closes. */
  returnTo: HTMLElement | null
}

export interface EhrOverlayStack {
  readonly open: (container: HTMLElement, returnTo: HTMLElement | null) => OverlayEntry
  readonly close: (entry: OverlayEntry) => void
}

function setInert(element: HTMLElement | null, inert: boolean) {
  if (!element) return
  if (inert) element.setAttribute('inert', '')
  else element.removeAttribute('inert')
}

/**
 * The open modal overlays, lowest first. With a workspace, every layer below
 * the top one is inert; without one (an overlay used outside a shell) nothing
 * is, and the stack only keeps track of where focus returns.
 */
function createOverlayStack(workspace: RefObject<HTMLElement | null> | null): EhrOverlayStack {
  const entries: OverlayEntry[] = []

  const syncInert = () => {
    if (!workspace) return
    const top = entries.at(-1)
    setInert(workspace.current, top !== undefined)
    for (const entry of entries) setInert(entry.container, entry !== top)
  }

  const restoreFocus = (entry: OverlayEntry) => {
    const target = entry.returnTo
    if (!target || !target.isConnected || target.closest('[inert]')) return
    // Focus the user has since moved elsewhere stays where it is.
    const active = document.activeElement
    if (active && active !== document.body && !entry.container.contains(active)) return
    target.focus()
  }

  return {
    open(container, returnTo) {
      const entry: OverlayEntry = { container, returnTo }
      entries.push(entry)
      syncInert()
      return entry
    },
    close(entry) {
      const index = entries.indexOf(entry)
      if (index < 0) return
      const wasTop = index === entries.length - 1
      entries.splice(index, 1)
      // An overlay opened from inside this one now returns focus where this one would have.
      for (const above of entries.slice(index)) {
        if (above.returnTo && entry.container.contains(above.returnTo)) above.returnTo = entry.returnTo
      }
      // First clear inert from the layer below, then move focus into it.
      syncInert()
      if (wasTop) restoreFocus(entry)
    },
  }
}

/** Overlays rendered outside a shell share this stack: no inert, focus still returns. */
const standaloneStack = createOverlayStack(null)

interface EhrShellMenu {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  /** The id of the phone menu panel, for the menu button's aria-controls. */
  readonly panelId: string
  readonly buttonRef: RefObject<HTMLButtonElement | null>
}

interface EhrShellContextValue {
  readonly layer: HTMLElement | null
  readonly stack: EhrOverlayStack
  /** Present when the shell has a sidebar to open as the phone menu. */
  readonly menu: EhrShellMenu | null
}

const EhrShellContext = createContext<EhrShellContextValue | null>(null)

/** The shell around a component, or null outside one. */
export function useEhrShell(): EhrShellContextValue | null {
  return useContext(EhrShellContext)
}

export interface EhrAppShellProps {
  /** Usually an EhrSidebar. On phones it opens from the top bar's menu button. */
  readonly sidebar?: ReactNode
  /** Usually an EhrTopBar. */
  readonly topBar?: ReactNode
  readonly children: ReactNode
  readonly skipLinkLabel?: string
  readonly className?: string
}

export function EhrAppShell({
  sidebar,
  topBar,
  children,
  skipLinkLabel = 'Skip to main content',
  className,
}: EhrAppShellProps) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [stack] = useState(() => createOverlayStack(workspaceRef))
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const hasSidebar = sidebar !== undefined && sidebar !== null && sidebar !== false

  const menu = useMemo<EhrShellMenu | null>(
    () => (hasSidebar ? { open: menuOpen, setOpen: setMenuOpen, panelId, buttonRef: menuButtonRef } : null),
    [hasSidebar, menuOpen, panelId],
  )
  const context = useMemo<EhrShellContextValue>(() => ({ layer, stack, menu }), [layer, stack, menu])

  return (
    <EhrShellContext.Provider value={context}>
      <div className={cx('hid-ehr', 'hid-ehr-shell', className)}>
        <div ref={workspaceRef} className="hid-ehr-workspace">
          <a className="hid-ehr-skip-link" href="#main-content">{skipLinkLabel}</a>
          {sidebar}
          <div className="hid-ehr-shell-body">
            {topBar}
            <main id="main-content" tabIndex={-1} className="hid-ehr-main">
              <div className="hid-ehr-main-inner">{children}</div>
            </main>
          </div>
        </div>
        <div ref={setLayer} className="hid-ehr-overlay-layer" />
      </div>
    </EhrShellContext.Provider>
  )
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  '[contenteditable="true"]',
].join(', ')

/** The elements Tab reaches inside `root`, in order. */
function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element =>
    element.tabIndex >= 0 && !element.closest('[hidden], [inert]'))
}

export interface EhrModalProps {
  readonly children: ReactNode
  /** Extra classes for the scrim: hid-ehr-scrim-center, hid-ehr-scrim-start or hid-ehr-scrim-drawer. */
  readonly scrimClassName?: string
  readonly onEscape: () => void
  /** Focused on open; the first element Tab reaches when absent. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>
  /** Focused on close; the element that had focus when the overlay opened when absent. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * One open modal overlay: a scrim over the whole viewport holding the panel
 * (`children`). Inside a shell it portals into the shell's overlay layer;
 * outside one it renders in place, inside its own `.hid-ehr` wrapper, with the
 * same focus trap and no inert. Render it only while the overlay is open.
 */
export function EhrModal({ children, scrimClassName, onEscape, initialFocusRef, returnFocusRef }: EhrModalProps) {
  const shell = useEhrShell()
  const stack = shell ? shell.stack : standaloneStack
  const ready = shell === null || shell.layer !== null
  const scrimRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const scrim = scrimRef.current
    if (!ready || !scrim) return
    const active = document.activeElement
    const opener = returnFocusRef?.current
      ?? (active instanceof HTMLElement && active !== document.body ? active : null)
    const entry = stack.open(scrim, opener)
    const target = initialFocusRef?.current ?? tabbable(scrim)[0] ?? scrim.querySelector<HTMLElement>('[tabindex="-1"]')
    target?.focus()
    return () => stack.close(entry)
  }, [ready, stack, initialFocusRef, returnFocusRef])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const scrim = event.currentTarget
    // Key presses in a higher overlay bubble here through React's tree; they are not ours.
    if (!(event.target instanceof Node) || !scrim.contains(event.target)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
      return
    }
    if (event.key !== 'Tab') return
    event.stopPropagation()
    const items = tabbable(scrim)
    const first = items[0]
    const last = items.at(-1)
    const active = document.activeElement
    if (!first || !last) {
      event.preventDefault()
      return
    }
    const inside = active instanceof Node && scrim.contains(active)
    if (event.shiftKey && (active === first || !inside || !items.includes(active as HTMLElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault()
      first.focus()
    }
  }

  // A press on the scrim itself would otherwise move focus to the page behind it.
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) event.preventDefault()
  }

  const frame = (
    <div ref={scrimRef} className={cx('hid-ehr-scrim', scrimClassName)} onKeyDown={onKeyDown} onMouseDown={onMouseDown}>
      {children}
    </div>
  )
  if (!shell) return <div className="hid-ehr">{frame}</div>
  return shell.layer ? createPortal(frame, shell.layer) : null
}
