import { HEALTH_ID_PREFIX, normalizeHealthIdInput } from '@hid/contracts'
import { Send } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FormActions, FormPage } from '../../../kasuwa/parts'
import { Alert, Button, Card, Field, Input, Textarea, cx } from '../../../kasuwa/ui'
import { staffApi } from '../../../staff/api'
import { failureText } from '../parts/chart'
import type { FieldErrors, FormValues } from '../parts/RecordForm'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  HID_FORMAT, METHOD_ROUTES, actionUnavailable, administratorOf, dropOfferedHealthId, healthIdProblem, offeredHealthId,
} from './access'

/** Today always asks for 60 minutes, so 60 is the default; the person may choose less (the design's 1 to 60). */
export const DEFAULT_MINUTES = '60'
export const DURATION_PROBLEM = 'Enter a number of minutes from 1 to 60.'
export const REASON_PROBLEM = 'Say why in at least 8 characters.'

function text(values: FormValues, key: string): string {
  const value = values[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Today's checks for an access request; the design's 1 to 60 minutes for the duration. A Health ID of HID- alone (the
 * field's start) is empty: "Enter the patient’s Health ID.".
 */
export function requestProblems(values: FormValues): FieldErrors {
  const errors: Record<string, string> = {}
  const hidProblem = healthIdProblem(normalizeHealthIdInput(text(values, 'hid')))
  if (hidProblem) errors.hid = hidProblem
  if (text(values, 'reason').trim().length < 8) errors.reason = REASON_PROBLEM
  const minutes = text(values, 'duration').trim()
  if (!/^\d{1,2}$/.test(minutes) || Number(minutes) < 1 || Number(minutes) > 60) errors.duration = DURATION_PROBLEM
  return errors
}

type Scope = 'read_records' | 'write_records'
const ORDER = ['hid', 'scope', 'duration', 'reason'] as const
type Key = (typeof ORDER)[number]

const SCOPES: ReadonlyArray<{ value: Scope; label: string; hint: string }> = [
  { value: 'read_records', label: 'See their records', hint: 'Read only' },
  { value: 'write_records', label: 'See and add to their records', hint: 'For notes, vitals and orders' },
]

/**
 * "Ask the patient for access" (today's "Request" method). A request waiting for the patient shows nothing of their
 * record; the page goes to the new request. One column, the Health ID handed over from Find a patient already in it.
 */
export function RequestAccess() {
  const { facility, permissions, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const id = useId()
  // A Health ID handed over from Patients, read once; otherwise the field starts at HID-, as today's does.
  const [hid, setHid] = useState(() => offeredHealthId(facility?.id, setActivePatient) || HEALTH_ID_PREFIX)
  useEffect(() => { dropOfferedHealthId() }, [])
  const [scope, setScope] = useState<Scope>('read_records')
  const [duration, setDuration] = useState(DEFAULT_MINUTES)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ key: Key; n: number } | null>(null)
  const sending = useRef(false)
  const unavailable = actionUnavailable(METHOD_ROUTES.request, permissions, administratorOf(facility, permissions))
  const unavailableId = `${id}-unavailable`

  // The first problem gets focus as it is shown.
  useLayoutEffect(() => { if (focusRequest) document.getElementById(`${id}-${focusRequest.key}`)?.focus() }, [focusRequest, id])
  const clear = (key: Key) => setErrors(current => {
    if (!(key in current)) return current
    const next = { ...current }
    delete next[key]
    return next
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current || !facility || unavailable) return
    setFormError(null)
    const found = requestProblems({ hid, scope, duration, reason })
    setErrors(found)
    const first = ORDER.find(key => found[key])
    if (first) { setFocusRequest(current => ({ key: first, n: (current?.n ?? 0) + 1 })); return }
    sending.current = true
    setBusy(true)
    try {
      const request = await staffApi.requestAccess(facility.id, normalizeHealthIdInput(hid), scope, reason.trim(), Number(duration.trim()))
      navigate(href(request.accessRequestId), {
        state: { notice: 'Request sent. You can see their records once the patient approves.' },
      })
    } catch (caught) {
      setFormError(failureText(caught, 'Something went wrong. Please try again.'))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const describe = (key: Key, hint?: boolean) => [errors[key] ? `${id}-${key}-error` : hint ? `${id}-${key}-hint` : ''].filter(Boolean).join(' ') || undefined

  return (
    <FormPage title="Ask the patient for access" description="They approve on their phone. You see nothing until they do."
      back={{ to: href(), label: 'Back to access requests' }}>
      <Card>
        <form noValidate className="flex flex-col gap-5 p-5" onSubmit={event => void submit(event)}>
          <Field label="Health ID" htmlFor={`${id}-hid`} hint={HID_FORMAT} hintId={`${id}-hid-hint`} error={errors.hid} errorId={`${id}-hid-error`}>
            <Input id={`${id}-hid`} value={hid} placeholder="HID-ADA2345" autoComplete="off" spellCheck={false}
              className="font-medium tracking-[.06em] uppercase" aria-invalid={errors.hid ? true : undefined} aria-describedby={describe('hid', true)}
              onChange={event => { setHid(normalizeHealthIdInput(event.target.value)); clear('hid') }} />
          </Field>

          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[13px] font-medium text-ink-2">What do you need?</legend>
            <div className="grid gap-2 @md:grid-cols-2">
              {SCOPES.map((option, index) => <label key={option.value} className={cx('flex min-h-11 cursor-pointer items-start gap-3 rounded-lg p-3 ring-1',
                scope === option.value ? 'bg-brand-soft ring-brand-line' : 'bg-surface ring-line-control')}>
                <input id={index === 0 ? `${id}-scope` : undefined} type="radio" name={`${id}-scope`} value={option.value} checked={scope === option.value}
                  onChange={() => setScope(option.value)} className="mt-0.5 size-4 accent-brand-fill" />
                <span className="min-w-0"><span className="block text-sm font-medium text-ink">{option.label}</span>
                  <span className="block text-[12px] text-ink-3">{option.hint}</span></span>
              </label>)}
            </div>
          </fieldset>

          <Field label="How long (minutes)" htmlFor={`${id}-duration`} hint="Up to 60 minutes." hintId={`${id}-duration-hint`} error={errors.duration} errorId={`${id}-duration-error`}>
            <Input id={`${id}-duration`} type="number" inputMode="numeric" min={1} max={60} step={1} value={duration}
              className="max-w-32" aria-invalid={errors.duration ? true : undefined} aria-describedby={describe('duration', true)}
              onChange={event => { setDuration(event.target.value); clear('duration') }} />
          </Field>

          <Field label="Why (the patient sees this)" htmlFor={`${id}-reason`} error={errors.reason} errorId={`${id}-reason-error`}>
            <Textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason}
              aria-invalid={errors.reason ? true : undefined} aria-describedby={describe('reason')}
              onChange={event => { setReason(event.target.value); clear('reason') }} />
          </Field>

          {formError ? <Alert intent="error" title="Couldn’t send the request">{formError}</Alert> : null}
          {unavailable ? <p id={unavailableId} className="m-0 text-[13px] text-ink-3">{unavailable}</p> : null}
          <FormActions sticky={false}>
            <Button type="submit" variant="primary" icon={Send} loading={busy} disabled={!facility || unavailable !== null}
              aria-describedby={unavailable ? unavailableId : undefined}>{busy ? 'Sending…' : 'Send request'}</Button>
          </FormActions>
        </form>
      </Card>
    </FormPage>
  )
}
