import { allModules, type Field, type Module } from './catalog'

/**
 * Sample records for the workspaces Health ID does not serve yet. They live in this module's memory only: nothing is
 * sent, nothing is kept in the browser, and a reload starts again from the same fictional rows. No real person, patient
 * or Health ID appears: every name is invented and says so.
 */

export type SampleValue = string | boolean
export type SampleFields = Readonly<Record<string, SampleValue>>

/** A saved state kept when an action changes a record: the design's "Preserved versions & amendments". */
export interface SampleRecordVersion {
  readonly at: string
  /** The status before the action. */
  readonly status: string
  /** The action's label. */
  readonly reason: string
  readonly author: string
  /** The fields before the action. */
  readonly fields: SampleFields
}

export interface SampleRecord {
  readonly id: string
  readonly moduleId: string
  readonly status: string
  readonly fields: SampleFields
  readonly updatedAt: string
  readonly versions: readonly SampleRecordVersion[]
  /** Each action taken, with what was entered for it (stock received, payments). */
  readonly steps: readonly { readonly action: string; readonly fields: SampleFields }[]
}

/** The design's own fictional values for the fields its screenshots show. */
const DESIGN_VALUES: Record<string, readonly string[]> = {
  reason: ['Review of results', 'Medication review', 'Antenatal review'],
  test: ['Full blood count', 'Blood culture', 'Malaria parasite test'],
  procedure: ['Appendicectomy (fictional)', 'Wound debridement (fictional)', 'Hernia repair (fictional)'],
  modality: ['X-ray', 'Ultrasound', 'CT'],
}

/** The design's own fictional values for one workspace's fields (its stock items and invoices). */
const DESIGN_MODULE_VALUES: Record<string, Record<string, readonly string[]>> = {
  inventory: {
    name: ['Fictional Med A', 'Fictional Gloves', 'Fictional Syringe'], unit: ['tablet', 'pair', 'piece'],
    packSize: ['10', '50', '100'], threshold: ['20', '100', '50'],
  },
}

export const FICTIONAL_PATIENTS = ['Alex Example', 'Taylor Fiction', 'Jordan Sample', 'Sam Placeholder', 'Riley Demo'] as const

/** Each fictional patient's made-up Health ID and recorded allergies, as the design's patient records carry them. */
const PATIENT_FACTS: Record<string, { readonly healthId: string; readonly allergies?: string }> = {
  'Alex Example': { healthId: 'HID-DEMO-001', allergies: 'Fictional Med A' },
  'Taylor Fiction': { healthId: 'HID-DEMO-002' },
  'Jordan Sample': { healthId: 'HID-DEMO-003' },
  'Sam Placeholder': { healthId: 'HID-DEMO-004' },
  'Riley Demo': { healthId: 'HID-DEMO-005' },
}

/** "Alex Example · HID-DEMO-001", as the design names a patient beside a record. */
export function samplePatientLine(name: string): string {
  const healthId = PATIENT_FACTS[name]?.healthId
  return healthId ? `${name} · ${healthId}` : name
}

export function samplePatientAllergies(name: string): string | undefined {
  return PATIENT_FACTS[name]?.allergies
}

/** The design's departments (design/ehr-target src/model.ts). */
export const SAMPLE_DEPARTMENTS = [
  'General Outpatient', 'Emergency', 'Inpatient', 'Laboratory', 'Pharmacy', 'Maternity', 'Pediatrics', 'Radiology', 'Dental',
  'Physiotherapy', 'Dialysis', 'Oncology', 'Cardiology', 'ICU', 'Theatre',
] as const

/** The demo staff a staff field picks from, named as the design names them ("Demo " and the role). */
const SAMPLE_STAFF = [
  { name: 'Demo Doctor', role: 'Doctor' }, { name: 'Demo Consultant', role: 'Consultant' },
  { name: 'Demo Medical Director', role: 'Medical Director' }, { name: 'Demo Nurse', role: 'Nurse' },
  { name: 'Demo Receptionist', role: 'Receptionist' }, { name: 'Demo Lab Scientist', role: 'Lab Scientist' },
  { name: 'Demo Pharmacist', role: 'Pharmacist' }, { name: 'Demo Billing Officer', role: 'Billing Officer' },
] as const

const CLINICAL_ROLES: readonly string[] = ['Doctor', 'Consultant', 'Medical Director']

