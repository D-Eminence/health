import { HEALTH_ID_PREFIX, normalizeHealthIdInput } from '@hid/contracts'
import { EhrButton, EhrCard, EhrField, EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usesNovuBackend } from '../../../backendContract'
import { isAllowedPatientLookup, staffApi } from '../../../staff/api'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import { selfServiceReview } from '../../../staff/staffAccess'
import { ErrorBox, RecordHeading } from '../parts/Notices'
import { patientFacts } from '../parts/PatientHeader'
import { COMPLETE_FIELD } from '../parts/RecordForm'
import { StatusBadge } from '../parts/StatusBadge'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  COMMAND_FAILED, EMERGENCY_ACCESS, EMERGENCY_MINUTES, HID_FORMAT, JUSTIFICATION_MAX, NOT_GRANTED, REASON_FIELD_MAX, REASON_MIN,
  REASON_TOO_SHORT, actionUnavailable, breakGlassReason, breakGlassRefusal, emergencyNotice, healthIdProblem,
} from './access'

const FIELDS = ['hid', 'reason', 'justification', 'ack'] as const
type FieldKey = (typeof FIELDS)[number]
type Problems = Partial<Record<FieldKey, string>>

/** The design's acknowledgement, naming the expiry today's break-glass request asks for. */
export const ACKNOWLEDGE = `I acknowledge patient notification, audit and ${EMERGENCY_MINUTES}-minute expiry`

function Required({ children }: { children: ReactNode }) {
  return <>{children}<span aria-hidden="true"> *</span></>
}

/**
 * The open emergency patient, as today's Patients page shows it ("Current emergency summary"), with the way back to
 * their read-only summary.
 */
export function CurrentEmergency() {
  const { activePatient } = useClinical()
  const href = useWorkspaceHref()
  if (activePatient?.purpose !== 'emergency') return null
  return (
    <EhrCard title="Current emergency summary">
      <p className="hid-ehr-clinical-emergency-current">
        <strong>{patientFacts(activePatient).name}</strong>
        <StatusBadge status="Emergency access" />
        <Link className="hid-ehr-clinical-link" to={href('summary')}>Open read-only emergency summary →</Link>
      </p>
    </EhrCard>
  )
}

/**
 * "Emergency break-glass access": the design's own page for the form (audit 7), reached from the Emergency list's empty
 * state at a real facility and from Patients' refused lookup, with Back to list to the Emergency list.
 */
export function BreakGlassPage() {
  const href = useWorkspaceHref()
  return (
    <>
      <RecordHeading title="Emergency break-glass access" backHref={href()} />
      <EhrCard>
        <BreakGlassForm />
      </EhrCard>
    </>
  )
}

/**
 * The design's break-glass form (Emergency reason, Clinical justification, the acknowledgement, "Record emergency
 * access") with the Health ID today's request needs, after today's emergency notice. It runs today's flow:
 * break-glass, then, once the session that asked is ready, an emergency lookup; the record opens only when that lookup
 * allows it and the session still accepts it, and then the read-only summary shows (the Emergency workspace's, from
 * wherever the form is: its own page, or inline on an access request's page). No card of its own: the caller's holds it.
 */
