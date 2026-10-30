import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { staffApi, type AssistedDocumentType } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { useFocusById } from '../../../staff/focus'
import { normalizeDeskCode } from '../../../staff/routes/InPersonCheck'
import { useFieldProblems } from '../../../staff/useFieldProblems'
import { ErrorBox } from '../parts/Notices'
import {
  ATTESTATIONS, CONFIRM_ALL, DATE_OF_BIRTH_ENTRY, DESK_CODE_ENTRY, DETAILS_REFUSED, DOCUMENT_ENTRY, DOCUMENT_TYPES, EMPTY,
  FIRST_NAME_ENTRY, KEY_REUSED, LAST_NAME_ENTRY, NOT_AUTHORIZED, NOT_COMPLETED, NOT_WAITING, RETRY, RETRY_PROOF, ROLE_REFUSED,
  ROUTE_CLOSED, STALE, dateOfBirthUnfinished, outcomeUnknown, requestOf, resultWords, signatureOf, type Attestation, type Mismatch,
  type Values,
} from './check'

export const DESK_CODE_HINT = 'As the patient’s own phone shows it: 10 letters and digits. Spaces, hyphens and case do not matter.'
export const DATE_OF_BIRTH_HINT = 'A check without it does not match a NIN record that has one.'

type Stage = { kind: 'form' } | { kind: 'verified' } | { kind: 'registered'; detail: string }

function Required({ children }: { children: ReactNode }) {
  return <>{children}<span aria-hidden="true"> *</span></>
}

/**
 * An answer that takes focus, as the design's Banner: its title is an h2 that focus moves to (the Banner's own title
 * is a `strong`). No status role: focus moving to it already says it, and a live region would say it twice.
 */
