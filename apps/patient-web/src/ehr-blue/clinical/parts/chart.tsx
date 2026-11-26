import { isHidApiError, PlainError, plainErrorText } from '@hid/http'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { PatientBanner } from '../../../kasuwa/parts'
import { Alert, Button, EmptyState, type Tone } from '../../../kasuwa/ui'
import { isAllowedPatientLookup, staffApi } from '../../../staff/api'
import type { ActivePatient } from '../../../staff/App'
import { PatientAssistant } from './PatientAssistant'
import { patientFacts, type PatientFacts } from './PatientHeader'
import { useClinical, useWorkspaceHref } from './Workspace'

/** The chart's wording, in plain words. */
export const OPEN_FIRST = 'Find the patient first.'
/** Classic's re-check refusal, word for word (staff/routes/Clinical.tsx verify, :1290 and :1296). */
export const ACCESS_ENDED = 'Your access to this patient has ended. Open the patient again to keep working.'
/**
 * Why changes are off. These keep the redesign's plain words by the coordinator's decision of 2 Nov 2026 (pre-merge
 * review, recorded in commits a1c93d13, 098b6a77 and db9967ae): classic's "Read-only access. This authorization does not
 * include changes; …" and "Write access could not be confirmed, so changes are unavailable. …" (Clinical.tsx:1811-1813),
 * like the rest of classic's chart and encounter words named there ("governed access", "Authorized"), must not ship.
 */
export const READ_ONLY = 'You can view this record but not change it.'
export const WRITE_UNKNOWN = 'We couldn’t check whether you can make changes, so changes are off. Refresh the page to try again.'
/** Classic's link to the summary of a patient open under emergency access (staff/routes/Patients.tsx:252), word for word. */
export const OPEN_EMERGENCY_SUMMARY = 'Open read-only emergency summary →'
/** Today's page with no patient open, word for word (staff/routes/Clinical.tsx:1375). */
export const CHOOSE_FIRST = 'Choose a patient first.'
// The detail sentence and the how-to are shown again, as today's page shows them, in the redesign's words with today's
// "documented".
export const CHOOSE_FIRST_DETAIL = 'Records show only for a patient you have access to at this facility.'
export const NO_AUTHORIZED_PATIENT = 'No patient open'
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

type WriteAnswer = { readonly allowed: boolean; readonly failed: boolean }

/**
 * The visit list's passed check, handed on to the one visit opened from it (Chart.passOn, Chart.checked): for each open
 * patient, the latest pass and the facility and patient it was for. A pass is used once; a visit reached any other way
 * (by its address, from another page, by going back to it later) checks again. Keyed on the open patient as the staff
 * session holds it, so a new lookup clears it.
 */
const passes = new WeakMap<object, { readonly token: string; readonly scope: string }>()
let passCount = 0

/**
 * What the current grant permits, asked once per open patient and shared by every workspace's chart, as classic's one
 * Clinical page asks it once (staff/routes/Clinical.tsx:1400-1409): each workspace mounts its own ChartProvider, and
 * without this each asked again. Keyed on the open patient as the staff session holds it, so a new grant (a new lookup,
 * even for the same patient) is asked about afresh. A check that failed is not kept: the next chart asks again.
 */
const writeAnswers = new WeakMap<object, { readonly scope: string; readonly answer: Promise<WriteAnswer> }>()

/** The write answer for the open patient: the one already asked (or being asked), else a new consentStatus read. */
function askWriteAccess(patient: ActivePatient, facilityId: string, patientId: string): Promise<WriteAnswer> {
  const scope = JSON.stringify([facilityId, patientId])
  const held = writeAnswers.get(patient)
  if (held && held.scope === scope) return held.answer
  const answer = staffApi.consentStatus(facilityId, patientId).then(
    status => ({ allowed: status.writeAllowed === true, failed: false }),
    () => {
      if (writeAnswers.get(patient)?.answer === answer) writeAnswers.delete(patient)
      return { allowed: false, failed: true }
    },
  )
  writeAnswers.set(patient, { scope, answer })
  return answer
}

