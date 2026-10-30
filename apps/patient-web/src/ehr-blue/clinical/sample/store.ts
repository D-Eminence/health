import { useSyncExternalStore } from 'react'
import { keyLabel } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import {
  CONFIRMED_ACTIONS, HISTORY_ORDER, REF_WORKSPACES, SAMPLE_CLINICIANS, SAMPLE_DEFINITIONS, TYPED_WORD_ACTIONS,
  type SampleDefinition, type SampleHandoff, type SampleRefKind,
} from './definitions'
import {
  SAMPLE_USER, SEED_ENCOUNTERS, SEED_PATIENTS, seedRecords,
  type SampleData, type SampleEncounter, type SamplePatient, type SampleRecord, type SampleValue,
} from './seed'

/**
 * The sample engine's store: fictional records in this page's memory only (a module variable read through
 * useSyncExternalStore). It never touches browser storage or the network and starts again from the seed on every
 * reload. `resetSampleStore()` starts it again in tests.
 */

export interface PendingHandoff {
  readonly workspace: string
  readonly patientId?: string
  readonly values: SampleData
}

export interface SampleState {
  readonly patients: readonly SamplePatient[]
  readonly encounters: readonly SampleEncounter[]
  readonly records: readonly SampleRecord[]
  /** A "Continue care" hand-off waiting for the target's create page. */
  readonly handoff: PendingHandoff | null
}

export type SampleOutcome = { readonly id: string } | { readonly error: string }

function seedState(): SampleState {
  return { patients: [...SEED_PATIENTS], encounters: [...SEED_ENCOUNTERS], records: seedRecords(), handoff: null }
}

let state: SampleState = seedState()
let sequence = 0
const listeners = new Set<() => void>()

function commit(next: SampleState) {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function snapshot() {
  return state
}

/** The current sample records; re-renders on every change. */
export function useSampleState(): SampleState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function sampleState(): SampleState {
  return state
}

/** Back to the seed: what a reload does. */
export function resetSampleStore() {
  sequence = 0
  commit(seedState())
}

/** A fresh fictional id (UUID shaped, never sent anywhere). */
function newId() {
  sequence += 1
  const random = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  const tail = `${random()}${sequence.toString(16).padStart(4, '0')}`.slice(-12)
  return `${random()}-${random().slice(0, 4)}-4${random().slice(0, 3)}-a${random().slice(0, 3)}-${tail}`
}

const now = () => new Date().toISOString()

export function sampleDefinition(id: string): SampleDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(SAMPLE_DEFINITIONS, id) ? SAMPLE_DEFINITIONS[id] : undefined
}

/** The design's record title: name, title, number, test, modality, procedure, reason, sample code or lot, else the id. */
export function recordName(record: Pick<SampleRecord, 'id' | 'data'>): string {
  const keys = ['name', 'title', 'number', 'test', 'modality', 'procedure', 'reason', 'sampleCode', 'lot']
  for (const key of keys) {
    const value = record.data[key]
    if (value) return String(value)
  }
  return record.id.slice(0, 8)
}

export function patientOf(current: SampleState, patientId: string | undefined) {
  return patientId ? current.patients.find(patient => patient.id === patientId) : undefined
}

/** "Name · Health ID" for the patient picker and the record line. */
export function patientLabel(patient: SamplePatient) {
  return `${patient.name} · ${patient.healthId}`
}

/** The records a workspace's list shows, in the order they were made. */
export function listedRecords(current: SampleState, definition: SampleDefinition): SampleRecord[] {
  const also = definition.alsoLists ?? []
  return current.records.filter(record => record.workspace === definition.id || also.includes(record.workspace))
}

export function findListed(current: SampleState, definition: SampleDefinition, recordId: string | undefined) {
  return recordId ? listedRecords(current, definition).find(record => record.id === recordId) : undefined
}

/** "Patient / context": the patient's name, or the record's own title when it has no patient. */
export function contextName(current: SampleState, record: SampleRecord) {
  return patientOf(current, record.patientId)?.name ?? recordName(record)
}

/** The design's search: any saved value, the patient's name or MRN. */
export function matchesSearch(current: SampleState, record: SampleRecord, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const patient = patientOf(current, record.patientId)
  const haystack = `${JSON.stringify(record.data)} ${patient?.name ?? ''} ${patient?.mrn ?? ''}`.toLowerCase()
  return haystack.includes(needle)
}

/** A saved value as the design's detail list prints it: linked records by their title, lists joined, Yes / No. */
export function displayValue(current: SampleState, value: SampleValue | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value !== 'string') return value.join(', ')
  const linked = current.records.find(record => record.id === value)
  if (linked) return recordName(linked)
  const patient = current.patients.find(person => person.id === value)
  if (patient) return patient.name
  const encounter = current.encounters.find(item => item.id === value)
  if (encounter) return encounter.id.slice(0, 8)
  return value
}

