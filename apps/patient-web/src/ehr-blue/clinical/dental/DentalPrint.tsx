import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ageInYears } from '@hid/ui/display'
import type { DentalProcedure, DentalSummary } from '../../../staff/api'
import { startPrint, type PrintJob } from '../../../print/printPaper'
import { PrintHeader } from '../../frame/PrintHeader'
import { doseText, durationText, routeText } from '../parts/clinicalPrint'
import '../parts/clinicalPrint.css'
import {
  DENTITION_WORDS, DRAFT_LIST, NOT_ON_LIST, anaestheticText, dayText, lagosDateTime, sexText, siteText, sortedFindings,
  surfacesText, toothText,
} from './dentalRules'

/*
 * The printed dental visit summary (DEN-1 route 14; Q-DEN-3 A: the patient's copy, handed over at the visit). Built only
 * from route 14's answer, read for this print and audited by the server as a print. The paper is put straight under
 * <body> while it prints, with the clinical papers' rules (clinicalPrint.css: hidden on screen, printed alone, A4 with
 * no browser header), and taken away once printed. Every date and time is Lagos time (Q181 A, Q182 A). The Health ID's
 * last 4 characters only. While the lists are drafts, the paper says so (Q124 A).
 */

const PAPER = { size: 'A4', kind: 'Dental visit summary' } as const

export function useDentalPrint() {
  const [paper, setPaper] = useState<{ node: ReactNode; round: number; job: PrintJob } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!paper) return
    return paper.job.run(area.current, () => setPaper(current => current?.round === paper.round ? null : current))
  }, [paper])
  /** Starts the print in the click (Safari's PDF tab opens only then); `print` it once the summary is read, or `cancel`. */
  const start = useCallback((): PrintJob => startPrint(PAPER), [])
  const print = useCallback((node: ReactNode, job: PrintJob) => {
    setPaper(current => ({ node, round: (current?.round ?? 0) + 1, job }))
  }, [])
  const portal = paper && typeof document !== 'undefined'
    ? createPortal(<div ref={area} data-clinical-print="dental-summary" aria-hidden="true">{paper.node}</div>, document.body)
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

function procedureLine(procedure: DentalProcedure): string {
  return [procedure.procedureName, procedure.byName ? `(${NOT_ON_LIST.toLowerCase()})` : '', siteText(procedure) ? `: ${siteText(procedure)}` : '']
    .filter(Boolean).join(' ').replace(' :', ':')
}

/**
 * Who did each procedure: names from SX-9, passed in ("A staff member here" when a name could not be read); each
 * condition by its label from the dental list (route 1), never its code.
 */
