import { HEALTH_ID_PREFIX, normalizeHealthIdInput } from '@hid/contracts'
import { EhrCard } from '@hid/ui/ehr'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../../staff/api'
import { failureText } from '../parts/chart'
import { RecordHeading } from '../parts/Notices'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues } from '../parts/RecordForm'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  HID_FORMAT, METHOD_ROUTES, actionUnavailable, administratorOf, dropOfferedHealthId, healthIdProblem, offeredHealthId,
} from './access'

/** Today always asks for 60 minutes, so 60 is the default; the person may choose less (the design's 1 to 60). */
export const DEFAULT_MINUTES = '60'
export const DURATION_PROBLEM = 'Access duration must be 1–60 minutes.'
export const REASON_PROBLEM = 'Enter a clinical reason of at least 8 characters.'

/** The Health ID comes first: it is the form's first input. */
const FIELDS: readonly FieldDef[] = [
  { key: 'hid', label: 'Health ID', required: true, hint: HID_FORMAT, autoComplete: 'off', full: true },
  { key: 'reason', label: 'Purpose of access', required: true, maxLength: 500 },
  {
    key: 'scope', label: 'Access scope', required: true,
    choices: [{ value: 'read_records', label: 'Read records' }, { value: 'write_records', label: 'Read and write records' }],
  },
  { key: 'duration', label: 'Duration (minutes, max 60)', type: 'number', required: true, min: 1, max: 60, step: 1, inputMode: 'numeric' },
]

function text(values: FormValues, key: string): string {
  const value = values[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Today's checks for an access request, in today's words; the design's 1 to 60 minutes for the duration. A Health ID
 * of HID- alone (the field's start) is empty: "Enter the patient’s Health ID.", in place of the form's own "Complete
 * this field.".
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

/**
 * "New external record access": ask the patient to approve access (today's "Request" method). A pending request does
 * not expose the record; the page goes to the new request, which waits for the patient.
 */
export function RequestAccess() {
  const { facility, permissions, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  // A Health ID handed over from Patients, read once; otherwise the field starts at HID-, as today's does.
  const [hid] = useState(() => offeredHealthId(facility?.id, setActivePatient) || HEALTH_ID_PREFIX)
  useEffect(() => { dropOfferedHealthId() }, [])
  const form = useRef<HTMLDivElement>(null)
  const unavailable = actionUnavailable(METHOD_ROUTES.request, permissions, administratorOf(facility, permissions))

  /**
   * Today's Health ID field is normalized as it changes (capitals, no spaces, the prefix once; emptied, it holds HID-
   * again). The form keeps its own values, so the Health ID is normalized here, on its way to the form's handler.
   */
  function normalizeHealthId(event: FormEvent<HTMLDivElement>) {
    const control = event.target
    if (control instanceof HTMLInputElement && control === form.current?.querySelector('input')) {
      control.value = normalizeHealthIdInput(control.value)
    }
  }

  async function send(values: FormValues) {
    if (!facility || unavailable) return
    const scope = text(values, 'scope') === 'write_records' ? 'write_records' : 'read_records'
    try {
      const request = await staffApi.requestAccess(facility.id, normalizeHealthIdInput(text(values, 'hid')), scope,
        text(values, 'reason').trim(), Number(text(values, 'duration').trim()))
      navigate(href(request.accessRequestId), {
        state: { notice: `Request ${request.accessRequestId} is ${request.status}. The patient must approve before records are available.` },
      })
    } catch (caught) {
      return { formError: failureText(caught, 'The access command failed.') }
    }
  }

  return (
    <>
      <RecordHeading title="New external record access" backHref={href()} />
      <EhrCard>
        <div ref={form} onChangeCapture={normalizeHealthId}>
          <RecordForm
            className="hid-ehr-clinical-consent-request-form"
            fields={FIELDS}
            initial={{ hid, scope: 'read_records', duration: DEFAULT_MINUTES }}
            submitLabel="Send access request"
            busyLabel="Working…"
            validate={requestProblems}
            disabled={!facility || unavailable !== null}
            onSubmit={send}
          >
            {unavailable ? <p className="hid-ehr-clinical-note">{unavailable}</p> : null}
          </RecordForm>
        </div>
      </EhrCard>
    </>
  )
}