export function displayItems(current: SampleState, data: SampleData): KeyValue[] {
  return Object.entries(data).map(([key, value]) => ({ label: keyLabel(key), value: displayValue(current, value) }))
}

/** A record picker's choices: "{title} · {status} · {id start}", the patient's own records (or ones with none). */
export function refChoices(current: SampleState, kind: SampleRefKind, patientId: string | undefined) {
  if (kind === 'patient') return current.patients.map(patient => ({ value: patient.id, label: `${patient.name} · active · ${patient.id.slice(0, 6)}` }))
  if (kind === 'encounter') {
    return current.encounters
      .filter(encounter => !patientId || encounter.patientId === patientId)
      .map(encounter => ({ value: encounter.id, label: `${encounter.id.slice(0, 8)} · ${encounter.status} · ${encounter.id.slice(0, 6)}` }))
  }
  const workspaces = REF_WORKSPACES[kind]
  return current.records
    .filter(record => workspaces.includes(record.workspace) && (!patientId || !record.patientId || record.patientId === patientId))
    .map(record => ({ value: record.id, label: `${recordName(record)} · ${record.status} · ${record.id.slice(0, 6)}` }))
}

export interface HistoryEntry {
  readonly workspace: SampleDefinition
  readonly record: SampleRecord
}

/**
 * "Connected hospital history": the same patient's records in the other sample workspaces, in the design's module
 * order. A visit lists only the records started from it.
 */
export function historyFor(current: SampleState, definition: SampleDefinition, record: SampleRecord): HistoryEntry[] {
  if (!record.patientId) return []
  const entries: HistoryEntry[] = []
  for (const id of HISTORY_ORDER) {
    const other = sampleDefinition(id)
    if (!other || other.id === definition.id) continue
    for (const item of listedRecords(current, other)) {
      if (item.patientId !== record.patientId) continue
      if (definition.historyFromRecord && item.parentId !== record.id) continue
      entries.push({ workspace: other, record: item })
    }
  }
  return entries
}

/** The confirmation an action asks for: none, a plain "{label}?" or one with a typed word. */
export function confirmationFor(actionId: string): { readonly word?: string } | null {
  if (!(CONFIRMED_ACTIONS as readonly string[]).includes(actionId)) return null
  return (TYPED_WORD_ACTIONS as readonly string[]).includes(actionId) ? { word: actionId.toUpperCase() } : {}
}

// ---- Hand-offs ----------------------------------------------------------------

export function setSampleHandoff(handoff: SampleHandoff, from: SampleRecord) {
  const values: Record<string, SampleValue> = {}
  if (handoff.carry) values[handoff.carry] = from.id
  commit({ ...state, handoff: { workspace: handoff.workspace, patientId: from.patientId, values } })
}

export function pendingHandoff(workspace: string): PendingHandoff | null {
  return state.handoff?.workspace === workspace ? state.handoff : null
}

export function clearSampleHandoff() {
  if (state.handoff) commit({ ...state, handoff: null })
}

// ---- Changes ------------------------------------------------------------------

const BOOKING_LENGTH = 30 * 60 * 1000

/** The design's booking checks (appointments create and reschedule). */
function checkBooking(current: SampleState, starts: SampleValue | undefined, clinician: SampleValue | undefined, exceptId?: string) {
  const at = typeof starts === 'string' ? Date.parse(starts) : Number.NaN
  if (Number.isNaN(at)) return 'Choose a valid appointment time.'
  if (!SAMPLE_CLINICIANS.some(choice => choice.value === clinician)) return 'Choose an active clinician membership ID from Staff.'
  const clash = current.records.some(record => record.workspace === 'appointments' && record.id !== exceptId && record.status === 'booked'
    && record.data.clinician === clinician && typeof record.data.starts === 'string' && Math.abs(Date.parse(record.data.starts) - at) < BOOKING_LENGTH)
  return clash ? 'Clinician already has an overlapping 30-minute appointment.' : null
}

