import { useRef, useState, type FormEvent } from 'react'
import { Button, Card, EmptyState, Field, Input, Select } from '@hid/ui'
import { isHidApiError } from '@hid/http'
import { staffApi, type AssistedDocumentType, type AssistedVerificationInput } from '../api'
import { useStaff } from '../App'
import { BUSY, useFocusById } from '../focus'
import { refusalText } from '../fieldProblem'
import { GroupError, useFieldProblems } from '../useFieldProblems'

/**
 * The staff in-person check of facility-assisted registration (hid-system main
 * f9dbaf0: #85, migration 0094, ADR-063; INTERFACE_CONTRACT.md "Facility-assisted
 * registration"). A patient without a usable registry phone starts on their own
 * phone, which shows a desk code. At a participating facility a doctor, clinician
 * or nurse types that code and the names and date of birth as written on one
 * original photo ID, and confirms five statements. Identity compares them with
 * the NIN record and answers verified, a result per field, or a refusal; never
 * the NIN, a record value, the contact or a Health ID, and this page shows none.
 *
 * Everything typed stays in this page's state: nothing goes to storage, the
 * address or router state. One Idempotency-Key per submission: the same key,
 * kept only while an answer is unknown (a 503 or a lost connection), replays the
 * stored check, so checking again with unchanged details is not counted twice.
 * Any other answer ends the submission; the next one takes a new key.
 */
export const ASSISTED_REGISTRATION_PERMISSION = 'identity.patient.assisted_registration'

const DOCUMENT_TYPES: ReadonlyArray<readonly [AssistedDocumentType, string]> = [
  ['national_id_card', 'National ID card'],
  ['international_passport', 'International passport'],
  ['drivers_licence', 'Driver’s licence'],
  ['voters_card', 'Voter’s card'],
]

type Attestation = keyof AssistedVerificationInput['attestations']
const ATTESTATIONS: ReadonlyArray<readonly [Attestation, string]> = [
  ['patientPresent', 'The patient is here in person.'],
  ['originalDocumentSeen', 'I have seen the original document, not a copy or a photo of it.'],
  ['photoMatchesPerson', 'The photo on the document matches the person in front of me.'],
  ['codeShownOnPatientsOwnDevice', 'The desk code is shown on the patient’s own phone.'],
  ['patientConsents', 'The patient agrees to this check against their NIN record.'],
]

/** Identity's desk code alphabet (Crockford base32: no I, L, O or U). */
const DESK_CODE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/

/**
 * The code as Identity reads it (identity/desk-code.ts): spaces, hyphens and case
 * ignored, the look-alikes O read as zero and I and L as one. Null when what is
 * left is not 10 characters of the alphabet.
 */
export function normalizeDeskCode(value: string): string | null {
  const code = value.replace(/[\s-]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
  return DESK_CODE.test(code) ? code : null
}

interface Values {
  deskCode: string
  documentType: AssistedDocumentType | ''
  firstName: string
  lastName: string
  dateOfBirth: string
  attestations: Record<Attestation, boolean>
}

const EMPTY: Values = {
  deskCode: '', documentType: '', firstName: '', lastName: '', dateOfBirth: '',
  attestations: { patientPresent: false, originalDocumentSeen: false, photoMatchesPerson: false,
    codeShownOnPatientsOwnDevice: false, patientConsents: false },
}

/** What would be sent for these values, read as Identity reads them; the same values give the same request. */
function requestOf(values: Values): AssistedVerificationInput {
  const dateOfBirth = values.dateOfBirth.trim()
  return {
    deskCode: normalizeDeskCode(values.deskCode) ?? values.deskCode.trim(),
    method: 'government_photo_id_in_person',
    documentType: values.documentType as AssistedDocumentType,
    document: { firstName: values.firstName.trim(), lastName: values.lastName.trim(), ...(dateOfBirth ? { dateOfBirth } : {}) },
    attestations: { patientPresent: true, originalDocumentSeen: true, photoMatchesPerson: true,
      codeShownOnPatientsOwnDevice: true, patientConsents: true },
  }
}

/** The values and the statements confirmed, as one string: the submission they make. */
function signatureOf(values: Values): string {
  return JSON.stringify([requestOf(values), ATTESTATIONS.map(([key]) => values.attestations[key])])
}

type FieldResult = 'match' | 'no_match' | 'not_in_record'
type Mismatch = { firstName?: string; lastName?: string; dateOfBirth?: string }

const RESULT_WORDS: Record<FieldResult, string> = {
  match: 'matches',
  no_match: 'does not match',
  not_in_record: 'not on the NIN record, so not compared',
}

function resultWords(field: keyof Mismatch, result: string | undefined, typedDateOfBirth: boolean): string {
  if (field === 'dateOfBirth' && result === 'no_match' && !typedDateOfBirth) {
    return 'does not match. None was typed; type the date of birth on the document.'
  }
  return result && Object.hasOwn(RESULT_WORDS, result) ? RESULT_WORDS[result as FieldResult] : 'no result given'
}

const DESK_CODE_ENTRY = 'Enter the 10-character desk code shown on the patient’s phone.'
const STALE = 'This desk code can no longer be checked: another check came first, or the patient has a new code. Ask the patient for the code on their phone now, then check again.'
const RETRY = 'The check could not be completed. Press Check again without changing the details: it is sent as the same check, so it is not counted twice.'
const RETRY_PROOF = 'The check is recorded, but the patient’s registration could not be moved on. Press Check again without changing the details within 10 minutes: it is not counted twice.'

/** An answer that may or may not have been recorded: the same submission is sent again. */
function outcomeUnknown(caught: unknown): boolean {
  if (!isHidApiError(caught)) return true
  return caught.status === 0 || caught.status === 408 || caught.status >= 500
}

export function InPersonCheck() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  if (!facility || !facility.permissions.includes(ASSISTED_REGISTRATION_PERMISSION)) {
    return <EmptyState titleAs="h1" title="In-person check unavailable"
      description="Your role at this facility cannot check patients in person. Doctors, clinicians and nurses at a facility that takes part in registration can. Ask a platform administrator if your role should." />
  }
  // Another facility starts afresh: nothing typed, answered or kept for a retry carries over.
  return <CheckDesk key={facility.id} facilityId={facility.id} />
}

