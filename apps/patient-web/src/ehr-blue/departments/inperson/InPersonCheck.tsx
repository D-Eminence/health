import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError, plainErrorText } from '@hid/http'
import { EhrButton, EhrField, EhrInput, EhrSelect, type EhrBadgeTone } from '@hid/ui/ehr'
import { staffApi, type AssistedDocumentType } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { useFocusById } from '../../../staff/focus'
import { refusalText } from '../../../staff/fieldProblem'
import { useFieldProblems } from '../../../staff/useFieldProblems'
import { pageAllowed } from '../../frame/pageAccess'
import { basePath, pageHrefOf } from '../../frame/pageHref'
import { useBluePages } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { DeptContextLine, DeptFacts, DeptRecordLayout } from '../parts/DeptRecord'
import {
  ANOTHER, ASSISTED_REGISTRATION_PERMISSION, ATTESTATIONS, ATTESTATIONS_ENTRY, CHECK, CHECK_AGAIN, CHECKING, DATE_OF_BIRTH_ENTRY,
  DESCRIPTION, DESK_CODE_ENTRY, DESK_CODE_NOT_FOUND, DISABLED_FALLBACK, DOCUMENT_TYPE_ENTRY, DOCUMENT_TYPES, EMPTY, EYEBROW,
  FIRST_NAME_ENTRY, KEY_REUSED, LAST_NAME_ENTRY, METHOD, METHOD_LABEL, MISMATCH_NEXT, MISMATCH_TITLE, NOT_AUTHORIZED, NOT_COMPLETED,
  NOTHING_RECORDED, PERMISSION_DENIED, REGISTERED_NEXT, REGISTERED_TITLE, RETRY, RETRY_PROOF, SOME_REFUSED, STALE, TITLE,
  UNAVAILABLE_MESSAGE, UNAVAILABLE_TITLE, VERIFIED_NEXT, VERIFIED_TITLE, dateOfBirthUnfinished, documentLabel, knownResult,
  normalizeDeskCode, outcomeUnknown, requestOf, resultWords, signatureOf, type Attestation, type Mismatch, type Values,
} from './inPersonRules'
import './inperson.css'

/**
 * The staff in-person check of facility-assisted registration in the blue EHR, drawn in the design's form and record
 * pattern (the design has no screen for it): the form card in the design's two-column grid, the five statements as its
 * checkbox list, the submit, then the outcome as its record view with "Available actions" and "Next steps". Requests,
 * checks, refusals and words are today's (staff/routes/InPersonCheck.tsx at main a4f5704, ported in inPersonRules.ts).
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
  // InPersonCheck.tsx:133-141: today's rule, and today's words for a member without the permission.
  const { facility, permissions } = useDeptAccess()
  if (!facility || !permissions.includes(ASSISTED_REGISTRATION_PERMISSION)) return <InPersonUnavailable />
  // Another facility starts afresh: nothing typed, answered or kept for a retry carries over.
  return <CheckDesk key={facility.id} facilityId={facility.id} />
}

/** InPersonCheck.tsx:136-137: today's refusal, word for word. The frame shows it at the page's address too. */
export function InPersonUnavailable() {
  return <DeptUnavailable title={UNAVAILABLE_TITLE} message={UNAVAILABLE_MESSAGE} />
}

