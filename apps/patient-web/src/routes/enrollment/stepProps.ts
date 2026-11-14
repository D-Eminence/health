/**
 * What every enrollment stage receives from the page (routes/Enrollment.tsx),
 * which keeps the state, the requests, focus and the error. A stage only shows
 * itself and reports what was done.
 */
export interface StepProps {
  /** Ref for the element focus goes to on this stage (authSteps.ts useStepFocus). */
  focusTarget: (element: HTMLElement | null) => void
  busy: boolean
  /** `aria-invalid` for the stage's field when the server refused its value. */
  invalid: true | undefined
  /** The id of the error describing the stage's field, when it is about the field. */
  errorId: string | undefined
}