/**
 * Holds, for one workspace, whether access to the open patient ended while it was in use, and what the current grant
 * permits (`consentStatus().writeAllowed`, direct care only). The write answer itself is shared through
 * `writeAnswers` (above), held only while the staff session keeps the same open patient; nothing else outlives the page.
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
    if (!facilityId || !patientId || !directCare || !lookup || !activePatient) return
    let current = true
    const scope = JSON.stringify([facilityId, patientId])
    void askWriteAccess(activePatient, facilityId, patientId).then(answer => { if (current) setWriteAccess({ scope, lookup, ...answer }) })
    return () => { current = false }
  }, [activePatient, facilityId, patientId, directCare, lookup])

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
   * Classic's re-check before a change: a fresh patient lookup. A refusal (403, 404, not allowed, or another patient)
   * closes the patient and throws ACCESS_ENDED; other failures (503) leave it open and rethrow.
   */
  readonly verify: () => Promise<void>
  /**
   * The visit list's check handed on to the visit opened from it: called once the list's own check (`verify`) has
   * passed, it answers a pass for the visit link's router state (never the address). Classic checks on loading the
   * encounters, not again on choosing one (staff/routes/Clinical.tsx:1316, :1838).
   */
  readonly passOn: () => string
  /**
   * The check before a visit is read: resolves at once for the pass the visit list handed on (`passOn`), used once and
   * only for the patient open now, else runs `verify`, so a visit reached by its address, or again later, checks as
   * classic's every Clinical load does (Clinical.tsx:1316) and an ended access says ACCESS_ENDED. Every save calls `verify`.
   */
  readonly checked: (pass: unknown) => Promise<void>
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
    if (!facilityId || !activePatient) throw new PlainError(OPEN_FIRST)
    // A patient opened from an emergency search card has no Health ID on screen to look up again (break-glass by
    // matchRef, 0132 ID-5): the grant's own end is checked here, and every record read is checked by the server; a read
    // it refuses ends access (readEndsAccess), as a refused lookup does for everyone else.
    if (!activePatient.hid) {
      const ends = Date.parse(activePatient.lookup.authorization.expiresAt ?? '')
      if (Number.isFinite(ends) && ends <= Date.now()) {
        endAccess()
        throw new PlainError(ACCESS_ENDED)
      }
      return
    }
    let answer
    try {
      answer = await staffApi.lookupPatient(facilityId, activePatient.hid, activePatient.purpose)
    } catch (caught) {
      if (isHidApiError(caught) && (caught.status === 403 || caught.status === 404)) {
        endAccess()
        throw new PlainError(ACCESS_ENDED)
      }
      throw caught
    }
    if (!isAllowedPatientLookup(answer) || answer.patient.patientId !== patientId) {
      endAccess()
      throw new PlainError(ACCESS_ENDED)
    }
  }, [activePatient, endAccess, facilityId, patientId])

  const passOn = useCallback(() => {
    if (!activePatient) return ''
    const token = `pass-${++passCount}`
    passes.set(activePatient, { token, scope: JSON.stringify([facilityId, patientId]) })
    return token
  }, [activePatient, facilityId, patientId])

  const checked = useCallback(async (pass: unknown) => {
    const held = activePatient ? passes.get(activePatient) : undefined
    if (activePatient && held && typeof pass === 'string' && held.token === pass && held.scope === JSON.stringify([facilityId, patientId])) {
      passes.delete(activePatient)
      return
    }
    await verify()
  }, [activePatient, facilityId, patientId, verify])

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
      passOn,
      checked,
      endAccess,
    }
  }, [activePatient, can, checked, context.ended, endAccess, facilityId, facilityName, passOn, patientId, verify, writeAccess])
}

/**
 * Whether a refused record read means access has ended, for a patient whose access `verify` cannot look up again (one
 * opened from an emergency search card, with no Health ID): EHR answers 403 once the grant has ended or been closed
 * elsewhere, and 404 once the patient is no longer there. The page then calls the chart's `endAccess`.
 */
export function readEndsAccess(patient: ActivePatient, caught: unknown): boolean {
  return !patient.hid && isHidApiError(caught) && (caught.status === 403 || caught.status === 404)
}

/** Whether access ended in this workspace (the patient was closed by a refusal). */
export function useAccessEnded() {
  const context = useContext(ChartContext)
  if (!context) throw new Error('Chart pages render inside <ChartProvider>')
  return context.ended
}

