import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isHidApiError, plainErrorText } from '@hid/http'
import { EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { staffApi, type AssistedDocumentType } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { refusalText } from '../../../staff/fieldProblem'
import { useFieldProblems } from '../../../staff/useFieldProblems'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import {
  ANOTHER, ASSISTED_REGISTRATION_PERMISSION, ATTESTATIONS, ATTESTATIONS_ENTRY, CHECK, CHECK_AGAIN, CHECKING, CODE_HINT, CODE_LABEL,
  CODE_PLACEHOLDER, CONFIRM_LEGEND, DATE_OF_BIRTH_ENTRY, DATE_OF_BIRTH_HINT, DATE_OF_BIRTH_LABEL, DESCRIPTION, DESK_CODE_ENTRY,
  DESK_CODE_NOT_FOUND, DETAILS_LEGEND, DISABLED, DOCUMENT_CHOOSE, DOCUMENT_LABEL, DOCUMENT_TYPE_ENTRY, DOCUMENT_TYPES, EMPTY,
  ERROR_TITLE, FIRST_NAME_ENTRY, FORM_TITLE, KEY_REUSED, LAST_NAME_ENTRY, LIMITED, MISMATCH_NEXT, MISMATCH_TITLE, NOT_AUTHORIZED,
  NOT_COMPLETED, PAGE_TITLE, REGISTERED_NEXT, REGISTERED_TITLE, RETRY, RETRY_PROOF, ROLE_REFUSED, SOME_REFUSED, STALE, STEP_CODE,
  STEP_CONFIRM, STEP_ID, STEP_ID_HINT, UNAVAILABLE_MESSAGE, UNAVAILABLE_TITLE, VERIFIED_NEXT, VERIFIED_TITLE, dateOfBirthUnfinished,
  knownResult, normalizeDeskCode, outcomeUnknown, requestOf, resultWords, signatureOf, type Attestation,
  type Mismatch, type Values,
} from './inPersonRules'
import './inperson.css'

/**
 * The staff in-person check of facility-assisted registration in the blue EHR, drawn in the design's form look (the
 * design has no screen for it): the form card with classic's three steps, the five statements as its checkbox list, the
 * submit, then the outcome as classic shows it (staff/routes/InPersonCheck.tsx:271-287): its heading, its lines and
 * "Check another patient", with no status badge, fact, "Available actions" or "Next steps" (parity 3.3-22, 3.3-24).
 * Requests, checks, refusals, steps and words are classic's (ported in inPersonRules.ts). As classic, the method is
 * fixed, so it is never offered as a choice.
 *
 * A patient without a usable registry phone starts on their own phone, which shows a desk code. A doctor, clinician or
 * nurse types that code and the names and date of birth as written on one original photo ID, and confirms five
 * statements. Identity answers verified, a result per field, or a refusal; never the NIN, a record value, the contact or
 * a Health ID, and this page shows none.
 *
 * Everything typed stays in this page's state: nothing goes to storage, the address or router state, and leaving the
 * page ends it. One Idempotency-Key per submission: the same key, kept only while an answer is unknown (a 503 or a lost
 * connection), replays the stored check, so checking again with unchanged details is not counted twice. Any other
 * answer ends the submission; the next one takes a new key.
 */
export function InPersonCheck() {
  // InPersonCheck.tsx:135-144: classic's rule, and classic's refusal.
  const { facility, permissions } = useDeptAccess()
  if (!facility || !permissions.includes(ASSISTED_REGISTRATION_PERMISSION)) return <InPersonUnavailable />
  // Another facility starts afresh: nothing typed, answered or kept for a retry carries over.
  return <CheckDesk key={facility.id} facilityId={facility.id} />
}

/** InPersonCheck.tsx:139-140: classic's refusal, word for word. The frame shows it at the page's address too. */
export function InPersonUnavailable() {
  return <DeptUnavailable title={UNAVAILABLE_TITLE} message={UNAVAILABLE_MESSAGE} />
}

/** InPersonCheck.tsx:143. */
type Stage =
  | { readonly kind: 'form' }
  | { readonly kind: 'verified' }
  | { readonly kind: 'registered'; readonly detail: string }

function Required() {
  return <span aria-hidden="true"> *</span>
}

function CheckDesk({ facilityId }: { readonly facilityId: string }) {
  // InPersonCheck.tsx:146-157.
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

  // InPersonCheck.tsx:159-162.
  function change(next: Partial<Values>) { setValues(previous => ({ ...previous, ...next })) }
  function attest(key: Attestation, checked: boolean) {
    setValues(previous => ({ ...previous, attestations: { ...previous.attestations, [key]: checked } }))
  }

  /** InPersonCheck.tsx:164-179. Refuses what would not be accepted, at its field, before anything is sent. */
  function refused(form: HTMLFormElement): boolean {
    if (!normalizeDeskCode(values.deskCode)) { problems.refuse('in-person-desk-code', DESK_CODE_ENTRY); return true }
    if (!values.documentType) { problems.refuse('in-person-document-type', DOCUMENT_TYPE_ENTRY); return true }
    if (!values.firstName.trim()) { problems.refuse('in-person-first-name', FIRST_NAME_ENTRY); return true }
    if (!values.lastName.trim()) { problems.refuse('in-person-last-name', LAST_NAME_ENTRY); return true }
    if (dateOfBirthUnfinished(form) || (values.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(values.dateOfBirth))) {
      problems.refuse('in-person-date-of-birth', DATE_OF_BIRTH_ENTRY); return true
    }
    const missing = ATTESTATIONS.find(([key]) => !values.attestations[key])
    if (missing) {
      problems.refuse('in-person-attestations', ATTESTATIONS_ENTRY, `in-person-${missing[0]}`)
      return true
    }
    return false
  }

  /** InPersonCheck.tsx:181-203. */
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

  /** InPersonCheck.tsx:208-257: each answer, said where classic says it, in classic's words. */
  function answer(caught: unknown, form: HTMLFormElement, typedDateOfBirth: boolean) {
    const code = isHidApiError(caught) ? caught.code : ''
    switch (code) {
      case 'ASSISTED_VERIFICATION_NOT_MATCHED': {
        const fields = isHidApiError(caught) && caught.fields ? caught.fields : {}
        setMismatch({ fields: { firstName: fields.firstName, lastName: fields.lastName, dateOfBirth: fields.dateOfBirth }, typedDateOfBirth })
        focus('in-person-mismatch-title')
        return
      }
      case 'NIN_ALREADY_REGISTERED':
        setValues(EMPTY)
        setStage({ kind: 'registered', detail: '' })
        focus('in-person-registered-title')
        return
      case 'DESK_CODE_NOT_FOUND':
        problems.refuse('in-person-desk-code', DESK_CODE_NOT_FOUND)
        return
      case 'DESK_CODE_INVALID':
        problems.refuse('in-person-desk-code', DESK_CODE_ENTRY)
        return
      case 'ASSISTED_VERIFICATION_STALE':
        problems.refuse('in-person-desk-code', STALE)
        return
      case 'ASSISTED_REGISTRATION_NOT_AUTHORIZED':
        // One answer for four causes (INTERFACE_CONTRACT.md at f9dbaf0): no sign-in confirmed with an authenticator, no
        // attested grant, an inactive membership or account, or a facility that does not take part. Each is named.
        setError(NOT_AUTHORIZED)
        return
      case 'PERMISSION_DENIED':
        setError(ROLE_REFUSED)
        return
      case 'ASSISTED_REGISTRATION_DISABLED':
        setError(DISABLED)
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
        setError(refusalText(caught, SOME_REFUSED))
        return
    }
    if (outcomeUnknown(caught)) { setError(RETRY); return }
    // Any other refusal in plain words: never Identity's own text (owner's rule, 1 Nov 2026).
    setError(plainErrorText(caught, NOT_COMPLETED, { codes: { ASSISTED_VERIFICATION_LIMITED: LIMITED }, audience: 'facility' }))
  }

  /** InPersonCheck.tsx:257-262. */
  function another() {
    pending.current = null; setRetrySignature(null)
    setValues(EMPTY); setMismatch(null); setError(''); problems.clear()
    setStage({ kind: 'form' })
    focus('in-person-form-title')
  }

  if (stage.kind === 'verified') {
    return (
      <Page>
        <Outcome titleId="in-person-verified-title" title={VERIFIED_TITLE} onAnother={another}>
          <p>{VERIFIED_NEXT}</p>
        </Outcome>
      </Page>
    )
  }
  if (stage.kind === 'registered') {
    return (
      <Page>
        <Outcome titleId="in-person-registered-title" title={REGISTERED_TITLE} onAnother={another} anotherVariant="secondary">
          {/* InPersonCheck.tsx:282: the detail line only when there is a detail to say. */}
          {stage.detail ? <p>{stage.detail}</p> : null}
          <p>{REGISTERED_NEXT}</p>
        </Outcome>
      </Page>
    )
  }

  const statementsError = problems.error('in-person-attestations')
  return (
    <Page>
      <DeptSection title={FORM_TITLE} headingId="in-person-form-title">
        {/* InPersonCheck.tsx:288-350: classic's three steps, fields, names, ids, hints and limits, in the design's form. */}
        <form className="hid-ehr-dept-form hid-ehr-dept-inperson-form" noValidate onSubmit={event => void check(event)}>
          <Step n={1} title={STEP_CODE}>
            <EhrField label={<>{CODE_LABEL}<Required /></>} controlId="in-person-desk-code" error={problems.error('in-person-desk-code')}
              hint={CODE_HINT}>
              <EhrInput name="deskCode" value={values.deskCode} placeholder={CODE_PLACEHOLDER} onChange={event => change({ deskCode: event.target.value })}
                autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} readOnly={busy} required />
            </EhrField>
          </Step>

          <Step n={2} title={STEP_ID} hint={STEP_ID_HINT}>
            <EhrField label={<>{DOCUMENT_LABEL}<Required /></>} controlId="in-person-document-type" error={problems.error('in-person-document-type')}>
              <EhrSelect name="documentType" value={values.documentType} required
                onChange={event => change({ documentType: event.target.value as AssistedDocumentType | '' })}>
                <option value="">{DOCUMENT_CHOOSE}</option>
                {DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </EhrSelect>
            </EhrField>
            <fieldset id="in-person-document" name="document" className="hid-ehr-dept-inperson-group">
              <legend className="hid-ehr-dept-inperson-note">{DETAILS_LEGEND}</legend>
              <div className="hid-ehr-dept-form-grid">
                <EhrField label={<>First name<Required /></>} controlId="in-person-first-name" error={problems.error('in-person-first-name')}>
                  <EhrInput name="firstName" value={values.firstName} onChange={event => change({ firstName: event.target.value })}
                    maxLength={100} autoComplete="off" spellCheck={false} readOnly={busy} required />
                </EhrField>
                <EhrField label={<>Last name<Required /></>} controlId="in-person-last-name" error={problems.error('in-person-last-name')}>
                  <EhrInput name="lastName" value={values.lastName} onChange={event => change({ lastName: event.target.value })}
                    maxLength={100} autoComplete="off" spellCheck={false} readOnly={busy} required />
                </EhrField>
                <EhrField label={DATE_OF_BIRTH_LABEL} controlId="in-person-date-of-birth"
                  error={problems.error('in-person-date-of-birth')} hint={DATE_OF_BIRTH_HINT}>
                  <EhrInput name="dateOfBirth" type="date" value={values.dateOfBirth} onChange={event => change({ dateOfBirth: event.target.value })}
                    autoComplete="off" readOnly={busy} />
                </EhrField>
              </div>
            </fieldset>
          </Step>

          <Step n={3} title={STEP_CONFIRM}>
            <fieldset name="attestations" className="hid-ehr-dept-inperson-group" {...problems.group('in-person-attestations')}>
              <legend className="hid-ehr-sr-only">{CONFIRM_LEGEND}</legend>
              <div className="hid-ehr-dept-inperson-checks">
                {ATTESTATIONS.map(([key, label]) => (
                  <label key={key} className="hid-ehr-dept-inperson-choice">
                    <input type="checkbox" id={`in-person-${key}`} name={key} checked={values.attestations[key]}
                      onChange={event => attest(key, event.target.checked)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {statementsError ? <p id="in-person-attestations-error" className="hid-ehr-error">{statementsError}</p> : null}
            </fieldset>
          </Step>

          {/* InPersonCheck.tsx:346, as the design's ErrorBox above the form's submit, under classic's title. */}
          {error ? <DeptNotice role="alert" tone="critical" title={ERROR_TITLE}>{error}</DeptNotice> : null}
          <div className="hid-ehr-dept-form-actions">
            {/* Kept enabled while it runs, so focus stays on it; a second press does nothing. */}
            <EhrButton type="submit" busy={busy}>{busy ? CHECKING : retrying ? CHECK_AGAIN : CHECK}</EhrButton>
          </div>
        </form>
      </DeptSection>

      {/* InPersonCheck.tsx:337-345: the result for each detail, never a record value; the typed details stay above. */}
      {mismatch ? (
        <DeptSection title={MISMATCH_TITLE} headingId="in-person-mismatch-title">
          <ul aria-label="Result for each detail" className="hid-ehr-dept-inperson-results">
            <ResultItem label="First name" result={mismatch.fields.firstName}>{resultWords('firstName', mismatch.fields.firstName, mismatch.typedDateOfBirth)}</ResultItem>
            <ResultItem label="Last name" result={mismatch.fields.lastName}>{resultWords('lastName', mismatch.fields.lastName, mismatch.typedDateOfBirth)}</ResultItem>
            <ResultItem label="Date of birth" result={mismatch.fields.dateOfBirth}>{resultWords('dateOfBirth', mismatch.fields.dateOfBirth, mismatch.typedDateOfBirth)}</ResultItem>
          </ul>
          <p>{MISMATCH_NEXT}</p>
        </DeptSection>
      ) : null}
    </Page>
  )
}

/** The page's heading over each of its views: classic's title and line on what the page is for (InPersonCheck.tsx:268). */
function Page({ children }: { readonly children: ReactNode }) {
  return <DeptPage title={PAGE_TITLE} description={DESCRIPTION} className="hid-ehr-dept-inperson">{children}</DeptPage>
}

/** One of classic's numbered steps (kasuwa/parts.tsx Step): its number, its title as an h3, and its hint under it. */
function Step({ n, title, hint, children }: { readonly n: number; readonly title: string; readonly hint?: string; readonly children: ReactNode }) {
  return (
    <div className="hid-ehr-dept-inperson-stepgroup">
      <div className="hid-ehr-dept-inperson-stephead">
        <span className="hid-ehr-dept-inperson-n" aria-hidden="true">{n}</span>
        <div>
          <h3 className="hid-ehr-dept-inperson-legend">{title}</h3>
          {hint ? <p className="hid-ehr-dept-inperson-note">{hint}</p> : null}
        </div>
      </div>
      {children}
    </div>
  )
}

/** One detail's result, as "First name: does not match"; its colour only repeats what its words say. */
function ResultItem({ label, result, children }: { readonly label: string; readonly result: string | undefined; readonly children: string }) {
  return (
    <li>
      <span className="hid-ehr-dept-inperson-detail">{label}:</span>{' '}
      <span className="hid-ehr-dept-inperson-result" data-result={knownResult(result) ?? 'none'}>{children}</span>
    </li>
  )
}

/**
 * The outcome as classic shows it (InPersonCheck.tsx:271-287): its heading, its lines, and "Check another patient". No
 * status badge, no fact, no "Available actions" and no "Next steps": classic has none, and the design has no screen for
 * this check (parity 3.3-22, 3.3-24). Nothing typed is shown: the name, date of birth and code are cleared as it shows.
 */
function Outcome({ title, titleId, onAnother, anotherVariant = 'primary', children }: {
  readonly title: string
  readonly titleId: string
  readonly onAnother: () => void
  /** Classic's button: primary after a check (InPersonCheck.tsx:275), plain after "already has a Health ID" (:283). */
  readonly anotherVariant?: 'primary' | 'secondary'
  readonly children: ReactNode
}) {
  return (
    <DeptSection title={title} headingId={titleId}>
      {children}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton variant={anotherVariant} onClick={onAnother}>{ANOTHER}</EhrButton>
      </div>
    </DeptSection>
  )
}
