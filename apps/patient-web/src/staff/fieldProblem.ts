import { createElement, type ReactNode } from 'react'
import { PlainError, isHidApiError, plainErrorText } from '@hid/http'

/**
 * A field the page refused before sending, named by its control's id. `alert`, a new number for each
 * refusal, when it was refused from Enter in the field itself.
 */
export interface FieldProblem { readonly field: string; readonly message: string; readonly alert?: number }

/**
 * Whether focus is already in `field` (a control, or a group of controls a rule covers) or on `focusId`,
 * its control: a refusal made from there cannot move focus to say why.
 */
export function focusIsWithin(field: string, focusId: string = field): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && (active.id === focusId || document.getElementById(field)?.contains(active) === true)
}

let refusals = 0

/**
 * A refusal to show at its field. Focus then moves to the field, so its description says why; refused
 * from Enter in the field itself, focus cannot move and nothing would be said, so the message is an
 * alert there instead, new for each refusal (as both, it would be said twice). useFieldProblems does the
 * same for the forms that use it.
 */
export function refusal(problem: FieldProblem): FieldProblem {
  return focusIsWithin(problem.field) ? { ...problem, alert: ++refusals } : problem
}

/** A value the page refused before sending, in the page's own plain words (so plainErrorText shows them). */
export class FieldInputError extends PlainError {
  constructor(readonly field: string, message: string) { super(message) }
}

/** Marks the refused control invalid and ties it to its error, which Field renders as `${id}-error`. */
export function problemProps(problem: FieldProblem | null, id: string) {
  return problem?.field === id ? { invalid: true, 'aria-describedby': `${id}-error` } : {}
}

/** Field's `error` while `id` is refused: an alert, new for each refusal, when refused from within the field. */
export function problemText(problem: FieldProblem | null, id: string): ReactNode {
  if (problem?.field !== id) return undefined
  return problem.alert ? createElement('span', { key: problem.alert, role: 'alert' }, problem.message) : problem.message
}

/** One request field a service refused, by its DTO name, and why. */
export interface RefusedField { readonly field: string; readonly messages: readonly string[] }

/**
 * The fields a 400 VALIDATION_FAILED names. Every hid-system service answers a
 * DTO refusal so (main.ts ValidationPipe): `errors: [{ field, messages }]`, one
 * entry per refused property with class-validator's messages, which the HTTP
 * client keeps as `details`.
 */
export function refusedFields(caught: unknown): RefusedField[] {
  if (!isHidApiError(caught) || caught.code !== 'VALIDATION_FAILED' || !Array.isArray(caught.details)) return []
  return caught.details.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const { field, messages } = entry as { field?: unknown; messages?: unknown }
    if (typeof field !== 'string' || !field) return []
    return [{ field, messages: Array.isArray(messages) ? messages.filter((message): message is string => typeof message === 'string') : [] }]
  })
}

/** What a form says when a service refused some of its fields: never the field's internal name or the service's words. */
export const FIELDS_REFUSED = 'Some details weren’t accepted. Check the details you entered and try again.'

/** One plain hint for a limit class-validator states, without the field's internal name; null for any other rule. */
function plainHint(message: string): string | null {
  const number = (pattern: RegExp) => pattern.exec(message)?.[1]
  const shorter = number(/shorter than or equal to (\d+) characters/)
  if (shorter) return shorter === '1' ? 'Use 1 character or fewer.' : `Use ${shorter} characters or fewer.`
  const longer = number(/longer than or equal to (\d+) characters/)
  if (longer) return longer === '1' ? 'Complete this field.' : `Use at least ${longer} characters.`
  const least = number(/must not be less than (-?[\d.]+)/)
  if (least) return `Enter ${least} or more.`
  const most = number(/must not be greater than (-?[\d.]+)/)
  if (most) return `Enter ${most} or less.`
  if (/should not be empty|must not be empty|should not be null or undefined/.test(message)) return 'Complete this field.'
  if (/must be a number|must be an integer|must be a positive number/.test(message)) return 'Enter a number.'
  if (/must be a valid ISO 8601 date|must be a Date instance|date string/.test(message)) return 'Enter a valid date.'
  if (/must be an email/.test(message)) return 'Enter a valid email address.'
  return null
}

/**
 * Why a field was refused, in plain words to show at that field: a hint for a stated limit ("Use 500 characters or
 * fewer."), else "Check this detail.". Never the field's internal name, the validator's wording, a pattern or a type.
 */
export function refusalSentences({ messages }: RefusedField): string[] {
  const hints = [...new Set(messages.map(plainHint).filter((hint): hint is string => hint !== null))]
  return hints.length > 0 ? hints : ['Check this detail.']
}

/**
 * What a refused request says, in plain words: FIELDS_REFUSED when a service refused fields (each is marked at its
 * field where the form has it), else plainErrorText's words, else the page's `fallback`. Never the server's text, a
 * code, a field's internal name or a JavaScript message.
 */
export function refusalText(caught: unknown, fallback: string): string {
  if (refusedFields(caught).length > 0) return FIELDS_REFUSED
  return plainErrorText(caught, fallback, { audience: 'facility' })
}
