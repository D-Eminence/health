import type { FormEvent } from 'react'
import { describedBy } from '../../authSteps'
import { CodeBoxes, codeComplete } from '../../CodeBoxes'
import type { StepProps } from './stepProps'
import { Button } from '../../kasuwa/ui'

/**
 * Enrollment's limits (hid-system #61 and #50): wrong codes spend one budget per
 * contact, so the fifth within 15 minutes refuses every code, a correct one too,
 * and sends no new one, for 15 minutes.
 */
const CODE_BUDGET_HINT = 'After 5 wrong codes within 15 minutes for the same contact, every code is refused, even a correct one, and no new code is sent to it, for 15 minutes.'

interface ContactCodeStepProps extends StepProps {
  maskedContact: string
  code: string
  onCode: (code: string) => void
  onSubmit: (event: FormEvent) => void
  /** Back to the contact step for another code, or another contact. */
  onAnotherCode: () => void
  /** A code was refused: say what a spent budget means. */
  budgetNote: boolean
}

/** The code sent to the contact. */
export function ContactCodeStep({ focusTarget, busy, invalid, errorId, maskedContact, code, onCode, onSubmit, onAnotherCode, budgetNote }: ContactCodeStepProps) {
  return <form onSubmit={onSubmit} className="flex flex-col gap-4">
    <h2 className="m-0 text-title-2 text-ink">Enter the code</h2><p id="enroll-code-hint" className="m-0 text-sm text-ink-2">We sent a 6-digit code to {maskedContact || 'your phone or email'}.</p>
    <CodeBoxes id="enroll-code" label="Code" value={code} onChange={onCode} inputRef={focusTarget} busy={busy}
      invalid={invalid} describedBy={describedBy('enroll-code-hint', errorId)} />
    <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || !codeComplete(code)}>{busy ? 'Checking…' : 'Check code'}</Button>
    {/* The note on a refused code is about that code: a new one starts without it. */}
    <Button variant="link" className="self-start" disabled={busy} onClick={onAnotherCode}>Get another code, or use another phone or email</Button>
    {budgetNote && <p className="m-0 text-[13px] text-ink-3">{CODE_BUDGET_HINT}</p>}
  </form>
}
