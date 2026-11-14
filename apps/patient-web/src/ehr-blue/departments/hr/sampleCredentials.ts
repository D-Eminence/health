import type { DeptFact } from '../parts/DeptRecord'

/*
 * The sample half of HR & Credentials: the design's credential records (the prototype catalog's "hr" module: its fields
 * and its one action), held in the page's memory only. Fictional people and credentials; nothing is sent or stored, and
 * a reload starts again from the rows below.
 */

export type SampleStatus = 'recorded' | 'reviewed'

export interface SampleData {
  readonly staff: string
  readonly name: string
  readonly expiry: string
  readonly employment: string
  readonly leave?: string
  readonly review?: string
}

/** A preserved version: the record as it was before a change, and the change's reason. */
export interface SampleVersion {
  readonly at: string
  readonly status: SampleStatus
  readonly reason: string
  readonly data: SampleData
}

export interface SampleRecord {
  readonly id: string
  readonly status: SampleStatus
  readonly updatedAt: string
  readonly data: SampleData
  readonly versions: ReadonlyArray<SampleVersion>
}

/** The fictional staff the form offers. */
export const SAMPLE_STAFF: ReadonlyArray<{ value: string; name: string; role: string }> = [
  { value: 'demo-doctor', name: 'Demo Doctor', role: 'Doctor' },
  { value: 'demo-nurse', name: 'Demo Nurse', role: 'Nurse' },
  { value: 'demo-pharmacist', name: 'Demo Pharmacist', role: 'Pharmacist' },
  { value: 'demo-scientist', name: 'Demo Laboratory Scientist', role: 'Laboratory scientist' },
]

export function staffName(value: string): string {
  return SAMPLE_STAFF.find(member => member.value === value)?.name ?? value
}

export type SampleFieldKey = 'staff' | 'name' | 'expiry' | 'employment' | 'leave'

/** The catalog's fields for an HR & Credentials record, in its order. */
export const SAMPLE_FIELDS: ReadonlyArray<{ key: SampleFieldKey; label: string; type: 'select' | 'text' | 'date'; required: boolean }> = [
  { key: 'staff', label: 'Staff member', type: 'select', required: true },
  { key: 'name', label: 'Fictional credential', type: 'text', required: true },
  { key: 'expiry', label: 'Expiry', type: 'date', required: true },
  { key: 'employment', label: 'Employment information', type: 'text', required: true },
  { key: 'leave', label: 'Leave request (optional)', type: 'text', required: false },
]

export type SampleValues = Record<SampleFieldKey, string>

export const EMPTY_VALUES: SampleValues = { staff: '', name: '', expiry: '', employment: '', leave: '' }

/** The catalog's action: a recorded credential's review. */
export const REVIEW_ACTION = {
  label: 'Record credential review',
  field: 'Simulated review (not independent verification)',
} as const

export const COMPLETE_THIS_FIELD = 'Complete this field.'

/** Each required field left empty, as the design's form says it. */
export function sampleProblems(values: SampleValues): Partial<Record<SampleFieldKey, string>> {
  const problems: Partial<Record<SampleFieldKey, string>> = {}
  for (const field of SAMPLE_FIELDS) if (field.required && !values[field.key].trim()) problems[field.key] = COMPLETE_THIS_FIELD
  return problems
}

function dataOf(values: SampleValues, review?: string): SampleData {
  const leave = values.leave.trim()
  return {
    staff: values.staff,
    name: values.name.trim(),
    expiry: values.expiry,
    employment: values.employment.trim(),
    ...leave ? { leave } : {},
    ...review ? { review } : {},
  }
}

export function valuesOf(data: SampleData): SampleValues {
  return { staff: data.staff, name: data.name, expiry: data.expiry, employment: data.employment, leave: data.leave ?? '' }
}

/** The rows a sample list starts from: the design's two records. */
export function sampleSeed(): SampleRecord[] {
  const at = '2026-10-26T11:41:16.706Z'
  const doctor: SampleData = { staff: 'demo-doctor', name: 'Medical licence (fictional)', expiry: '2030-01-01', employment: 'Employed' }
  return [
    { id: 'f8f25d2e-3c1a-4b7e-9d10-5a6b7c8d9e01', status: 'reviewed', updatedAt: at, data: { ...doctor, review: 'Local review only' },
      versions: [{ at, status: 'recorded', reason: REVIEW_ACTION.label, data: doctor }] },
    { id: 'b459b486-7e2f-4a3c-8b91-0c1d2e3f4a02', status: 'recorded', updatedAt: at,
      data: { staff: 'demo-nurse', name: 'Nursing registration (fictional)', expiry: '2029-06-30', employment: 'Employed' }, versions: [] },
  ]
}

export function createSample(values: SampleValues, id: string, now: string): SampleRecord {
  return { id, status: 'recorded', updatedAt: now, data: dataOf(values), versions: [] }
}

/** A recorded credential's details changed: the version before is kept. */
export function editSample(record: SampleRecord, values: SampleValues, now: string): SampleRecord {
  return { ...record, updatedAt: now, data: dataOf(values, record.data.review),
    versions: [...record.versions, { at: now, status: record.status, reason: 'Edit record', data: record.data }] }
}

/** The catalog's review: recorded to reviewed, with the review's words; the version before is kept. */
export function reviewSample(record: SampleRecord, review: string, now: string): SampleRecord {
  return { ...record, status: 'reviewed', updatedAt: now, data: { ...record.data, review: review.trim() },
    versions: [...record.versions, { at: now, status: record.status, reason: REVIEW_ACTION.label, data: record.data }] }
}

/** A record's saved fields, in the design's order, each only when it holds a value. */
export function sampleFacts(data: SampleData): DeptFact[] {
  return [
    { label: 'Staff', value: staffName(data.staff) },
    { label: 'Name', value: data.name },
    { label: 'Expiry', value: data.expiry },
    { label: 'Employment', value: data.employment },
    ...data.leave ? [{ label: 'Leave', value: data.leave }] : [],
    ...data.review ? [{ label: 'Review', value: data.review }] : [],
  ]
}

export function sampleTexts(record: SampleRecord): string[] {
  const { data } = record
  return [data.name, staffName(data.staff), data.expiry, data.employment, data.leave, data.review, record.status, record.id.slice(0, 8)]
    .filter((text): text is string => Boolean(text))
}
