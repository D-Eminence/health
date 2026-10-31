import { normalizeHealthIdInput } from '@hid/contracts'
import { Siren } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Field, Input, Textarea } from '../../../kasuwa/ui'
import { FormActions } from '../../../kasuwa/parts'
import { usesNovuBackend } from '../../../backendContract'
import { isAllowedPatientLookup, staffApi } from '../../../staff/api'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import { selfServiceReview } from '../../../staff/staffAccess'
import { patientFacts } from '../parts/PatientHeader'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { offeredHealthId, dropOfferedHealthId, healthIdInput } from '../consent/access'
import {
  COMMAND_FAILED, EMERGENCY_ACCESS, EMERGENCY_CONTACTS_TOLD, EMERGENCY_MINUTES, HID_FORMAT, NOTICE_BEFORE, NOTICE_WHEN, NOT_GRANTED, REASON_MAX,
  REASON_MIN, REASON_TOO_SHORT, actionUnavailable, breakGlassRefusal, healthIdProblem,
} from './access'

const FIELDS = ['hid', 'reason', 'ack'] as const
type FieldKey = (typeof FIELDS)[number]
type Problems = Partial<Record<FieldKey, string>>

/** The acknowledgement, naming the expiry today's break-glass request asks for. */
export const ACKNOWLEDGE = `I understand the patient is told, every view is reviewed, and access ends after ${EMERGENCY_MINUTES} minutes.`

/** The open emergency patient, with the way back to their emergency summary. */
export function CurrentEmergency() {
  const { activePatient } = useClinical()
  const href = useWorkspaceHref()
  if (activePatient?.purpose !== 'emergency') return null
  return (
    <Alert intent="warning" icon={Siren} live={false} title={`${patientFacts(activePatient).name} is open with emergency access`}
      action={<Button size="sm" to={href('summary')}>Open summary</Button>} />
  )
}

/**
 * Emergency access: the Health ID, one reason (the request carries one) and the acknowledgement. It runs today's flow:
 * break-glass, then, once the session that asked is ready, an emergency lookup; the record opens only when that lookup
 * allows it and the session still accepts it, and then the emergency summary shows.
 */
export function BreakGlassCard() {
  const { facility, permissions, setActivePatient } = useClinical()
  const navigate = useNavigate()
  const href = useWorkspaceHref()
  const id = useId()
  // A Health ID handed over from Find a patient, if any, read once.
  const [hid, setHid] = useState(() => offeredHealthId(facility?.id, setActivePatient))
  useEffect(() => { dropOfferedHealthId() }, [])
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [problems, setProblems] = useState<Problems>({})
  // A problem refused from Enter in its own field cannot move focus to say why: it is an alert there, new each time.
  const [alerted, setAlerted] = useState<{ field: FieldKey; key: number } | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ field: FieldKey; key: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const alerts = useRef(0)
  const normalized = normalizeHealthIdInput(hid)
  const administrator = usesNovuBackend() && permissions.includes('workforce.manage') ? selfServiceReview(facility) : null
  const unavailable = actionUnavailable(EMERGENCY_ACCESS, permissions, administrator)
  const unavailableId = `${id}-unavailable`
  const controlId = (field: FieldKey) => `${id}-${field}`

  useLayoutEffect(() => {
    if (focusRequest) document.getElementById(`${id}-${focusRequest.field}`)?.focus()
  }, [focusRequest, id])

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
    if (!ack) found.ack = 'Tick the box to go on.'
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
      const within = document.activeElement === document.getElementById(controlId(first))
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
    // The record opens only while the session that asked for emergency access is ready: it waits while that session
    // is checked, and never opens once it ended.
    const sentIn = staffSessionGeneration()
    try {
      try {
        await staffApi.breakGlass(facility.id, normalized, reason.trim())
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
      if (setActivePatient({ hid: normalized, lookup, purpose: 'emergency' })) navigate(href('summary'))
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : COMMAND_FAILED)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const ackError = errorFor('ack')
  const ackErrorId = `${id}-ack-error`
  const describe = (field: FieldKey, hint: boolean) => problems[field] ? `${controlId(field)}-error` : hint ? `${controlId(field)}-hint` : undefined

  return (
    <Card>
      <form noValidate className="flex flex-col gap-5 p-5" onSubmit={event => void submit(event)}>
        <Alert intent="warning" live={false} title={NOTICE_WHEN}>
          {NOTICE_BEFORE}{usesNovuBackend() ? ` ${EMERGENCY_CONTACTS_TOLD}` : ''}
        </Alert>
        <Field label="Health ID" htmlFor={controlId('hid')} hint={HID_FORMAT} hintId={`${controlId('hid')}-hint`} error={errorFor('hid')} errorId={`${controlId('hid')}-error`}>
          <Input id={controlId('hid')} required autoComplete="off" spellCheck={false} value={hid} placeholder="HID-ADA2345"
            className="font-medium tracking-[.06em] uppercase" aria-invalid={problems.hid ? true : undefined} aria-describedby={describe('hid', true)}
            onChange={event => { setHid(healthIdInput(event.target.value)); changed('hid') }} />
        </Field>
        <Field label="Why do you need emergency access?" htmlFor={controlId('reason')} hint="What is happening, and why care can’t wait. It’s kept with the review."
          hintId={`${controlId('reason')}-hint`} error={errorFor('reason')} errorId={`${controlId('reason')}-error`}>
          <Textarea id={controlId('reason')} required rows={3} maxLength={REASON_MAX} value={reason}
            aria-invalid={problems.reason ? true : undefined} aria-describedby={describe('reason', true)}
            onChange={event => { setReason(event.target.value); changed('reason') }} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input id={controlId('ack')} type="checkbox" required checked={ack} className="mt-0.5 size-4 shrink-0 accent-brand-fill"
              aria-invalid={problems.ack ? true : undefined} aria-describedby={ackError ? ackErrorId : undefined}
              onChange={event => { setAck(event.target.checked); changed('ack') }} />
            <span>{ACKNOWLEDGE}</span>
          </label>
          {ackError ? <p id={ackErrorId} className="m-0 text-xs font-medium text-danger-ink">{ackError}</p> : null}
        </div>
        {error ? <Alert intent="error" title="Couldn’t open emergency access">{error}</Alert> : null}
        {unavailable ? <p id={unavailableId} className="m-0 text-[13px] text-ink-3">{unavailable}</p> : null}
        <FormActions sticky={false}>
          <Button type="submit" variant="destructive" icon={Siren} loading={busy} disabled={!facility || unavailable !== null}
            aria-describedby={unavailable ? unavailableId : undefined}>{busy ? 'Opening…' : 'Open emergency access'}</Button>
        </FormActions>
      </form>
    </Card>
  )
}
