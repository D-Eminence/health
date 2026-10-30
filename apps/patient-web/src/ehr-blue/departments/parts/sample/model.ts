import type { ReactNode } from 'react'

/*
 * The sample workspaces' model: what a definition says (fields, actions, statuses, fictional rows) and the helpers
 * the engine shares. Everything here is in memory only: nothing is sent, nothing is stored in the browser, and every
 * record and patient is fictional.
 */

/** A record's values, by field key, as text. */
export type SampleValues = Readonly<Record<string, string>>

/** A choice in a select: what is stored and what is shown. */
export interface SampleOption {
  readonly value: string
  readonly label: string
}

/** What a select's choices may depend on: the patient chosen on the form, or the record an action is on. */
export interface SampleOptionContext {
  readonly patientId?: string
  readonly record?: SampleRecord
}

export interface SampleField {
  readonly key: string
  /** The form label; the "Saved record" label comes from the key, as the design's record view does. */
  readonly label: string
  readonly type?: 'text' | 'number' | 'date' | 'datetime-local' | 'textarea'
  /** Required unless false, as in the design's catalogue. */
  readonly required?: boolean
  /** A select: fixed fictional choices, or choices that depend on the patient or the record. */
  readonly options?: readonly string[] | ((context: SampleOptionContext) => readonly SampleOption[])
}

export interface SampleAction {
  readonly id: string
  readonly label: string
  /** The statuses the action is offered in. */
  readonly from: readonly string[]
  /** The status it leaves the record in, unless the definition's `apply` works out another. */
  readonly to: string
  readonly fields?: readonly SampleField[]
}

/** A stock batch on a Stock record. */
export interface SampleBatch {
  readonly lot: string
  readonly quantity: number
  readonly expiry: string
}

/** What a record keeps besides its shown values: stock batches, an invoice's payments. */
export interface SampleState {
  readonly batches?: readonly SampleBatch[]
  /** Minor currency units paid, less refunds. */
  readonly paidCents?: number
}

/** A preserved version: the record as it was before an action, the status it had and why it changed. */
export interface SampleVersion {
  readonly at: string
  readonly status: string
  readonly reason: string
  readonly values: SampleValues
}

export interface SampleRecord {
  readonly id: string
  readonly status: string
  /** One of SAMPLE_PATIENTS, on a workspace about patients. */
  readonly patientId?: string
  readonly values: SampleValues
  readonly state?: SampleState
  readonly updatedAt: string
  readonly versions: readonly SampleVersion[]
}

/** A record of another sample workspace about the same patient, for "Connected hospital history". */
export interface SampleConnection {
  readonly key: string
  /** The other workspace's path, a sibling of this one. */
  readonly page: string
  readonly title: string
  readonly name: string
  readonly status: string
}

export interface SampleApplyContext {
  readonly record: SampleRecord
  /** The page's other records (a vehicle already out, a reference already used). */
  readonly records: readonly SampleRecord[]
  readonly action: SampleAction
  readonly values: SampleValues
  readonly at: string
}

/** An action's own rule: a refusal in plain words, or what it changes besides the status and the values. */
export type SampleApplied =
  | { readonly error: string }
  | { readonly status?: string; readonly values?: SampleValues; readonly state?: SampleState }

/** The module tabs a workspace shares with its siblings: Stock | Procurement, Claims | Policies. */
export interface SampleTabs {
  /** Names the navigation landmark. */
  readonly label: string
  /** Each tab's workspace id, label, and its path when the page's address differs from its id (Stock is at supply). */
  readonly tabs: readonly { readonly id: string; readonly label: string; readonly path?: string }[]
}

export interface SampleDefinition {
  /** The page's path and the design's module id. */
  readonly id: string
  readonly title: string
  /** Records belong to a patient: the create form asks for one first. */
  readonly patient?: boolean
  /** The status a new record starts in. */
  readonly initial: string
  readonly fields: readonly SampleField[]
  readonly actions: readonly SampleAction[]
  /** Values a new form starts with, as the design's forms do (quantity 1, units per pack 1). */
  readonly defaults?: SampleValues
  /** The fictional rows the page opens with. */
  readonly records: readonly SampleRecord[]
  readonly tabs?: SampleTabs
  /** Values worked out when a record is created, after the form's (an invoice's number and totals). */
  readonly created?: (values: SampleValues, sequence: number) => { readonly values?: SampleValues; readonly state?: SampleState }
  /**
   * A record's own rule on create and edit, against the page's other records: a refusal in the design's words (a
   * quantity of zero, a charge already made, an overlapping shift).
   */
  readonly validate?: (values: SampleValues, records: readonly SampleRecord[]) => string | undefined
  /** Values worked out again when a record is edited (an invoice's totals). */
  readonly edited?: (record: SampleRecord, values: SampleValues) => { readonly values?: SampleValues }
  /** An action's own rule (a payment over the balance, negative stock). */
  readonly apply?: (context: SampleApplyContext) => SampleApplied
  /** More of the "Saved record" card: an invoice's totals, a stock item's batches. */
  readonly savedExtra?: (record: SampleRecord) => ReactNode
  /** Records of the other workspaces about this patient. */
  readonly connected?: (patientId: string) => readonly SampleConnection[]
}

export interface SamplePatient {
  readonly id: string
  readonly name: string
  readonly healthId: string
}