function Result({ id, tone, title, children }: { id: string; tone: 'info' | 'warning'; title: string; children: ReactNode }) {
  return (
    <section
      className={`hid-ehr-clinical-banner${tone === 'warning' ? ' hid-ehr-clinical-banner-warning' : ''} hid-ehr-clinical-in-person-check-result`}
      aria-labelledby={id}
    >
      <h2 id={id} tabIndex={-1} className="hid-ehr-clinical-banner-title hid-ehr-clinical-in-person-check-title">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Today's CheckDesk (staff/routes/InPersonCheck.tsx) in the design's create form: the same values, refusals in the
 * same order and words, the one assistedVerification call on the press, the same Idempotency-Key rules, every answer
 * in today's words, places and focus moves. Everything typed stays in this component's state: nothing goes to
 * storage, the address or router state, and the typed values are cleared once the patient is checked or found
 * already registered. Mounted per facility (key), so another facility starts afresh.
 */
export function CheckDesk({ facilityId }: { facilityId: string }) {
  const [values, setValues] = useState<Values>(EMPTY)
  const [stage, setStage] = useState<Stage>({ kind: 'form' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mismatch, setMismatch] = useState<{ fields: Mismatch; typedDateOfBirth: boolean } | null>(null)
  // The submission whose answer is unknown, kept in memory only so the same check can be sent again.
  const pending = useRef<{ signature: string; key: string } | null>(null)
  const [retrySignature, setRetrySignature] = useState<string | null>(null)
  const problems = useFieldProblems()
  const focus = useFocusById()
  const signature = signatureOf(values)
  const retrying = retrySignature !== null && retrySignature === signature

  function change(next: Partial<Values>) { setValues(previous => ({ ...previous, ...next })) }
  function attest(key: Attestation, checked: boolean) {
    setValues(previous => ({ ...previous, attestations: { ...previous.attestations, [key]: checked } }))
  }

  /** Refuses what would not be accepted, at its field, before anything is sent: the first problem only, in today's order. */
  function refused(form: HTMLFormElement): boolean {
    if (!normalizeDeskCode(values.deskCode)) { problems.refuse('in-person-desk-code', DESK_CODE_ENTRY); return true }
    if (!values.documentType) { problems.refuse('in-person-document-type', DOCUMENT_ENTRY); return true }
    if (!values.firstName.trim()) { problems.refuse('in-person-first-name', FIRST_NAME_ENTRY); return true }
    if (!values.lastName.trim()) { problems.refuse('in-person-last-name', LAST_NAME_ENTRY); return true }
    if (dateOfBirthUnfinished(form) || (values.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(values.dateOfBirth))) {
      problems.refuse('in-person-date-of-birth', DATE_OF_BIRTH_ENTRY); return true
    }
    const missing = ATTESTATIONS.find(([key]) => !values.attestations[key])
    if (missing) {
      problems.refuse('in-person-attestations', CONFIRM_ALL, `in-person-${missing[0]}`)
      return true
    }
    return false
  }

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    setError(''); setMismatch(null); problems.clear()
    if (refused(form)) return
    const input = requestOf(values)
    const key = pending.current?.signature === signature ? pending.current.key : crypto.randomUUID()
    pending.current = { signature, key }
    setBusy(true)
    try {
      await staffApi.assistedVerification(facilityId, input, key)
      pending.current = null; setRetrySignature(null)
      setValues(EMPTY)
      setStage({ kind: 'verified' })
      focus('in-person-verified-title')
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      if (outcomeUnknown(caught)) setRetrySignature(signature)
      else { pending.current = null; setRetrySignature(null) }
      answer(caught, form, Boolean(input.document.dateOfBirth))
    } finally { setBusy(false) }
  }

  function answer(caught: unknown, form: HTMLFormElement, typedDateOfBirth: boolean) {
    const code = isHidApiError(caught) ? caught.code : ''
    const message = caught instanceof Error ? caught.message : ''
    switch (code) {
      case 'ASSISTED_VERIFICATION_NOT_MATCHED': {
        const fields = isHidApiError(caught) && caught.fields ? caught.fields : {}
        setMismatch({ fields: { firstName: fields.firstName, lastName: fields.lastName, dateOfBirth: fields.dateOfBirth }, typedDateOfBirth })
        focus('in-person-mismatch-title')
        return
      }
      case 'NIN_ALREADY_REGISTERED':
        setValues(EMPTY)
        setStage({ kind: 'registered', detail: message })
        focus('in-person-registered-title')
        return
      case 'DESK_CODE_NOT_FOUND':
        problems.refuse('in-person-desk-code', message || NOT_WAITING)
        return
      case 'DESK_CODE_INVALID':
        problems.refuse('in-person-desk-code', message || DESK_CODE_ENTRY)
        return
      case 'ASSISTED_VERIFICATION_STALE':
        problems.refuse('in-person-desk-code', STALE)
        return
      case 'ASSISTED_REGISTRATION_NOT_AUTHORIZED':
        // One answer for four causes (no sign-in confirmed with an authenticator, no attested grant, an inactive
        // membership or account, or a facility that does not take part). Each is named.
        setError(NOT_AUTHORIZED)
        return
      case 'PERMISSION_DENIED':
        setError(ROLE_REFUSED)
        return
      case 'ASSISTED_REGISTRATION_DISABLED':
        setError(`${message || ROUTE_CLOSED} Nothing was recorded.`)
        return
      case 'IDEMPOTENCY_KEY_REUSED':
        setError(KEY_REUSED)
        return
      case 'ENROLLMENT_RECONCILIATION_REQUIRED':
      case 'ENROLLMENT_UNAVAILABLE':
        setError(RETRY_PROOF)
        return
      case 'VALIDATION_FAILED':
        problems.markRefused(form, caught)
        setError(refusalText(caught, DETAILS_REFUSED))
        return
    }
    if (outcomeUnknown(caught)) { setError(RETRY); return }
    // Any other refusal says what Identity said: a 4xx detail is written for the person using the client.
    setError(message || NOT_COMPLETED)
  }

  function another() {
    pending.current = null; setRetrySignature(null)
    setValues(EMPTY); setMismatch(null); setError(''); problems.clear()
    setStage({ kind: 'form' })
    focus('in-person-form-title')
  }

  const anotherAction = (
    <div className="hid-ehr-clinical-banner-actions">
      <EhrButton variant="secondary" onClick={another}>Check another patient</EhrButton>
    </div>
  )

  if (stage.kind === 'verified') {
    return (
      <Result id="in-person-verified-title" tone="info" title="Checked. The patient can continue on their phone.">
        <p>On their own phone they add a phone number or email, choose a password, and then see their Health ID. If the phone still shows the desk code, ask them to open their registration again on that phone.</p>
        {anotherAction}
      </Result>
    )
  }

  if (stage.kind === 'registered') {
    return (
      <Result id="in-person-registered-title" tone="warning" title="This person already has a Health ID">
        <p>{stage.detail}</p>
        <p>Do not start a new registration for them. Their registration on the phone has ended; account recovery lets them sign in to the Health ID they have.</p>
        {anotherAction}
      </Result>
    )
  }

  // An error replaces the hint under its control, as today's Field does: the control is described by the error alone.
  const deskCodeError = problems.error('in-person-desk-code')
  const dateOfBirthError = problems.error('in-person-date-of-birth')
  const attestationsError = problems.error('in-person-attestations')

  return (
    <>
      {mismatch ? (
        <Result id="in-person-mismatch-title" tone="warning" title="The details do not match the NIN record">
          <ul aria-label="Result for each detail" className="hid-ehr-clinical-in-person-check-results">
            <li>First name: {resultWords('firstName', mismatch.fields.firstName, mismatch.typedDateOfBirth)}</li>
            <li>Last name: {resultWords('lastName', mismatch.fields.lastName, mismatch.typedDateOfBirth)}</li>
            <li>Date of birth: {resultWords('dateOfBirth', mismatch.fields.dateOfBirth, mismatch.typedDateOfBirth)}</li>
          </ul>
          <p>Check the document. If only spelling or spacing differs, such as a hyphen or a space in a name, type it the way the document allows and check again; each check counts toward the daily limit. Otherwise do not register this patient.</p>
        </Result>
      ) : null}

      <section className="hid-ehr-card" aria-labelledby="in-person-form-title">
        <div className="hid-ehr-card-header">
          <h2 id="in-person-form-title" tabIndex={-1} className="hid-ehr-card-title hid-ehr-clinical-in-person-check-focus">Check a patient</h2>
        </div>
        <form className="hid-ehr-clinical-form hid-ehr-clinical-in-person-check-form" noValidate onSubmit={event => void check(event)}>
          <div className="hid-ehr-clinical-form-grid">
            <EhrField controlId="in-person-desk-code" label={<Required>Desk code</Required>}
              hint={deskCodeError === undefined ? DESK_CODE_HINT : undefined} error={deskCodeError}>
              <EhrInput name="deskCode" value={values.deskCode} onChange={event => change({ deskCode: event.target.value })}
                autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} readOnly={busy} required />
            </EhrField>

            <fieldset className="hid-ehr-clinical-choices">
              <legend>Method</legend>
              <div className="hid-ehr-clinical-choice-row">
                <label className="hid-ehr-clinical-choice">
                  <input type="radio" name="method" value="government_photo_id_in_person" checked readOnly />
                  <span>Original government photo ID, checked in person</span>
                </label>
              </div>
            </fieldset>

            <EhrField controlId="in-person-document-type" label={<Required>Document checked</Required>} error={problems.error('in-person-document-type')}>
              <EhrSelect name="documentType" value={values.documentType}
                onChange={event => change({ documentType: event.target.value as AssistedDocumentType | '' })} required>
                <option value="">Choose the document</option>
                {DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </EhrSelect>
            </EhrField>

            <fieldset id="in-person-document" name="document" className="hid-ehr-clinical-form-full hid-ehr-clinical-in-person-check-group">
              <legend>As written on the document</legend>
              <div className="hid-ehr-clinical-form-grid">
                <EhrField controlId="in-person-first-name" label={<Required>First name</Required>} error={problems.error('in-person-first-name')}>
                  <EhrInput name="firstName" value={values.firstName} onChange={event => change({ firstName: event.target.value })}
                    maxLength={100} autoComplete="off" spellCheck={false} readOnly={busy} required />
                </EhrField>
                <EhrField controlId="in-person-last-name" label={<Required>Last name</Required>} error={problems.error('in-person-last-name')}>
                  <EhrInput name="lastName" value={values.lastName} onChange={event => change({ lastName: event.target.value })}
                    maxLength={100} autoComplete="off" spellCheck={false} readOnly={busy} required />
                </EhrField>
                <EhrField controlId="in-person-date-of-birth" label="Date of birth (if the document shows one)"
                  hint={dateOfBirthError === undefined ? DATE_OF_BIRTH_HINT : undefined} error={dateOfBirthError}>
                  <EhrInput name="dateOfBirth" type="date" value={values.dateOfBirth} onChange={event => change({ dateOfBirth: event.target.value })}
                    autoComplete="off" readOnly={busy} />
                </EhrField>
              </div>
            </fieldset>

            <fieldset name="attestations" {...problems.group('in-person-attestations')}
              className="hid-ehr-clinical-form-full hid-ehr-clinical-in-person-check-group">
              <legend>Confirm each statement</legend>
              <div className="hid-ehr-clinical-in-person-check-statements">
                {ATTESTATIONS.map(([key, label]) => (
                  <label key={key} className="hid-ehr-clinical-checkbox">
                    <span><Required>{label}</Required></span>
                    <input type="checkbox" id={`in-person-${key}`} name={key} required checked={values.attestations[key]}
                      onChange={event => attest(key, event.target.checked)} />
                  </label>
                ))}
              </div>
              {attestationsError !== undefined
                ? <p id="in-person-attestations-error" className="hid-ehr-clinical-field-error">{attestationsError}</p> : null}
            </fieldset>
          </div>

          {error ? <ErrorBox>{error}</ErrorBox> : null}
          <div className="hid-ehr-clinical-form-footer">
            {/* Kept focusable while it runs (aria-disabled, not disabled), so focus stays on it; a second press does nothing. */}
            <EhrButton type="submit" busy={busy}>{busy ? 'Checking…' : retrying ? 'Check again' : 'Check the details'}</EhrButton>
          </div>
        </form>
      </section>
    </>
  )
}
