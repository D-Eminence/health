import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { Turnstile } from '../../Turnstile'
import { AuthStepper } from '../../AuthLayout'
import { organizationTypeLabel, organizationTypes, productLabel, productOptions, waitWords, type Product } from './enrollmentRules'
import { Choices, ErrorWords } from './parts'
import { CAC_STEP, PRODUCT_STEP, REGISTRATION_STEPS, REVIEW_STEP, shownSteps, type Enrollment } from './useEnrollment'

/**
 * The agreements, required before sending. Health ID records no acceptance, so the boxes say what the applicant has
 * read or will do; there is no Data Processing Agreement, so it has no box. The two documents are linked in the line
 * itself, so nothing else repeats them.
 */
export const AGREEMENTS = [
  ['terms', 'I have read the', 'Terms of Service'],
  ['privacy', 'I have read the', 'Privacy Policy'],
  ['ndpa', 'I will protect patients’ data and ask for their consent', null],
  ['authorised', 'I am allowed to register this facility', null],
] as const
export type Agreement = (typeof AGREEMENTS)[number][0]
export type Agreements = Readonly<Record<Agreement, boolean>>
export const NO_AGREEMENTS: Agreements = { terms: false, privacy: false, ndpa: false, authorised: false }

// The public site's legal pages, as the patient sign-up links them (routes/enrollment/Signup.tsx:92-93). Absolute: a
// relative /terms on the portal's own origin opens the patient sign-in, not the legal page.
const LEGAL_URLS: Readonly<Record<string, string>> = {
  terms: 'https://healthidentitydirectory.com/terms',
  privacy: 'https://healthidentitydirectory.com/privacy',
}

/** The fixed ids of the controls Health ID takes, so a problem can point at one. */
export const IDS = {
  name: 'hid-ehr-signup-name',
  email: 'hid-ehr-signup-email',
  type: 'hid-ehr-signup-type',
  cac: 'hid-ehr-signup-cac',
  product: 'hid-ehr-signup-product',
} as const

const HEADING_ID = 'hid-ehr-signup-step-title'

type Checked = 'name' | 'email' | 'cac'
type Problems = Partial<Record<Checked, string>>

// The WHATWG's valid e-mail address, as the browser checks type="email".
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
// Today's CAC pattern (ProviderEnrollment.tsx:1038).
const CAC = /^(RC|BN|IT)[0-9]{4,20}$/

/** What a step needs before Continue, by the limits today's form sets on its fields (ProviderEnrollment.tsx:1034-1049). */
function problemsOf(step: number, e: Enrollment): Problems {
  const problems: Problems = {}
  if (step === 0) {
    const name = e.name.trim()
    if (!name) problems.name = 'Enter your full name.'
    else if (name.length < 2) problems.name = 'Enter at least two letters.'
    const email = e.email.trim()
    if (!email) problems.email = 'Enter your email address.'
    else if (!EMAIL.test(email)) problems.email = 'Enter an email address like name@example.com.'
  }
  if (step === CAC_STEP) {
    if (!e.cac) problems.cac = 'Enter your CAC number.'
    else if (!CAC.test(e.cac)) problems.cac = 'Start with RC, BN or IT, then the digits, like RC123456.'
  }
  return problems
}

const FIRST: Record<Checked, string> = { name: IDS.name, email: IDS.email, cac: IDS.cac }

/**
 * Register a facility: one question a step, each named once by its heading (the stepper says only "Step 2 of 5").
 * Step 1 takes the administrator's name and email, step 2 the facility type, step 3 the CAC number, step 4 the product,
 * which a type with only one product is not asked (it is chosen already, and the review says which). The last step
 * lists the answers, each section with one Edit, and the four required agreements; Send runs today's start beside
 * today's security check.
 */