export function DentalSummaryPaper({ summary, names, conditionText }: {
  readonly summary: DentalSummary
  readonly names: (membershipId: string | null) => string
  readonly conditionText: (code: string) => string
}) {
  const patient = summary.patient
  const age = ageInYears(patient.dateOfBirth, summary.printedAt)
  const ageSex = [age === null ? '' : `${age} years`, sexText(patient.sex)].filter(Boolean).join(' · ')
  const chart = summary.chart
  const findings = chart ? sortedFindings(chart.findings) : []
  const draft = summary.listStatus === 'draft'
  return (
    <div className="hid-clinical-paper" data-paper="dental-summary">
      <PrintHeader facility={summary.facilityName} className="hid-clinical-paper-brand" />
      <div className="hid-clinical-paper-head">
        <p className="hid-clinical-paper-kind">Dental visit summary</p>
        <p className="hid-clinical-paper-caption">Printed: {lagosDateTime(summary.printedAt)}</p>
      </div>
      <Rows rows={[
        ['Patient', patient.fullName],
        ['Health ID ending', patient.healthIdLast4],
        ['Age and sex', ageSex],
        ['Visit', lagosDateTime(summary.encounter.startedAt)],
        ['Reason for visit', summary.encounter.chiefComplaint],
      ]} />
      {draft ? <p className="hid-clinical-paper-caption">{DRAFT_LIST}. Check this paper against the patient’s record.</p> : null}
      <section>
        <h2>Tooth chart</h2>
        {chart ? (
          <>
            <p className="hid-clinical-paper-caption">
              Version {chart.versionNo}, {DENTITION_WORDS[chart.dentition] ?? ''}, recorded {lagosDateTime(chart.recordedAt)}
            </p>
            {findings.length > 0 ? (
              <ul>
                {findings.map(finding => (
                  <li key={`${finding.tooth}-${finding.condition}`}>
                    {toothText(finding.tooth)}: {conditionText(finding.condition)}
                    {finding.surfaces ? `, surfaces ${surfacesText(finding.surfaces, finding.tooth)}` : ''}
                    {finding.note ? `. ${finding.note}` : ''}
                  </li>
                ))}
              </ul>
            ) : <p>No findings: every tooth charted as present and sound.</p>}
            {chart.note ? <p className="hid-clinical-paper-note">{chart.note}</p> : null}
          </>
        ) : <p>No tooth chart recorded.</p>}
      </section>
      <section>
        <h2>Treatment done at this visit</h2>
        {summary.doneThisVisit.length > 0 ? (
          <ol>
            {summary.doneThisVisit.map(procedure => (
              <li key={procedure.procedureId}>
                <p className="hid-clinical-paper-drug">{procedureLine(procedure)}</p>
                <p>{[anaestheticText(procedure.anaesthetic), procedure.doneAt ? `Done ${lagosDateTime(procedure.doneAt)}` : '',
                  `by ${names(procedure.performedByMembershipId)}`].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ol>
        ) : <p>None recorded</p>}
      </section>
      <section>
        <h2>Treatment plan still to do</h2>
        {summary.plannedProcedures.length > 0
          ? <ul>{summary.plannedProcedures.map(procedure => <li key={procedure.procedureId}>{procedureLine(procedure)}</li>)}</ul>
          : <p>Nothing planned</p>}
      </section>
      <section>
        <h2>Diagnoses</h2>
        {summary.diagnoses.length > 0
          ? <ul>{summary.diagnoses.map((diagnosis, index) => <li key={`${diagnosis.code ?? diagnosis.display}-${index}`}>{diagnosis.display}</li>)}</ul>
          : <p>None recorded</p>}
      </section>
      <section>
        <h2>Medicines</h2>
        {summary.prescriptions.length > 0 ? (
          <ol>
            {summary.prescriptions.map((medicine, index) => {
              const dose = doseText(medicine.doseQuantity, medicine.doseUnit)
              const duration = durationText(medicine.startsOn, medicine.endsOn)
              return (
                <li key={`${medicine.medicationDisplay}-${index}`}>
                  <p className="hid-clinical-paper-drug">{medicine.medicationDisplay}{dose ? ` ${dose}` : ''}</p>
                  <p>{[routeText(medicine.routeCode), medicine.frequency ?? '', duration ? `for ${duration}` : ''].filter(Boolean).join(' · ')
                    || 'How to take it is not recorded'}</p>
                  {medicine.instructions ? <p>{medicine.instructions}</p> : null}
                </li>
              )
            })}
          </ol>
        ) : <p>None prescribed at this visit</p>}
      </section>
      <section>
        <h2>Follow-up</h2>
        {summary.visit.followUpOn || summary.visit.followUpNote ? (
          <>
            {summary.visit.followUpOn ? <p>Come back on {dayText(summary.visit.followUpOn)}.</p> : null}
            {summary.visit.followUpNote ? <p className="hid-clinical-paper-note">{summary.visit.followUpNote}</p> : null}
          </>
        ) : <p>No follow-up date set.</p>}
      </section>
      <div className="hid-clinical-paper-sign">
        <div>
          <div className="hid-clinical-paper-line" />
          <p className="hid-clinical-paper-caption">Dentist’s name</p>
        </div>
        <div>
          <div className="hid-clinical-paper-line" />
          <p className="hid-clinical-paper-caption">Signature</p>
        </div>
      </div>
      <p className="hid-clinical-paper-foot">{FOOT}</p>
    </div>
  )
}
