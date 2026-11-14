import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmSheet } from '../../../kasuwa/parts'

export interface ConfirmRequest {
  /** The sheet's title: "Confirm the patient". */
  readonly title?: string
  /** Who or what it acts on: the patient banner (compact). */
  readonly subject: ReactNode
  /** What will happen, as a question: "Send this lab request for Adaeze Okafor?" */
  readonly effect: ReactNode
  readonly confirmLabel: string
  readonly undo?: ReactNode
}

/**
 * Ask before a consequential save (confirm the patient: wrong-patient prevention). `ask` resolves true only when
 * Confirm is pressed; Cancel, Escape and the backdrop resolve false, and nothing is sent. Render `sheet` once.
 */
export function useConfirm() {
  const [asking, setAsking] = useState<(ConfirmRequest & { readonly answer: (yes: boolean) => void }) | null>(null)
  const ask = useCallback((request: ConfirmRequest) => new Promise<boolean>(answer => setAsking({ ...request, answer })), [])
  const close = (yes: boolean) => {
    asking?.answer(yes)
    setAsking(null)
  }
  const sheet = (
    <ConfirmSheet
      open={asking !== null}
      onClose={() => close(false)}
      title={asking?.title ?? 'Confirm the patient'}
      subject={asking?.subject}
      effect={asking?.effect ?? ''}
      undo={asking?.undo}
      confirmLabel={asking?.confirmLabel ?? 'Confirm'}
      onConfirm={() => close(true)}
    />
  )
  return { ask, sheet }
}
