import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ClinicalRecord, LabAbnormalFlag, LabResultRevision } from '../../../staff/api'
import { routeLabel } from '../../../plainLabels'
import { ageInYears, formatDate, formatWhen } from './format'
import type { PatientFacts } from './PatientHeader'
import './clinicalPrint.css'

/*
 * Printing clinical paper from the consultation: a prescription, a discharge summary and a lab result. Each is built
 * only from what the page already read; nothing is fetched to print. The paper is put on the page only while it
 * prints, straight under <body> so it is in normal flow and its named page size applies (clinicalPrint.css hides it on
 * screen and prints it alone); window.print runs in the commit that shows it, and the paper goes once the print dialog
 * closes. Where the record holds nothing for a line (the prescriber's licence,
 * follow-up), the paper leaves a line to write on by hand rather than inventing it.
 */

export type PaperKind = 'prescription' | 'discharge' | 'lab-result'

export function usePaperPrint() {
  const [paper, setPaper] = useState<{ kind: PaperKind; node: ReactNode; round: number } | null>(null)
  useLayoutEffect(() => {
    if (!paper) return
    const done = () => setPaper(current => current?.round === paper.round ? null : current)
    window.addEventListener('afterprint', done, { once: true })
    try { window.print() } catch { done() }
    return () => window.removeEventListener('afterprint', done)
  }, [paper])
  const print = useCallback((kind: PaperKind, node: ReactNode) => setPaper(current => ({ kind, node, round: (current?.round ?? 0) + 1 })), [])
  const area = paper && typeof document !== 'undefined'
    ? createPortal(<div data-clinical-print={paper.kind} aria-hidden="true">{paper.node}</div>, document.body)
    : null
  return { print, area }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

/** Who the paper is about: name, age and sex, Health ID. */
export interface PaperPatient {
  readonly name: string
  readonly hid: string
  readonly ageSex: string | null
}

const SEX_WORDS: Readonly<Record<string, string>> = { male: 'Male', female: 'Female', m: 'Male', f: 'Female' }

export function paperPatient(facts: PatientFacts, today = new Date()): PaperPatient {
  const age = ageInYears(facts.dateOfBirth, today)
  const sex = SEX_WORDS[(facts.sex ?? '').trim().toLowerCase()] ?? null
  const ageSex = [age === null ? null : `${age} years`, sex].filter(Boolean).join(' · ')
  return { name: facts.name, hid: facts.hid, ageSex: ageSex || null }
}

/** One medicine as the paper writes it. */
export interface DrugLine {
  readonly key: string
  readonly medicine: string
  readonly dose: string
  readonly route: string
  readonly frequency: string
  readonly duration: string
  readonly instructions: string
}

/** "7 days (12 Nov 2026 to 18 Nov 2026)", "Until 18 Nov 2026", "From 12 Nov 2026", or '' when neither date is set. */
export function durationText(startsOn: unknown, endsOn: unknown): string {
  const start = formatDate(text(startsOn))
  const end = formatDate(text(endsOn))
  if (start && end) {
    const days = Math.round((Date.parse(`${text(endsOn).slice(0, 10)}T00:00:00Z`) - Date.parse(`${text(startsOn).slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1
    return days >= 1 ? `${days} ${days === 1 ? 'day' : 'days'} (${start} to ${end})` : `${start} to ${end}`
  }
  if (end) return `Until ${end}`
  if (start) return `From ${start}`
  return ''
}

/** The dose with its unit, a decimal with its leading zero: "0.5 mg". */
export function doseText(quantity: unknown, unit: unknown): string {
  const amount = text(quantity).replace(/^\./, '0.')
  return amount ? [amount, text(unit)].filter(Boolean).join(' ') : ''
}

/** How the medicine is taken, in plain words where there are some ("By mouth"), else as the prescriber wrote it. */
export function routeText(code: unknown): string {
  const written = text(code)
  const plain = routeLabel(written)
  return plain ? plain.charAt(0).toUpperCase() + plain.slice(1) : written
}

export function drugLine(record: ClinicalRecord): DrugLine {
  return {
    key: record.id,
    medicine: text(record.medicationDisplay) || 'Medicine not named',
    dose: doseText(record.doseQuantity, record.doseUnit),
    route: routeText(record.routeCode),
    frequency: text(record.frequency),
    duration: durationText(record.startsOn, record.endsOn),
    instructions: text(record.instructions),
  }
}

/**
 * Only an active prescription prints as a prescription. A draft was never activated or checked, one on hold was held
 * for a reason, and a completed, cancelled or entered-in-error one is over: once signed by hand, paper for any of them
 * could be dispensed anywhere, past the activation the Pharmacy hand-off checks.
 */
const PRINTED_STATUSES: ReadonlySet<string> = new Set(['active'])

export function isPrintable(record: ClinicalRecord): boolean {
  return PRINTED_STATUSES.has(text(record.status))
}

export function printableDrugs(records: readonly ClinicalRecord[] | null | undefined): DrugLine[] {
  return (records ?? []).filter(isPrintable).map(drugLine)
}

/** Held medicines, listed apart on the discharge summary so nobody takes them as ones to continue. */
export function heldDrugs(records: readonly ClinicalRecord[] | null | undefined): DrugLine[] {
  return (records ?? []).filter(record => text(record.status) === 'on_hold').map(drugLine)
}

/** Lab requests the discharge summary lists as requested: any not cancelled or entered in error. */
const TEST_NOT_LISTED: ReadonlySet<string> = new Set(['cancelled', 'entered_in_error', 'revoked'])

export function isListedTest(record: ClinicalRecord): boolean {
  return !TEST_NOT_LISTED.has(text(record.status))
}

interface MembershipAt {
  readonly id: string
  readonly membershipId?: unknown
}

/**
 * The signed-in member as the paper reads them: the staff session's actor (staff/api.ts Actor). EHR writes a record's
 * createdBy as its author's account id and createdByMembershipId as their membership at the facility it was written
 * at (hid-system ehr-api: context.actor.accountId, context.membershipId). The actor's `id` is the sign-in subject
 * ("staff-invitation:<account id>", say), never the account id, so it is never compared. Identity sends `accountId`
 * on every staff session (current-staff-context), though the Actor type does not name it, so it is read as unknown.
 */
export interface PrintingMember {
  readonly displayName?: string
  readonly accountId?: unknown
  readonly facility?: MembershipAt
  readonly facilities?: readonly MembershipAt[]
}

/**
 * Whether the signed-in member wrote a record: by account when the session carries one; else by their membership at
 * the chart's facility (where the chart's records were written), when the record carries one. Neither known: no.
 */
function writtenBy(actor: PrintingMember, facilityId: string): (record: ClinicalRecord) => boolean {
  const accountId = text(actor.accountId)
  if (accountId) return record => text(record.createdBy) === accountId
  const membership = facilityId ? [actor.facility, ...(actor.facilities ?? [])].find(facility => facility?.id === facilityId) : undefined
  const membershipId = text(membership?.membershipId)
  if (membershipId) return record => text(record.createdByMembershipId) === membershipId
  return () => false
}

/** The signed-in member's name, only when they wrote every one of the records; else null, a line to write by hand. */
function authorName(records: readonly ClinicalRecord[], actor: PrintingMember | null | undefined, facilityId: string): string | null {
  const name = actor?.displayName?.trim()
  if (!actor || !name || records.length === 0) return null
  return records.every(writtenBy(actor, facilityId)) ? name : null
}

/**
 * The clinician's name on the discharge summary, only when the signed-in member wrote the consultation note; anyone
 * else printing it (a nurse, records) leaves the line to be written by hand. `facilityId` is the chart's.
 */
export function clinicianName(note: ClinicalRecord | null | undefined, actor: PrintingMember | null | undefined, facilityId: string): string | null {
  return note ? authorName([note], actor, facilityId) : null
}

/**
 * The prescriber's name, when the paper can say it truthfully: the signed-in member wrote every printed record.
 * When anyone else wrote one, the name is left for the prescriber to write. `facilityId` is the chart's.
 */
export function prescriberName(records: readonly ClinicalRecord[], actor: PrintingMember | null | undefined, facilityId: string): string | null {
  return authorName(records, actor, facilityId)
}

function PaperHead({ facility, kind, printedAt }: { readonly facility: string; readonly kind: string; readonly printedAt: string }) {
  return (
    <div className="hid-clinical-paper-head">
      <div>
        <p className="hid-clinical-paper-facility">{facility}</p>
        <p className="hid-clinical-paper-kind">{kind}</p>
      </div>
      <p className="hid-clinical-paper-caption">Date: {printedAt}</p>
    </div>
  )
}

function PatientBlock({ patient, extra = [] }: { readonly patient: PaperPatient; readonly extra?: ReadonlyArray<readonly [string, string]> }) {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Patient', patient.name],
    ['Health ID', patient.hid],
    ...(patient.ageSex ? [['Age and sex', patient.ageSex] as const] : []),
    ...extra.filter(([, value]) => value),
  ]
  return (
    <dl className="hid-clinical-paper-patient">
      {rows.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  )
}

/** The prescriber's name (or a line to write it), licence number and signature lines. */
function SignBlock({ who, name }: { readonly who: string; readonly name: string | null }) {
  return (
    <div className="hid-clinical-paper-sign">
      <div>
        <div className="hid-clinical-paper-line">{name ?? ''}</div>
        <p className="hid-clinical-paper-caption">{who}’s name</p>
      </div>
      <div>
        <div className="hid-clinical-paper-line" />
        <p className="hid-clinical-paper-caption">Licence number</p>
      </div>
      <div>
        <div className="hid-clinical-paper-line" />
        <p className="hid-clinical-paper-caption">Signature</p>
      </div>
      <div>
        <div className="hid-clinical-paper-line" />
        <p className="hid-clinical-paper-caption">Date signed</p>
      </div>
    </div>
  )
}

function DrugList({ drugs }: { readonly drugs: readonly DrugLine[] }) {
  return (
    <ol>
      {drugs.map(drug => (
        <li key={drug.key}>
          <p className="hid-clinical-paper-drug">{drug.medicine}{drug.dose ? ` ${drug.dose}` : ''}</p>
          <p>{[drug.route, drug.frequency, drug.duration ? `for ${drug.duration}` : ''].filter(Boolean).join(' · ') || 'How to take it is not recorded'}</p>
          {drug.instructions ? <p>{drug.instructions}</p> : null}
        </li>
      ))}
    </ol>
  )
}

const FOOT = 'Printed from Health ID. Check this paper against the patient’s record before acting on it.'

const MORE_PRESCRIPTIONS = 'This visit has more prescriptions on later pages of the record, and they are not on this paper. Check the record.'

export function PrescriptionPaper({ facility, patient, drugs, prescriber, printedAt, more = false }: {
  readonly facility: string
  readonly patient: PaperPatient
  readonly drugs: readonly DrugLine[]
  readonly prescriber: string | null
  readonly printedAt: string
  /** The visit holds more prescriptions than the page read. */
  readonly more?: boolean
}) {
  return (
    <div className="hid-clinical-paper" data-paper="prescription">
      <PaperHead facility={facility} kind="Prescription" printedAt={printedAt} />
      <PatientBlock patient={patient} />
      <section>
        <h2>Rx</h2>
        {drugs.length > 0 ? <DrugList drugs={drugs} /> : <p>No medicine to print.</p>}
        {more ? <p className="hid-clinical-paper-caption">{MORE_PRESCRIPTIONS}</p> : null}
      </section>
      <SignBlock who="Prescriber" name={prescriber} />
      <p className="hid-clinical-paper-foot">{FOOT}</p>
    </div>
  )
}

/**
 * One part of the record as the page holds it. "shown" is what was read (and whether the record holds more than
 * that); otherwise the part was not read, and the paper says why rather than saying there is none.
 */
export type Section<T> =
  | { readonly state: 'shown'; readonly value: T; readonly more?: boolean }
  | { readonly state: 'no-right' | 'loading' | 'failed' | 'later-page' }

export function shown<T>(value: T, more = false): Section<T> {
  return { state: 'shown', value, more }
}

const NOT_SHOWN: Readonly<Record<Exclude<Section<unknown>['state'], 'shown'>, string>> = {
  'no-right': 'Not available to you. Check the patient’s record.',
  loading: 'Still loading when this was printed. Check the patient’s record.',
  failed: 'Could not be loaded. Check the patient’s record.',
  'later-page': 'On a later page of the record, not on this paper. Check the patient’s record.',
}

const MORE_ON_LATER_PAGES = 'More are on later pages of the record and are not on this paper. Check the record.'

/** What a discharge summary is built from: the consultation as the page has read it. */
export interface DischargeSummary {
  readonly facility: string
  readonly patient: PaperPatient
  readonly visitType: string
  readonly startedAt: string
  readonly status: string
  readonly complaint: string
  readonly diagnoses: Section<readonly string[]>
  /** The consultation note's latest content and whether it is signed, or null when the visit has none. */
  readonly note: Section<{ readonly content: string; readonly signed: boolean } | null>
  readonly tests: Section<readonly string[]>
  /** Active prescriptions: the medicines to continue. */
  readonly drugs: Section<readonly DrugLine[]>
  /** Prescriptions on hold, listed apart. */
  readonly held: readonly DrugLine[]
  readonly clinician: string | null
  readonly printedAt: string
}

/** A section's body: what it holds, what to say when it holds nothing, or why it was not read. */
function SectionBody<T>({ section, empty, children }: {
  readonly section: Section<T>
  readonly empty: (value: T) => boolean
  readonly children: (value: T) => ReactNode
}) {
  if (section.state !== 'shown') return <p>{NOT_SHOWN[section.state]}</p>
  return <>
    {empty(section.value) ? null : children(section.value)}
    {section.more ? <p className="hid-clinical-paper-caption">{MORE_ON_LATER_PAGES}</p> : null}
  </>
}

function Lines({ count }: { readonly count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div key={index} className="hid-clinical-paper-line" />)}</>
}

export function DischargeSummaryPaper({ summary }: { readonly summary: DischargeSummary }) {
  return (
    <div className="hid-clinical-paper" data-paper="discharge">
      <PaperHead facility={summary.facility} kind="Discharge summary" printedAt={summary.printedAt} />
      <PatientBlock patient={summary.patient} extra={[
        ['Visit', summary.visitType], ['Seen', formatWhen(summary.startedAt)], ['Visit status', summary.status],
      ]} />
      <section>
        <h2>Reason for visit</h2>
        <p>{summary.complaint || 'Not recorded'}</p>
      </section>
      <section>
        <h2>Diagnoses</h2>
        <SectionBody section={summary.diagnoses} empty={() => false}>
          {items => items.length > 0 ? <ul>{items.map(item => <li key={item}>{item}</li>)}</ul> : <p>None recorded</p>}
        </SectionBody>
      </section>
      <section>
        <h2>Clinical summary</h2>
        <SectionBody section={summary.note} empty={() => false}>
          {note => note
            ? <>
              {note.signed ? null : <p className="hid-clinical-paper-caption">This note is a draft and has not been signed.</p>}
              <p className="hid-clinical-paper-note">{note.content}</p>
            </>
            : <p>No consultation note recorded</p>}
        </SectionBody>
      </section>
      {summary.tests.state === 'shown' && summary.tests.value.length === 0 && !summary.tests.more ? null : (
        <section>
          <h2>Tests requested</h2>
          <SectionBody section={summary.tests} empty={items => items.length === 0}>
            {items => <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>}
          </SectionBody>
        </section>
      )}
      <section>
        <h2>Medicines on discharge</h2>
        <SectionBody section={summary.drugs} empty={() => false}>
          {drugs => drugs.length > 0 ? <DrugList drugs={drugs} /> : <p>None active at this visit</p>}
        </SectionBody>
      </section>
      {summary.drugs.state === 'shown' && summary.held.length > 0 ? (
        <section>
          <h2>Medicines on hold</h2>
          <p className="hid-clinical-paper-caption">Held at this visit: not to be taken unless a clinician says so.</p>
          <DrugList drugs={summary.held} />
        </section>
      ) : null}
      <section>
        <h2>Follow-up</h2>
        <Lines count={3} />
      </section>
      <SignBlock who="Clinician" name={summary.clinician} />
      <p className="hid-clinical-paper-foot">{FOOT}</p>
    </div>
  )
}

/** One released result on the lab result paper. */
export interface LabPaperLine {
  readonly key: string
  readonly value: string
  readonly range: string
  readonly flag: string
  readonly released: string
}

/** A flag worth calling out on paper; normal and not set print nothing. */
const FLAG_WORDS: Readonly<Partial<Record<LabAbnormalFlag, string>>> = {
  high: 'High', low: 'Low', abnormal: 'Abnormal', critical_candidate: 'Possibly critical',
}

/** The latest released revision of each result that is not entered in error. */
export function labPaperLines(results: ReadonlyArray<{ readonly id: string; readonly status: string; readonly revisions: readonly LabResultRevision[] }>): LabPaperLine[] {
  return results.flatMap(result => {
    if (result.status === 'entered_in_error') return []
    const revision = [...result.revisions].reverse().find(item => item.releaseStatus === 'released' && item.verificationStatus !== 'entered_in_error')
    if (!revision) return []
    const value = revision.resultType === 'numeric'
      ? revision.numericValue == null ? 'Not recorded' : [String(revision.numericValue), revision.unit ?? ''].filter(Boolean).join(' ')
      : revision.textValue ?? 'Not recorded'
    return [{
      key: result.id, value, range: revision.referenceRange ?? '', flag: FLAG_WORDS[revision.abnormalFlag] ?? '',
      released: formatWhen(revision.releasedAt ?? null),
    }]
  })
}

export function LabResultPaper({ facility, patient, test, lines, printedAt }: {
  readonly facility: string
  readonly patient: PaperPatient
  readonly test: string
  readonly lines: readonly LabPaperLine[]
  readonly printedAt: string
}) {
  return (
    <div className="hid-clinical-paper" data-paper="lab-result">
      <PaperHead facility={facility} kind="Laboratory result" printedAt={printedAt} />
      <PatientBlock patient={patient} extra={[['Test', test]]} />
      <section>
        <table>
          <thead><tr><th>Result</th><th>Normal range</th><th>Flag</th><th>Released</th></tr></thead>
          <tbody>{lines.map(line => (
            <tr key={line.key}><td><strong>{line.value}</strong></td><td>{line.range}</td><td>{line.flag}</td><td>{line.released}</td></tr>
          ))}</tbody>
        </table>
      </section>
      <SignBlock who="Reviewing clinician" name={null} />
      <p className="hid-clinical-paper-foot">{FOOT}</p>
    </div>
  )
}