/** A new record: the design's create, with its checks. */
export function createSampleRecord(workspace: string, patientId: string | undefined, values: SampleData): SampleOutcome {
  const definition = sampleDefinition(workspace)
  if (!definition) return { error: 'This sample workspace does not exist.' }
  if (definition.patient && !patientOf(state, patientId)) return { error: 'Select registered patient' }
  if (workspace === 'appointments') {
    const problem = checkBooking(state, values.starts, values.clinician)
    if (problem) return { error: problem }
  }
  if (workspace === 'radiology') {
    const encounter = state.encounters.find(item => item.id === values.encounter)
    if (!encounter || encounter.status !== 'signed') return { error: 'Sign the encounter before issuing clinical orders.' }
  }
  const at = now()
  const created: SampleRecord = {
    id: newId(), workspace, patientId: definition.patient ? patientId : undefined, status: definition.initial,
    createdAt: at, updatedAt: at, data: { ...values }, versions: [],
  }
  commit({ ...state, records: [...state.records, created] })
  return { id: created.id }
}

const OCCUPIED = 'Bed is occupied, awaiting cleaning or in maintenance.'

function withoutKey(data: SampleData, key: string): SampleData {
  const next = { ...data }
  delete next[key]
  return next
}

/** An action on a record: the design's state change, its version and its side effects. */
export function applySampleAction(workspace: string, recordId: string, actionId: string, values: SampleData): SampleOutcome {
  const definition = sampleDefinition(workspace)
  const record = definition ? findListed(state, definition, recordId) : undefined
  const action = definition?.actions.find(item => item.id === actionId)
  if (!definition || !record || !action) return { error: 'The record is missing or outside your authorized hospital / branch.' }
  if (!action.from.includes(record.status)) return { error: 'This action is no longer available for the current record state.' }

  for (const field of action.fields ?? []) {
    if (!field.ref) continue
    const linked = state.records.find(item => item.id === values[field.key])
    if (linked?.patientId && record.patientId && linked.patientId !== record.patientId) return { error: 'Linked action record belongs to another patient.' }
  }

  let records = [...state.records]
  let patients = state.patients
  const at = now()
  const touch = (id: string, change: (item: SampleRecord) => SampleRecord) => {
    records = records.map(item => (item.id === id ? { ...change(item), updatedAt: at } : item))
  }
  let data: SampleData = { ...record.data, ...values }

  if (definition.id === 'appointments' && action.id === 'reschedule') {
    const problem = checkBooking(state, values.starts, record.data.clinician, record.id)
    if (problem) return { error: problem }
  }
  if (definition.id === 'appointments' && action.id === 'checkin') {
    if (records.some(item => item.workspace === 'journey' && item.parentId === record.id)) return { error: 'Already checked in.' }
    const visit: SampleRecord = {
      id: newId(), workspace: 'journey', patientId: record.patientId, parentId: record.id, status: 'waiting',
      createdAt: at, updatedAt: at, data: { ...record.data, complaint: record.data.reason ?? '' }, versions: [],
    }
    records.push(visit)
  }
  if ((action.id === 'admit' || action.id === 'transfer') && (definition.id === 'inpatient' || definition.id === 'icu')) {
    const bed = records.find(item => item.id === values.bed && item.workspace === 'wards')
    if (!bed || bed.status !== 'available') return { error: OCCUPIED }
    const previous = typeof record.data.bed === 'string' ? record.data.bed : undefined
    if (action.id === 'transfer' && previous && previous !== bed.id) touch(previous, item => ({ ...item, status: 'cleaning', data: withoutKey(item.data, 'admission') }))
    touch(bed.id, item => ({ ...item, status: 'occupied', data: { ...item.data, admission: record.id } }))
  }
  if (action.id === 'discharge' && typeof record.data.bed === 'string') {
    touch(record.data.bed, item => ({ ...item, status: 'cleaning', data: withoutKey(item.data, 'admission') }))
  }
  if (definition.id === 'maternity' && action.id === 'delivery' && typeof values.newborn === 'string' && values.newborn) {
    const newborn: SamplePatient = {
      id: newId(), name: values.newborn, healthId: `LOCAL-${newId().slice(0, 8)}`,
      mrn: `MRN-${String(state.patients.length + 1).padStart(6, '0')}`, provisional: true,
    }
    patients = [...patients, newborn]
    data = { ...data, newbornId: newborn.id }
  }
  if (definition.id === 'bloodbank' && (action.id === 'reserve' || action.id === 'issue')) {
    const expiry = typeof record.data.expiry === 'string' ? Date.parse(record.data.expiry) : Number.NaN
    if (!Number.isNaN(expiry) && expiry < Date.now()) return { error: 'Blood unit expired. Dispose it.' }
  }
  if (action.id === 'publish') data = { ...data, publishedAt: at }

  const reason = typeof values.reason === 'string' && values.reason ? values.reason : action.label
  touch(record.id, item => ({
    ...item,
    status: action.to,
    data,
    versions: [...item.versions, { at, author: SAMPLE_USER, reason, status: item.status, data: item.data }],
  }))
  commit({ ...state, records, patients })
  return { id: record.id }
}
