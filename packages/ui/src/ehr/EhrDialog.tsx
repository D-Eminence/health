'use client'

/**
 * The decision dialog: one short question before a consequential action.
 *
 * Cancel comes first and takes focus; the confirm button names the outcome.
 * A confirmWord adds a field, and confirm stays disabled until the word is
 * typed exactly. Escape cancels, Tab stays inside, and focus returns to the
 * opener. Only one decision dialog shows at a time: a second one waits until
 * the first closes.
 */

import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { EhrModal } from './EhrAppShell'
import { EhrButton } from './EhrButton'
import { EhrField, EhrInput } from './EhrField'

// The dialog that holds the one visible place. Read and written only from
// effects and event handlers, never while rendering on a server.
let owner: string | null = null
const listeners = new Set<() => void>()

function setOwner(next: string | null) {
  owner = next
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const currentOwner = () => owner
const serverOwner = () => null

export interface EhrDialogProps {
  readonly open: boolean
  /** One short question. */
  readonly title: string
  readonly description: ReactNode
  /** Names the outcome, such as "Deactivate staff member": never "OK". */
  readonly confirmLabel: string
  readonly cancelLabel?: string
  readonly confirmVariant?: 'primary' | 'danger'
  /** For high-impact actions: confirm stays disabled until this word is typed exactly. */
  readonly confirmWord?: string
  readonly busy?: boolean
  readonly onConfirm: () => void | Promise<unknown>
  readonly onCancel: () => void
  /** Where focus goes on close; the element focused when the dialog opened by default. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

export function EhrDialog({ open, ...props }: EhrDialogProps) {
  const id = useId()
  const current = useSyncExternalStore(subscribe, currentOwner, serverOwner)

  // Take the one place whenever it is free while open...
  useLayoutEffect(() => {
    if (open && owner === null) setOwner(id)
  }, [open, current, id])

  // ...and give it back on close, for the next dialog waiting.
  useLayoutEffect(() => {
    if (!open) return
    return () => {
      if (owner === id) setOwner(null)
    }
  }, [open, id])

  return open && current === id ? <DecisionDialog {...props} /> : null
}

function DecisionDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  confirmWord,
  busy = false,
  onConfirm,
  onCancel,
  returnFocusRef,
}: Omit<EhrDialogProps, 'open'>) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [word, setWord] = useState('')
  const confirmed = confirmWord === undefined || word === confirmWord

  return (
    <EhrModal scrimClassName="hid-ehr-scrim-center" onEscape={onCancel} initialFocusRef={cancelRef} returnFocusRef={returnFocusRef}>
      <section
        className="hid-ehr-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="hid-ehr-overlay-title">{title}</h2>
        <div id={descriptionId} className="hid-ehr-dialog-description">{description}</div>
        {confirmWord !== undefined ? (
          <EhrField label={`Type ${confirmWord} to confirm`} className="hid-ehr-dialog-confirm-word">
            <EhrInput
              value={word}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={event => setWord(event.target.value)}
            />
          </EhrField>
        ) : null}
        <div className="hid-ehr-actions hid-ehr-dialog-actions">
          <EhrButton ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel}</EhrButton>
          <EhrButton variant={confirmVariant} disabled={!confirmed} busy={busy} onClick={onConfirm}>{confirmLabel}</EhrButton>
        </div>
      </section>
    </EhrModal>
  )
}