/**
 * The choices the design gives a field from the facility itself: staff (Clinician, Staff member, Assigned nurse),
 * Department and Destination branch.
 */
export function sampleFacilityChoices(field: Field): readonly { readonly value: string; readonly label: string }[] | undefined {
  if (field.key === 'clinician' || field.key === 'staff' || field.key === 'assignedTo') {
    return SAMPLE_STAFF
      .filter(person => field.key === 'staff' || (field.key === 'clinician' ? CLINICAL_ROLES.includes(person.role) : person.role === 'Nurse'))
      .map(person => ({ value: person.name, label: `${person.name} · ${person.role} · Online` }))
  }
  if (field.key === 'department' && !field.options) return SAMPLE_DEPARTMENTS.map(name => ({ value: name, label: name }))
  if (field.key === 'destination' && field.label.includes('branch')) return [{ value: 'Annex branch (fictional)', label: 'Annex branch (fictional)' }]
  return undefined
}

const records = new Map<string, SampleRecord[]>()
const listeners = new Set<() => void>()

export function sampleModule(id: string): Module | undefined {
  return allModules.find(module => module.id === id)
}

/**
 * A record's id: eight hex digits, as the design shows record ids, made of the workspace's place in the design's list
 * and the record's number in it ("5a020001" is the first appointment). It is the same whichever workspace opens first,
 * so a record's address keeps working until a reload.
 */
function sampleId(moduleId: string, number: number): string {
  const place = allModules.findIndex(module => module.id === moduleId) + 1
  return (0x5a000000 + place * 0x10000 + number).toString(16)
}

/** Fixed sample times, so every visit shows the same rows: 29 October 2026, a few hours apart. */
function sampleTime(index: number): string {
  return new Date(Date.UTC(2026, 9, 29, 8 + index, 30)).toISOString()
}

function sampleValue(module: Module, field: Field, index: number): SampleValue {
  const patient = FICTIONAL_PATIENTS[index % FICTIONAL_PATIENTS.length]!
  if (field.type === 'checkbox') return false
  const facility = sampleFacilityChoices(field)
  if (facility?.length) return facility[index % facility.length]!.value
  if (field.options?.length) return field.options[index % field.options.length]!
  if (field.choices?.length) return field.choices[index % field.choices.length]!.value
  if (field.ref) return field.ref === 'patient' ? patient : `${field.label} ${index + 1} (fictional)`
  if (module.id === 'patients' && field.key === 'name') return patient
  const named = DESIGN_MODULE_VALUES[module.id]?.[field.key]?.[index] ?? DESIGN_VALUES[field.key]?.[index]
  if (named) return named
  switch (field.type) {
    case 'date': return `2026-10-${String(20 + index).padStart(2, '0')}`
    case 'datetime-local': return `2026-10-${String(29 + (index % 2)).padStart(2, '0')}T${String(9 + index).padStart(2, '0')}:00`
    case 'number': return String((index + 1) * 2)
    case 'email': return `sample${index + 1}@example.test`
    case 'tel': return `0800 000 000${index}`
    case 'textarea': return 'Fictional note for the demonstration.'
    case 'file': return ''
    default: return `${field.label} ${index + 1} (fictional)`
  }
}

/** An invoice is numbered when it is raised, as the design numbers them ("DEMO-1"). */
function invoiceNumber(moduleId: string, number: number): Record<string, string> {
  return moduleId === 'billing' ? { number: `DEMO-${number}` } : {}
}

function seed(module: Module): SampleRecord[] {
  return Array.from({ length: 3 }, (_, index) => ({
    id: sampleId(module.id, index + 1),
    moduleId: module.id,
    status: module.initial ?? 'active',
    fields: {
      ...(module.patient ? { patient: FICTIONAL_PATIENTS[index]! } : {}),
      ...Object.fromEntries(module.fields.map(field => [field.key, sampleValue(module, field, index)])),
      ...invoiceNumber(module.id, index + 1),
    },
    updatedAt: sampleTime(index),
    versions: [],
    // A stock item starts with one received batch, so its adjust and transfer actions have a batch to pick.
    steps: module.id === 'inventory'
      ? [{ action: 'receive', fields: { lot: `DEMO-LOT-${index + 1}`, quantity: '96', expiry: '2030-01-01', reference: 'Receipt (fictional)' } }]
      : [],
  }))
}