export function Registration({ e, agreed, onAgree }: {
  readonly e: Enrollment
  readonly agreed: Agreements
  readonly onAgree: (agreement: Agreement, value: boolean) => void
}) {
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const [problems, setProblems] = useState<Problems>({})
  const [incomplete, setIncomplete] = useState(false)
  // The field to focus after a Continue it stopped: the first one with a problem.
  const [fieldFocus, setFieldFocus] = useState<{ id: string } | null>(null)
  const step = e.regStep
  const checking = e.availability === 'checking'
  const shown = shownSteps(e.organizationType)
  const at = Math.max(0, shown.indexOf(step))

  // A step change (Continue, Back, Edit, a refusal that returns to a step) moves focus to the step's heading, in the
  // commit that shows it. Not on the first showing of the form.
  useLayoutEffect(() => {
    if (e.headingFocus > 0) stepHeading.current?.focus()
  }, [e.headingFocus])
  useLayoutEffect(() => {
    if (fieldFocus) document.getElementById(fieldFocus.id)?.focus()
  }, [fieldFocus])

  function move(to: number) {
    setProblems({})
    setIncomplete(false)
    e.setError(null)
    e.toStep(to)
  }

  function next(event: FormEvent) {
    event.preventDefault()
    if (step === REVIEW_STEP) { submit(); return }
    const found = problemsOf(step, e)
    const first = (Object.keys(FIRST) as Checked[]).find(key => found[key])
    if (first) { setProblems(found); setFieldFocus({ id: FIRST[first] }); return }
    move(shown[at + 1] ?? REVIEW_STEP)
  }

  /** Every step is checked again first; the first one missing something is shown. Then today's start. */
  function submit() {
    if (e.busy || !allAgreed || !e.turnstileToken || e.retryIn > 0) return
    for (let earlier = 0; earlier < REVIEW_STEP; earlier++) {
      const found = problemsOf(earlier, e)
      if (Object.keys(found).length) {
        move(earlier)
        setProblems(found)
        setIncomplete(true)
        return
      }
    }
    void e.start()
  }

  const allAgreed = AGREEMENTS.every(([key]) => agreed[key])
  const refusalAtCac = e.error?.at === 'cac' ? e.error : null
  const stepError = e.error && !refusalAtCac ? e.error : null

  if (checking) {
    return <>
      <h1 className="hid-ehr-signup-title">Register a facility</h1>
      <p role="status" className="hid-ehr-signup-lede">Checking that sign-up is open…</p>
    </>
  }

  return (
    <>
      <AuthStepper label="Sign-up progress" named={false}
        steps={shown.map(index => ({ label: REGISTRATION_STEPS[index]!, current: index === step }))} />
      <form className="hid-ehr-signup-form" noValidate onSubmit={next} aria-labelledby={HEADING_ID}>
        <h1 id={HEADING_ID} ref={stepHeading} tabIndex={-1} className="hid-ehr-signup-title">{REGISTRATION_STEPS[step]}</h1>
        {step === 0 ? <p className="hid-ehr-signup-lede">Register your clinic, hospital, lab or pharmacy. You’ll manage its
          {' '}Health ID account.</p> : null}
        {incomplete ? <p role="alert" className="hid-ehr-signup-alert">Fill in this step before you send.</p> : null}

        {step === 0 && <div className="hid-ehr-signup-fields">
          <EhrField label="Full name" controlId={IDS.name} error={problems.name}>
            <EhrInput required minLength={2} maxLength={200} autoComplete="name" value={e.name}
              onChange={event => e.setName(event.target.value)} />
          </EhrField>
          <EhrField label="Email" controlId={IDS.email} error={problems.email}>
            <EhrInput type="email" required maxLength={254} autoComplete="email" value={e.email}
              onChange={event => e.setEmail(event.target.value)} />
          </EhrField>
        </div>}

        {step === 1 && <Choices name="hid-ehr-signup-type" labelledBy={HEADING_ID} value={e.organizationType}
          options={organizationTypes.map(option => ({ value: option.value, label: option.label }))}
          onChange={value => e.setType(value)} note={e.productNote} noteId="hid-ehr-signup-type-note" />}

        {step === CAC_STEP && <div className="hid-ehr-signup-fields">
          <EhrField label="CAC number" controlId={IDS.cac} hint="From your business registration certificate."
            error={problems.cac ?? (refusalAtCac ? <span role="alert"><ErrorWords error={refusalAtCac} /></span> : undefined)}>
            <EhrInput required value={e.cac} onChange={event => e.setCac(event.target.value)}
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              pattern="(RC|BN|IT)[0-9]{4,20}" maxLength={22} placeholder="RC123456" />
          </EhrField>
        </div>}

        {step === PRODUCT_STEP && <Choices name="hid-ehr-signup-product" labelledBy={HEADING_ID} value={e.productCode}
          options={productOptions[e.organizationType].map(code => ({ value: code, label: productLabel(code) }))}
          onChange={value => e.setProductCode(value as Product)} />}

        {step === REVIEW_STEP && <Review e={e} agreed={agreed} onAgree={onAgree} onEdit={move} />}

        {stepError ? <p role="alert" className="hid-ehr-signup-alert"><ErrorWords error={stepError} /></p> : null}

        {step === REVIEW_STEP ? <div className="hid-ehr-signup-turnstile">
          <Turnstile action="provider-enrollment" onTokenChange={e.setTurnstileToken} resetKey={e.resetKey} />
        </div> : null}
        {/* Back, then the one primary: rightmost from 640px, at the bottom on a phone. */}
        <div className="hid-ehr-signup-actions">
          {at > 0 ? <EhrButton type="button" variant="secondary" onClick={() => move(shown[at - 1]!)}>Back</EhrButton> : null}
          {step === REVIEW_STEP
            ? <EhrButton type="submit" busy={e.busy} disabled={!allAgreed || !e.turnstileToken || e.retryIn > 0}>
              {e.busy ? 'Sending…' : 'Send'}
            </EhrButton>
            : <EhrButton type="submit">Continue</EhrButton>}
        </div>
        {step === REVIEW_STEP && e.retryIn > 0 && !e.busy ? <p className="hid-ehr-signup-hint">{e.carried
          ? 'You can send your changes in ' : 'You can try again in '}{waitWords(e.retryIn)}.</p> : null}
      </form>
    </>
  )
}

