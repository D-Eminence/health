import { normalizeHealthIdInput } from '@hid/contracts'
import { EhrButton, EhrCard, EhrField, EhrInput } from '@hid/ui/ehr'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../../staff/api'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import { ErrorBox, RecordHeading } from '../parts/Notices'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  HID_FORMAT, METHOD_ROUTES, actionUnavailable, administratorOf, dropOfferedHealthId, healthIdInput, healthIdProblem,
  offeredHealthId, useOpenPatient,
} from './access'

export const PIN_PROBLEM = 'Enter the patient’s 4 to 8 digit access PIN.'

/**
 * Patient PIN access (today's "Patient PIN" method), drawn as the design's create page. The PIN is checked on the
 * server; once the session that sent it is ready again, the patient lookup opens the record, and only an allowed
 * lookup does.
 */
export function PinAccess() {
  const { facility, permissions } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const openPatient = useOpenPatient()
  const [hid, setHid] = useState(() => offeredHealthId(facility?.id))
  useEffect(() => { dropOfferedHealthId() }, [])
  const [pin, setPin] = useState('')
  const [problem, setProblem] = useState<{ field: 'hid' | 'pin'; message: string; alert: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const hidInput = useRef<HTMLInputElement>(null)
  const pinInput = useRef<HTMLInputElement>(null)
  const unavailable = actionUnavailable(METHOD_ROUTES.pin, permissions, administratorOf(facility, permissions))

  /** A refusal at its field: focus moves there, or, from Enter in the field, the message is announced as an alert. */
  function refuse(field: 'hid' | 'pin', message: string) {
    const input = field === 'hid' ? hidInput.current : pinInput.current
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
      setError(caught instanceof Error ? caught.message : 'The access command failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <RecordHeading title="Patient PIN access" backHref={href()} />
      <EhrCard>
        <p>Only the patient should share their access PIN. Verification and grant creation happen on the server.</p>
        <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void submit(event)}>
          <div className="hid-ehr-clinical-form-grid">
            <EhrField label={<>Health ID<span aria-hidden="true"> *</span></>} hint={HID_FORMAT} error={shown('hid')}>
              <EhrInput
                ref={hidInput}
                autoComplete="off"
                spellCheck={false}
                required
                value={hid}
                onChange={event => { setHid(healthIdInput(event.target.value)); if (problem?.field === 'hid') setProblem(null) }}
              />
            </EhrField>
            <EhrField label={<>Patient access PIN<span aria-hidden="true"> *</span></>} hint="4 to 8 digits." error={shown('pin')}>
              <EhrInput
                ref={pinInput}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="\s*(\d\s*){4,8}"
                maxLength={16}
                required
                value={pin}
                onChange={event => { setPin(event.target.value); if (problem?.field === 'pin') setProblem(null) }}
              />
            </EhrField>
          </div>
          {unavailable ? <p id="pin-access-unavailable" className="hid-ehr-clinical-note">{unavailable}</p> : null}
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          <div className="hid-ehr-clinical-form-footer">
            <EhrButton
              type="submit"
              busy={busy}
              disabled={!facility || unavailable !== null}
              aria-describedby={unavailable ? 'pin-access-unavailable' : undefined}
            >
              {busy ? 'Working…' : 'Verify PIN and open'}
            </EhrButton>
          </div>
        </form>
      </EhrCard>
    </>
  )
}
