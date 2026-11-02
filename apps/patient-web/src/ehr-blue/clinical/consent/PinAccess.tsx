import { HEALTH_ID_PREFIX, normalizeHealthIdInput } from '@hid/contracts'
import { KeyRound } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { FormActions, FormPage } from '../../../kasuwa/parts'
import { Alert, Button, Card, Field, Input } from '../../../kasuwa/ui'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../../staff/api'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import { isDemoFacility } from '../../blueFacilities'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  HID_FORMAT, METHOD_ROUTES, actionUnavailable, administratorOf, dropOfferedHealthId, healthIdProblem, offeredHealthId,
  useOpenPatient,
} from './access'

export const PIN_PROBLEM = 'Enter the patient’s 4 to 8 digit access PIN.'

/**
 * At the demo facilities only: that the seed gives no demo patient a PIN, how Patient One or Two sets one, and how wrong
 * PINs pause the check.
 */
export const DEMO_PIN_NOTE = 'No demo patient has a PIN yet. Demo Patient One or Two can set an Access PIN in the Health ID app, but not within 24 hours of a password reset. Patients Three to Ten have no login, so they never have one. Five wrong PINs in 15 minutes pause PIN checks for this demo login here for 15 minutes.'

/**
 * Patient PIN access (today's "Patient PIN" method), one column. The Health ID handed over from Find a patient is
 * already in it, so the PIN field takes focus. Once the session that sent the PIN is ready again, the patient lookup
 * opens the record, and only an allowed lookup does. At a demo facility, the form first says that no demo patient has a
 * PIN yet and how one gets one.
 */
export function PinAccess() {
  const { facility, permissions, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const id = useId()
  const openPatient = useOpenPatient()
  // A Health ID handed over from Patients, read once; otherwise the field starts at HID-, as today's does.
  const [hid, setHid] = useState(() => offeredHealthId(facility?.id, setActivePatient) || HEALTH_ID_PREFIX)
  useEffect(() => { dropOfferedHealthId() }, [])
  const [pin, setPin] = useState('')
  const [problem, setProblem] = useState<{ field: 'hid' | 'pin'; message: string; alert: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unavailable = actionUnavailable(METHOD_ROUTES.pin, permissions, administratorOf(facility, permissions))

  /** A refusal at its field: focus moves there, or, from Enter in the field, the message is announced as an alert. */
  function refuse(field: 'hid' | 'pin', message: string) {
    const input = document.getElementById(`${id}-${field}`)
    const alert = document.activeElement === input
    setProblem({ field, message, alert })
    setAttempt(value => value + 1)
    if (!alert) input?.focus()
  }

  function shown(field: 'hid' | 'pin'): ReactNode {
    if (problem?.field !== field) return undefined
    return problem.alert ? <span key={attempt} role="alert">{problem.message}</span> : problem.message
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || unavailable) return
    setError('')
    const normalized = normalizeHealthIdInput(hid)
    const hidProblem = healthIdProblem(normalized)
    if (hidProblem) return refuse('hid', hidProblem)
    // Identity removes every space from a PIN before checking it, so a PIN typed in groups is one PIN.
    const compactPin = pin.replace(/\s+/g, '')
    if (!/^\d{4,8}$/.test(compactPin)) return refuse('pin', PIN_PROBLEM)
    setProblem(null)
    setBusy(true)
    // The record opens after the grant only while the session that obtained it is ready.
    const sentIn = staffSessionGeneration()
    try {
      if (!facility) throw new Error('Select a facility first.')
      await staffApi.verifyPin(facility.id, normalized, compactPin)
      await untilStaffSessionReady(sentIn)
      if (await openPatient(normalized, 'direct-care')) navigate(href.to('patients', 'open'))
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const hidId = `${id}-hid`
  const pinId = `${id}-pin`
  return (
    <FormPage title="Use the patient’s Access PIN" description="Ask the patient to type their PIN. Only they should know it."
      back={{ to: href(), label: 'Back to access requests' }}>
      <Card>
        <form noValidate className="flex flex-col gap-5 p-5" onSubmit={event => void submit(event)}>
          {isDemoFacility(facility?.id) ? <p className="m-0 text-[13px] text-ink-3">{DEMO_PIN_NOTE}</p> : null}
          <Field label="Health ID" htmlFor={hidId} hint={HID_FORMAT} hintId={`${hidId}-hint`} error={shown('hid')} errorId={`${hidId}-error`}>
            <Input id={hidId} autoComplete="off" spellCheck={false} required value={hid} placeholder="HID-ADA2345"
              className="font-medium tracking-[.06em] uppercase"
              aria-invalid={problem?.field === 'hid' ? true : undefined} aria-describedby={problem?.field === 'hid' ? `${hidId}-error` : `${hidId}-hint`}
              onChange={event => { setHid(normalizeHealthIdInput(event.target.value)); if (problem?.field === 'hid') setProblem(null) }} />
          </Field>
          <Field label="Access PIN" htmlFor={pinId} hint="4 to 8 digits." hintId={`${pinId}-hint`} error={shown('pin')} errorId={`${pinId}-error`}>
            <Input id={pinId} type="password" inputMode="numeric" autoComplete="off" pattern="\s*(\d\s*){4,8}" maxLength={16} required
              value={pin} className="max-w-48 tracking-[.3em]"
              aria-invalid={problem?.field === 'pin' ? true : undefined} aria-describedby={problem?.field === 'pin' ? `${pinId}-error` : `${pinId}-hint`}
              onChange={event => { setPin(event.target.value); if (problem?.field === 'pin') setProblem(null) }} />
          </Field>
          {unavailable ? <p id="pin-access-unavailable" className="m-0 text-[13px] text-ink-3">{unavailable}</p> : null}
          {error ? <Alert intent="error" title="Couldn’t open the record">{error}</Alert> : null}
          <FormActions sticky={false}>
            <Button type="submit" variant="primary" icon={KeyRound} loading={busy} disabled={!facility || unavailable !== null}
              aria-describedby={unavailable ? 'pin-access-unavailable' : undefined}>{busy ? 'Checking…' : 'Check PIN and open'}</Button>
          </FormActions>
        </form>
      </Card>
    </FormPage>
  )
}
