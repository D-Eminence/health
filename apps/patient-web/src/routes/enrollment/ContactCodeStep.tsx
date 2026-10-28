import type { FormEvent } from 'react'
import { describedBy } from '../../authSteps'
import { CodeBoxes, codeComplete } from '../../CodeBoxes'
import type { StepProps } from './stepProps'

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
  return <form onSubmit={onSubmit} className="patient-form">
    <h2>Verify your contact</h2><p id="enroll-code-hint" className="patient-field-hint">Enter the six digit code sent to {maskedContact || 'your contact'}.</p>
    <CodeBoxes id="enroll-code" label="Verification code" value={code} onChange={onCode} inputRef={focusTarget} busy={busy}
      invalid={invalid} describedBy={describedBy('enroll-code-hint', errorId)} />
    <button type="submit" className="patient-primary-button" disabled={busy || !codeComplete(code)}>{busy ? 'Checking…' : 'Verify code'}</button>
    {/* The note on a refused code is about that code: a new one starts without it. */}
    <button type="button" className="patient-text-button" disabled={busy} onClick={onAnotherCode}>Request another code or change contact</button>
    {budgetNote && <p className="patient-field-hint">{CODE_BUDGET_HINT}</p>}
  </form>
}
