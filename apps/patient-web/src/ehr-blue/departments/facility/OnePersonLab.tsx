import { useCallback, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrDialog, EhrField, EhrTextarea } from '@hid/ui/ehr'
import { staffApi, type FacilitySettings } from '../../../staff/api'
import { DeptSection } from '../parts/DeptPage'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptFacts } from '../parts/DeptRecord'
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'

/*
 * One-person lab (owner decision 33.3, hid-system 0111), for the facility administrator: whether the scientist who
 * entered a lab result may check it themselves, with a typed reason. Off everywhere until the administrator turns it on;
 * every switch is recorded with who, when and why, and Identity decides who may change it. Offered to holders of
 * organization.manage, wherever Identity answers the read: a 404 is an image before 0111, and nothing is shown.
 */

export const ONE_PERSON_EXPLAINED = 'When it’s on, the scientist who entered a result can check it themselves, with a reason. '
  + 'Every self-check is recorded.'

const REASON_MIN = 10
const REASON_MAX = 500

/** Identity's refusals in plain words; only the code is compared, and it is never shown. */
const REFUSED: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Check the reason (10 to 500 characters) and try again.',
  FACILITY_SETTING_REASON_INVALID: 'Enter a reason of 10 to 500 characters.',
  FACILITY_SETTING_INVALID: 'The setting could not be read; try again.',
  PERMISSION_DENIED: 'Only the facility administrator can change this.',
  FACILITY_SETTING_PERMISSION_DENIED: 'Only the facility administrator can change this.',
  FACILITY_SETTING_UNCHANGED: 'One-person lab is already set that way.',
  FACILITY_SETTINGS_UNAVAILABLE: 'Facility settings are unavailable; try again later.',
}
/** Refusals about the reason: said at the reason, so it can be fixed there. */
const AT_REASON: ReadonlySet<string> = new Set(['VALIDATION_FAILED', 'FACILITY_SETTING_REASON_INVALID'])
const UNANSWERED: ReadonlySet<string> = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT'])
const NOT_REACHED = 'Couldn’t reach Health ID. Check the connection and try again.'

function refusalWords(caught: unknown, fallback: string): string {
  if (!isHidApiError(caught)) return fallback
  return REFUSED[caught.code] ?? (UNANSWERED.has(caught.code) ? NOT_REACHED : fallback)
}

/** A reason's length as Identity counts it: characters after trimming. */
const lengthOf = (reason: string) => [...reason.trim()].length

const readSettings = (facilityId: string) => staffApi.facilitySettings(facilityId)

export function OnePersonLab({ facilityId, permissions }: { readonly facilityId: string; readonly permissions: readonly string[] }) {
  const allowed = permissions.includes('organization.manage')
  const read = useFacilityRead<FacilitySettings>(facilityId, allowed, readSettings)
  // Read again after a refused read: the section stays, so Try again keeps its place.
  const [retrying, setRetrying] = useState(false)
  if (!allowed) return null
  // An image before 0111 has no such read: nothing is shown, as today.
  if (isHidApiError(read.caught) && read.caught.status === 404) return null
  if (!read.value) {
    if (!read.caught && !(retrying && read.loading)) return null
    return (
      <DeptSection title="One-person lab">
        {read.loading ? <p role="status" className="hid-ehr-dept-muted">Loading the one-person lab setting…</p> : (
          <DeptNotice tone="caution" role="alert">
            <p>{refusalWords(read.caught, 'The one-person lab setting could not be loaded. Try again later.')}</p>
          </DeptNotice>
        )}
        <div className="hid-ehr-actions">
          <EhrButton variant="secondary" busy={read.loading} onClick={() => { if (!read.loading) { setRetrying(true); void read.refresh() } }}>Try again</EhrButton>
        </div>
      </DeptSection>
    )
  }
  return <OnePersonLabSwitch facilityId={facilityId} settings={read.value} onChanged={read.refresh} />
}

