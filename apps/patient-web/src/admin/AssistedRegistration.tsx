import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { adminApi, newIdempotencyKey, type AdminActor, type AssistedRegistrationDesignation,
  type AssistedRegistrationDesignationInput } from './api'
import { StepUpCancelledError, useStepUp } from './StepUp'
import { Status, ResourceView, commandFailure, date, has, useResource } from './ui'
import { isProblem } from './problems'

/**
 * A facility's designation for facility-assisted registration (hid-system main
 * f9dbaf0: #85, migration 0094, ADR-063; INTERFACE_CONTRACT.md "Facility-assisted
 * registration"). An active designation lets its doctors, clinicians and nurses
 * check patients in person, and lists the facility's name with this location
 * in the public list of participating facilities while
 * ASSISTED_REGISTRATION_ENABLED is on. Reading needs platform.facility.read;
 * changing it needs platform.facility.manage, a fresh step-up, a reason, an
 * Idempotency-Key and If-Match with the version read, 0 for the first.
 */

/** This screen's explanations of the command's refusals (admin/admin-command-error.ts). */
const DESIGNATION_PROBLEMS: Readonly<Record<string, string>> = {
  ADMIN_STATE_CONFLICT: 'Nothing changed: the designation already has this status and location.',
  ADMIN_COMMAND_INVALID: 'This designation was refused. A facility’s first designation must be active; check the values and try again.',
  PERMISSION_DENIED: 'Changing the designation needs the platform.facility.manage permission. Ask a Super Admin.',
  VERSION_CONFLICT: 'The designation changed since it was read. It has been read again: check it, then make your change again.',
  VALIDATION_FAILED: 'Check the values: town, LGA and state are required (up to 120 characters), the address line and hours up to 200, and the reason 8 to 500 characters.',
  ADMIN_RESOURCE_NOT_FOUND: 'This facility was not found. Check the facility link.',
}

const SAVE_FAILED = 'The designation could not be saved. Try again.'

/** A text patients are shown has no control characters (the DTO's SHOWN_TEXT): a tab or line break pasted in. */
function hasControlCharacter(text: string): boolean {
  return [...text].some(character => { const code = character.charCodeAt(0); return code < 0x20 || code === 0x7f })
}

type Field = 'addressLine' | 'town' | 'lga' | 'state' | 'hours' | 'reason'
interface Values { status: 'active' | 'suspended'; addressLine: string; town: string; lga: string; state: string; hours: string; reason: string }

const LIMITS: Record<Field, { max: number; required: boolean; missing: string }> = {
  addressLine: { max: 200, required: false, missing: '' },
  town: { max: 120, required: true, missing: 'Enter the town patients are shown.' },
  lga: { max: 120, required: true, missing: 'Enter the local government area patients are shown.' },
  state: { max: 120, required: true, missing: 'Enter the state patients are shown.' },
  hours: { max: 200, required: false, missing: '' },
  reason: { max: 500, required: true, missing: '' },
}

const REASON = 'Enter a reason of 8 to 500 characters. It is recorded in the audit log.'

function refusal(field: Field, value: string): string | null {
  const text = value.trim()
  if (field === 'reason') return text.length < 8 || text.length > 500 ? REASON : null
  const limit = LIMITS[field]
  if (limit.required && !text) return limit.missing
  if (text.length > limit.max) return `Use at most ${limit.max} characters.`
  if (hasControlCharacter(text)) return 'Remove the tab or line break.'
  return null
}

function bodyOf(values: Values): AssistedRegistrationDesignationInput {
  const addressLine = values.addressLine.trim()
  const hours = values.hours.trim()
  return { status: values.status, ...(addressLine ? { addressLine } : {}), town: values.town.trim(), lga: values.lga.trim(),
    state: values.state.trim(), ...(hours ? { hours } : {}), reason: values.reason.trim() }
}

const TITLE = 'admin-assisted-registration-title'

