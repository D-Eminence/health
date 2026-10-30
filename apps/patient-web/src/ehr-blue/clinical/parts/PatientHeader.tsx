import type { ActivePatient } from '../../../staff/App'
import { ageInYears, formatDate } from './format'
import { StatusBadge } from './StatusBadge'

export interface PatientFacts {
  readonly name: string
  readonly hid: string
  readonly dateOfBirth?: string
  readonly sex?: string
}

/** The facts an allowed lookup carries. The name falls back to the Health ID, as today's chart does. */
export function patientFacts(patient: ActivePatient): PatientFacts {
  const summary = patient.lookup.patient
  const joined = [summary.firstName, summary.lastName].filter(Boolean).join(' ')
  return {
    name: summary.fullName?.trim() || joined || patient.hid,
    hid: summary.hid || patient.hid,
    dateOfBirth: summary.dateOfBirth,
    sex: summary.gender,
  }
}

/** "Taylor Fiction · HID-…", the design's patient line on a record. */
export function patientLine(facts: PatientFacts): string {
  return facts.name === facts.hid ? facts.hid : `${facts.name} · ${facts.hid}`
}

function sexLabel(value: string | undefined) {
  if (!value) return undefined
  const text = value.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The patient header on every chart page: name, Health ID, age, sex and flags (such as "Emergency access" or
 * "Read only"), in the design's meta-row style. Facts the lookup does not carry read "Not recorded".
 */
export function PatientHeader({ facts, flags = [] }: { facts: PatientFacts; flags?: readonly string[] }) {
  const age = ageInYears(facts.dateOfBirth)
  const born = formatDate(facts.dateOfBirth)
  return (
    <section className="hid-ehr-clinical-patient" aria-label="Patient">
      <h2 className="hid-ehr-clinical-patient-name">{facts.name}</h2>
      <ul className="hid-ehr-clinical-patient-facts">
        <li><span className="hid-ehr-clinical-patient-fact-label">Health ID </span>{facts.hid}</li>
        <li><span className="hid-ehr-clinical-patient-fact-label">Age </span>{age === null ? 'Not recorded' : `${age} years${born ? ` (born ${born})` : ''}`}</li>
        <li><span className="hid-ehr-clinical-patient-fact-label">Sex </span>{sexLabel(facts.sex) ?? 'Not recorded'}</li>
      </ul>
      {flags.length > 0 ? (
        <div className="hid-ehr-clinical-patient-flags" aria-label="Flags" role="group">
          {flags.map(flag => <StatusBadge key={flag} status={flag} />)}
        </div>
      ) : null}
    </section>
  )
}