/** A failed call in plain words (plainErrorText), or `fallback`. ACCESS_ENDED and OPEN_FIRST, written for people, pass through. */
export function failureText(caught: unknown, fallback: string): string {
  return plainErrorText(caught, fallback, { codes: CHART_REFUSALS, audience: 'facility' })
}

/** The page's own words for the refusals a chart step shares: never the server's. */
const CHART_REFUSALS: Readonly<Record<string, string>> = {
  PATIENT_NOT_FOUND: 'We couldn’t find a patient with that Health ID. Check it and try again.',
}

/** The open patient's banner, the same on every chart page: who is open and what this access allows. */
export function ChartBanner({ chart, compact = false, sticky = false, action }: { chart: Chart; compact?: boolean; sticky?: boolean; action?: ReactNode }) {
  return <PatientBanner name={chart.facts.name} hid={chart.facts.hid} dateOfBirth={chart.facts.dateOfBirth} sex={chart.facts.sex}
    status={accessStatus(chart)} compact={compact} sticky={sticky} action={action} />
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
  const { can } = useClinical()
  // Find a patient opens only with identity.patient.read (any other role lands on Home); without it, Access requests.
  const findPatient = can('identity.patient.read') ? { to: href.to('patients'), label: 'Find a patient', change: 'Change patient →' }
    : can('identity.consent.write') ? { to: href.to('consent'), label: 'Access requests', change: 'Access requests →' } : null

  if (ended && !chart) {
    return (
      <Alert intent="error" title="Access to this patient ended" action={findPatient ? <Button size="sm" to={findPatient.to}>{findPatient.label}</Button> : undefined}>
        Open the patient again to keep working.
      </Alert>
    )
  }
  if (!chart) {
    return (
      <EmptyState illustration="patient" title={CHOOSE_FIRST}
        description={<>{CHOOSE_FIRST_DETAIL} <strong>{NO_AUTHORIZED_PATIENT}.</strong> {OPEN_PATIENT_HOW}</>}
        action={findPatient ? <Button variant="primary" to={findPatient.to}>{findPatient.label}</Button> : undefined} />
    )
  }
  // Under emergency access the chart is the read-only emergency summary, as classic's Clinical page is
  // (staff/routes/Clinical.tsx:1413-1415): a role that may open it is taken straight there, with no extra click; one
  // that may not keeps this notice, with classic's link to it.
  if (chart.purpose === 'emergency' && !allowEmergency && can('identity.break-glass.write')) return <Navigate replace to={href.to('emergency', 'summary')} />
  if (chart.purpose === 'emergency' && !allowEmergency) {
    return (
      <>
        {banner ? <ChartBanner chart={chart} sticky /> : null}
        <Alert intent="warning" className="mb-4" title="Emergency access shows the emergency summary only"
          action={<Button size="sm" to={href.to('emergency', 'summary')}>{OPEN_EMERGENCY_SUMMARY}</Button>}>
          Nothing can be added or changed.
        </Alert>
      </>
    )
  }
  return (
    <>
      {/* The record assistant rides in the banner, so it is one click away on every chart page (QA P1-9). */}
      {banner ? <ChartBanner chart={chart} sticky action={<PatientAssistant chart={chart} />} /> : null}
      {banner && chart.purpose === 'direct-care' ? (
        // Today's line and "Change patient →" under the patient's name (staff/routes/Clinical.tsx:1767-1768).
        <p className="hid-ehr-chart-line mt-2 mb-4 text-[13px] text-ink-2">
          HID {chart.patient.hid} · {DIRECT_CARE}
          {/* The way back to the patient's own page from every chart page (flow review, 18 Nov 2026). */}
          {can('identity.patient.read') ? <>{' '}<Link className="font-medium text-brand-ink underline underline-offset-2" to={href.to('patients', 'open')}>Patient page</Link> ·</> : null}
          {findPatient ? <>{' '}<Link className="font-medium text-brand-ink underline underline-offset-2" to={findPatient.to}>{findPatient.change}</Link></> : null}
        </p>
      ) : null}
      {banner && chart.writeNotice ? <Alert intent="info" size="sm" className="mb-4">{chart.writeNotice}</Alert> : null}
      {children(chart)}
    </>
  )
}