export function BreakGlassForm() {
  const { facility, permissions, setActivePatient } = useClinical()
  const navigate = useNavigate()
  const href = useWorkspaceHref()
  const id = useId()
  const [hid, setHid] = useState(HEALTH_ID_PREFIX)
  const [reason, setReason] = useState('')
  const [justification, setJustification] = useState('')
  const [ack, setAck] = useState(false)
  const [problems, setProblems] = useState<Problems>({})
  // A problem refused from Enter in its own field cannot move focus to say why: it is an alert there, new each time.
  const [alerted, setAlerted] = useState<{ field: FieldKey; key: number } | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ field: FieldKey; key: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const alerts = useRef(0)
  const controls = useRef(new Map<FieldKey, HTMLInputElement | HTMLTextAreaElement>())
  const normalized = normalizeHealthIdInput(hid)
  const administrator = usesNovuBackend() && permissions.includes('workforce.manage') ? selfServiceReview(facility) : null
  const unavailable = actionUnavailable(EMERGENCY_ACCESS, permissions, administrator)
  const unavailableId = `${id}-unavailable`

  useLayoutEffect(() => {
    if (focusRequest) controls.current.get(focusRequest.field)?.focus()
  }, [focusRequest])

  const register = (field: FieldKey) => (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (element) controls.current.set(field, element)
    else controls.current.delete(field)
  }

  const changed = (field: FieldKey) => {
    setProblems(current => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setAlerted(current => current?.field === field ? null : current)
  }

  const errorFor = (field: FieldKey): ReactNode => {
    const message = problems[field]
    if (!message) return undefined
    return alerted?.field === field ? <span key={alerted.key} role="alert">{message}</span> : message
  }

  function check(): Problems {
    const found: Problems = {}
    const hidProblem = healthIdProblem(normalized)
    if (hidProblem) found.hid = hidProblem
    if (reason.trim().length < REASON_MIN) found.reason = REASON_TOO_SHORT
    if (!justification.trim()) found.justification = COMPLETE_FIELD
    if (!ack) found.ack = COMPLETE_FIELD
    return found
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the request runs; a second press does nothing.
    if (sending.current || !facility || unavailable !== null) return
    setError('')
    const found = check()
    setProblems(found)
    const first = FIELDS.find(field => found[field])
    if (first) {
      const within = document.activeElement === controls.current.get(first)
      if (within) setAlerted({ field: first, key: ++alerts.current })
      else {
        setAlerted(null)
        setFocusRequest({ field: first, key: ++alerts.current })
      }
      return
    }
    setAlerted(null)
    sending.current = true
    setBusy(true)
    // The record opens after the grant only while the session that obtained it is ready: it waits while that session
    // is checked, and never opens once it ended.
    const sentIn = staffSessionGeneration()
    try {
      try {
        await staffApi.breakGlass(facility.id, normalized, breakGlassReason(reason, justification))
      } catch (caught) {
        const known = breakGlassRefusal(caught, facility.name)
        if (known) throw new Error(known)
        throw caught
      }
      await untilStaffSessionReady(sentIn)
      const lookup = await staffApi.lookupPatient(facility.id, normalized, 'emergency')
      if (!isAllowedPatientLookup(lookup)) {
        setActivePatient(null)
        throw new Error(NOT_GRANTED)
      }
      // A lookup answered after the session or facility changed opens nothing.
      if (setActivePatient({ hid: normalized, lookup, purpose: 'emergency' })) navigate(href.to('emergency', 'summary'))
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : COMMAND_FAILED)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const ackError = errorFor('ack')
  const ackErrorId = `${id}-ack-error`

  return (
    <>
      {/* Today's emergency notice, as the design's critical banner (no title: today's notice has none). */}
      <div className="hid-ehr-clinical-banner hid-ehr-clinical-banner-critical hid-ehr-clinical-emergency-notice">
        <p>{emergencyNotice(usesNovuBackend())}</p>
      </div>
      <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void submit(event)}>
        <div className="hid-ehr-clinical-form-grid">
          <EhrField label={<Required>Health ID</Required>} hint={HID_FORMAT} error={errorFor('hid')}>
            <EhrInput
              ref={register('hid')}
              required
              autoComplete="off"
              spellCheck={false}
              value={hid}
              onChange={event => { setHid(normalizeHealthIdInput(event.target.value)); changed('hid') }}
            />
          </EhrField>
          <EhrField label={<Required>Emergency reason</Required>} error={errorFor('reason')}>
            <EhrInput
              ref={register('reason')}
              required
              autoComplete="off"
              maxLength={REASON_FIELD_MAX}
              value={reason}
              onChange={event => { setReason(event.target.value); changed('reason') }}
            />
          </EhrField>
          <EhrField className="hid-ehr-clinical-form-full" label={<Required>Clinical justification</Required>} error={errorFor('justification')}>
            <EhrTextarea
              ref={register('justification')}
              required
              rows={3}
              maxLength={JUSTIFICATION_MAX}
              value={justification}
              onChange={event => { setJustification(event.target.value); changed('justification') }}
            />
          </EhrField>
          <div>
            <label className="hid-ehr-clinical-checkbox">
              <Required>{ACKNOWLEDGE}</Required>
              <input
                ref={register('ack')}
                type="checkbox"
                required
                checked={ack}
                aria-invalid={problems.ack ? true : undefined}
                aria-describedby={ackError ? ackErrorId : undefined}
                onChange={event => { setAck(event.target.checked); changed('ack') }}
              />
            </label>
            {ackError ? <p id={ackErrorId} className="hid-ehr-clinical-field-error">{ackError}</p> : null}
          </div>
        </div>
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {unavailable ? <p id={unavailableId} className="hid-ehr-clinical-note">{unavailable}</p> : null}
        <div className="hid-ehr-clinical-form-footer">
          <EhrButton
            type="submit"
            busy={busy}
            disabled={!facility || unavailable !== null}
            aria-describedby={unavailable ? unavailableId : undefined}
          >
            {busy ? 'Working…' : 'Record emergency access'}
          </EhrButton>
        </div>
      </form>
    </>
  )
}
