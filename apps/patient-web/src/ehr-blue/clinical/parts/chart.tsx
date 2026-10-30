import { isHidApiError } from '@hid/http'
import { EhrEmptyState } from '@hid/ui/ehr'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isAllowedPatientLookup, staffApi } from '../../../staff/api'
import type { ActivePatient } from '../../../staff/App'
import { Banner } from './Notices'
import { patientFacts, type PatientFacts } from './PatientHeader'
import { useClinical, useWorkspaceHref } from './Workspace'

/** Today's chart wording, kept word for word. */
export const OPEN_FIRST = 'Open a patient through governed access first.'
export const ACCESS_ENDED = 'Patient access has ended. Reopen the record through governed access.'
export const READ_ONLY = 'Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.'
export const WRITE_UNKNOWN = 'Write access could not be confirmed, so changes are unavailable. Refresh the page to try again.'
export const CHOOSE_FIRST = 'Choose a patient first.'
export const CHOOSE_FIRST_DETAIL = 'Clinical records require a current backend authorization for the selected facility.'
export const NO_AUTHORIZED_PATIENT = 'No authorized patient'
export const OPEN_PATIENT_HOW = 'Open a patient using an approved request, patient PIN, or documented emergency access.'

type WriteAccess = { readonly scope: string; readonly allowed: boolean; readonly failed: boolean }

interface ChartValue {
  readonly ended: boolean
  readonly markEnded: () => void
  readonly clearEnded: () => void
  readonly writeAccess: WriteAccess | null
}

const ChartContext = createContext<ChartValue | null>(null)

/**
 * Holds, for one workspace, whether access to the open patient ended while it was in use, and what the current grant
 * permits (`consentStatus().writeAllowed`, direct care only). Nothing here outlives the page; nothing is stored.
 */
export function ChartProvider({ children }: { children: ReactNode }) {
  const { facility, activePatient } = useClinical()
  const [ended, setEnded] = useState(false)
  const [writeAccess, setWriteAccess] = useState<WriteAccess | null>(null)
  const patientId = activePatient?.lookup.patient.patientId
  const directCare = activePatient?.purpose === 'direct-care'
  const facilityId = facility?.id

  useEffect(() => {
    if (!facilityId || !patientId || !directCare) return
    let current = true
    const scope = JSON.stringify([facilityId, patientId])
    staffApi.consentStatus(facilityId, patientId).then(
      status => { if (current) setWriteAccess({ scope, allowed: status.writeAllowed === true, failed: false }) },
      () => { if (current) setWriteAccess({ scope, allowed: false, failed: true }) },
    )
    return () => { current = false }
  }, [facilityId, patientId, directCare])

  // A patient opened again (after access ended) clears the notice.
  useEffect(() => { if (patientId) setEnded(false) }, [patientId])

  const value = useMemo<ChartValue>(() => ({
    ended,
    markEnded: () => setEnded(true),
    clearEnded: () => setEnded(false),
    writeAccess,
  }), [ended, writeAccess])

  return <ChartContext.Provider value={value}>{children}</ChartContext.Provider>
}

export interface Chart {
  readonly facilityId: string
  readonly facilityName: string
  readonly patient: ActivePatient
  readonly patientId: string
  readonly facts: PatientFacts
  readonly purpose: ActivePatient['purpose']
  /** Changes are offered only in direct care, once the grant is known to allow them. */
  readonly canWrite: boolean
  /** Why changes are unavailable (READ_ONLY or WRITE_UNKNOWN), once known; null while unknown or allowed. */
  readonly writeNotice: string | null
  readonly can: (...permissions: string[]) => boolean
  /**
   * Today's re-check before a change or a list read: a fresh patient lookup. A refusal (403, 404, not allowed, or
   * another patient) closes the patient and throws ACCESS_ENDED; other failures (503) leave it open and rethrow.
   */
  readonly verify: () => Promise<void>
  /** Close the patient and show "Access to this patient ended", after a refusal seen elsewhere. */
  readonly endAccess: () => void
}