function OnePersonLabSwitch({ facilityId, settings, onChanged }: {
  readonly facilityId: string; readonly settings: FacilitySettings; readonly onChanged: () => Promise<void>
}) {
  const { enabled, changedAt, changedByName, reason: lastReason } = settings.onePersonLab
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>(undefined)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')
  const turn = enabled ? 'Turn off' : 'Turn on'
  const reasonId = `ehr-facility-one-person-reason-${facilityId}`
  const focusReason = useCallback(() => document.getElementById(reasonId)?.focus(), [reasonId])

  function start() { setEditing(true); setReason(''); setReasonError(undefined); setProblem(''); setDone('') }
  function cancel() { setEditing(false); setReason(''); setReasonError(undefined) }

  function check(event: FormEvent) {
    event.preventDefault()
    const length = lengthOf(reason)
    if (length < REASON_MIN || length > REASON_MAX) { setReasonError('Enter a reason of 10 to 500 characters.'); focusReason(); return }
    setReasonError(undefined); setProblem('')
    setAsking(true)
  }

  async function change() {
    if (busy) return
    setBusy(true)
    try {
      const answer = await staffApi.setOnePersonLab(facilityId, !enabled, reason.trim())
      setAsking(false); setEditing(false); setReason('')
      setDone(answer.enabled ? 'One-person lab is now on.' : 'One-person lab is now off.')
      void onChanged()
    } catch (caught) {
      setAsking(false)
      const said = refusalWords(caught, 'One-person lab could not be changed. Try again.')
      if (isHidApiError(caught) && AT_REASON.has(caught.code)) { setReasonError(said); focusReason() }
      else setProblem(said)
      // Already set that way: what is shown is read again.
      if (isHidApiError(caught) && caught.code === 'FACILITY_SETTING_UNCHANGED') void onChanged()
    } finally { setBusy(false) }
  }

  const changed = changedAt
    ? `${dateText(changedAt)}${changedByName ? ` by ${changedByName}` : ''}`
    : 'Never changed. It is off until the facility administrator turns it on.'

  return (
    <DeptSection title="One-person lab">
      <p><strong>One-person lab: {enabled ? 'On' : 'Off'}</strong></p>
      <p className="hid-ehr-dept-muted">{ONE_PERSON_EXPLAINED}</p>
      <DeptFacts facts={[
        { label: 'Last changed', value: changed },
        ...(changedAt && lastReason ? [{ label: 'Reason', value: lastReason }] : []),
      ]} />
      {done ? <DeptNotice tone="positive" role="status"><p>{done}</p></DeptNotice> : null}
      {problem ? <DeptNotice tone="critical" role="alert"><p>{problem}</p></DeptNotice> : null}
      {editing ? (
        <form noValidate onSubmit={check} aria-label={`${turn} one-person lab`}>
          <EhrField controlId={reasonId} label="Reason" error={reasonError}
            hint={`${lengthOf(reason)} of ${REASON_MAX} characters; at least ${REASON_MIN}.`}>
            <EhrTextarea value={reason} rows={3} maxLength={REASON_MAX} required
              onChange={event => { setReason(event.target.value); setReasonError(undefined) }} />
          </EhrField>
          <div className="hid-ehr-actions">
            <EhrButton variant="secondary" onClick={cancel}>Cancel</EhrButton>
            <EhrButton type="submit" variant="primary">{turn}</EhrButton>
          </div>
        </form>
      ) : (
        <div className="hid-ehr-actions">
          <EhrButton variant="primary" onClick={start}>{turn}</EhrButton>
        </div>
      )}
      <EhrDialog open={asking} title={enabled ? 'Turn off one-person lab?' : 'Turn on one-person lab?'} busy={busy}
        description={enabled
          ? 'Every lab result will again need a second person to check it. Your reason is recorded with the change.'
          : 'The scientist who entered a result will be able to check it themselves, with a reason. Every self-check is '
            + 'recorded, and your reason is recorded with the change.'}
        confirmLabel={turn} onConfirm={() => void change()} onCancel={() => setAsking(false)} />
    </DeptSection>
  )
}