export function sampleRecords(moduleId: string): readonly SampleRecord[] {
  const module = sampleModule(moduleId)
  if (!module) return []
  let list = records.get(moduleId)
  if (!list) {
    list = seed(module)
    records.set(moduleId, list)
  }
  return list
}

function publish() {
  listeners.forEach(listener => listener())
}

export function subscribeSamples(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** A version that changes on every write, for useSyncExternalStore. */
let version = 0
export function sampleVersion(): number {
  return version
}

export function createSample(moduleId: string, fields: Record<string, SampleValue>): SampleRecord {
  const module = sampleModule(moduleId)
  const now = new Date().toISOString()
  const number = sampleRecords(moduleId).length + 1
  const record: SampleRecord = {
    id: sampleId(moduleId, number), moduleId, status: module?.initial ?? 'active', fields: { ...fields, ...invoiceNumber(moduleId, number) },
    updatedAt: now, versions: [], steps: [],
  }
  records.set(moduleId, [record, ...sampleRecords(moduleId)])
  version += 1
  publish()
  return record
}

/** Takes an action on a record, preserving its earlier state as a version, as the design does. */
export function actOnSample(moduleId: string, id: string, change: {
  readonly action: string; readonly label: string; readonly to: string; readonly fields: Record<string, SampleValue>; readonly author: string
}) {
  const now = new Date().toISOString()
  records.set(moduleId, sampleRecords(moduleId).map(record => record.id !== id ? record : {
    ...record,
    status: change.to,
    fields: { ...record.fields, ...change.fields },
    updatedAt: now,
    versions: [...record.versions, { at: now, status: record.status, reason: change.label, author: change.author, fields: record.fields }],
    steps: [...record.steps, { action: change.action, fields: change.fields }],
  }))
  version += 1
  publish()
}

/** Saves changes to an unsigned draft in place: a draft keeps no versions until it is signed or completed. */
export function editSampleDraft(moduleId: string, id: string, fields: Record<string, SampleValue>) {
  records.set(moduleId, sampleRecords(moduleId).map(record => record.id !== id ? record : {
    ...record, fields: { ...record.fields, ...fields }, updatedAt: new Date().toISOString(),
  }))
  version += 1
  publish()
}

/** Every sample record of a kind (the design's record kinds: visit, admission, encounter…), across its workspaces. */
export function sampleRecordsOfKind(kind: string): readonly SampleRecord[] {
  return allModules.filter(module => module.kind === kind).flatMap(module => sampleRecords(module.id))
}

/** A record by its id, in any workspace opened so far. */
export function findSample(id: string): SampleRecord | undefined {
  for (const list of records.values()) {
    const found = list.find(record => record.id === id)
    if (found) return found
  }
  return undefined
}

/** The patient's records in the workspaces opened so far, other than the given one: the design's connected history. */
export function connectedSamples(patient: string, exceptModuleId: string): readonly SampleRecord[] {
  return allModules
    .filter(module => module.id !== exceptModuleId)
    .flatMap(module => (records.get(module.id) ?? []).filter(record => record.fields.patient === patient))
}

/**
 * What one workspace hands the next (the design's Continue care: the patient and the visit or admission carry into
 * the new record). Memory only, read once by the next create form.
 */
const handoffs = new Map<string, Record<string, SampleValue>>()

export function handOffSample(moduleId: string, values: Record<string, SampleValue>) {
  handoffs.set(moduleId, values)
}

export function sampleHandoff(moduleId: string): Record<string, SampleValue> | undefined {
  return handoffs.get(moduleId)
}

export function clearSampleHandoff(moduleId: string) {
  handoffs.delete(moduleId)
}

/** The record's name in a list, as the design names it (its name, title, number, test… reason), else its id. */
const NAME_KEYS = ['name', 'title', 'number', 'test', 'modality', 'procedure', 'reason', 'sampleCode', 'lot'] as const

export function sampleTitle(record: SampleRecord): string {
  const key = NAME_KEYS.find(candidate => typeof record.fields[candidate] === 'string' && record.fields[candidate] !== '')
  return key ? String(record.fields[key]) : record.id.toLowerCase()
}

/** "checked-in" → "checked in". */
export function statusWords(status: string): string {
  return status.replace(/[-_]+/g, ' ')
}
