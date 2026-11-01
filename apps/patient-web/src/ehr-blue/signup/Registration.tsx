import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { EhrButton, EhrDialog, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { Turnstile } from '../../Turnstile'
import { organizationTypeLabel, organizationTypes, productLabel, productOptions, waitWords, type Product } from './enrollmentRules'
import { PasswordField } from './PasswordField'
import { ErrorWords, Required } from './parts'
import { CAC_STEP, REGISTRATION_STEPS, REVIEW_STEP, type Enrollment } from './useEnrollment'

/** What every design field Health ID does not take says: shown, disabled, never sent or kept. */
export const NOT_COLLECTED = 'Not collected by Health ID yet'

/*
 * The design's four agreement boxes (facility-fields.ts step 5) are not drawn. The start Submit sends has no field for
 * an agreement (providerEnrollmentApi.start in staff/api.ts; enrollment.providerStart in packages/contracts), so Health
 * ID cannot record one, and a required box that is then forgotten would let an applicant believe their agreement was
 * kept (parity report 3.2). Step 5 links the Terms of Service and Privacy Policy beside Submit instead. The boxes come
 * back once the start can carry them. There is no Data Processing Agreement, so nothing names one.
 */

// The public site's legal pages, as the patient sign-up links them (routes/enrollment/Signup.tsx:92-93). Absolute: a
// relative /terms on the portal's own origin opens the patient sign-in, not the legal page.
const TERMS_URL = 'https://healthidentitydirectory.com/terms'
const PRIVACY_URL = 'https://healthidentitydirectory.com/privacy'

// The design's own options for fields Health ID does not take (facility-fields.ts, model.ts:349-365).
const ROLES = ['Owner', 'Medical Director', 'Administrator', 'Other authorised representative']
const OWNERSHIP = ['Public', 'Private', 'Faith-based', 'NGO']
const CARE_LEVELS = ['Primary', 'Secondary', 'Tertiary']
const YES_NO = ['Yes', 'No']
const DEPARTMENTS = ['General Outpatient', 'Emergency', 'Inpatient', 'Laboratory', 'Pharmacy', 'Maternity', 'Pediatrics',
  'Radiology', 'Dental', 'Physiotherapy', 'Dialysis', 'Oncology', 'Cardiology', 'ICU', 'Theatre']

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
function NotCollected({ label, full, hint = NOT_COLLECTED, children }: {
  readonly label: string
  readonly full?: boolean
  readonly hint?: string
  readonly children: ReactNode
}) {
  return <EhrField label={label} hint={hint} className={full ? 'hid-ehr-signup-full' : undefined}>{children}</EhrField>
}

function Options({ list }: { readonly list: readonly string[] }) {
  return <><option value="">Select…</option>{list.map(option => <option key={option}>{option}</option>)}</>
}

/** The design's progress: "Step N of 5 · name", the bar, and the five names with the current one marked. */
function Progress({ step }: { readonly step: number }) {
  return (
    <div className="hid-ehr-signup-progress" role="group" aria-label="Registration progress">
      <p id="hid-ehr-signup-progress-label" className="hid-ehr-signup-progress-label">
        Step {step + 1} of {REGISTRATION_STEPS.length} · {REGISTRATION_STEPS[step]}
      </p>
      <progress className="hid-ehr-signup-progress-bar" max={REGISTRATION_STEPS.length} value={step + 1}
        aria-labelledby="hid-ehr-signup-progress-label" />
      <ol className="hid-ehr-signup-progress-steps">
        {REGISTRATION_STEPS.map((name, index) => (
          <li key={name} aria-current={index === step ? 'step' : undefined}>{index + 1}. {name}</li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Register your facility (design screens 02-07): the design's five steps over today's one details form. Step 1 takes
 * the administrator's name and email, step 2 the facility type (today's five), step 3 the CAC number, step 4 the
 * product (today's one per type); step 5 reviews them, links the Terms of Service and Privacy Policy, and submits
 * beside today's security check. Submitting asks first (07), then runs today's start. Every other design field is shown
 * disabled and is never sent or kept.
 */
export function Registration({ e }: { readonly e: Enrollment }) {
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
    if (e.busy || !e.turnstileToken || e.retryIn > 0) return
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

  const refusalAtCac = e.error?.at === 'cac' ? e.error : null
  const stepError = e.error && !refusalAtCac ? e.error : null

  return (
    <>
      <p className="hid-ehr-signup-eyebrow">A workspace for your facility</p>
      <h1 className="hid-ehr-page-title hid-ehr-signup-title">Register your facility</h1>
      <p className="hid-ehr-signup-intro">Tell us about your facility. Verify your CAC registration, confirm your email and choose
        a password. Your administrator account is ready straight away.</p>

      {checking ? <p role="status" className="hid-ehr-signup-status">Checking that facility sign-up is open…</p> : <>
        <Progress step={step} />
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
            <NotCollected label="Phone"><EhrInput type="tel" disabled /></NotCollected>
            <EhrField label={<Required>Email</Required>} controlId={IDS.email} error={problems.email}>
              <EhrInput type="email" required maxLength={254} autoComplete="email" value={e.email}
                onChange={event => e.setEmail(event.target.value)} />
            </EhrField>
            <PasswordField label="Password" controlId="hid-ehr-signup-password-later" disabled
              hint="You choose your password after confirming your email." />
            <PasswordField label="Confirm password" controlId="hid-ehr-signup-confirm-later" disabled
              toggleLabel="Show password confirmation"
              hint="You choose your password after confirming your email." />
            <NotCollected label="Role at the facility"><EhrSelect disabled><Options list={ROLES} /></EhrSelect></NotCollected>
          </div>}

          {step === 1 && <div className="hid-ehr-signup-grid">
            <NotCollected label="Facility name"
              hint={`${NOT_COLLECTED}: your facility’s registered name comes from its CAC record.`}>
              <EhrInput disabled />
            </NotCollected>
            <EhrField label={<Required>Facility type</Required>} controlId={IDS.type}>
              <EhrSelect required value={e.organizationType}
                onChange={event => e.setType(event.target.value as typeof e.organizationType)}>
                {organizationTypes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </EhrSelect>
            </EhrField>
            <NotCollected label="Ownership"><EhrSelect disabled><Options list={OWNERSHIP} /></EhrSelect></NotCollected>
            <NotCollected label="Level of care"><EhrSelect disabled><Options list={CARE_LEVELS} /></EhrSelect></NotCollected>
            <NotCollected label="Address"><EhrInput disabled /></NotCollected>
            <NotCollected label="State"><EhrSelect disabled><Options list={[]} /></EhrSelect></NotCollected>
            <NotCollected label="Local government area"><EhrSelect disabled><Options list={[]} /></EhrSelect></NotCollected>
            <NotCollected label="GPS pin (latitude, longitude)"><EhrInput disabled /></NotCollected>
            <NotCollected label="Facility phone"><EhrInput type="tel" disabled /></NotCollected>
            <NotCollected label="Facility email"><EhrInput type="email" disabled /></NotCollected>
            <NotCollected label="Bed count"><EhrInput type="number" disabled /></NotCollected>
            <NotCollected label="Operating hours"><EhrInput disabled /></NotCollected>
            <NotCollected label="24-hour emergency"><EhrSelect disabled><Options list={YES_NO} /></EhrSelect></NotCollected>
            <NotCollected label="Departments" full>
              <EhrSelect multiple disabled className="hid-ehr-signup-multiple">
                {DEPARTMENTS.map(department => <option key={department}>{department}</option>)}
              </EhrSelect>
            </NotCollected>
            <NotCollected label="Services offered" full><EhrTextarea rows={3} disabled /></NotCollected>
          </div>}

          {step === CAC_STEP && <div className="hid-ehr-signup-grid">
            <NotCollected label="State Ministry of Health licence number"><EhrInput disabled /></NotCollected>
            <NotCollected label="National facility registry ID (optional)"><EhrInput disabled /></NotCollected>
            <EhrField label={<Required>CAC registration number</Required>} controlId={IDS.cac}
              hint="We check your CAC against the official registry, and Health ID support checks every new facility within one working day."
              error={problems.cac ?? (refusalAtCac ? <span role="alert"><ErrorWords error={refusalAtCac} /></span> : undefined)}>
              <EhrInput required value={e.cac} onChange={event => e.setCac(event.target.value)}
                autoCapitalize="characters" autoComplete="off" spellCheck={false}
                pattern="(RC|BN|IT)[0-9]{4,20}" maxLength={22} placeholder="RC123456" />
            </EhrField>
            <NotCollected label="Medical Director’s full name"><EhrInput disabled /></NotCollected>
            <NotCollected label="MDCN number"><EhrInput disabled /></NotCollected>
            <NotCollected label="NHIA accreditation (optional)"><EhrInput disabled /></NotCollected>
            <NotCollected label="Operating licence (image/PDF, max 2 MB)" full><EhrInput type="file" disabled /></NotCollected>
            <NotCollected label="CAC certificate (image/PDF, max 2 MB)" full><EhrInput type="file" disabled /></NotCollected>
            <NotCollected label="Proof of address (image/PDF, max 2 MB)" full><EhrInput type="file" disabled /></NotCollected>
          </div>}

          {step === 3 && <>
            <p className="hid-ehr-signup-muted">Your facility starts with one Health ID product. The products a facility can
              choose depend on its type.</p>
            <div className="hid-ehr-signup-grid">
              <NotCollected label="Expected number of staff"><EhrInput type="number" disabled /></NotCollected>
              <EhrField label={<Required>Product to start with</Required>} controlId={IDS.product} hint={e.productNote}
                className="hid-ehr-signup-full">
                <EhrSelect required value={e.productCode} onChange={event => e.setProductCode(event.target.value as Product)}>
                  {productOptions[e.organizationType].map(code => <option key={code} value={code}>{productLabel(code)}</option>)}
                </EhrSelect>
              </EhrField>
              <NotCollected label="Migrating existing records?"><EhrSelect disabled><Options list={YES_NO} /></EhrSelect></NotCollected>
              <NotCollected label="Need interoperability with other facilities?">
                <EhrSelect disabled><Options list={YES_NO} /></EhrSelect>
              </NotCollected>
            </div>
          </>}

          {step === REVIEW_STEP && <Review e={e} onEdit={move} />}

          {stepError ? <p role="alert" className="hid-ehr-signup-alert"><ErrorWords error={stepError} /></p> : null}

          <div className="hid-ehr-signup-actions">
            {step === REVIEW_STEP ? <>
              <div className="hid-ehr-signup-turnstile">
                <Turnstile action="provider-enrollment" onTokenChange={e.setTurnstileToken} resetKey={e.resetKey} />
              </div>
              <EhrButton type="submit" busy={e.busy} disabled={!e.turnstileToken || e.retryIn > 0}>
                {e.busy ? 'Verifying CAC…' : 'Submit facility for verification'}
              </EhrButton>
            </> : <EhrButton type="submit">Continue</EhrButton>}
          </div>
          {step === REVIEW_STEP && e.retryIn > 0 && !e.busy ? <p className="hid-ehr-hint">{e.carried
            ? 'You can continue with your changes in ' : 'You can try again in '}{waitWords(e.retryIn)}.</p> : null}
        </form>

        <div className="hid-ehr-signup-controls">
          {step > 0 ? <EhrButton variant="secondary" onClick={() => move(step - 1)}>Back</EhrButton> : null}
          <EhrButton variant="secondary" disabled aria-describedby="hid-ehr-signup-later-note">Save &amp; continue later</EhrButton>
          <p id="hid-ehr-signup-later-note" className="hid-ehr-hint">Not available yet: Health ID doesn’t save drafts of a
            registration.</p>
        </div>

        <EhrDialog open={confirming} title="Submit this registration?"
          description="Check the details above, then submit. Health ID checks your CAC registration number and emails you a six digit code."
          confirmLabel="Confirm and submit"
          onCancel={() => setConfirming(false)}
          onConfirm={() => { setConfirming(false); void e.start() }} />
      </>}
    </>
  )
}

/**
 * Step 5, Agreements (design screen 06): each section with its Edit, today's waits and panels, and last, just above the
 * security check and Submit, the Terms of Service and Privacy Policy to read (with no box: see the note at the top).
 */
function Review({ e, onEdit }: {
  readonly e: Enrollment
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
              <EhrButton variant="secondary" onClick={() => onEdit(index)}>Edit {section.toLowerCase()}</EhrButton>
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

      {/* Shown, not folded away, now that no box asks for them: what to read before Submit, never an acceptance. */}
      <div className="hid-ehr-signup-agreements">
        <p>Before you submit, please read the <a className="hid-ehr-signup-link" href={TERMS_URL} target="_blank"
          rel="noopener">Health ID Terms of Service</a> and the <a className="hid-ehr-signup-link" href={PRIVACY_URL}
          target="_blank" rel="noopener">Health ID Privacy Policy</a> (each opens in a new tab).</p>
        <p>Facility users are responsible for appropriate data protection and patient consent.</p>
      </div>
    </>
  )
}
