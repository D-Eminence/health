import type { LabAccession, LabExecution, LabResult, LabWorkItem } from '../../../staff/api'
import { patientLabel } from '../parts/routedWork'

/*
 * Where a lab request is, in the lab's own words, mapped in this one place from what Lab sends: the work item (its
 * accession, its samples' statuses) and, once the backend sends them on the work item (docs/POINT_OF_CARE_SPEC.md §4),
 * the statuses of its tests and results. The record page maps the same way from the accession it reads.
 *
 *   Waiting for sample  no accession yet, or its sample still to be taken (required; rejected: take another)
 *   Testing             sample taken (collected: receive it), received (start the test) or a test running
 *   Enter results       a test finished and has no result yet
 *   Check & release     a result entered (to verify) or verified (to release)
 *   Done                every result released (or Lab says the work is completed)
 */

export type LabStage = 'collect' | 'testing' | 'enter' | 'check' | 'done'
export const STAGES: readonly LabStage[] = ['collect', 'testing', 'enter', 'check', 'done']
export const STAGE_LABEL: Readonly<Record<LabStage, string>> = {
  collect: 'Waiting for sample', testing: 'Testing', enter: 'Enter results', check: 'Check & release', done: 'Done',
}

/** A walk-in's basics (§4): enough to label the sample, read results against the right ranges and send them by SMS. */
export interface WalkInBasics {
  readonly name: string
  readonly ageYears: number
  readonly sex: 'female' | 'male'
  readonly phone: string
  readonly healthId?: string | null
  readonly clinicalNote?: string | null
}

/**
 * What a lab work item may carry beyond today's fields (proposed, §4): the walk-in's basics, the request it belongs to
 * (several tests asked for together), and the statuses of its tests and results so the work list can say the stage.
 */
interface LabRequestFields {
  readonly walkIn?: WalkInBasics | null
  readonly request?: { readonly id: string; readonly number: string } | null
  readonly executionStatuses?: readonly LabExecution['status'][]
  readonly resultStatuses?: readonly LabResult['status'][]
  readonly releasedAt?: string | null
}
const fields = (item: object) => item as LabRequestFields

export const walkInOf = (item: LabWorkItem): WalkInBasics | null => fields(item).walkIn ?? null
export const requestOf = (item: LabWorkItem) => fields(item).request ?? null
export const releasedAtOf = (item: LabWorkItem) => fields(item).releasedAt ?? null

/** The facts a stage is decided from. */
export interface StageFacts {
  readonly accessioned: boolean
  readonly specimens: readonly string[]
  readonly executions: readonly LabExecution['status'][]
  readonly results: readonly LabResult['status'][]
  /** Lab's own status of the work item, when there is one. */
  readonly status?: string
}

const FINISHED_WORK: ReadonlySet<string> = new Set(['completed', 'resulted', 'released', 'reported'])

/** The stage, from the facts. Checked in this order so the most urgent unfinished step wins. */
export function stageFrom(facts: StageFacts): LabStage {
  const results = facts.results.filter(status => status !== 'entered_in_error')
  if (results.some(status => status === 'entered_unverified' || status === 'verified_not_released')) return 'check'
  if (facts.executions.filter(status => status === 'completed').length > results.length) return 'enter'
  if (facts.executions.includes('in_progress')) return 'testing'
  if (results.length > 0 && results.every(status => status === 'released')) return 'done'
  if (facts.status && FINISHED_WORK.has(facts.status.toLowerCase())) return 'done'
  if (!facts.accessioned) return 'collect'
  if (facts.specimens.some(status => status === 'collected' || status === 'received')) return 'testing'
  return 'collect'
}

/** A work item's facts, as the work list reads it. */
export function factsOfItem(item: LabWorkItem): StageFacts {
  return {
    accessioned: Boolean(item.accessionId), specimens: item.specimenStatuses ?? [],
    executions: fields(item).executionStatuses ?? [], results: fields(item).resultStatuses ?? [], status: item.status,
  }
}

