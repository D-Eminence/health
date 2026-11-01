import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { EhrButton, EhrDialog, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { Turnstile } from '../../Turnstile'
import { AuthStepper } from '../../AuthLayout'
import { organizationTypeLabel, organizationTypes, productLabel, productOptions, waitWords, type Product } from './enrollmentRules'
import { ErrorWords, Required } from './parts'
import { CAC_STEP, REGISTRATION_STEPS, REVIEW_STEP, type Enrollment } from './useEnrollment'

/**
 * The design's fields Health ID does not take (phone, role, address, licences, departments…) are not drawn: a field
 * that is shown disabled with "not collected yet" says the same thing on every step (owner's rule: say each thing once,
 * no "not available yet").
 */
/**
 * The design's agreements (facility-fields.ts step 5), required before submitting. Health ID records no acceptance, so
 * the boxes say what the applicant has read; there is no Data Processing Agreement, so it has no box.
 */
export const AGREEMENTS = [
  ['terms', 'I have read the Terms of Service'],
  ['privacy', 'I have read the Privacy Policy'],
  ['ndpa', 'I acknowledge data protection and patient consent responsibilities'],
  ['authorised', 'I am authorised to register this facility'],
] as const
export type Agreement = (typeof AGREEMENTS)[number][0]
export type Agreements = Readonly<Record<Agreement, boolean>>
export const NO_AGREEMENTS: Agreements = { terms: false, privacy: false, ndpa: false, authorised: false }

// The public site's legal pages, as the patient sign-up links them (routes/enrollment/Signup.tsx:92-93). Absolute: a
// relative /terms on the portal's own origin opens the patient sign-in, not the legal page.
const TERMS_URL = 'https://healthidentitydirectory.com/terms'
const PRIVACY_URL = 'https://healthidentitydirectory.com/privacy'

/** The fixed ids of the controls Health ID takes, so a problem can point at one. */
export const IDS = {
  name: 'hid-ehr-signup-name',
  email: 'hid-ehr-signup-email',
  type: 'hid-ehr-signup-type',
  cac: 'hid-ehr-signup-cac',
  product: 'hid-ehr-signup-product',
} as const

type Checked = 'name' | 'email' | 'cac'
type Problems = Partial<Record<Checked, string>>

const REQUIRED = 'This field is required.'
// The WHATWG's valid e-mail address, as the browser checks type="email".
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
// Today's CAC pattern (ProviderEnrollment.tsx:1038).
const CAC = /^(RC|BN|IT)[0-9]{4,20}$/

/** What a step needs before Continue, by the limits today's form sets on its fields (ProviderEnrollment.tsx:1034-1049). */
function problemsOf(step: number, e: Enrollment): Problems {
  const problems: Problems = {}
  if (step === 0) {
    const name = e.name.trim()
    if (!name) problems.name = REQUIRED
    else if (name.length < 2) problems.name = 'Enter at least two characters.'
    const email = e.email.trim()
    if (!email) problems.email = REQUIRED
    else if (!EMAIL.test(email)) problems.email = 'Enter a valid email address.'
  }
  if (step === CAC_STEP) {
    if (!e.cac) problems.cac = REQUIRED
    else if (!CAC.test(e.cac)) problems.cac = 'Enter the number on your CAC certificate: RC, BN or IT, then its digits, for example RC123456.'
  }
  return problems
}

const FIRST: Record<Checked, string> = { name: IDS.name, email: IDS.email, cac: IDS.cac }

/** A design field Health ID does not take: shown, disabled, unnamed, never sent or kept. */
/**
 * Register your facility (design screens 02-07): the design's five steps over today's one details form. Step 1 takes
 * the administrator's name and email, step 2 the facility type (today's five), step 3 the CAC number, step 4 the
 * product (today's one per type); step 5 reviews them, shows the agreements and their four required boxes, and submits
 * beside today's security check. Submitting asks first (07), then runs today's start. The design's other fields are not
 * drawn: Health ID takes none of them.
 */
export function Registration({ e, agreed, onAgree }: {
  readonly e: Enrollment
  readonly agreed: Agreements
  readonly onAgree: (agreement: Agreement, value: boolean) => void
}) {
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const [problems, setProblems] = useState<Problems>({})
  const [incomplete, setIncomplete] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // The field to focus after a Continue it stopped: the first one with a problem.
  const [fieldFocus, setFieldFocus] = useState<{ id: string } | null>(null)
  const step = e.regStep
  const checking = e.availability === 'checking'

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
    move(step + 1)
  }

  /** The design re-checks every step first and returns to the first one missing something. */
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
    setConfirming(true)
  }

  const allAgreed = AGREEMENTS.every(([key]) => agreed[key])
  const refusalAtCac = e.error?.at === 'cac' ? e.error : null
  const stepError = e.error && !refusalAtCac ? e.error : null

  return (
    <>
      {checking ? null : <AuthStepper label="Registration progress"
        steps={REGISTRATION_STEPS.map((name, index) => ({ label: name, current: index === step }))} />}
      <h1 className="hid-ehr-page-title hid-ehr-signup-title">Register a facility</h1>
      <p className="hid-ehr-signup-intro">Sign up your clinic, hospital, lab or pharmacy.</p>

      {checking ? <p role="status" className="hid-ehr-signup-status">Checking that facility sign-up is open…</p> : <>
        <form className="hid-ehr-signup-form" noValidate onSubmit={next} aria-labelledby="hid-ehr-signup-step-title">
          <h2 id="hid-ehr-signup-step-title" ref={stepHeading} tabIndex={-1} className="hid-ehr-signup-step-title">
            {REGISTRATION_STEPS[step]}
          </h2>
          {incomplete ? <p role="alert" className="hid-ehr-signup-alert">Complete this section before submitting.</p> : null}

          {step === 0 && <div className="hid-ehr-signup-grid">
            <EhrField label={<Required>Full name</Required>} controlId={IDS.name} error={problems.name}>
              <EhrInput required minLength={2} maxLength={200} autoComplete="name" value={e.name}
                onChange={event => e.setName(event.target.value)} />
            </EhrField>
            <EhrField label={<Required>Email</Required>} controlId={IDS.email} error={problems.email}>
              <EhrInput type="email" required maxLength={254} autoComplete="email" value={e.email}
                onChange={event => e.setEmail(event.target.value)} />
            </EhrField>
          </div>}

          {step === 1 && <div className="hid-ehr-signup-grid">
            <EhrField label={<Required>Facility type</Required>} controlId={IDS.type}>
              <EhrSelect required value={e.organizationType}
                onChange={event => e.setType(event.target.value as typeof e.organizationType)}>
                {organizationTypes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </EhrSelect>
            </EhrField>
          </div>}

          {step === CAC_STEP && <div className="hid-ehr-signup-grid">
            <EhrField label={<Required>CAC registration number</Required>} controlId={IDS.cac}
              hint="We check your CAC against the official registry, and Health ID support checks every new facility within one working day."
              error={problems.cac ?? (refusalAtCac ? <span role="alert"><ErrorWords error={refusalAtCac} /></span> : undefined)}>
              <EhrInput required value={e.cac} onChange={event => e.setCac(event.target.value)}
                autoCapitalize="characters" autoComplete="off" spellCheck={false}
                pattern="(RC|BN|IT)[0-9]{4,20}" maxLength={22} placeholder="RC123456" />
            </EhrField>
          </div>}

          {step === 3 && <>
            <p className="hid-ehr-signup-muted">Your facility starts with one Health ID product. The products a facility can
              choose depend on its type.</p>
            <div className="hid-ehr-signup-grid">
              <EhrField label={<Required>Product to start with</Required>} controlId={IDS.product} hint={e.productNote}
                className="hid-ehr-signup-full">
                <EhrSelect required value={e.productCode} onChange={event => e.setProductCode(event.target.value as Product)}>
                  {productOptions[e.organizationType].map(code => <option key={code} value={code}>{productLabel(code)}</option>)}
                </EhrSelect>
              </EhrField>
            </div>
          </>}

          {step === REVIEW_STEP && <Review e={e} agreed={agreed} onAgree={onAgree} onEdit={move} />}

          {stepError ? <p role="alert" className="hid-ehr-signup-alert"><ErrorWords error={stepError} /></p> : null}

          {step === REVIEW_STEP ? <div className="hid-ehr-signup-turnstile">
            <Turnstile action="provider-enrollment" onTokenChange={e.setTurnstileToken} resetKey={e.resetKey} />
          </div> : null}
          {/* Back, then the one primary: rightmost from 640px, at the bottom on a phone. */}
          <div className="hid-ehr-signup-actions">
            {step > 0 ? <EhrButton type="button" variant="secondary" onClick={() => move(step - 1)}>Back</EhrButton> : null}
            {step === REVIEW_STEP
              ? <EhrButton type="submit" busy={e.busy} disabled={!allAgreed || !e.turnstileToken || e.retryIn > 0}>
                {e.busy ? 'Verifying CAC…' : 'Submit facility for verification'}
              </EhrButton>
              : <EhrButton type="submit">Continue</EhrButton>}
          </div>
          {step === REVIEW_STEP && e.retryIn > 0 && !e.busy ? <p className="hid-ehr-hint">{e.carried
            ? 'You can continue with your changes in ' : 'You can try again in '}{waitWords(e.retryIn)}.</p> : null}
        </form>


        <EhrDialog open={confirming} title="Submit this registration?"
          description="Check the details above, then submit. Health ID checks your CAC registration number and emails you a six digit code."
          confirmLabel="Confirm and submit"
          onCancel={() => setConfirming(false)}
          onConfirm={() => { setConfirming(false); void e.start() }} />
      </>}
    </>
  )
}

