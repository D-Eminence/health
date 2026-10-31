import { useRef, useState, type FormEvent } from 'react'
import { EmptyState, Field, Input, Select } from '@hid/ui'
import { CircleCheck, RotateCcw, ShieldCheck } from 'lucide-react'
import { Alert, Button as KButton, Card as KCard } from '../../kasuwa/ui'
import { FormActions, FormPage, Step } from '../../kasuwa/parts'
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
  ['originalDocumentSeen', 'I’ve seen the original ID, not a copy or photo.'],
  ['photoMatchesPerson', 'The photo on the ID is this person.'],
  ['codeShownOnPatientsOwnDevice', 'The code is on their own phone.'],
  ['patientConsents', 'They agree to this check against their NIN.'],
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
  no_match: 'doesn’t match',
  not_in_record: 'not on their NIN, so not checked',
}

function resultWords(field: keyof Mismatch, result: string | undefined, typedDateOfBirth: boolean): string {
  if (field === 'dateOfBirth' && result === 'no_match' && !typedDateOfBirth) {
    return 'doesn’t match. None was typed; type the date on the ID.'
  }
  return result && Object.hasOwn(RESULT_WORDS, result) ? RESULT_WORDS[result as FieldResult] : 'no result given'
}

const DESK_CODE_ENTRY = 'Type the 10-character code on their phone.'
const DATE_OF_BIRTH_ENTRY = 'Type the full date as it is on the ID, or leave it empty if there isn’t one.'
const STALE = 'That code has changed. Ask for the code on their phone now, then check again.'
const RETRY = 'That didn’t go through. Press Check again without changes. It won’t count twice.'
const RETRY_PROOF = 'Saved, but their sign-up didn’t move on. Press Check again within 10 minutes, without changes.'

/**
 * An answer that may or may not have been recorded: the same submission is sent again. A 503
 * ASSISTED_REGISTRATION_DISABLED is not one: the route is closed and nothing was recorded.
 */
function outcomeUnknown(caught: unknown): boolean {
  if (!isHidApiError(caught)) return true
  if (caught.code === 'ASSISTED_REGISTRATION_DISABLED') return false
  return caught.status === 0 || caught.status === 408 || caught.status >= 500
}

/**
 * Whether the date control holds a date it cannot report: one partly typed, or impossible such as 31
 * February. Its value is then empty, so without this the check would go without the date the staff
 * member typed, be counted, and be answered as if none was typed.
 */
function dateOfBirthUnfinished(form: HTMLFormElement): boolean {
  const control = form.elements.namedItem('dateOfBirth')
  return control instanceof HTMLInputElement && control.validity.badInput
}