/** The open patient's chart, or null while no patient is open (or access ended). */
export function useChart(): Chart | null {
  const context = useContext(ChartContext)
  if (!context) throw new Error('Chart pages render inside <ChartProvider>')
  const { facility, activePatient, setActivePatient, can } = useClinical()
  const { markEnded, writeAccess } = context
  const patientId = activePatient?.lookup.patient.patientId

  const endAccess = useCallback(() => {
    setActivePatient(null)
    markEnded()
  }, [markEnded, setActivePatient])

  const verify = useCallback(async () => {
    if (!facility || !activePatient) throw new Error(OPEN_FIRST)
    let answer
    try {
      answer = await staffApi.lookupPatient(facility.id, activePatient.hid, activePatient.purpose)
    } catch (caught) {
      if (isHidApiError(caught) && (caught.status === 403 || caught.status === 404)) {
        endAccess()
        throw new Error(ACCESS_ENDED)
      }
      throw caught
    }
    if (!isAllowedPatientLookup(answer) || answer.patient.patientId !== patientId) {
      endAccess()
      throw new Error(ACCESS_ENDED)
    }
  }, [activePatient, endAccess, facility, patientId])

  return useMemo(() => {
    if (!facility || !activePatient || !patientId || context.ended) return null
    const scope = JSON.stringify([facility.id, patientId])
    const known = writeAccess?.scope === scope ? writeAccess : null
    const directCare = activePatient.purpose === 'direct-care'
    const canWrite = directCare && known?.allowed === true
    const writeNotice = !directCare || !known || known.allowed ? null : known.failed ? WRITE_UNKNOWN : READ_ONLY
    return {
      facilityId: facility.id,
      facilityName: facility.name,
      patient: activePatient,
      patientId,
      facts: patientFacts(activePatient),
      purpose: activePatient.purpose,
      canWrite,
      writeNotice,
      can,
      verify,
      endAccess,
    }
  }, [activePatient, can, context.ended, endAccess, facility, patientId, verify, writeAccess])
}

/** Whether access ended in this workspace (the patient was closed by a refusal). */
export function useAccessEnded() {
  const context = useContext(ChartContext)
  if (!context) throw new Error('Chart pages render inside <ChartProvider>')
  return context.ended
}

/** Today's refusal text for a failed call, or a fallback. ACCESS_ENDED and other thrown messages pass through. */
export function failureText(caught: unknown, fallback: string): string {
  if (caught instanceof Error && caught.message) return caught.message
  return fallback
}

/**
 * The states a chart page shows instead of its content: access ended (drawn as the design's critical banner, with
 * today's sentence), no patient open (today's words in the design's empty state), and emergency access, which is
 * read-only and shows only the emergency summary. Otherwise renders `children(chart)`.
 */
export function ChartGate({ children, allowEmergency = false }: { children: (chart: Chart) => ReactNode; allowEmergency?: boolean }) {
  const chart = useChart()
  const ended = useAccessEnded()
  const href = useWorkspaceHref()

  if (ended && !chart) {
    return (
      <Banner tone="critical" title="Access to this patient ended" actions={<Link className="hid-ehr-clinical-link" to={href.to('patients')}>Go to patient access →</Link>}>
        {ACCESS_ENDED}
      </Banner>
    )
  }
  if (!chart) {
    return (
      <EhrEmptyState
        title={CHOOSE_FIRST}
        message={`${CHOOSE_FIRST_DETAIL} ${OPEN_PATIENT_HOW}`}
        action={<Link className="hid-ehr-clinical-link" to={href.to('patients')}>Go to patient access →</Link>}
      />
    )
  }
  if (chart.purpose === 'emergency' && !allowEmergency) {
    return (
      <Banner tone="warning" title="Emergency access is read-only" actions={<Link className="hid-ehr-clinical-link" to={href.to('emergency')}>Open the emergency summary →</Link>}>
        {`${chart.facts.name} is open under emergency access. Emergency access shows the read-only emergency summary only; nothing can be added or changed.`}
      </Banner>
    )
  }
  return <>{children(chart)}</>
}
