import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DischargeSummaryPrint, WristbandPrint } from '../../../staff/api'
import { formatPhone } from '@hid/ui/display'
import { PrintHeader } from '../../frame/PrintHeader'
import { startPrint, type PrintJob } from '../../../print/printPaper'
import '../../clinical/parts/clinicalPrint.css'
import { CONDITION_WORDS, ninText, outcomeText, sexText, lagosDateTime, dayText } from './inpatientRules'

/*
 * The inpatient papers, printed with the shared print engine (print/printPaper.ts): the signed discharge summary (A4)
 * and the wristband (a band printer's strip; a WebKit browser prints it from a PDF of the slip). Each paper is built only
 * from the answer just read for it, put straight under <body> while it prints (inpatient.css hides it on screen and
 * prints it alone), and taken away once printed: the band's Health ID is never kept in the page after printing, never
 * put in an address or in storage. The paper's title names the facility and what it is, never the patient.
 */

export type InpatientPaper = 'discharge' | 'band'
const PAPERS = {
  discharge: { size: 'A4', kind: 'Discharge summary' },
  band: { size: 'slip', kind: 'Wristband' },
} as const

export function useInpatientPrint() {
  const [paper, setPaper] = useState<{ kind: InpatientPaper; node: ReactNode; round: number; job: PrintJob } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!paper) return
    return paper.job.run(area.current, () => setPaper(current => current?.round === paper.round ? null : current))
  }, [paper])
  /** Starts the print in the click (Safari's PDF tab opens only then); `print` it once the paper is read, or `cancel`. */
  const start = useCallback((kind: InpatientPaper): PrintJob => startPrint(PAPERS[kind]), [])
  const print = useCallback((kind: InpatientPaper, node: ReactNode, job: PrintJob) => {
    setPaper(current => ({ kind, node, round: (current?.round ?? 0) + 1, job }))
  }, [])
  const portal = paper && typeof document !== 'undefined'
    ? createPortal(<div ref={area} data-inpatient-print={paper.kind} aria-hidden="true">{paper.node}</div>, document.body)
    : null
  return { start, print, area: portal }
}

const FOOT = 'Printed from Health ID. Check this paper against the patient’s record before acting on it.'