export function InPersonCheck() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  if (!facility || !facility.permissions.includes(ASSISTED_REGISTRATION_PERMISSION)) {
    return <EmptyState titleAs="h1" title="You can’t check patients in person here"
      description="Doctors and nurses at a taking-part facility can. Ask your administrator." />
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
  function refused(form: HTMLFormElement): boolean {
    if (!normalizeDeskCode(values.deskCode)) { problems.refuse('in-person-desk-code', DESK_CODE_ENTRY); return true }
    if (!values.documentType) { problems.refuse('in-person-document-type', 'Choose which ID you looked at.'); return true }
    if (!values.firstName.trim()) { problems.refuse('in-person-first-name', 'Type the first name as it is on the ID.'); return true }
    if (!values.lastName.trim()) { problems.refuse('in-person-last-name', 'Type the last name as it is on the ID.'); return true }
    if (dateOfBirthUnfinished(form) || (values.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(values.dateOfBirth))) {
      problems.refuse('in-person-date-of-birth', DATE_OF_BIRTH_ENTRY); return true
    }
    const missing = ATTESTATIONS.find(([key]) => !values.attestations[key])
    if (missing) {
      problems.refuse('in-person-attestations', 'Tick all five. If any isn’t true, stop here.', `in-person-${missing[0]}`)
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
        problems.refuse('in-person-desk-code', message || 'No sign-up is waiting for this code. Ask them to show the code again.')
        return
      case 'DESK_CODE_INVALID':
        problems.refuse('in-person-desk-code', message || DESK_CODE_ENTRY)
        return
      case 'ASSISTED_VERIFICATION_STALE':
        problems.refuse('in-person-desk-code', STALE)
        return
      case 'ASSISTED_REGISTRATION_NOT_AUTHORIZED':
        // One answer for four causes (INTERFACE_CONTRACT.md at f9dbaf0): no sign-in confirmed with an authenticator, no
        // attested grant, an inactive membership or account, or a facility that does not take part. Each is named.
        setError('You can’t check patients in person here yet. Ask Health ID support to set you up.')
        return
      case 'PERMISSION_DENIED':
        setError('Your role here can’t check patients in person. Ask your administrator.')
        return
      case 'ASSISTED_REGISTRATION_DISABLED':
        setError(`${message || 'Registration at a facility is not available.'} Nothing was recorded.`)
        return
      case 'IDEMPOTENCY_KEY_REUSED':
        setError('This was already sent with different details. Check them and try again.')
        return
      case 'ENROLLMENT_RECONCILIATION_REQUIRED':
      case 'ENROLLMENT_UNAVAILABLE':
        setError(RETRY_PROOF)
        return
      case 'VALIDATION_FAILED':
        problems.markRefused(form, caught)
        setError(refusalText(caught, 'Some details weren’t accepted. Check them and try again.'))
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

  // One column: the heading, each step and the button share one edge (alignment), and the steps are three short groups
  // (chunking). The method is fixed (a government photo ID seen in person), so it is said, not offered as a choice.
  return <FormPage title="Check a patient in person" description="For patients who can’t get a code on their NIN phone. You check their photo ID.">

    {stage.kind === 'verified' && <KCard>
      <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-success-soft text-success-ink"><CircleCheck className="size-6" aria-hidden /></span>
        <h2 id="in-person-verified-title" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Checked</h2>
        <p className="m-0 max-w-sm text-sm text-ink-2">They can finish on their phone now. If it still shows the code, ask them to open their sign-up again.</p>
        <KButton variant="primary" icon={RotateCcw} onClick={another}>Check another patient</KButton>
      </div>
    </KCard>}

    {stage.kind === 'registered' && <KCard>
      <div className="flex flex-col gap-3 p-5">
        <h2 id="in-person-registered-title" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">They already have a Health ID</h2>
        {stage.detail ? <p className="m-0 text-sm text-ink-2">{stage.detail}</p> : null}
        <p className="m-0 text-sm text-ink-2">Don’t register them again. They can get back into their account with “Forgot password”.</p>
        <div><KButton icon={RotateCcw} onClick={another}>Check another patient</KButton></div>
      </div>
    </KCard>}

    {stage.kind === 'form' && <form noValidate onSubmit={event => void check(event)} className="flex flex-col gap-4" aria-labelledby="in-person-form-title">
      <h2 id="in-person-form-title" tabIndex={-1} className="sr-only">Check a patient</h2>

      <Step bodyClassName="staff-form" n={1} title="The code on their phone">
        <Field label="Code" htmlFor="in-person-desk-code" required error={problems.error('in-person-desk-code')} hint="10 letters and numbers. Spaces and dashes don’t matter.">
          <Input {...problems.control('in-person-desk-code')} id="in-person-desk-code" name="deskCode" value={values.deskCode} placeholder="ABCD-EFGH-JK"
            onChange={event => change({ deskCode: event.target.value })} autoComplete="off" autoCapitalize="characters"
            spellCheck={false} maxLength={20} readOnly={busy} required />
        </Field>
      </Step>

      <Step bodyClassName="staff-form" n={2} title="Their photo ID" hint="The original, not a copy or a photo of it.">
        <Field label="Which ID?" htmlFor="in-person-document-type" required error={problems.error('in-person-document-type')}>
          <Select {...problems.control('in-person-document-type')} id="in-person-document-type" name="documentType" value={values.documentType}
            onChange={event => change({ documentType: event.target.value as AssistedDocumentType | '' })} required>
            <option value="">Choose</option>
            {DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <fieldset id="in-person-document" name="document" className="m-0 flex flex-col gap-4 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] text-ink-3">Type the details exactly as they are on the ID.</legend>
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
          <Field label="Date of birth" htmlFor="in-person-date-of-birth" error={problems.error('in-person-date-of-birth')} hint="If the ID shows one. Without it, the check may not match.">
            <Input {...problems.control('in-person-date-of-birth')} id="in-person-date-of-birth" name="dateOfBirth" type="date" value={values.dateOfBirth}
              onChange={event => change({ dateOfBirth: event.target.value })} autoComplete="off" readOnly={busy} />
          </Field>
        </fieldset>
      </Step>

      <Step bodyClassName="staff-form" n={3} title="Confirm">
        <fieldset name="attestations" {...problems.group('in-person-attestations')} className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="sr-only">Confirm each statement</legend>
          {ATTESTATIONS.map(([key, label]) => <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-sm text-ink ring-1 ring-line has-[:checked]:bg-brand-soft has-[:checked]:ring-brand-line">
            <input type="checkbox" id={`in-person-${key}`} name={key} checked={values.attestations[key]} className="mt-0.5 size-4 accent-[var(--color-brand)]"
              onChange={event => attest(key, event.target.checked)} /> {label}
          </label>)}
          <GroupError field="in-person-attestations">{problems.error('in-person-attestations')}</GroupError>
        </fieldset>
      </Step>

      {stage.kind === 'form' && mismatch && <Alert intent="warning" title="The details don’t match their NIN">
        <ul className="m-0 mt-1 list-none p-0" aria-label="Result for each detail">
          <li>First name: {resultWords('firstName', mismatch.fields.firstName, mismatch.typedDateOfBirth)}</li>
          <li>Last name: {resultWords('lastName', mismatch.fields.lastName, mismatch.typedDateOfBirth)}</li>
          <li>Date of birth: {resultWords('dateOfBirth', mismatch.fields.dateOfBirth, mismatch.typedDateOfBirth)}</li>
        </ul>
        <p className="m-0 mt-2">If only a space or hyphen differs, type it as the ID shows and check again. Otherwise, don’t register them.</p>
      </Alert>}
      {mismatch ? <span id="in-person-mismatch-title" tabIndex={-1} className="sr-only">The details don’t match their NIN</span> : null}
      {error && <Alert intent="error" title="That didn’t work">{error}</Alert>}

      {/* Kept enabled while it runs, so focus stays on it; a second press does nothing. */}
      <FormActions><KButton type="submit" variant="primary" icon={ShieldCheck} aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Checking…' : retrying ? 'Check again' : 'Check details'}</KButton></FormActions>
    </form>}
  </FormPage>
}
