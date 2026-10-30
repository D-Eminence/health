import { allModules, type Field, type Module } from './catalog'

/**
 * Sample records for the workspaces Health ID does not serve yet. They live in this module's memory only: nothing is
 * sent, nothing is kept in the browser, and a reload starts again from the same fictional rows. No real person, patient
 * or Health ID appears: every name is invented and says so.
 */

export type SampleValue = string | boolean

export interface SampleRecord {
  readonly id: string
  readonly moduleId: string
  readonly status: string
  readonly fields: Readonly<Record<string, SampleValue>>
  readonly updatedAt: string
  readonly history: readonly { readonly what: string; readonly at: string }[]
}

/** The design's own fictional values for the fields its screenshots show. */
const DESIGN_VALUES: Record<string, readonly string[]> = {
  reason: ['Review of results', 'Medication review', 'Antenatal review'],
  test: ['Full blood count', 'Blood culture', 'Malaria parasite test'],
  procedure: ['Appendicectomy (fictional)', 'Wound debridement (fictional)', 'Hernia repair (fictional)'],
  modality: ['X-ray', 'Ultrasound', 'CT'],
}

export const FICTIONAL_PATIENTS = ['Alex Example', 'Taylor Fiction', 'Jordan Sample', 'Sam Placeholder', 'Riley Demo'] as const

const records = new Map<string, SampleRecord[]>()
const listeners = new Set<() => void>()
let sequence = 0

export function sampleModule(id: string): Module | undefined {
  return allModules.find(module => module.id === id)
}

function nextId(): string {
  sequence += 1
  return `S-${String(sequence).padStart(4, '0')}`
}

/** Fixed sample times, so every visit shows the same rows: 29 October 2026, a few hours apart. */
function sampleTime(index: number): string {
  return new Date(Date.UTC(2026, 9, 29, 8 + index, 30)).toISOString()
}

function sampleValue(module: Module, field: Field, index: number): SampleValue {
  const patient = FICTIONAL_PATIENTS[index % FICTIONAL_PATIENTS.length]!
  if (field.type === 'checkbox') return false
  if (field.options?.length) return field.options[index % field.options.length]!
  if (field.choices?.length) return field.choices[index % field.choices.length]!.value
  if (field.ref) return field.ref === 'patient' ? patient : `${field.label} ${index + 1} (fictional)`
  if (module.id === 'patients' && field.key === 'name') return patient
  const named = DESIGN_VALUES[field.key]?.[index]
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

function seed(module: Module): SampleRecord[] {
  return Array.from({ length: 3 }, (_, index) => ({
    id: nextId(),
    moduleId: module.id,
    status: module.initial ?? 'active',
    fields: {
      ...(module.patient ? { patient: FICTIONAL_PATIENTS[index]! } : {}),
      ...Object.fromEntries(module.fields.map(field => [field.key, sampleValue(module, field, index)])),
    },
    updatedAt: sampleTime(index),
    history: [{ what: 'Created (sample)', at: sampleTime(index) }],
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
  const record: SampleRecord = {
    id: nextId(), moduleId, status: module?.initial ?? 'active', fields, updatedAt: now,
    history: [{ what: 'Created (sample)', at: now }],
  }
  records.set(moduleId, [record, ...sampleRecords(moduleId)])
  version += 1
  publish()
  return record
}

export function updateSample(moduleId: string, id: string, change: { status?: string; fields?: Record<string, SampleValue>; what: string }) {
  const now = new Date().toISOString()
  records.set(moduleId, sampleRecords(moduleId).map(record => record.id !== id ? record : {
    ...record,
    status: change.status ?? record.status,
    fields: { ...record.fields, ...change.fields },
    updatedAt: now,
    history: [...record.history, { what: change.what, at: now }],
  }))
  version += 1
  publish()
}

/** The record's name in a list, as the design names it (its name, title, number, test… reason), else its id. */
const NAME_KEYS = ['name', 'title', 'number', 'test', 'modality', 'procedure', 'reason', 'sampleCode', 'lot'] as const

export function sampleTitle(module: Module, record: SampleRecord): string {
  const key = NAME_KEYS.find(candidate => typeof record.fields[candidate] === 'string' && record.fields[candidate] !== '')
    ?? module.fields.find(field => typeof record.fields[field.key] === 'string' && record.fields[field.key] !== '')?.key
  return key ? String(record.fields[key]) : record.id
}

/** "checked-in" → "checked in". */
export function statusWords(status: string): string {
  return status.replace(/[-_]+/g, ' ')
}
