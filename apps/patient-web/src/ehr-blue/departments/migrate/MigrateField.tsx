import type { ReactNode } from 'react'
import { describedBy } from '../../../authSteps'
import { problemText, type FieldProblem } from '../../../staff/fieldProblem'
import { DeptNotice } from '../parts/DeptNotice'

/**
 * A labelled field in the design's form look, with the control's own id: the page moves focus to a refused field by
 * that id, and its error is `${id}-error` (EhrField makes its own ids, so it cannot be used here). The required mark is
 * hidden from assistive technology, as the design's forms hide it.
 */
export function MigrateField({ id, label, required = false, hint, problem, className, children }: {
  readonly id: string
  readonly label: ReactNode
  readonly required?: boolean
  readonly hint?: ReactNode
  readonly problem: FieldProblem | null
  readonly className?: string
  readonly children: ReactNode
}) {
  const error = problemText(problem, id)
  return (
    <div className={['hid-ehr-field', className].filter(Boolean).join(' ')}>
      <label className="hid-ehr-label" htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {children}
      {error !== undefined ? <p id={`${id}-error`} className="hid-ehr-error">{error}</p> : null}
      {hint !== undefined ? <p id={`${id}-hint`} className="hid-ehr-hint">{hint}</p> : null}
    </div>
  )
}

/** A control's id, and while it is refused its validity and error, described first, then anything else that describes it. */
export function controlProps(problem: FieldProblem | null, id: string, ...more: Array<string | false | null | undefined>) {
  const refused = problem?.field === id
  return { id, 'aria-invalid': refused ? true : undefined, 'aria-describedby': describedBy(refused && `${id}-error`, ...more) }
}

/** What a form says once a request is refused: the refusal, and the design's line on what to do next. */
export function FormRefusal({ error }: { readonly error: string }) {
  if (!error) return null
  return <>
    <DeptNotice tone="critical" role="alert" className="hid-ehr-dept-migrate-form-error">{error}</DeptNotice>
    <p className="hid-ehr-dept-muted">Correct the issue or retry using the same button. No success is reported until saved.</p>
  </>
}