/** The fictional registered patients every sample workspace chooses from. */
export const SAMPLE_PATIENTS: readonly SamplePatient[] = [
  { id: 'sample-patient-1', name: 'Patient One', healthId: 'HID-ZDEMAAA2' },
  { id: 'sample-patient-2', name: 'Patient Two', healthId: 'HID-ZDEMAAB3' },
  { id: 'sample-patient-3', name: 'Patient Three', healthId: 'HID-ZDEMAAC4' },
  { id: 'sample-patient-4', name: 'Patient Four', healthId: 'HID-ZDEMAAD5' },
  { id: 'sample-patient-5', name: 'Patient Five', healthId: 'HID-ZDEMAAE6' },
]

export function samplePatient(id: string | undefined): SamplePatient | undefined {
  return id ? SAMPLE_PATIENTS.find(patient => patient.id === id) : undefined
}

/** What the design shows for a record of a patient: "Patient One · HID-ZDEMAAA2". */
export function patientLine(patient: SamplePatient) {
  return `${patient.name} · ${patient.healthId}`
}

/** The error under a required field left empty, in the design's words. */
export const REQUIRED_TEXT = 'Complete this field.'

/** A preserved version's reason when the record's fields were edited. */
export const EDIT_REASON = 'Edit record'

/** The words under a form whose action was refused, in the design's words. */
export const RETRY_TEXT = 'Correct the issue or retry using the same button. No success is reported until saved.'

/** A record's name, as the design names one: its name, title, number or reason, else the start of its id. */
export function recordName(record: SampleRecord) {
  const { values } = record
  return values.name || values.title || values.number || values.test || values.modality || values.procedure
    || values.reason || values.sampleCode || values.lot || record.id.slice(0, 8)
}

/** A value's label in "Saved record", from its key as the design shows it: "packSize" is "Pack Size". */
export function keyLabel(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/(^|\s)([a-z])/g, (_, space: string, letter: string) => space + letter.toUpperCase())
}

/** A record's values as labelled facts, in the order they were recorded. */
export function valueFacts(values: SampleValues) {
  return Object.entries(values).map(([key, value]) => ({ label: keyLabel(key), value }))
}

/** The record is required unless the field says otherwise. */
export function isRequired(field: SampleField) {
  return field.required !== false
}

/** A select's choices for this patient or record. */
export function fieldOptions(field: SampleField, context: SampleOptionContext): readonly SampleOption[] | undefined {
  if (!field.options) return undefined
  if (typeof field.options === 'function') return field.options(context)
  return field.options.map(option => ({ value: option, label: option }))
}

/** The required fields left empty, with the design's error under each. */
export function missingFields(fields: readonly SampleField[], values: SampleValues): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    if (isRequired(field) && !(values[field.key] ?? '').trim()) errors[field.key] = REQUIRED_TEXT
  }
  return errors
}

/** Only the values that were given. */
export function givenValues(values: SampleValues): SampleValues {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''))
}

/** Whether a row matches the search, as the design's search does: the record's values and its patient. */
export function matchesSampleSearch(record: SampleRecord, query: string) {
  const wanted = query.trim().toLocaleLowerCase()
  if (!wanted) return true
  const patient = samplePatient(record.patientId)
  return [...Object.values(record.values), patient?.name, patient?.healthId].filter(Boolean).join(' ').toLocaleLowerCase().includes(wanted)
}

/** An id for a new fictional record, unique on its page: hexadecimal like the design's, made from no real data. */
export function sampleId(seed: string, sequence: number) {
  let hash = 2166136261
  for (const char of `${seed}:${sequence}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `${(hash >>> 0).toString(16).padStart(8, '0')}-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`
}

/** One CSV cell: quoted when it must be, and never read as a formula by a spreadsheet. */
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** The filtered rows as CSV: the list's columns, then each field. */
export function sampleCsv(definition: SampleDefinition, records: readonly SampleRecord[]) {
  const header = ['Record', 'Reference', 'Patient / context', 'Status', 'Updated', ...definition.fields.map(field => field.label)]
  const rows = records.map(record => {
    const patient = samplePatient(record.patientId)
    return [recordName(record), record.id.slice(0, 8), patient ? patient.name : recordName(record), record.status, record.updatedAt,
      ...definition.fields.map(field => record.values[field.key] ?? '')]
  })
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/**
 * Hands the viewer a file made on this page from fictional rows: a Blob and an object URL, revoked once the
 * download has started. Nothing is sent anywhere.
 */
export function downloadFile(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Another workspace's fictional records as a select's choices, as the design lists a linked record: its name, status
 * and the start of its id. The name is what is kept.
 */
export function recordOptions(records: readonly SampleRecord[]): readonly SampleOption[] {
  return records.map(record => ({ value: recordName(record), label: `${recordName(record)} · ${record.status} · ${record.id.slice(0, 6)}` }))
}

/** The design's refusal for a quantity of zero or less. */
export const QUANTITY_TEXT = 'Quantity must be greater than zero.'

/** The design's refusal for an amount of zero or less. */
export const AMOUNT_TEXT = 'Amount must be greater than zero.'

/** A number above zero, or undefined. */
export function above(value: string | undefined) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

/** A whole number above zero, or undefined. */
export function wholeAbove(value: string | undefined, floor = 0) {
  const number = Number(value)
  return Number.isInteger(number) && number > floor ? number : undefined
}
