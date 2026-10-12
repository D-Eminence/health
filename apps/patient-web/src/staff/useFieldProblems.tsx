import { useCallback, useState, type ReactNode } from 'react'
import { refusalSentences, refusedFields } from './fieldProblem'
import { useFocusById } from './focus'

interface Shown { readonly field: string; readonly message: string; readonly alert: boolean }

/**
 * A provider form's field errors (PEHR-04). A value refused before sending is
 * reported at its field, or at the group of fields a rule covers, which Field
 * (or the group) renders as `${field}-error`: the control is marked invalid and
 * described by it, and takes focus once the render showing it has committed,
 * so its description announces the error. Refused from Enter in the field
 * itself, focus does not move, so the message is an alert there instead, new
 * for each refusal; as both it would be spoken twice. Fields a service refused
 * with 400 VALIDATION_FAILED are marked the same way without moving focus: the
 * form's own alert says so.
 */
export function useFieldProblems() {
  const focus = useFocusById()
  const [shown, setShown] = useState<{ readonly items: readonly Shown[]; readonly seq: number }>({ items: [], seq: 0 })
  /** Refuses `field` (a control's id, or a group's) and moves focus to `focusId`, that field's control. */
  const refuse = useCallback((field: string, message: string, focusId: string = field) => {
    const active = document.activeElement
    const alert = active instanceof HTMLElement && active.id === focusId
    setShown(previous => ({ items: [{ field, message, alert }], seq: previous.seq + 1 }))
    if (!alert) focus(focusId)
  }, [focus])
  /** Marks the controls of `form` named by a 400 VALIDATION_FAILED, where the form has one by that name. */
  const markRefused = useCallback((form: HTMLFormElement, caught: unknown) => {
    const items = refusedFields(caught).flatMap(entry => {
      const control = form.elements.namedItem(entry.field)
      return control instanceof HTMLElement && control.id
        ? [{ field: control.id, message: refusalSentences(entry).join(' '), alert: false }] : []
    })
    setShown(previous => ({ items, seq: previous.seq + 1 }))
  }, [])
  const clear = useCallback(() => setShown(previous => previous.items.length ? { items: [], seq: previous.seq } : previous), [])
  const find = (field: string) => shown.items.find(item => item.field === field)
  return {
    refuse, markRefused, clear,
    /** Field's `error` (or a group's error text) while `field` is refused. */
    error(field: string): ReactNode {
      const item = find(field)
      return !item ? undefined : item.alert ? <span key={shown.seq} role="alert">{item.message}</span> : item.message
    },
    /** Props for a control: invalid and described by its error while refused. */
    control(field: string) {
      return find(field) ? { invalid: true, 'aria-describedby': `${field}-error` } : {}
    },
    /** Props for a group of controls that one rule covers: described by its error while refused. */
    group(field: string) {
      return find(field) ? { 'aria-describedby': `${field}-error` } : {}
    },
  }
}

/** A group's error, rendered as `${field}-error` as Field renders a control's. */
export function GroupError({ field, children }: { field: string; children: ReactNode }) {
  if (!children) return null
  return <p id={`${field}-error`} className="staff-error">{children}</p>
}
