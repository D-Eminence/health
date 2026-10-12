import { createElement, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'

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

export class FieldInputError extends Error {
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

/** A DTO property in words: doseQuantity is "Dose quantity". */
function fieldWords(field: string) {
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Each reason a field was refused, as a sentence led by the field's name in
 * words. class-validator leads its messages with the property itself
 * ("title must be shorter than…"), which is replaced.
 */
export function refusalSentences({ field, messages }: RefusedField): string[] {
  const name = fieldWords(field)
  const sentence = (text: string) => /[.!?]$/.test(text) ? text : `${text}.`
  if (messages.length === 0) return [`${name} was refused.`]
  return messages.map(message => sentence(message.startsWith(`${field} `) ? `${name}${message.slice(field.length)}` : `${name}: ${message}`))
}

/** What a refused request says: its message and, for a 400 VALIDATION_FAILED, each field refused and why. */
export function refusalText(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback
  const sentences = refusedFields(caught).flatMap(refusalSentences)
  return sentences.length === 0 ? caught.message : [caught.message, ...sentences].join(' ')
}
