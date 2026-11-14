import type { FieldDef, FormValues } from '../parts/RecordForm'
import { DEPARTMENTS, SAMPLE_CLINICIANS, SAMPLE_NURSES, type SampleField } from './definitions'
import type { SampleData, SampleValue } from './seed'
import { refChoices, type SampleState } from './store'

/**
 * A sample field as the shared RecordForm draws it, choosing the control the way the design does: options or a
 * record picker make a select; the keys "clinician", "assignedTo" and "department" pick from the fictional staff and
 * the branch departments.
 */
export function toFieldDef(current: SampleState, field: SampleField, patientId: string | undefined): FieldDef {
  const required = field.required !== false
  const base = { key: field.key, label: field.label, required }
  if (field.ref) return { ...base, choices: refChoices(current, field.ref, patientId) }
  if (field.options) return { ...base, options: field.options }
  if (field.key === 'clinician') return { ...base, choices: SAMPLE_CLINICIANS }
  if (field.key === 'assignedTo') return { ...base, choices: SAMPLE_NURSES }
  if (field.key === 'department') return { ...base, options: DEPARTMENTS }
  const type = field.type === 'file' ? 'text' : field.type ?? 'text'
  return { ...base, type }
}

/** The fields RecordForm draws (a file field is drawn beside it). */
export function formFields(current: SampleState, fields: readonly SampleField[], patientId: string | undefined): FieldDef[] {
  return fields.filter(field => field.type !== 'file').map(field => toFieldDef(current, field, patientId))
}

/** The design's create form starts priority and urgency at "Routine". */
export function createInitial(fields: readonly SampleField[], carried: SampleData = {}): FormValues {
  const initial: Record<string, string | boolean | readonly string[]> = {}
  for (const field of fields) {
    if (field.key === 'priority' || field.key === 'urgency') initial[field.key] = 'Routine'
    const value = carried[field.key]
    if (value !== undefined) initial[field.key] = value
  }
  return initial
}

/** Form values as record data (the design keeps every submitted value). */
export function toData(values: FormValues): Record<string, SampleValue> {
  return { ...values }
}
