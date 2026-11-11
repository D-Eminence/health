import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { EhrButton, EhrDialog, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { Turnstile } from '../../Turnstile'
import { hasOtherFacilitySignUps, OtherFacilitySignUps } from '../../staff/routes/ProviderEnrollment'
import { organizationTypeLabel, productLabel, waitWords, type Product } from './enrollmentRules'
import { PasswordField } from './PasswordField'
import { ErrorWords, Required } from './parts'
import { CAC_STEP, REGISTRATION_STEPS, REVIEW_STEP, type Enrollment } from './useEnrollment'
import {
  ADMINISTRATOR_ROLES, administratorRoleName, FACILITY_DETAILS_FIELDS, PLATFORM_FIELDS, profileFieldProblem, profileRows,
  type ProfileField,
} from '../collected/facilityProfile'
import { PHONE_REFUSED, phoneE164, REQUIRED as FIELD_REQUIRED } from '../collected/places'
import { profileControlId, ProfileFields } from '../collected/ProfileFields'

/*
 * Every field of the design is collected (hid-system 0122; owner: "allow trading name, all fields required"), except
 * the operating licence, CAC certificate and proof of address, which wait for the document store and its virus scanner
 * and are not shown at all until then.
 */

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

/** The prefix of the facility details' control ids (profileControlId). */
export const PROFILE_PREFIX = 'hid-ehr-signup'

/** The fixed ids of the controls, so a problem can point at one. */
export const IDS = {
  name: 'hid-ehr-signup-name',
  phone: 'hid-ehr-signup-phone',
  email: 'hid-ehr-signup-email',
  role: 'hid-ehr-signup-role',
  type: 'hid-ehr-signup-type',
  cac: 'hid-ehr-signup-cac',
  product: 'hid-ehr-signup-product',
} as const

// The account's phone and email are 'adminPhone' and 'adminEmail': 'phone' and 'email' are the facility's (ProfileField).
type Checked = 'name' | 'adminPhone' | 'adminEmail' | 'role' | 'cac' | ProfileField
type Problems = Partial<Record<Checked, string>>

/** Each step's checked fields, in the order the step shows them: the first with a problem takes focus. */
const STEP_CHECKS: Readonly<Record<number, readonly Checked[]>> = {
  0: ['name', 'adminPhone', 'adminEmail', 'role'],
  1: FACILITY_DETAILS_FIELDS,
  [CAC_STEP]: ['smohLicenceNumber', 'hasRegistryId', 'registryId', 'cac', 'medicalDirectorName', 'medicalDirectorMdcn',
    'hasNhiaAccreditation', 'nhiaAccreditationNumber'],
  3: PLATFORM_FIELDS,
}

function idOf(key: Checked): string {
  if (key === 'adminPhone') return IDS.phone
  if (key === 'adminEmail') return IDS.email
  return key === 'name' || key === 'role' || key === 'cac' ? IDS[key] : profileControlId(PROFILE_PREFIX, key)
}

const REQUIRED = 'This field is required.'
// The WHATWG's valid e-mail address, as the browser checks type="email".
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
// Today's CAC pattern (ProviderEnrollment.tsx:1038).
const CAC = /^(RC|BN|IT)[0-9]{4,20}$/

/** What a step needs before Continue, by the limits today's form sets on its fields (ProviderEnrollment.tsx:1034-1049). */
function problemsOf(step: number, e: Enrollment): Problems {
  const problems: Problems = {}
  for (const key of STEP_CHECKS[step] ?? []) {
    const problem = problemOf(key, e)
    if (problem) problems[key] = problem
  }
  return problems
}

function problemOf(key: Checked, e: Enrollment): string | null {
  switch (key) {
    case 'name': {
      const name = e.name.trim()
      return !name ? REQUIRED : name.length < 2 ? 'Enter at least two characters.' : null
    }
    case 'adminPhone':
      return !e.administratorPhone.trim() ? FIELD_REQUIRED : phoneE164(e.administratorPhone) ? null : PHONE_REFUSED
    case 'adminEmail': {
      const email = e.email.trim()
      return !email ? REQUIRED : EMAIL.test(email) ? null : 'Enter a valid email address.'
    }
    case 'role': return e.administratorRole ? null : 'Choose your role at the facility.'
    case 'cac':
      return !e.cac ? REQUIRED : CAC.test(e.cac) ? null
        : 'Enter the number on your CAC certificate: RC, BN or IT, then its digits, for example RC123456.'
    default: return profileFieldProblem(key, e.profile)
  }
}

function Options({ list }: { readonly list: ReadonlyArray<readonly [string, string]> }) {
  return <><option value="">Select…</option>{list.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>
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
 * Register your facility (design screens 02-07): the design's five steps. Step 1 takes the administrator's name, phone,
 * email and role, step 2 the facility's name and details and its type (today's five), step 3 its regulatory details and
 * the CAC number, step 4 the expected staff, the product (today's one per type) and two questions; step 5 reviews them
 * all, links the Terms of Service and Privacy Policy, and submits beside today's security check. Submitting asks first
 * (07), then runs the start, which sends every field (hid-system 0122). Every field is required.
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
    const first = (STEP_CHECKS[step] ?? []).find(key => found[key])
    if (first) { setProblems(found); setFieldFocus({ id: idOf(first) }); return }
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

  // The facility's details, drawn over steps 2 to 4 (ProfileFields), with this step's problems.
  const profileProps = {
    errors: problems, prefix: PROFILE_PREFIX, fullClassName: 'hid-ehr-signup-full',
    onChange: e.setProfileField,
  } as const
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
            <EhrField label={<Required>Your phone</Required>} controlId={IDS.phone} error={problems.adminPhone}
              hint="For Health ID support to reach you about this sign-up. It is not shown to anyone else.">
              <EhrInput type="tel" required maxLength={32} autoComplete="tel" value={e.administratorPhone}
                onChange={event => e.setAdministratorPhone(event.target.value)} />
            </EhrField>
            <EhrField label={<Required>Email</Required>} controlId={IDS.email} error={problems.adminEmail}>
              <EhrInput type="email" required maxLength={254} autoComplete="email" value={e.email}
                onChange={event => e.setEmail(event.target.value)} />
            </EhrField>
            <PasswordField label="Password" controlId="hid-ehr-signup-password-later" disabled
              hint="You choose your password after confirming your email." />
            <PasswordField label="Confirm password" controlId="hid-ehr-signup-confirm-later" disabled
              toggleLabel="Show password confirmation"
              hint="You choose your password after confirming your email." />
            <EhrField label={<Required>Role at the facility</Required>} controlId={IDS.role} error={problems.role}>
              <EhrSelect required value={e.administratorRole}
                onChange={event => e.setAdministratorRole(event.target.value as typeof e.administratorRole)}>
                <Options list={ADMINISTRATOR_ROLES} />
              </EhrSelect>
            </EhrField>
          </div>}

          {step === 1 && <div className="hid-ehr-signup-grid">
            <ProfileFields form={e.profile} fields={['tradingName']} {...profileProps} />
            <EhrField label={<Required>Facility type</Required>} controlId={IDS.type}
              hint={hasOtherFacilitySignUps() ? <OtherFacilitySignUps inline linkClassName="hid-ehr-signup-link" /> : undefined}>
              <EhrSelect required value={e.organizationType}
                onChange={event => e.setType(event.target.value as typeof e.organizationType)}>
                {e.typeChoices.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </EhrSelect>
            </EhrField>
            <ProfileFields form={e.profile} fields={FACILITY_DETAILS_FIELDS.filter(field => field !== 'tradingName')}
              {...profileProps} />
          </div>}

          {step === CAC_STEP && <div className="hid-ehr-signup-grid">
            <ProfileFields form={e.profile} fields={['smohLicenceNumber', 'hasRegistryId', 'registryId']} {...profileProps} />
            <EhrField label={<Required>CAC registration number</Required>} controlId={IDS.cac}
              hint="We check your CAC against the official registry, and Health ID support checks every new facility within one working day."
              error={problems.cac ?? (refusalAtCac ? <span role="alert"><ErrorWords error={refusalAtCac} /></span> : undefined)}>
              <EhrInput required value={e.cac} onChange={event => e.setCac(event.target.value)}
                autoCapitalize="characters" autoComplete="off" spellCheck={false}
                pattern="(RC|BN|IT)[0-9]{4,20}" maxLength={22} placeholder="RC123456" />
            </EhrField>
            <ProfileFields form={e.profile} fields={['medicalDirectorName', 'medicalDirectorMdcn', 'hasNhiaAccreditation',
              'nhiaAccreditationNumber']} {...profileProps} />
          </div>}

          {step === 3 && <>
            <p className="hid-ehr-signup-muted">Your facility starts with one Health ID product. The products a facility can
              choose depend on its type.</p>
            <div className="hid-ehr-signup-grid">
              <ProfileFields form={e.profile} fields={['expectedStaff']} {...profileProps} />
              <EhrField label={<Required>Product to start with</Required>} controlId={IDS.product} hint={e.productNote}
                className="hid-ehr-signup-full">
                <EhrSelect required value={e.productCode} onChange={event => e.setProductCode(event.target.value as Product)}>
                  {e.productChoices.map(code => <option key={code} value={code}>{productLabel(code)}</option>)}
                </EhrSelect>
              </EhrField>
              <ProfileFields form={e.profile} fields={['migratingRecords', 'needsInteroperability']} {...profileProps} />
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
 * Step 5, Check and send (design screen 06, Agreements): each section with its Edit, today's waits and panels, and
 * last, just above the security check and Submit, the Terms of Service and Privacy Policy to read (with no box: see the
 * note at the top).
 */
function Review({ e, onEdit }: {
  readonly e: Enrollment
  readonly onEdit: (step: number) => void
}) {
  // Only what has a value, as the design lists it; never a password.
  const sections: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [
    [['Full name', e.name.trim()], ['Your phone', phoneE164(e.administratorPhone) ?? e.administratorPhone.trim()],
      ['Email', e.administratorEmail], ['Role at the facility', administratorRoleName(e.administratorRole)]],
    [...profileRows(e.profile, ['tradingName']), ['Facility type', organizationTypeLabel(e.organizationType)],
      ...profileRows(e.profile, FACILITY_DETAILS_FIELDS.filter(field => field !== 'tradingName'))],
    [...profileRows(e.profile, ['smohLicenceNumber', 'hasRegistryId', 'registryId']), ['CAC registration number', e.cac],
      ...profileRows(e.profile, ['medicalDirectorName', 'medicalDirectorMdcn', 'hasNhiaAccreditation', 'nhiaAccreditationNumber'])],
    [...profileRows(e.profile, ['expectedStaff']), ['Product', productLabel(e.productCode)],
      ...profileRows(e.profile, ['migratingRecords', 'needsInteroperability'])],
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
        <p>Changed details take effect only with a new code. The code already sent is for the details you gave before: the
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
