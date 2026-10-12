import { isHidApiError } from '@hid/http'

/** A field the page refused before sending, named by its control's id. */
export interface FieldProblem { readonly field: string; readonly message: string }

export class FieldInputError extends Error {
  constructor(readonly field: string, message: string) { super(message) }
}

/** Marks the refused control invalid and ties it to its error, which Field renders as `${id}-error`. */
export function problemProps(problem: FieldProblem | null, id: string) {
  return problem?.field === id ? { invalid: true, 'aria-describedby': `${id}-error` } : {}
}

export function problemText(problem: FieldProblem | null, id: string) {
  return problem?.field === id ? problem.message : undefined
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
