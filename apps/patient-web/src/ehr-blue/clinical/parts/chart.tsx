import { isHidApiError } from '@hid/http'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PatientBanner } from '../../../kasuwa/parts'
import { Alert, Button, EmptyState, type Tone } from '../../../kasuwa/ui'
import { isAllowedPatientLookup, staffApi } from '../../../staff/api'
import type { ActivePatient } from '../../../staff/App'
import { patientFacts, type PatientFacts } from './PatientHeader'
import { useClinical, useWorkspaceHref } from './Workspace'

/** The chart's wording, in plain words. */
export const OPEN_FIRST = 'Find the patient first.'
export const ACCESS_ENDED = 'Patient access has ended. Find the patient again to reopen their record.'
export const READ_ONLY = 'You can view this record but not change it.'
export const WRITE_UNKNOWN = 'We couldn’t check whether you can make changes, so changes are off. Refresh the page to try again.'
/** Today's page with no patient open, word for word (staff/routes/Clinical.tsx:1375). */
export const CHOOSE_FIRST = 'Choose a patient first.'
// The detail sentence and the how-to are shown again, as today's page shows them, in the redesign's words with today's
// "documented"; "No authorized patient" is today's.
export const CHOOSE_FIRST_DETAIL = 'Records show only for a patient you have access to at this facility.'
export const NO_AUTHORIZED_PATIENT = 'No authorized patient'
export const OPEN_PATIENT_HOW = 'Open a patient with an approved request, the patient’s PIN, or documented emergency access.'
/** Today's line under the patient's name for direct care (staff/routes/Clinical.tsx:1767), in plain words. */
export const DIRECT_CARE = 'Direct care access.'

type WriteAccess = { readonly scope: string; readonly lookup: object; readonly allowed: boolean; readonly failed: boolean }

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
  // Each lookup (a new grant, even for the same patient) is asked about afresh: an earlier grant's answer never shows.
  const lookup = activePatient?.lookup

  useEffect(() => {
    if (!facilityId || !patientId || !directCare || !lookup) return
    let current = true
    const scope = JSON.stringify([facilityId, patientId])
    staffApi.consentStatus(facilityId, patientId).then(
      status => { if (current) setWriteAccess({ scope, lookup, allowed: status.writeAllowed === true, failed: false }) },
      () => { if (current) setWriteAccess({ scope, lookup, allowed: false, failed: true }) },
    )
    return () => { current = false }
  }, [facilityId, patientId, directCare, lookup])

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
  // Keyed on values, not on the facility object, so verify keeps its identity while the session is unchanged.
  const facilityId = facility?.id
  const facilityName = facility?.name
  const patientId = activePatient?.lookup.patient.patientId

  const endAccess = useCallback(() => {
    setActivePatient(null)
    markEnded()
  }, [markEnded, setActivePatient])

  const verify = useCallback(async () => {
    if (!facilityId || !activePatient) throw new Error(OPEN_FIRST)
    let answer
    try {
      answer = await staffApi.lookupPatient(facilityId, activePatient.hid, activePatient.purpose)
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
  }, [activePatient, endAccess, facilityId, patientId])

  return useMemo(() => {
    if (!facilityId || !activePatient || !patientId || context.ended) return null
    const scope = JSON.stringify([facilityId, patientId])
    const known = writeAccess?.scope === scope && writeAccess.lookup === activePatient.lookup ? writeAccess : null
    const directCare = activePatient.purpose === 'direct-care'
    const canWrite = directCare && known?.allowed === true
    const writeNotice = !directCare || !known || known.allowed ? null : known.failed ? WRITE_UNKNOWN : READ_ONLY
    return {
      facilityId,
      facilityName: facilityName ?? '',
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
  }, [activePatient, can, context.ended, endAccess, facilityId, facilityName, patientId, verify, writeAccess])
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

/** The open patient's banner, the same on every chart page: who is open and what this access allows. */
export function ChartBanner({ chart, compact = false, sticky = false }: { chart: Chart; compact?: boolean; sticky?: boolean }) {
  return <PatientBanner name={chart.facts.name} hid={chart.facts.hid} dateOfBirth={chart.facts.dateOfBirth} sex={chart.facts.sex}
    status={accessStatus(chart)} compact={compact} sticky={sticky} />
}

function accessStatus(chart: Chart): { label: string; tone: Tone } {
  if (chart.purpose === 'emergency') return { label: 'Emergency access · Read only', tone: 'danger' }
  if (chart.writeNotice) return { label: 'Read only', tone: 'warn' }
  return { label: 'Access allowed', tone: 'success' }
}

/**
 * The states a chart page shows instead of its content: access ended, no patient open, and emergency access, which is
 * read-only and shows only the emergency summary. Otherwise the patient banner (sticky, once per page: wrong-patient
 * prevention), why changes are off when they are (said once, here), then `children(chart)`. `banner` is off for pages
 * that draw the patient themselves (the patient page and the emergency summary).
 */
export function ChartGate({ children, allowEmergency = false, banner = !allowEmergency }: {
  children: (chart: Chart) => ReactNode; allowEmergency?: boolean; banner?: boolean
}) {
  const chart = useChart()
  const ended = useAccessEnded()
  const href = useWorkspaceHref()

  if (ended && !chart) {
    return (
      <Alert intent="error" title="Access to this patient ended" action={<Button size="sm" to={href.to('patients')}>Find a patient</Button>}>
        Open the patient again to keep working.
      </Alert>
    )
  }
  if (!chart) {
    return (
      <EmptyState illustration="patient" title={CHOOSE_FIRST}
        description={<>{CHOOSE_FIRST_DETAIL} <strong>{NO_AUTHORIZED_PATIENT}.</strong> {OPEN_PATIENT_HOW}</>}
        action={<Button variant="primary" to={href.to('patients')}>Find a patient</Button>} />
    )
  }
  if (chart.purpose === 'emergency' && !allowEmergency) {
    return (
      <>
        {banner ? <ChartBanner chart={chart} sticky /> : null}
        <Alert intent="warning" className="mb-4" title="Emergency access shows the emergency summary only"
          action={<Button size="sm" to={href.to('emergency', 'summary')}>Open the emergency summary</Button>}>
          Nothing can be added or changed.
        </Alert>
      </>
    )
  }
  return (
    <>
      {banner ? <ChartBanner chart={chart} sticky /> : null}
      {banner && chart.purpose === 'direct-care' ? (
        // Today's line and "Change patient →" under the patient's name (staff/routes/Clinical.tsx:1767-1768).
        <p className="mt-2 mb-4 text-[13px] text-ink-2">
          HID {chart.patient.hid} · {DIRECT_CARE}{' '}
          <Link className="font-medium text-brand-ink underline underline-offset-2" to={href.to('patients')}>Change patient →</Link>
        </p>
      ) : null}
      {banner && chart.writeNotice ? <Alert intent="info" size="sm" className="mb-4">{chart.writeNotice}</Alert> : null}
      {children(chart)}
    </>
  )
}
