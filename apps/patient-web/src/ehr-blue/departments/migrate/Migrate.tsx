import { Link } from 'react-router-dom'
import { useStaff, type ActivePatient } from '../../../staff/App'
import { pageAllowed } from '../../frame/pageAccess'
import { basePath, pageHrefOf } from '../../frame/pageHref'
import { useBluePages } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'

/*
 * Health ID Migrate's start page. Staff never type an ID here (the owner's rule: "staff should not type"). Paper
 * records are brought in from the patient's own page, so this page only sends staff there: open the patient first.
 */

/** The page's title, and its name in the sidebar (page.tsx). */
export const PAPER_RECORDS = 'Bring in paper records'

/**
 * The refusal for a role without ocr.job.read, on this page and at its address (page.tsx). Roles that hold it see the
 * page; others get this line. It names no permission (the owner's rule).
 */
export const NO_DOCUMENT_OCR = 'Bringing in paper records isn’t part of your role at this facility.'

/** Said when this role can't open the Patients page, where paper records start. */
export const NO_PATIENTS = 'Opening patients isn’t part of your role at this facility.'

/** Said under emergency access: paper records are brought in for direct care only. */
export const NOT_IN_EMERGENCY = 'Paper records can’t be brought in during emergency access.'

/** The open patient's name, or nothing: the page shows no Health ID or other code. */
function nameOf(patient: ActivePatient) {
  const summary = patient.lookup.patient
  const full = summary.fullName?.trim() || [summary.firstName, summary.lastName].filter(Boolean).join(' ')
  const first = summary.firstName?.trim() || full.split(/\s+/)[0] || ''
  return { full, first }
}

/** The blue Patients page's address, when it is live and this session may open it. */
function usePatientsHref(): string | null {
  const pages = useBluePages()
  const { state } = useStaff()
  const session = state.status === 'ready' ? state.session : null
  const patients = pages.find(page => basePath(page.path) === 'patients')
  return patients && patients.status === 'live' && pageAllowed(patients, session) ? pageHrefOf(patients) : null
}

export function Migrate() {
  const { facilityId, permissions } = useDeptAccess()
  const { activePatient } = useStaff()
  const patientsHref = usePatientsHref()

  if (!facilityId || !permissions.includes('ocr.job.read')) return <DeptPage title={PAPER_RECORDS}>
    <DeptNotice tone="critical" role="alert">{NO_DOCUMENT_OCR}</DeptNotice>
  </DeptPage>

  const emergency = activePatient?.purpose === 'emergency'
  const open = activePatient?.purpose === 'direct-care' ? nameOf(activePatient) : null
  return <DeptPage title={PAPER_RECORDS}
    // Links, not buttons: each only goes to another page, so it can open in a new tab like any link.
    primaryAction={patientsHref ? <Link className="hid-ehr-button" to={patientsHref}>Open a patient</Link> : undefined}>
    <DeptSection>
      <p>Open the patient first. Then tap Bring in paper records on their page.</p>
      {patientsHref ? null : <DeptNotice tone="caution">{NO_PATIENTS}</DeptNotice>}
      {emergency ? <DeptNotice tone="caution">{NOT_IN_EMERGENCY}</DeptNotice> : null}
      {open && patientsHref ? <div className="hid-ehr-dept-form-actions">
        <p>{open.full ? `Patient open now: ${open.full}` : 'A patient is open now.'}</p>
        <Link className="hid-ehr-button hid-ehr-button-secondary" to={`${patientsHref}/open`}>
          {open.first ? `Open ${open.first}’s page` : 'Open their page'}
        </Link>
      </div> : null}
    </DeptSection>
  </DeptPage>
}