/** InPersonCheck.tsx:143, with the document checked kept for the outcome's record (never a name, a date or the code). */
type Stage =
  | { readonly kind: 'form' }
  | { readonly kind: 'verified'; readonly checked: string }
  | { readonly kind: 'registered'; readonly detail: string; readonly checked: string }

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
  const patientsHref = usePatientsStep()
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
    const checked = documentLabel(input.documentType)
    const key = pending.current?.signature === signature ? pending.current.key : crypto.randomUUID()
    pending.current = { signature, key }
    setBusy(true)
    try {
      await staffApi.assistedVerification(facilityId, input, key)
      pending.current = null; setRetrySignature(null)
      setValues(EMPTY)
      setStage({ kind: 'verified', checked })
      focus('in-person-verified-title')
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      if (outcomeUnknown(caught)) setRetrySignature(signature)
      else { pending.current = null; setRetrySignature(null) }
      answer(caught, form, Boolean(input.document.dateOfBirth), checked)
    } finally { setBusy(false) }
  }

  /** InPersonCheck.tsx:205-255: each answer, said where today's page says it, in today's words. */
  function answer(caught: unknown, form: HTMLFormElement, typedDateOfBirth: boolean, checked: string) {
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
        setStage({ kind: 'registered', detail: '', checked })
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
        setError(PERMISSION_DENIED)
        return
      case 'ASSISTED_REGISTRATION_DISABLED':
        setError(`${DISABLED_FALLBACK} ${NOTHING_RECORDED}`)
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
    setError(plainErrorText(caught, NOT_COMPLETED, { codes: { ASSISTED_VERIFICATION_LIMITED: 'The daily limit of in-person checks has been reached. Try again later.' }, audience: 'facility' }))
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
        <Outcome status="verified" tone="positive" titleId="in-person-verified-title" title={VERIFIED_TITLE} checked={stage.checked}
          onAnother={another} patientsHref={patientsHref}>
          <p>{VERIFIED_NEXT}</p>
        </Outcome>
      </Page>
    )
  }
  if (stage.kind === 'registered') {
    return (
      <Page>
        <Outcome status="already registered" tone="caution" titleId="in-person-registered-title" title={REGISTERED_TITLE}
          checked={stage.checked} onAnother={another} patientsHref={patientsHref}>
          {stage.detail ? <p>{stage.detail}</p> : null}
          <p>{REGISTERED_NEXT}</p>
        </Outcome>
      </Page>
    )
  }

  const statementsError = problems.error('in-person-attestations')
  return (
    <Page>
      <DeptSection title="Check a patient" headingId="in-person-form-title">
        {/* InPersonCheck.tsx:286-338: today's fields, names, ids and limits, in the design's two-column grid. */}
        <form className="hid-ehr-dept-form hid-ehr-dept-inperson-form" noValidate onSubmit={event => void check(event)}>
          <div className="hid-ehr-dept-form-grid">
            <EhrField label={<>Desk code<Required /></>} controlId="in-person-desk-code" error={problems.error('in-person-desk-code')}
              hint="As the patient’s own phone shows it: 10 letters and digits. Spaces, hyphens and case do not matter.">
              <EhrInput name="deskCode" value={values.deskCode} onChange={event => change({ deskCode: event.target.value })}
                autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} readOnly={busy} required />
            </EhrField>
            <fieldset className="hid-ehr-dept-inperson-method">
              <legend className="hid-ehr-label">Method</legend>
              <label className="hid-ehr-dept-inperson-choice">
                <input type="radio" name="method" value={METHOD} checked readOnly />
                <span>{METHOD_LABEL}</span>
              </label>
            </fieldset>
            <EhrField label={<>Document checked<Required /></>} controlId="in-person-document-type" error={problems.error('in-person-document-type')}>
              <EhrSelect name="documentType" value={values.documentType} required
                onChange={event => change({ documentType: event.target.value as AssistedDocumentType | '' })}>
                <option value="">Choose the document</option>
                {DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </EhrSelect>
            </EhrField>
          </div>

          <fieldset id="in-person-document" name="document" className="hid-ehr-dept-inperson-group">
            <legend className="hid-ehr-dept-inperson-legend">As written on the document</legend>
            <div className="hid-ehr-dept-form-grid">
              <EhrField label={<>First name<Required /></>} controlId="in-person-first-name" error={problems.error('in-person-first-name')}>
                <EhrInput name="firstName" value={values.firstName} onChange={event => change({ firstName: event.target.value })}
                  maxLength={100} autoComplete="off" spellCheck={false} readOnly={busy} required />
              </EhrField>
              <EhrField label={<>Last name<Required /></>} controlId="in-person-last-name" error={problems.error('in-person-last-name')}>
                <EhrInput name="lastName" value={values.lastName} onChange={event => change({ lastName: event.target.value })}
                  maxLength={100} autoComplete="off" spellCheck={false} readOnly={busy} required />
              </EhrField>
              <EhrField label="Date of birth (if the document shows one)" controlId="in-person-date-of-birth"
                error={problems.error('in-person-date-of-birth')} hint="A check without it does not match a NIN record that has one.">
                <EhrInput name="dateOfBirth" type="date" value={values.dateOfBirth} onChange={event => change({ dateOfBirth: event.target.value })}
                  autoComplete="off" readOnly={busy} />
              </EhrField>
            </div>
          </fieldset>

          <fieldset name="attestations" className="hid-ehr-dept-inperson-group" {...problems.group('in-person-attestations')}>
            <legend className="hid-ehr-dept-inperson-legend">Confirm each statement</legend>
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

          {/* InPersonCheck.tsx:351, as the design's ErrorBox above the form's submit. */}
          {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
          <div className="hid-ehr-dept-form-actions">
            {/* Kept enabled while it runs, so focus stays on it; a second press does nothing. */}
            <EhrButton type="submit" busy={busy}>{busy ? CHECKING : retrying ? CHECK_AGAIN : CHECK}</EhrButton>
          </div>
        </form>
      </DeptSection>

      {/* InPersonCheck.tsx:341-349: the result for each detail, never a record value; the typed details stay above. */}
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

/** The page's heading over each of its views: today's eyebrow, title and line on what the page is for. */
function Page({ children }: { readonly children: ReactNode }) {
  return <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-inperson">{children}</DeptPage>
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
 * The outcome as the design's record view: its status under the heading, the outcome's card beside "Available actions",
 * and "Next steps" only where one leads to a live page. Its facts are the method and the document checked: never a
 * name, a date of birth or the desk code, which are cleared as the outcome shows.
 */
function Outcome({ status, tone, title, titleId, checked, onAnother, patientsHref, children }: {
  readonly status: string
  readonly tone: EhrBadgeTone
  readonly title: string
  readonly titleId: string
  readonly checked: string
  readonly onAnother: () => void
  readonly patientsHref: string | null
  readonly children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <>
      <DeptContextLine status={status} tone={tone} />
      <DeptRecordLayout
        main={(
          <DeptSection title={title} headingId={titleId}>
            {children}
            <DeptFacts className="hid-ehr-dept-inperson-facts" facts={[
              { label: 'Method', value: METHOD_LABEL },
              { label: 'Document checked', value: checked },
            ]} />
          </DeptSection>
        )}
        aside={(
          <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-actions-card" aria-labelledby="in-person-actions-title">
            <h2 id="in-person-actions-title" className="hid-ehr-card-title">Available actions</h2>
            <div className="hid-ehr-dept-action-stack">
              <EhrButton variant="secondary" onClick={onAnother}>{ANOTHER}</EhrButton>
            </div>
            {patientsHref ? (
              <>
                <h3>Next steps</h3>
                <p className="hid-ehr-dept-inperson-step">
                  <EhrButton variant="secondary" onClick={() => navigate(patientsHref)}>Open patients</EhrButton>
                </p>
              </>
            ) : null}
          </section>
        )}
      />
    </>
  )
}

/**
 * The address of Patients when it is a live page this session may open: where the patient is looked up by their
 * Health ID once they have one. Null otherwise, so no step leads into a sample or to a refusal. Nothing about the
 * patient goes with it: the address is the page's own.
 */
function usePatientsStep(): string | null {
  const pages = useBluePages()
  const { state } = useStaff()
  const session = state.status === 'ready' ? state.session : null
  const patients = pages.find(page => basePath(page.path) === 'patients')
  return patients && patients.status === 'live' && pageAllowed(patients, session) ? pageHrefOf(patients) : null
}