function Rows({ rows }: { readonly rows: ReadonlyArray<readonly [string, string | null | undefined]> }) {
  return (
    <dl className="hid-clinical-paper-patient">
      {rows.filter(([, value]) => value).map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  )
}

function Section({ title, text }: { readonly title: string; readonly text: string | null | undefined }) {
  if (!text?.trim()) return null
  return <section><h2>{title}</h2><p className="hid-clinical-paper-note">{text}</p></section>
}

/** Route 19's print: the discharge summary as signed, with the Health ID's last 4 characters only. */
export function DischargeSummaryPaper({ print }: { readonly print: DischargeSummaryPrint }) {
  const patient = print.patient
  const born = patient.dateOfBirth ? `${dayText(patient.dateOfBirth)}${patient.dateOfBirthEstimated ? ' (estimated)' : ''}` : ''
  const summary = print.summary ?? {}
  const contact = [print.facility.address, print.facility.phone ? formatPhone(print.facility.phone) : ''].filter(Boolean).join(' · ')
  return (
    <div className="hid-clinical-paper" data-paper="inpatient-discharge">
      <PrintHeader facility={print.facility.name} className="hid-clinical-paper-brand" />
      {contact ? <p className="hid-clinical-paper-caption">{contact}</p> : null}
      <div className="hid-clinical-paper-head">
        <p className="hid-clinical-paper-kind">Discharge summary</p>
        <p className="hid-clinical-paper-caption">Printed: {lagosDateTime(print.printedAt)}</p>
      </div>
      <Rows rows={[
        ['Patient', patient.fullName],
        ['Health ID ending', patient.healthIdLast4],
        ['NIN', ninText(patient.ninStatus)],
        ['Sex', sexText(patient.sex)],
        ['Date of birth', born],
        ['Admission', print.admissionNumber],
        ['Admitted', print.admittedAt ? lagosDateTime(print.admittedAt) : null],
        ['Discharged', print.dischargedAt ? lagosDateTime(print.dischargedAt) : null],
        ['Wards', print.wards.join(', ')],
        ['Responsible doctor', print.responsibleDoctor],
        ['Outcome', outcomeText(print.outcome)],
        ['Referred to', print.referredToFacilityName],
        ['Time of death', print.diedAt ? lagosDateTime(print.diedAt) : null],
        ['Condition at discharge', summary.conditionAtDischarge ? CONDITION_WORDS[summary.conditionAtDischarge] : null],
      ]} />
      <Section title="Presenting problem" text={summary.presentingProblem} />
      <Section title="Course in hospital" text={summary.courseInHospital} />
      <Section title="Procedures done" text={summary.proceduresDone} />
      <section>
        <h2>Diagnoses</h2>
        {print.diagnoses.length > 0 ? <ul>{print.diagnoses.map((item, index) => (
          <li key={`${item.display}-${index}`}>{item.display}{item.code ? ` (${[item.codeSystem, item.code].filter(Boolean).join(' ')})` : ''}</li>
        ))}</ul> : <p>None recorded</p>}
      </section>
      <section>
        <h2>Medicines on discharge</h2>
        {print.medicinesOnDischarge.length > 0 ? <ol>{print.medicinesOnDischarge.map(item => (
          <li key={item.prescriptionId}>
            <p className="hid-clinical-paper-drug">{[item.medicationDisplay ?? 'Medicine not named', item.strength, item.doseForm].filter(Boolean).join(' ')}</p>
            <p>{[item.dose, item.frequency, item.duration ? `for ${item.duration}` : ''].filter(Boolean).join(' · ') || 'How to take it is not recorded'}</p>
          </li>
        ))}</ol> : <p>None</p>}
      </section>
      <Section title="Follow-up plan" text={summary.followUpPlan} />
      <Section title="Advice for the patient" text={summary.patientAdvice} />
      <div className="hid-clinical-paper-sign">
        <div>
          <div className="hid-clinical-paper-line">{print.signedBy ?? ''}</div>
          <p className="hid-clinical-paper-caption">Signed by</p>
        </div>
        <div>
          <div className="hid-clinical-paper-line">{print.signedAt ? lagosDateTime(print.signedAt) : ''}</div>
          <p className="hid-clinical-paper-caption">Signed</p>
        </div>
      </div>
      <p className="hid-clinical-paper-foot">{FOOT}</p>
    </div>
  )
}

/** Routes 20 and 21: the band, with the Health ID on it (this paper is the only place the page puts it). */
export function BandPaper({ band }: { readonly band: WristbandPrint }) {
  const name = band.unknownLabel ?? band.fullName ?? 'Patient'
  // Labelled as on the screen (AdmissionIdentity): "Born 14 May 1972", or "Born about 14 May 1972" for an estimate.
  const born = band.dateOfBirth ? `${band.ageEstimated ? 'Born about' : 'Born'} ${dayText(band.dateOfBirth)}` : band.ageEstimated ? 'Estimated age' : ''
  return (
    <div className="hid-inpatient-band" data-paper="band">
      <div>
        <p className="hid-inpatient-band-name">{name}</p>
        <p>{[sexText(band.sex), born].filter(Boolean).join(' · ')}</p>
        {band.motherName ? <p>Baby of {band.motherName}{band.motherAdmissionNumber ? ` (${band.motherAdmissionNumber})` : ''}</p> : null}
      </div>
      <div>
        <p className="hid-inpatient-band-code">{band.healthId}</p>
        <p className="hid-inpatient-band-code">{band.admissionNumber}</p>
        {band.pairCode ? <p className="hid-inpatient-band-code">Pair {band.pairCode}</p> : null}
      </div>
      <div>
        <p>{band.facilityName}</p>
        {band.wardName ? <p>{band.wardName}</p> : null}
        {band.allergyAlert ? <p className="hid-inpatient-band-alert">Allergy: check the chart</p> : null}
      </div>
    </div>
  )
}
