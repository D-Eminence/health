'use client'

/**
 * The drawer: a right-hand panel for viewing or editing in context, which
 * becomes a bottom sheet on phones (max-width 700px). Its header is sticky and
 * has a Close button. Focus moves in on open, stays inside, and returns to the
 * opener.
 *
 * A clean drawer closes on Escape or Close. A dirty one (`dirty`) asks first:
 * "Keep editing" (focused) or "Discard changes". The form stays mounted the
 * whole time, so nothing typed is lost by asking.
 */

import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon'
import { EhrModal } from './EhrAppShell'
import { EhrButton } from './EhrButton'

export interface EhrDrawerProps {
  readonly open: boolean
  readonly title: string
  readonly onClose: () => void
  /** Unsaved changes: closing asks before discarding them. */
  readonly dirty?: boolean
  readonly children: ReactNode
  /** Where focus goes on close; the element focused when the drawer opened by default. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

export function EhrDrawer({ open, ...props }: EhrDrawerProps) {
  return open ? <DrawerPanel {...props} /> : null
}

function DrawerPanel({ title, onClose, dirty = false, children, returnFocusRef }: Omit<EhrDrawerProps, 'open'>) {
  const titleId = useId()
  const choiceTitleId = useId()
  const [asking, setAsking] = useState(false)
  const choosing = asking && dirty
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Where the user was when they asked to close, so "Keep editing" puts them back.
  const resumeRef = useRef<HTMLElement | null>(null)
  const wasChoosing = useRef(false)

  useLayoutEffect(() => {
    if (choosing) keepEditingRef.current?.focus()
    else if (wasChoosing.current) {
      const resume = resumeRef.current
      if (resume?.isConnected) resume.focus()
      else closeRef.current?.focus()
    }
    wasChoosing.current = choosing
  }, [choosing])

  const requestClose = () => {
    if (!dirty) {
      onClose()
      return
    }
    if (choosing) {
      keepEditingRef.current?.focus()
      return
    }
    const active = document.activeElement
    resumeRef.current = active instanceof HTMLElement ? active : null
    setAsking(true)
  }

  return (
    <EhrModal
      scrimClassName="hid-ehr-scrim-drawer"
      onEscape={choosing ? () => setAsking(false) : requestClose}
      returnFocusRef={returnFocusRef}
    >
      <section className="hid-ehr-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="hid-ehr-drawer-header">
          <h2 id={titleId} className="hid-ehr-overlay-title">{title}</h2>
          <EhrButton
            ref={closeRef}
            variant="secondary"
            size="sm"
            icon={<HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={1.65} aria-hidden />}
            onClick={requestClose}
          >
            Close
          </EhrButton>
        </header>
        {choosing ? (
          <div className="hid-ehr-drawer-discard" role="group" aria-labelledby={choiceTitleId}>
            <h3 id={choiceTitleId} className="hid-ehr-drawer-discard-title">Discard unsaved changes?</h3>
            <p className="hid-ehr-drawer-discard-text">Your latest edits have not been saved.</p>
            <div className="hid-ehr-actions">
              <EhrButton ref={keepEditingRef} variant="primary" onClick={() => setAsking(false)}>Keep editing</EhrButton>
              <EhrButton
                variant="danger"
                onClick={() => {
                  setAsking(false)
                  onClose()
                }}
              >
                Discard changes
              </EhrButton>
            </div>
          </div>
        ) : null}
        {/* Hidden, never unmounted, while the choice is open: the form keeps its values. */}
        <div className="hid-ehr-drawer-body" hidden={choosing}>{children}</div>
      </section>
    </EhrModal>
  )
}