type Stage = { kind: 'form' } | { kind: 'verified' } | { kind: 'registered'; detail: string }

function CheckDesk({ facilityId }: { facilityId: string }) {
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

  /** Refuses what would not be accepted, at its field, before anything is sent. */
  function refused(): boolean {
    if (!normalizeDeskCode(values.deskCode)) { problems.refuse('in-person-desk-code', DESK_CODE_ENTRY); return true }
    if (!values.documentType) { problems.refuse('in-person-document-type', 'Choose the document you checked.'); return true }
    if (!values.firstName.trim()) { problems.refuse('in-person-first-name', 'Enter the first name as written on the document.'); return true }
    if (!values.lastName.trim()) { problems.refuse('in-person-last-name', 'Enter the last name as written on the document.'); return true }
    if (values.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(values.dateOfBirth)) {
      problems.refuse('in-person-date-of-birth', 'Enter the date of birth as written on the document, or leave it empty if it shows none.'); return true
    }
    const missing = ATTESTATIONS.find(([key]) => !values.attestations[key])
    if (missing) {
      problems.refuse('in-person-attestations', 'Confirm all five statements. If any is not true, do not check this patient.', `in-person-${missing[0]}`)
      return true
    }
    return false
  }

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    setError(''); setMismatch(null); problems.clear()
    if (refused()) return
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
        problems.refuse('in-person-desk-code', message || 'No registration is waiting for this desk code. Ask the patient to show the code on their phone again.')
        return
      case 'DESK_CODE_INVALID':
        problems.refuse('in-person-desk-code', message || DESK_CODE_ENTRY)
        return
      case 'ASSISTED_VERIFICATION_STALE':
        problems.refuse('in-person-desk-code', STALE)
        return
      case 'ASSISTED_REGISTRATION_NOT_AUTHORIZED':
        setError('You cannot register patients in person at this facility. Ask a platform administrator: the facility must take part, and your account needs an attested clinical grant and an active membership here.')
        return
      case 'PERMISSION_DENIED':
        setError('Your role at this facility cannot check patients in person. Ask a platform administrator.')
        return
      case 'ASSISTED_REGISTRATION_DISABLED':
        setError(`${message || 'Registration at a facility is not available.'} Nothing was recorded.`)
        return
      case 'IDEMPOTENCY_KEY_REUSED':
        setError('This check was already sent with other details. Check the details, then send them again.')
        return
      case 'ENROLLMENT_RECONCILIATION_REQUIRED':
      case 'ENROLLMENT_UNAVAILABLE':
        setError(RETRY_PROOF)
        return
      case 'VALIDATION_FAILED':
        problems.markRefused(form, caught)
        setError(refusalText(caught, 'Some details were refused. Check them, then send them again.'))
        return
    }
    if (outcomeUnknown(caught)) { setError(RETRY); return }
    // Any other refusal says what Identity said: a 4xx detail is written for the person using the client.
    setError(message || 'The check could not be completed.')
  }

  function another() {
    pending.current = null; setRetrySignature(null)
    setValues(EMPTY); setMismatch(null); setError(''); problems.clear()
    setStage({ kind: 'form' })
    focus('in-person-form-title')
  }

  return <div className="staff-in-person">
    <div className="staff-page-head">
      <p className="staff-eyebrow">Identity operations</p>
      <h1>In-person check</h1>
      <p>Check a patient registering on their own phone who cannot receive the code sent to the phone on their NIN record. You check one original photo ID; Health ID compares the details with the NIN record and never shows you the record.</p>
    </div>
    <div className="staff-stack">
      {stage.kind === 'verified' && <Card className="staff-card">
        <h2 id="in-person-verified-title" tabIndex={-1}>Checked. The patient can continue on their phone.</h2>
        <p>On their own phone they add a phone number or email, choose a password, and then see their Health ID. If the phone still shows the desk code, ask them to open their registration again on that phone.</p>
        <Button tone="secondary" onClick={another}>Check another patient</Button>
      </Card>}

      {stage.kind === 'registered' && <Card className="staff-card">
        <h2 id="in-person-registered-title" tabIndex={-1}>This person already has a Health ID</h2>
        <p>{stage.detail}</p>
        <p>Do not start a new registration for them. Their registration on the phone has ended; account recovery lets them sign in to the Health ID they have.</p>
        <Button tone="secondary" onClick={another}>Check another patient</Button>
      </Card>}

      {stage.kind === 'form' && <Card className="staff-card">
        <h2 id="in-person-form-title" tabIndex={-1}>Check a patient</h2>
        <form className="staff-form" noValidate onSubmit={event => void check(event)}>
          <Field label="Desk code" htmlFor="in-person-desk-code" required error={problems.error('in-person-desk-code')}
            hint="As the patient’s own phone shows it: 10 letters and digits. Spaces, hyphens and case do not matter.">
            <Input {...problems.control('in-person-desk-code')} id="in-person-desk-code" name="deskCode" value={values.deskCode}
              onChange={event => change({ deskCode: event.target.value })} autoComplete="off" autoCapitalize="characters"
              spellCheck={false} maxLength={20} readOnly={busy} required />
          </Field>

          <fieldset>
            <legend>Method</legend>
            <label className="staff-choice"><input type="radio" name="method" value="government_photo_id_in_person" checked readOnly />
              Original government photo ID, checked in person</label>
          </fieldset>

          <Field label="Document checked" htmlFor="in-person-document-type" required error={problems.error('in-person-document-type')}>
            <Select {...problems.control('in-person-document-type')} id="in-person-document-type" name="documentType" value={values.documentType}
              onChange={event => change({ documentType: event.target.value as AssistedDocumentType | '' })} required>
              <option value="">Choose the document</option>
              {DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>

          <fieldset id="in-person-document" name="document">
            <legend>As written on the document</legend>
            <div className="staff-form-row">
              <Field label="First name" htmlFor="in-person-first-name" required error={problems.error('in-person-first-name')}>
                <Input {...problems.control('in-person-first-name')} id="in-person-first-name" name="firstName" value={values.firstName}
                  onChange={event => change({ firstName: event.target.value })} maxLength={100} autoComplete="off" spellCheck={false} readOnly={busy} required />
              </Field>
              <Field label="Last name" htmlFor="in-person-last-name" required error={problems.error('in-person-last-name')}>
                <Input {...problems.control('in-person-last-name')} id="in-person-last-name" name="lastName" value={values.lastName}
                  onChange={event => change({ lastName: event.target.value })} maxLength={100} autoComplete="off" spellCheck={false} readOnly={busy} required />
              </Field>
            </div>
            <Field label="Date of birth (if the document shows one)" htmlFor="in-person-date-of-birth" error={problems.error('in-person-date-of-birth')}
              hint="A check without it does not match a NIN record that has one.">
              <Input {...problems.control('in-person-date-of-birth')} id="in-person-date-of-birth" name="dateOfBirth" type="date" value={values.dateOfBirth}
                onChange={event => change({ dateOfBirth: event.target.value })} autoComplete="off" readOnly={busy} />
            </Field>
          </fieldset>

          <fieldset name="attestations" {...problems.group('in-person-attestations')}>
            <legend>Confirm each statement</legend>
            {ATTESTATIONS.map(([key, label]) => <label key={key} className="staff-choice">
              <input type="checkbox" id={`in-person-${key}`} name={key} checked={values.attestations[key]}
                onChange={event => attest(key, event.target.checked)} /> {label}
            </label>)}
            <GroupError field="in-person-attestations">{problems.error('in-person-attestations')}</GroupError>
          </fieldset>

          {/* Kept enabled while it runs, so focus stays on it; a second press does nothing. */}
          <Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Checking…' : retrying ? 'Check again' : 'Check the details'}</Button>
        </form>
      </Card>}

      {stage.kind === 'form' && mismatch && <Card className="staff-card">
        <h2 id="in-person-mismatch-title" tabIndex={-1}>The details do not match the NIN record</h2>
        <ul aria-label="Result for each detail">
          <li>First name: {resultWords('firstName', mismatch.fields.firstName, mismatch.typedDateOfBirth)}</li>
          <li>Last name: {resultWords('lastName', mismatch.fields.lastName, mismatch.typedDateOfBirth)}</li>
          <li>Date of birth: {resultWords('dateOfBirth', mismatch.fields.dateOfBirth, mismatch.typedDateOfBirth)}</li>
        </ul>
        <p>Check the document. If only spelling or spacing differs, such as a hyphen or a space in a name, type it the way the document allows and check again; each check counts toward the daily limit. Otherwise do not register this patient.</p>
      </Card>}

      {error && <div role="alert"><p className="staff-error">{error}</p></div>}
    </div>
  </div>
}