export function AssistedRegistrationPanel({ facilityId, actor, onChanged }: {
  facilityId: string; actor: AdminActor; onChanged: () => void
}) {
  const load = useCallback((signal?: AbortSignal) => adminApi.assistedRegistration(facilityId, signal), [facilityId])
  const resource = useResource(load, 'The designation for registration in person could not be loaded.')
  // A submission's answer, numbered: each is a new element, and a submission clears the last one when it starts,
  // so the same words answering again are announced again.
  const [outcome, setOutcome] = useState<{ tone: 'error' | 'notice'; text: string; seq: number } | null>(null)
  const outcomes = useRef(0)
  const show = (tone: 'error' | 'notice', text: string) => setOutcome({ tone, text, seq: ++outcomes.current })
  // A save or a version conflict reads the designation again, and its new version replaces the form and the
  // button that had focus: focus moves to the panel's heading instead of falling to the page.
  const [headingFocus, setHeadingFocus] = useState(0)
  useEffect(() => { if (headingFocus) document.getElementById(TITLE)?.focus() }, [headingFocus])
  const canManage = has(actor, 'platform.facility.manage')

  return <section className="admin-panel" aria-labelledby={TITLE}>
    <div className="admin-panel-head"><div>
      <h2 id={TITLE} tabIndex={-1}>Registration in person</h2>
      <p>Whether patients who cannot receive a code on the phone of their NIN record can prove here, with an original photo ID,
        that they hold their NIN. While it is active and registration at a facility is switched on, the public list of
        participating facilities shows this facility’s name and the location below.</p>
    </div></div>
    <ResourceView resource={resource}>{designation => <>
      <Designation designation={designation} />
      {canManage
        ? <DesignationForm key={`${designation.version}`} facilityId={facilityId} designation={designation}
          onSubmitting={() => setOutcome(null)}
          onSaved={(saved, replayed) => {
            show('notice', replayed ? 'This designation was already saved.'
              : saved === 'active' ? 'Saved. Patients can now be checked in person here while registration at a facility is switched on.'
                : 'Saved. No patient can be checked in person here while it is suspended.')
            setHeadingFocus(count => count + 1)
            resource.reload(); onChanged()
          }}
          onFailed={(caught, message) => {
            show('error', message)
            // The command names a version no longer current: read the designation again.
            if (isProblem(caught, 'VERSION_CONFLICT')) {
              setHeadingFocus(count => count + 1)
              resource.reload()
            }
          }} />
        : <p className="admin-note">Changing it needs the platform.facility.manage permission.</p>}
    </>}</ResourceView>
    {outcome?.tone === 'error' && <p key={outcome.seq} className="admin-error" role="alert">{outcome.text}</p>}
    {/* Always present, so a notice is announced as it appears in it. */}
    <div role="status">{outcome?.tone === 'notice' && <p key={outcome.seq} className="admin-success">{outcome.text}</p>}</div>
  </section>
}

function Designation({ designation }: { designation: AssistedRegistrationDesignation }) {
  if (!designation.designated) return <p>This facility does not take part in registration in person.</p>
  return <dl className="admin-detail-grid">
    <div><dt>Status</dt><dd><Status value={designation.status ?? 'unknown'} /></dd></div>
    <div><dt>Address line</dt><dd>{designation.addressLine ?? 'Not given'}</dd></div>
    <div><dt>Town</dt><dd>{designation.town}</dd></div>
    <div><dt>Local government area</dt><dd>{designation.lga}</dd></div>
    <div><dt>State</dt><dd>{designation.state}</dd></div>
    <div><dt>Opening hours</dt><dd>{designation.hours ?? 'Not given'}</dd></div>
    <div><dt>Reason</dt><dd>{designation.reason ?? 'Not recorded'}</dd></div>
    <div><dt>Changed</dt><dd>{date(designation.updatedAt)}</dd></div>
  </dl>
}