export const stageOf = (item: LabWorkItem): LabStage => stageFrom(factsOfItem(item))

/** An accession's facts, as the record page reads it: its samples and each received sample's tests and results. */
export function factsOfRecord(accession: LabAccession | null, executions: readonly LabExecution[], status?: string): StageFacts {
  return {
    accessioned: accession !== null, specimens: accession?.specimens.map(specimen => specimen.status) ?? [],
    executions: executions.map(execution => execution.status),
    results: executions.flatMap(execution => execution.result ? [execution.result.status] : []), status,
  }
}

/** The one next thing to do at this stage, in a word or two: the card's button. */
export function nextAction(stage: LabStage, facts: StageFacts, paymentFirst: boolean): string {
  switch (stage) {
    case 'collect': return paymentFirst ? 'Take payment' : 'Collect sample'
    case 'testing':
      if (facts.executions.includes('in_progress')) return 'Finish test'
      if (facts.specimens.includes('collected')) return 'Receive sample'
      return 'Start test'
    case 'enter': return 'Enter results'
    case 'check': return 'Check & release'
    case 'done': return 'Give result'
  }
}

// ------------------------------------------------------------------ person --
/** Who the request is for, as every lab screen shows it. */
export interface LabPerson {
  readonly name: string
  /** "34 y", from the walk-in's age or the date of birth. */
  readonly age: string | null
  readonly sex: string | null
  readonly phone: string | null
  readonly dateOfBirth: string | null
  readonly healthId: string | null
  /** The Health ID line: the Health ID, "ending 1234", or that there is none. */
  readonly hidText: string
}

function yearsSince(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null
  const born = new Date(dateOfBirth)
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) age -= 1
  return age
}

const sexWord = (sex: string | null | undefined) => sex ? sex.replace(/^./, letter => letter.toUpperCase()) : null

export function personOf(item: LabWorkItem): LabPerson {
  const walkIn = walkInOf(item)
  if (walkIn) return {
    name: walkIn.name, age: `${walkIn.ageYears} y`, sex: sexWord(walkIn.sex), phone: walkIn.phone, dateOfBirth: null,
    healthId: walkIn.healthId ?? null, hidText: walkIn.healthId ? walkIn.healthId : 'No Health ID',
  }
  const patient = item.patient
  const years = yearsSince(patient?.dateOfBirth)
  return {
    name: patient?.fullName ?? patientLabel(item), age: years === null ? null : `${years} y`, sex: sexWord(patient?.sex), phone: null,
    dateOfBirth: patient?.dateOfBirth ?? null, healthId: null,
    hidText: patient?.healthIdLast4 ? `Health ID ending ${patient.healthIdLast4}` : 'Health ID not sent',
  }
}

/** "34 y · Female", or null when neither is known. */
export function ageSex(person: LabPerson): string | null {
  return [person.age, person.sex].filter(Boolean).join(' · ') || null
}

/** How long the request has waited since it was accepted: "12 min", "2 h 5 min", "3 days". */
export function waitedText(acceptedAt: string | null | undefined, now = Date.now()): string | null {
  if (!acceptedAt) return null
  const at = Date.parse(acceptedAt)
  if (Number.isNaN(at)) return null
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  const days = Math.floor(minutes / (24 * 60))
  return `${days} day${days === 1 ? '' : 's'}`
}

/** Stat and urgent first, then the longest waiting. */
export function byUrgencyThenWait<T>(items: readonly T[], priorityOf: (item: T) => string | null | undefined, acceptedOf: (item: T) => string | null | undefined): T[] {
  const rank = (item: T) => ({ stat: 0, asap: 1, urgent: 2 } as Record<string, number>)[(priorityOf(item) ?? '').toLowerCase()] ?? 3
  const time = (item: T) => { const at = Date.parse(acceptedOf(item) ?? ''); return Number.isNaN(at) ? Infinity : at }
  return [...items].sort((a, b) => rank(a) - rank(b) || time(a) - time(b))
}
