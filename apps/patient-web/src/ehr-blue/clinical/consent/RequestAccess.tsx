import { normalizeHealthIdInput } from '@hid/contracts'
import { EhrCard } from '@hid/ui/ehr'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../../staff/api'
import { failureText } from '../parts/chart'
import { RecordHeading } from '../parts/Notices'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues } from '../parts/RecordForm'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  HID_FORMAT, METHOD_ROUTES, actionUnavailable, administratorOf, dropOfferedHealthId, healthIdProblem, offeredHealthId,
} from './access'

/** The design prefills 30 minutes; Identity's grant lasts what was asked, up to the design's 60. */
export const DEFAULT_MINUTES = '30'
export const DURATION_PROBLEM = 'Access duration must be 1–60 minutes.'
export const REASON_PROBLEM = 'Enter a clinical reason of at least 8 characters.'

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

/** Today's checks for an access request, in today's words; the design's 1 to 60 minutes for the duration. */
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
  const { facility, permissions } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  // A Health ID handed over from Patients, read once.
  const [hid] = useState(() => offeredHealthId(facility?.id))
  useEffect(() => { dropOfferedHealthId() }, [])
  const unavailable = actionUnavailable(METHOD_ROUTES.request, permissions, administratorOf(facility, permissions))

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
        <p>Ask the patient to approve access. A pending request does not expose their record.</p>
        <RecordForm
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
      </EhrCard>
    </>
  )
}