function DesignationForm({ facilityId, designation, onSubmitting, onSaved, onFailed }: {
  facilityId: string; designation: AssistedRegistrationDesignation
  /** A submission is about to be sent: the last answer no longer stands. */
  onSubmitting: () => void
  onSaved: (status: 'active' | 'suspended', replayed: boolean) => void
  onFailed: (caught: unknown, message: string) => void
}) {
  const first = !designation.designated
  const [values, setValues] = useState<Values>({
    status: designation.status === 'suspended' ? 'suspended' : 'active',
    addressLine: designation.addressLine ?? '', town: designation.town ?? '', lga: designation.lga ?? '',
    state: designation.state ?? '', hours: designation.hours ?? '', reason: '',
  })
  // A value refused before sending, said at its field. Focus moves there once it shows, so its description is
  // read; refused from Enter in that field, focus cannot move, so the message is an alert instead.
  const [refused, setRefused] = useState<{ field: Field; message: string; alert: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const withStepUp = useStepUp()
  // The submission whose answer is unknown (a 503 or a lost connection), sent again with its key while nothing changed.
  const pending = useRef<{ signature: string; key: string } | null>(null)
  const id = (field: Field) => `admin-assisted-${field}`
  useEffect(() => { if (refused && !refused.alert) document.getElementById(id(refused.field))?.focus() }, [refused])

  function change(field: keyof Values, value: string) {
    setValues(previous => ({ ...previous, [field]: value }))
    if (refused?.field === field) setRefused(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    for (const field of ['addressLine', 'town', 'lga', 'state', 'hours', 'reason'] as const) {
      const message = refusal(field, values[field])
      if (message) {
        setRefused({ field, message, alert: document.activeElement?.id === id(field) })
        return
      }
    }
    setRefused(null)
    // The first designation is active: If-Match 0 with suspended is refused.
    const body = bodyOf(first ? { ...values, status: 'active' } : values)
    const signature = JSON.stringify([designation.version, body])
    const key = pending.current?.signature === signature ? pending.current.key : newIdempotencyKey()
    pending.current = { signature, key }
    setBusy(true)
    onSubmitting()
    try {
      const saved = await withStepUp(() => adminApi.setAssistedRegistration(facilityId, body, designation.version, key))
      pending.current = null
      onSaved(saved.status, saved.replayed)
    } catch (caught) {
      // Only an answer that may have been recorded keeps its key: a 5xx, or none at all.
      const unknown = !isHidApiError(caught) ? !(caught instanceof StepUpCancelledError) : caught.status === 0 || caught.status >= 500
      if (!unknown) pending.current = null
      onFailed(caught, commandFailure(caught, SAVE_FAILED, DESIGNATION_PROBLEMS))
    } finally { setBusy(false) }
  }

  const input = (field: Field, label: string, options: { optional?: boolean; hint?: string } = {}) => {
    const error = refused?.field === field ? refused.message : null
    const alert = refused?.field === field && refused.alert
    // As Field does: an error replaces the hint, and describes the control alone.
    const described = error ? `${id(field)}-error` : options.hint ? `${id(field)}-hint` : ''
    return <div className="admin-designation-field">
      <label htmlFor={id(field)}>{label}{options.optional ? ' (optional)' : ''}</label>
      {field === 'reason'
        ? <textarea id={id(field)} rows={3} maxLength={500} value={values.reason} onChange={event => change(field, event.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={described || undefined} />
        : <input id={id(field)} value={values[field]} maxLength={LIMITS[field].max} autoComplete="off"
          onChange={event => change(field, event.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={described || undefined} />}
      {options.hint && !error && <small id={`${id(field)}-hint`} className="admin-note">{options.hint}</small>}
      {error && <small id={`${id(field)}-error`} className="admin-field-error" role={alert ? 'alert' : undefined}>{error}</small>}
    </div>
  }

  return <form className="admin-action-form admin-designation-form" noValidate onSubmit={event => void submit(event)}>
    <h3>{first ? 'Designate this facility' : 'Change the designation'}</h3>
    {first
      ? <p className="admin-note">A first designation is active. Only a verified, active facility of an active organization can be designated.</p>
      : <fieldset className="admin-designation-status">
        <legend>Status</legend>
        <label className="admin-checkbox"><input type="radio" name="admin-assisted-status" value="active" checked={values.status === 'active'}
          onChange={() => change('status', 'active')} /> Active: its doctors, clinicians and nurses can check patients in person</label>
        <label className="admin-checkbox"><input type="radio" name="admin-assisted-status" value="suspended" checked={values.status === 'suspended'}
          onChange={() => change('status', 'suspended')} /> Suspended: no checks, and not in the public list</label>
      </fieldset>}
    {input('addressLine', 'Address line', { optional: true })}
    {input('town', 'Town')}
    {input('lga', 'Local government area (LGA)')}
    {input('state', 'State')}
    {input('hours', 'Opening hours', { optional: true, hint: 'As patients should read it, for example “Mon to Fri, 9am to 4pm”.' })}
    {input('reason', 'Reason for this designation change', { hint: 'Recorded in the audit log. The change also needs your authenticator confirmation.' })}
    {/* Kept focusable while it runs; a second press does nothing. */}
    <button type="submit" className="admin-primary" aria-disabled={busy || undefined}>
      {busy ? 'Saving…' : first ? 'Designate facility' : 'Save designation'}
    </button>
  </form>
}