/** Check and send: the answers in one short list, one Edit a section, the agreements, and what Send does. */
function Review({ e, agreed, onAgree, onEdit }: {
  readonly e: Enrollment
  readonly agreed: Agreements
  readonly onAgree: (agreement: Agreement, value: boolean) => void
  readonly onEdit: (step: number) => void
}) {
  // Each section with the step that holds it; never a password. A product the type decides has no Edit: the type's has.
  const choosesProduct = productOptions[e.organizationType].length > 1
  const sections: ReadonlyArray<{ step: number; edit: string; rows: ReadonlyArray<readonly [string, string]> }> = [
    { step: 0, edit: 'Edit name and email', rows: [['Name', e.name.trim()], ['Email', e.administratorEmail]] },
    { step: 1, edit: 'Edit facility type', rows: [['Facility type', organizationTypeLabel(e.organizationType)],
      ...(choosesProduct ? [] : [['Product', productLabel(e.productCode)] as const])] },
    { step: CAC_STEP, edit: 'Edit CAC number', rows: [['CAC number', e.cac]] },
    ...(choosesProduct ? [{ step: PRODUCT_STEP, edit: 'Edit product', rows: [['Product', productLabel(e.productCode)] as const] }] : []),
  ]
  const kept = e.kept
  const carried = e.carried
  return (
    <>
      <div className="hid-ehr-signup-summary">
        {sections.map(section => (
          <div key={section.step} className="hid-ehr-signup-section">
            <dl className="hid-ehr-signup-facts">
              {section.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <EhrButton variant="quiet" className="hid-ehr-signup-edit" aria-label={section.edit}
              onClick={() => onEdit(section.step)}>Edit</EhrButton>
          </div>
        ))}
      </div>

      {kept ? <div className="hid-ehr-signup-note">
        <p>A sign-up for {kept.cacRegistrationNumber} was started with {kept.administratorEmail}. Until 24 hours after it
          {' '}started, only that email can finish it. You can still correct the CAC number.</p>
        <EhrButton variant="secondary" onClick={() => e.firstEmail(kept)}>Use the email I first gave</EhrButton>
      </div> : null}

      {carried ? <div className="hid-ehr-signup-note">
        <p>A new facility type or name needs a new code. The code we already sent is for {organizationTypeLabel(
          carried.carries.organizationType)}, with {carried.carries.administratorName} as administrator.</p>
        {carried.enterableUntil > e.now ? <EhrButton variant="secondary"
          onClick={() => e.enterCodeInForce(carried)}>Use the details I gave before</EhrButton> : null}
      </div> : null}

      <fieldset className="hid-ehr-signup-checks">
        <legend className="hid-ehr-sr-only">Agreements</legend>
        {AGREEMENTS.map(([key, words, link]) => (
          <label key={key} className="hid-ehr-signup-check">
            <input type="checkbox" required checked={agreed[key]} onChange={event => onAgree(key, event.target.checked)} />
            <span>{words}{link ? <> <a className="hid-ehr-signup-link" href={LEGAL_URLS[key]} target="_blank"
              rel="noopener">{link}</a></> : null}</span>
          </label>
        ))}
      </fieldset>

      <p className="hid-ehr-signup-hint">When you send, we check your CAC number and email a 6-digit code
        to {e.administratorEmail || 'you'}. There’s nothing to pay.</p>
    </>
  )
}