/** Step 5, Agreements (design screen 06): each section with its Edit, the agreements, and today's waits and panels. */
function Review({ e, agreed, onAgree, onEdit }: {
  readonly e: Enrollment
  readonly agreed: Agreements
  readonly onAgree: (agreement: Agreement, value: boolean) => void
  readonly onEdit: (step: number) => void
}) {
  // Only what has a value, as the design lists it; never a password.
  const sections: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [
    [['Full name', e.name.trim()], ['Email', e.administratorEmail]],
    [['Facility type', organizationTypeLabel(e.organizationType)]],
    [['CAC registration number', e.cac]],
    [['Product', productLabel(e.productCode)]],
  ]
  const kept = e.kept
  const carried = e.carried
  return (
    <>
      <div className="hid-ehr-signup-summary">
        {sections.map((rows, index) => {
          const section = REGISTRATION_STEPS[index]!
          return (
            <details key={section} open={index === 0}>
              <summary>{section}</summary>
              <EhrButton variant="secondary" onClick={() => onEdit(index)}>Edit {section.replace(/^[A-Z][a-z]/, start => start.toLowerCase())}</EhrButton>
              <dl className="hid-ehr-signup-facts">
                {rows.filter(([, value]) => value).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </details>
          )
        })}
      </div>

      <p className="hid-ehr-signup-info">No payment is taken at sign-up. When you submit, we check your CAC registration
        number against the official registry and email a six digit code to {e.administratorEmail || 'your email address'}.</p>

      <details className="hid-ehr-signup-agreements">
        <summary>Read the agreements</summary>
        <p><strong>Terms of Service:</strong> read the <a className="hid-ehr-signup-link" href={TERMS_URL} target="_blank"
          rel="noopener">Health ID Terms of Service</a> (opens in a new tab).</p>
        <p><strong>Privacy Policy:</strong> read the <a className="hid-ehr-signup-link" href={PRIVACY_URL} target="_blank"
          rel="noopener">Health ID Privacy Policy</a> (opens in a new tab).</p>
        <p><strong>Data protection and patient consent:</strong> Facility users acknowledge responsibility for appropriate
          data protection and patient consent.</p>
      </details>

      <fieldset className="hid-ehr-signup-checks">
        <legend className="hid-ehr-sr-only">Agreements</legend>
        {AGREEMENTS.map(([key, label]) => (
          <label key={key} className="hid-ehr-signup-check">
            <input type="checkbox" required checked={agreed[key]} onChange={event => onAgree(key, event.target.checked)} />
            <span className="hid-ehr-signup-required" aria-hidden="true">*</span>
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      {kept ? <div className="hid-ehr-signup-note">
        <p>A sign-up for {kept.cacRegistrationNumber} was started with {kept.administratorEmail}, and only that email can
          {' '}finish it until 24 hours after it started. You can still correct the CAC number.</p>
        <EhrButton variant="secondary" size="sm" onClick={() => e.firstEmail(kept)}>Use the email I first gave</EhrButton>
      </div> : null}

      {carried ? <div className="hid-ehr-signup-note">
        <p>A new facility type or administrator name takes effect only with a new code. The code already sent is for the
          {' '}facility type {organizationTypeLabel(carried.carries.organizationType)}, with {carried.carries.administratorName} as
          {' '}administrator.</p>
        {carried.enterableUntil > e.now ? <EhrButton variant="secondary" size="sm"
          onClick={() => e.enterCodeInForce(carried)}>Use the details I gave before</EhrButton> : null}
      </div> : null}
    </>
  )
}
