import { useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Field, Input, PasswordInput, Select } from '@hid/ui'
import './providerSetup.css'
import { AuthLayout } from '../../AuthLayout'
import { useDocumentTitle } from '../../authSteps'
import { Turnstile } from '../../Turnstile'
import { usesNovuBackend } from '../../backendContract'
import { PROVIDER_ENROLLMENT_PATH, providerEnrollmentHref, STAFF_SIGN_IN_PATH, staffSignInHref } from '../../productHostname'
import { getEnvironment } from '../env'
import { providerEnrollmentApi, staffApi, type StaffLoginChallenge } from '../api'
import { announceStaffSessionChange } from '../session'
import { StaffMfaSteps, type StaffMfaCalls, type StaffMfaLook } from './StaffMfaSteps'
import { ClinicianSignUpEntry } from '../clinician/ClinicianSignUpEntry'

type Product = 'ehr' | 'migrate' | 'laboratory' | 'pharmacy'
type OrganizationType = 'clinic' | 'hospital' | 'laboratory' | 'pharmacy' | 'other'

const products: Array<{ code: Product; label: string }> = [
  { code: 'ehr', label: 'Health ID EHR' },
  { code: 'laboratory', label: 'Health ID Laboratory' },
  { code: 'pharmacy', label: 'Health ID Pharmacy' },
  { code: 'migrate', label: 'Health ID Migrate' },
]

const organizationTypes: Array<{ value: OrganizationType; label: string }> = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'other', label: 'Other healthcare provider' },
]

const productOptions: Record<OrganizationType, Product[]> = {
  hospital: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
  clinic: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
  laboratory: ['laboratory'],
  pharmacy: ['pharmacy'],
  other: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
}

/**
 * What a self-signed-up administrator really gets on Novu (P4, owner decision
 * "all types now"). Activation makes one account with the org_admin role, and
 * Novu grants org_admin organization.manage, workforce.manage, audit.read,
 * identity.registration.write/approve and outreach registration and campaign
 * read/write only (migrations 0006, 0011, 0024, 0038). The portal's
 * navigation therefore shows Overview, Patient registration, Facility audit
 * and Outreach, whatever product was chosen: not the Clinical record
 * (ehr.encounter.read), Laboratory (lab.work-item.read), Pharmacy
 * (pharmacy.work-item.read) or Document OCR (ocr.job.read). Nothing on Novu,
 * and no page here, adds staff to a facility, so the administrator is its
 * only user. The product is stored and changes nothing yet.
 */
export const PRODUCT_NOTES: Readonly<Record<Product, string>> = {
  ehr: 'EHR sign-ups get the Provider Portal for now. The clinical record, and adding staff accounts for your doctors '
    + 'and nurses, aren’t available yet.',
  laboratory: 'Laboratory sign-ups get the Provider Portal for now. The Laboratory workspace, and adding staff '
    + 'accounts for your team, aren’t available yet.',
  pharmacy: 'Pharmacy sign-ups get the Provider Portal for now. The Pharmacy workspace, and adding staff accounts '
    + 'for your team, aren’t available yet.',
  migrate: 'Migrate sign-ups get the Provider Portal for now. The document migration workspace, and adding staff '
    + 'accounts for your team, aren’t available yet.',
}

function EnrollmentButton({ primary, ...rest }: { primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={primary ? 'patient-primary-button' : 'patient-text-button'} {...rest} />
}

/** The authenticator steps, drawn as the rest of provider enrollment is. */
const ENROLLMENT_MFA_LOOK: StaffMfaLook = {
  headingAs: 'h2',
  classNames: { step: 'patient-form', note: 'patient-field-hint', error: 'patient-inline-error', status: 'patient-field-hint' },
  Button: EnrollmentButton,
}

/**
 * The staff API's sign-in steps, outside the provider workspace. Verify and
 * activation set the session cookies, so the other tabs are told at once (this
 * page does not listen, so the announcement goes on a channel of its own); the
 * page then reloads into the workspace, which reads the session.
 */
const ENROLLMENT_MFA_CALLS: StaffMfaCalls = {
  verify: async proof => {
    const session = await staffApi.verifyMfa(proof)
    announceStaffSessionChange()
    return session
  },
  sendEnrollmentCode: () => staffApi.sendEnrollmentCode(),
  startEnrollment: emailCode => staffApi.startEnrollment(emailCode),
  activate: async code => {
    const activation = await staffApi.activateEnrollment(code)
    announceStaffSessionChange()
    return activation
  },
}

/**
 * On Novu (novu-v1) activation ends with the password, which signs the
 * administrator in (owner decision: a password, no authenticator). hid-system
 * main since #71 adds an authenticator step after it.
 */
const NOVU_STEPS = [['details', 'Organization'], ['otp', 'Email confirmation'], ['password', 'Password']] as const
const MAIN_STEPS = [...NOVU_STEPS, ['authenticator', 'Authenticator']] as const

/** Identity's wait before another code (resendAfterSeconds), when its answer does not give one. */
const DEFAULT_RESEND_SECONDS = 60

const START_UNAVAILABLE = 'We couldn’t finish checking your details just now. Please try again in a minute. '
  + 'If an email with a code arrives meanwhile, ignore it: you’ll get a new code when you try again.'
const STEP_UNAVAILABLE = 'Facility sign-up is temporarily unavailable. Please try again in a few minutes.'
const OFFLINE = 'We couldn’t reach Health ID. Check your internet connection and try again.'

type Step = 'start' | 'resend' | 'verify' | 'activate'

/** What the page says or does about a refusal. */
type Refusal =
  | { kind: 'closed' }
  /** An outage, a timeout or a lost connection: the step may be tried again. */
  | { kind: 'unavailable'; text: string }
  | { kind: 'message'; text: string; support?: 'plain' | 'cac' }
  /** Activation's enrollment session is gone: back to the details for a new code. */
  | { kind: 'session-expired' }
  /** Activation may have created the account already: sign in. */
  | { kind: 'maybe-active' }
  | { kind: 'help'; title: string; text: string }

/**
 * A refusal's own words for the administrator. Identity masks every 5xx detail
 * on Novu, and the production gateway replaces the whole body of any 502, 503
 * or 504 with its own UPSTREAM_UNAVAILABLE, so every status of 500 or more is
 * read as "temporarily unavailable", whatever its code. A closed sign-up is a
 * 423 for that reason (P4).
 */
function refusalOf(reason: unknown, step: Step, activationUncertain: boolean, novu: boolean): Refusal {
  if (!isHidApiError(reason)) return { kind: 'message', text: 'We could not complete facility sign-up. Please try again.' }
  const { status, code } = reason
  if (status === 423 && code === 'PROVIDER_ENROLLMENT_UNAVAILABLE') return { kind: 'closed' }
  const starting = step === 'start' || step === 'resend'
  if (status === 0 && code === 'NETWORK_ERROR') return { kind: 'unavailable', text: starting ? START_UNAVAILABLE : OFFLINE }
  if (status === 0 || status === 408 || status >= 500 || code === 'UPSTREAM_UNAVAILABLE') {
    return { kind: 'unavailable', text: starting ? START_UNAVAILABLE : STEP_UNAVAILABLE }
  }
  if (step === 'activate') {
    if (status === 401 && code === 'ORGANIZATION_COMPLETION_SESSION_INVALID') {
      // On Novu an earlier try may have created the account before its answer was lost: its session is then used up.
      return novu && activationUncertain ? { kind: 'maybe-active' } : { kind: 'session-expired' }
    }
    // Novu: the account was created, then the sign-in that follows it failed (401, or 405 under OIDC).
    if (novu && (status === 401 || status === 405)) return { kind: 'maybe-active' }
    if (code === 'PROVIDER_EMAIL_ALREADY_REGISTERED') return { kind: 'help', title: 'This email already has a Health ID account',
      text: 'The administrator email already belongs to a Health ID account, for example a patient account, so it can’t '
        + 'also be this facility’s administrator. Signing up again with another email for the same CAC number won’t work '
        + 'either.' }
    if (code === 'ORGANIZATION_REVIEW_REQUIRED') return { kind: 'help', title: 'Health ID needs to check this organization',
      text: 'This organization can’t be set up automatically. It may already be registered with Health ID, for example '
        + 'for another product.' }
  }
  if (code === 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT') return { kind: 'message',
    text: 'This browser is signed in to Health ID, for example to a patient account. Sign out of Health ID first, or '
      + 'open this page in a private (incognito) window, then try again.' }
  if (code === 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' || code === 'ORGANIZATION_REVIEW_REQUIRED') return { kind: 'message',
    support: 'cac', text: 'This organization needs a check by Health ID before it can be set up, for example because '
      + 'its CAC number is already linked to Health ID or another sign-up for it is in progress.' }
  if (code === 'PROVIDER_ALREADY_REGISTERED') return { kind: 'message', support: 'plain',
    text: 'This organization is already registered with Health ID. If you are its administrator, sign in instead.' }
  if (code === 'PROVIDER_CAC_PROFILE_INCOMPLETE') return { kind: 'message', support: 'cac',
    text: 'We couldn’t set up your organization automatically from its CAC record: the record is missing details we '
      + 'need, or it doesn’t show the company as active.' }
  if (code === 'CAC_NOT_VERIFIED') return { kind: 'message', text: 'We couldn’t verify this CAC registration number. '
    + 'Check the number on your CAC certificate (it starts with RC, BN or IT) and try again.' }
  if (code === 'APPLICATION_RATE_LIMITED') return { kind: 'message',
    text: 'There have been too many sign-up attempts from your network. Please try again later.' }
  if (code === 'VERIFICATION_QUOTA_EXCEEDED') return { kind: 'message',
    text: 'The limit on CAC checks has been reached for now. Please try again later.' }
  if (code === 'VERSION_CONFLICT') return { kind: 'message',
    text: 'Your sign-up changed while we were working on it. Please try again.' }
  if (code === 'ORGANIZATION_COMPLETION_CODE_INVALID') return { kind: 'message',
    text: 'That code isn’t right, or it has expired. Check the latest email from Health ID and try again, or send a new code.' }
  if (code === 'ORIGIN_DENIED') return { kind: 'message',
    text: 'This site isn’t allowed to send facility sign-ups. Open Set up your facility from healthidentitydirectory.com and try again.' }
  if (code.startsWith('TURNSTILE_') && code.endsWith('_MISMATCH')) return { kind: 'message',
    text: 'The security check was made for another Health ID site. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.' }
  if (code.startsWith('TURNSTILE_')) return { kind: 'message',
    text: 'The security check didn’t go through. Please complete it again, then retry.' }
  if (code === 'PROVIDER_ENROLLMENT_DENIED') return { kind: 'message', text: STEP_UNAVAILABLE }
  if (code === 'VALIDATION_FAILED') return { kind: 'message', text: 'Some of the details weren’t accepted. Check them and try again.' }
  return { kind: 'message', text: reason.message }
}

/** Health ID support's address, from the build's support contact (a mailto: link). */
function supportAddress(): string | null {
  let contact: string | null = null
  try { contact = getEnvironment().supportContact } catch { /* a configuration problem is reported where the API is used */ }
  return contact?.startsWith('mailto:') ? contact.slice('mailto:'.length) : null
}

/** "Contact Health ID support …", with the address when the build has it. */
function SupportContact({ purpose }: { purpose: 'plain' | 'cac' | 'register' | 'finish' | 'inline' }) {
  const address = supportAddress()
  const lead = purpose === 'register' ? 'To register your facility, contact Health ID support'
    : purpose === 'inline' ? 'contact Health ID support' : 'Contact Health ID support'
  const tail = purpose === 'cac' ? ', and give your CAC registration number.' : purpose === 'finish'
    ? ' to finish setting up your facility.' : '.'
  return <>{lead}{address ? <> at <a href={`mailto:${address}`}>{address}</a></> : null}{tail}</>
}

/** Where this administrator signs in next time: the EHR site in production, this portal elsewhere. */
function SignInLink({ children }: { children: ReactNode }) {
  const elsewhere = staffSignInHref(window.location.hostname)
  return elsewhere ? <a className="patient-primary-button" href={elsewhere}>{children}</a>
    : <Link className="patient-primary-button" to={STAFF_SIGN_IN_PATH}>{children}</Link>
}

/** A heading that takes focus when its panel replaces the step before it. */
function FocusedHeading({ id, children }: { id: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <h2 id={id} ref={heading} tabIndex={-1} className="hid-mfa-heading">{children}</h2>
}

function isOrganizationType(value: string | null): value is OrganizationType {
  return organizationTypes.some(option => option.value === value)
}

function isProduct(value: string | null): value is Product {
  return products.some(product => product.code === value)
}

/** Whole seconds until `at`, never below zero. */
function secondsUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 1000))
}

function seconds(count: number): string {
  return `${count} second${count === 1 ? '' : 's'}`
}

export function ProviderEnrollment() {
  // hid-system accepts the sign-up's security check only on the main site: a staff product host (a bookmark, an old
  // link) sends the administrator there, keeping only a product it knows.
  const elsewhere = providerEnrollmentHref(window.location.hostname)
  return elsewhere === PROVIDER_ENROLLMENT_PATH ? <EnrollmentSteps /> : <EnrollOnMainSite href={elsewhere} />
}

function EnrollOnMainSite({ href }: { href: string }) {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const [params] = useSearchParams()
  const product = params.get('product')
  const target = isProduct(product) ? `${href}?product=${product}` : href
  return <AuthLayout brandTo="/provider/sign-in" brandLabel="Health ID provider sign in"
    headerLink={{ to: '/provider/sign-in', label: 'Sign in' }}
    title="Set up your facility." titleId="provider-enroll-title"
    lede="Facility sign-up is done on the main Health ID site.">
    <p><a className="patient-primary-button" href={target}>Continue to facility sign-up</a></p>
  </AuthLayout>
}

function EnrollmentSteps() {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const navigate = useNavigate()
  const novu = usesNovuBackend()
  // On main (hid-system #71) the administrator's account is active after activation, but signed in only once its
  // authenticator is; on Novu activation signs them in ('done').
  const [stage, setStage] = useState<'details' | 'otp' | 'password' | 'authenticator' | 'sign-in' | 'done' | 'help'>('details')
  // Novu says whether self sign-up is open before the form is filled; main has no such read.
  const [availability, setAvailability] = useState<'checking' | 'open' | 'closed'>(novu ? 'checking' : 'open')
  const [challenge, setChallenge] = useState<StaffLoginChallenge | null>(null)
  const [signInReason, setSignInReason] = useState<string | null>(null)
  const [help, setHelp] = useState<{ title: string; text: string } | null>(null)
  // The public site's product links arrive here with ?product= (and may name ?type=), preselecting the choice.
  const [params] = useSearchParams()
  const [organizationType, setOrganizationType] = useState<OrganizationType>(() => {
    const type = params.get('type')
    return isOrganizationType(type) ? type : 'hospital'
  })
  const [productCode, setProductCode] = useState<Product>(() => {
    const product = params.get('product')
    const type = params.get('type')
    const allowed = productOptions[isOrganizationType(type) ? type : 'hospital']
    return isProduct(product) && allowed.includes(product) ? product : allowed[0]!
  })
  const [cac, setCac] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; support?: 'plain' | 'cac' } | null>(null)
  const [resent, setResent] = useState(false)
  // Identity sends no new code within resendAfterSeconds of the last one, yet still answers the start
  // (hid-system 0056): a new code is offered only after that wait. A start whose answer was lost (a timeout, or
  // the gateway's 503 at 30 s while Identity carried on) may have sent a code, so it waits as long.
  const [resendAt, setResendAt] = useState(0)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  // An activation whose answer was lost may have created the account and used up its session.
  const activationUncertain = useRef(false)

  useEffect(() => {
    if (!novu) return
    let active = true
    // `{ open: false }` closes the form. A 404 (an Identity without self sign-up), an outage or a malformed answer
    // shows it: the start then answers for itself.
    providerEnrollmentApi.availability().then(
      answer => { if (active) setAvailability(answer?.open === false ? 'closed' : 'open') },
      () => { if (active) setAvailability('open') })
    return () => { active = false }
  }, [novu])

  const waiting = Math.max(resendAt, retryAt) > now
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [waiting])

  function setType(value: OrganizationType) {
    setOrganizationType(value)
    const allowed = productOptions[value]
    if (!allowed.includes(productCode)) setProductCode(allowed[0]!)
  }

  /** After an outage, Novu's availability says whether sign-up has closed meanwhile or is only failing. */
  async function closedNow(): Promise<boolean> {
    if (!novu) return false
    try { return (await providerEnrollmentApi.availability()).open === false } catch { return false }
  }

  async function refuse(reason: unknown, step: Step) {
    const refusal = refusalOf(reason, step, activationUncertain.current, novu)
    if (refusal.kind === 'closed') { setError(null); setAvailability('closed'); return }
    if (refusal.kind === 'unavailable') {
      if (step === 'activate') activationUncertain.current = true
      if (step === 'start' || step === 'resend') setRetryAt(Date.now() + DEFAULT_RESEND_SECONDS * 1000)
      setNow(Date.now())
      if (await closedNow()) { setError(null); setAvailability('closed'); return }
      setError({ text: refusal.text })
      return
    }
    if (refusal.kind === 'session-expired') {
      setError({ text: 'Your sign-up session has expired. Check your details and select Continue to get a new code.' })
      setChallengeId(''); setCode(''); setPassword('')
      // A start within resendAfterSeconds of the last code sends none (hid-system 0056).
      setRetryAt(resendAt); setNow(Date.now())
      setStage('details')
      return
    }
    if (refusal.kind === 'maybe-active') {
      setError(null); setPassword('')
      setSignInReason(null)
      setStage('sign-in')
      return
    }
    if (refusal.kind === 'help') {
      setError(null); setPassword('')
      setHelp({ title: refusal.title, text: refusal.text })
      setStage('help')
      return
    }
    setError({ text: refusal.text, ...(refusal.support ? { support: refusal.support } : {}) })
  }

  function startInput(token: string) {
    return {
      productCode,
      organizationType,
      cacRegistrationNumber: cac.replace(/\s+/g, '').toUpperCase(),
      administratorName: name.trim(),
      administratorEmail: email.trim().toLowerCase(),
      turnstileToken: token,
    }
  }

  function codeSent(result: { challengeId: string; resendAfterSeconds?: number }) {
    const wait = typeof result.resendAfterSeconds === 'number' && Number.isFinite(result.resendAfterSeconds)
      ? Math.min(Math.max(result.resendAfterSeconds, 0), 600) : DEFAULT_RESEND_SECONDS
    const sentAt = Date.now()
    setChallengeId(result.challengeId)
    setResendAt(sentAt + wait * 1000)
    setRetryAt(0)
    setNow(sentAt)
  }

  async function start(event: FormEvent) {
    event.preventDefault()
    if (busy || !turnstileToken || retryAt > Date.now()) return
    setBusy(true)
    setError(null)
    try {
      codeSent(await providerEnrollmentApi.start(startInput(turnstileToken)))
      setResent(false)
      setStage('otp')
    } catch (reason) {
      await refuse(reason, 'start')
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  /** "Send a new code": the start again, with the same details and a new security check. */
  async function resend() {
    if (busy || !turnstileToken || Math.max(resendAt, retryAt) > Date.now()) return
    setBusy(true)
    setError(null)
    setResent(false)
    try {
      codeSent(await providerEnrollmentApi.start(startInput(turnstileToken)))
      setCode('')
      setResent(true)
    } catch (reason) {
      await refuse(reason, 'resend')
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    if (busy || !challengeId || !/^\d{6}$/.test(code)) return
    setBusy(true)
    setError(null)
    try {
      await providerEnrollmentApi.verify(challengeId, code)
      setCode('')
      setResent(false)
      activationUncertain.current = false
      setStage('password')
    } catch (reason) {
      await refuse(reason, 'verify')
    } finally {
      setBusy(false)
    }
  }

  async function activate(event: FormEvent) {
    event.preventDefault()
    if (busy || password.length < 12) return
    setBusy(true)
    setError(null)
    try {
      const activated = await providerEnrollmentApi.activate(password)
      setPassword('')
      // hid-system main since #71: activation opens the administrator's first staff sign-in, whose second step comes
      // next: an authenticator set up on the activation's own proof, or the code of one the account already has.
      if (activated.status === 'mfa_enrollment_required' || activated.status === 'mfa_required') {
        setChallenge({ status: activated.status, expiresAt: activated.expiresAt })
        setStage('authenticator')
        setBusy(false)
        return
      }
      // Novu (and main before #71) answers with the session, which the browser now holds: the other tabs are told.
      announceStaffSessionChange()
      // On Novu the administrator is told first where to sign in next time; main keeps its own path.
      if (novu) { setStage('done'); setBusy(false) }
      else openWorkspace()
    } catch (reason) {
      await refuse(reason, 'activate')
      setBusy(false)
    }
  }

  /** The workspace reads the session the browser now holds. */
  function openWorkspace() {
    navigate('/provider', { replace: true })
    window.location.reload()
  }

  function startAgain() {
    setStage('details'); setCode(''); setChallengeId(''); setError(null); setResent(false)
    // A start within resendAfterSeconds of the last code sends none (hid-system 0056), yet answers as if it had.
    setRetryAt(resendAt); setNow(Date.now())
  }

  const steps = novu ? NOVU_STEPS : MAIN_STEPS
  const currentStep = stage === 'sign-in' ? 'authenticator' : stage
  const closed = availability === 'closed'
  const retryIn = secondsUntil(retryAt, now)
  const resendIn = secondsUntil(Math.max(resendAt, retryAt), now)
  const productNote = novu ? PRODUCT_NOTES[productCode] : null
  // The address as Identity has it: the code was sent to it, and the administrator signs in with it.
  const administratorEmail = email.trim().toLowerCase()

  return (
    <AuthLayout brandTo="/provider/sign-in" brandLabel="Health ID provider sign in"
      headerLink={{ to: '/provider/sign-in', label: 'Sign in' }}
      title="Set up your facility." titleId="provider-enroll-title"
      lede={novu
        ? 'Verify your CAC registration, confirm your email and choose a password. Your administrator account is ready straight away.'
        : 'Verify your CAC registration and your facility can start using Health ID straight away.'}
      steps={closed || availability === 'checking' || stage === 'help'
        ? undefined : steps.map(([step, label]) => ({ label, current: step === currentStep }))}
      stepsLabel="Provider enrollment steps">
        {error && !closed ? <p role="alert" className="patient-inline-error">{error.text}
          {error.support ? <> <SupportContact purpose={error.support} /></> : null}</p> : null}

        {availability === 'checking' && <p role="status" className="patient-field-hint">Checking that facility sign-up is open…</p>}

        {closed && <section className="patient-form" aria-labelledby="provider-enroll-closed-title">
          <FocusedHeading id="provider-enroll-closed-title">Facility sign-up isn’t open right now</FocusedHeading>
          <p className="patient-field-hint">Hospitals, laboratories and pharmacies can’t sign themselves up on Health ID at the
            moment. <SupportContact purpose="register" /></p>
          <p className="patient-field-hint">If your facility already uses Health ID, sign in instead.</p>
        </section>}

        {availability === 'open' && stage === 'details' && (
          <form onSubmit={event => void start(event)} className="auth-form provider-setup-form">
            <fieldset className="provider-setup-choice">
              <legend>Facility type</legend>
              <div className="provider-setup-options">
                {organizationTypes.map(option => (
                  <label key={option.value} className="provider-setup-option">
                    <input type="radio" name="provider-facility-type" value={option.value}
                      checked={organizationType === option.value} onChange={() => setType(option.value)} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="provider-setup-fields">
              <Field label="Product" htmlFor="provider-product">
                <Select id="provider-product" value={productCode} onChange={event => setProductCode(event.target.value as Product)}
                  aria-describedby={productNote ? 'provider-product-note' : undefined}>
                  {productOptions[organizationType].map(code => <option key={code} value={code}>{products.find(product => product.code === code)?.label}</option>)}
                </Select>
              </Field>
              {productNote && <p id="provider-product-note" className="patient-field-hint">{productNote}</p>}

              <Field label="CAC registration number" htmlFor="provider-cac">
                <Input id="provider-cac" required value={cac}
                  onChange={event => setCac(event.target.value.replace(/\s+/g, '').toUpperCase())}
                  autoCapitalize="characters" autoComplete="off" spellCheck={false}
                  pattern="(RC|BN|IT)[0-9]{4,20}" maxLength={22} placeholder="RC123456" />
              </Field>

              <Field label="Administrator full name" htmlFor="provider-admin-name">
                <Input id="provider-admin-name" required minLength={2} maxLength={200}
                  autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
              </Field>

              <Field label="Administrator email" htmlFor="provider-admin-email">
                <Input id="provider-admin-email" required type="email" maxLength={254}
                  autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
              </Field>
            </div>

            <div className="provider-setup-actions">
              <Turnstile action="provider-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />
              <button type="submit" className="patient-primary-button provider-setup-submit" disabled={busy || !turnstileToken || retryIn > 0}>
                {busy ? 'Verifying CAC…' : 'Continue'}
              </button>
              {retryIn > 0 && !busy && <p className="patient-field-hint">You can try again in {seconds(retryIn)}.</p>}
              <p className="provider-setup-fineprint">We check your CAC against the official registry. Registrations already linked to
                Health ID are reviewed by our team before activation.{novu && ' Health ID support also checks every new facility within one working day.'}</p>
            </div>
          </form>
        )}

        {availability === 'open' && stage === 'otp' && (<>
          <form onSubmit={event => void verify(event)} className="patient-form">
            <h2>Confirm your administrator email</h2>
            <p className="patient-field-hint">Enter the six digit code sent to {administratorEmail}.</p>
            <label>Email verification code
              <Input required inputMode="numeric" autoComplete="one-time-code" value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                pattern="[0-9]{6}" maxLength={6} />
            </label>
            <button type="submit" className="patient-primary-button" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Verify email'}
            </button>
            <button type="button" className="patient-text-button" onClick={startAgain}>
              Start again
            </button>
          </form>
          <section className="patient-form provider-setup-resend" aria-labelledby="provider-enroll-resend-title">
            <h3 id="provider-enroll-resend-title">Didn’t get the code?</h3>
            <p className="patient-field-hint">Check your spam or junk folder first. A new code replaces the last one.</p>
            <Turnstile action="provider-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />
            <button type="button" className="patient-secondary-button" onClick={() => void resend()}
              disabled={busy || !turnstileToken || resendIn > 0}>Send a new code</button>
            {resendIn > 0 && <p className="patient-field-hint">You can ask for a new code in {seconds(resendIn)}.</p>}
            <div role="status">{resent && <p className="patient-field-hint">We’ve sent a new code to {administratorEmail}.</p>}</div>
          </section>
        </>)}

        {availability === 'open' && stage === 'password' && (
          <form onSubmit={event => void activate(event)} className="patient-form">
            <h2>Create your provider account</h2>
            <p id="provider-password-hint" className="patient-field-hint">{novu
              ? `Choose a password of at least 12 characters. You’ll use it with ${administratorEmail} to sign in. Once your account `
                + 'is created, you go straight into the Provider Portal as your facility’s administrator.'
              : 'Choose a password of at least 12 characters. After activation, you will set up an authenticator app, then enter '
                + 'the Provider Portal as your facility administrator.'}</p>
            {/* Lets a password manager save the new password with its email. */}
            <input type="email" hidden readOnly autoComplete="username" value={administratorEmail} />
            <Field label="Password" htmlFor="provider-password">
              <PasswordInput id="provider-password" required autoComplete="new-password" minLength={12} maxLength={256}
                aria-describedby="provider-password-hint" value={password} onChange={event => setPassword(event.target.value)} />
            </Field>
            <button type="submit" className="patient-primary-button" disabled={busy || password.length < 12}>
              {busy ? 'Creating provider account…' : 'Create provider account'}
            </button>
          </form>
        )}

        {stage === 'authenticator' && challenge && (
          <StaffMfaSteps challenge={challenge} proof={challenge.status === 'mfa_enrollment_required' ? 'activation' : undefined}
            calls={ENROLLMENT_MFA_CALLS} look={ENROLLMENT_MFA_LOOK} doneLabel="Continue to the Provider Portal"
            onSignedIn={openWorkspace} onRestart={reason => { setChallenge(null); setSignInReason(reason); setStage('sign-in') }} />
        )}

        {!closed && stage === 'sign-in' && (novu ? <MaybeActive email={administratorEmail} /> : <SignInToFinish reason={signInReason} />)}

        {!closed && stage === 'done' && <FacilityReady email={administratorEmail} product={productCode} onContinue={openWorkspace} />}

        {!closed && stage === 'help' && help && <section className="patient-form" aria-labelledby="provider-enroll-help-title">
          <FocusedHeading id="provider-enroll-help-title">{help.title}</FocusedHeading>
          <p className="patient-field-hint">{help.text} <SupportContact purpose="finish" /></p>
        </section>}

        {/* Clinician self sign-up (hid-system ADR-066): a doctor or nurse applies with their own account, not this one. */}
        <p className="patient-auth-footer">Provider enrollment sets up a facility and its administrator's account, which can't also hold a
          clinical role there: doctors and nurses apply with their own email address.</p>
        <ClinicianSignUpEntry className="patient-auth-footer" />
    </AuthLayout>
  )
}

/**
 * Novu: the administrator is signed in on this site (the session cookies are
 * this host's only), and staff sign in on the EHR site from then on. What the
 * account opens is said as it is (PRODUCT_NOTES).
 */
function FacilityReady({ email, product, onContinue }: { email: string; product: Product; onContinue: () => void }) {
  const ehrSite = staffSignInHref(window.location.hostname) !== null
  return <section className="patient-form" aria-labelledby="provider-enroll-done-title">
    <FocusedHeading id="provider-enroll-done-title">Your facility is set up</FocusedHeading>
    <p className="patient-field-hint">You’re signed in as your facility’s administrator.</p>
    <p className="patient-field-hint">{ehrSite
      ? `Next time, sign in at ehr.healthidentitydirectory.com with ${email} and the password you just chose.`
      : `Next time, sign in to the Provider Portal with ${email} and the password you just chose.`}</p>
    <p className="patient-field-hint">{PRODUCT_NOTES[product]}</p>
    <button type="button" className="patient-primary-button" onClick={onContinue}>Continue to the Provider Portal</button>
  </section>
}

/**
 * Novu: activation's answer was lost, or the sign-in that follows it failed,
 * after the account may have been created. A new activation would be refused
 * (its session is used up), so the administrator signs in instead.
 */
function MaybeActive({ email }: { email: string }) {
  return <section className="patient-form" aria-labelledby="provider-enroll-sign-in-title">
    <FocusedHeading id="provider-enroll-sign-in-title">Your account may already be ready</FocusedHeading>
    <p className="patient-field-hint">We couldn’t confirm that your facility was set up, but it may have been. Sign in with
      {email ? ` ${email}` : ' your administrator email'} and the password you chose. If you can’t sign in,
      {' '}<SupportContact purpose="inline" /></p>
    <SignInLink>Sign in to the Provider Portal</SignInLink>
  </section>
}

/**
 * hid-system main (#71): the activation's own challenge can no longer go on
 * (it expired, ran out of attempts, or the account's authenticator must be
 * reset). The account is active: an ordinary staff sign-in opens a new
 * challenge, and sets up the authenticator with a code emailed to the
 * administrator.
 */
function SignInToFinish({ reason }: { reason: string | null }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <section className="patient-form" aria-labelledby="provider-enroll-sign-in-title">
    <h2 id="provider-enroll-sign-in-title" ref={heading} tabIndex={-1} className="hid-mfa-heading">Sign in to finish setting up</h2>
    {reason && <p role="alert" className="patient-inline-error">{reason}</p>}
    <p className="patient-field-hint">Your provider account is active. Sign in with your administrator email and the password you chose,
      then set up your authenticator app.</p>
    <Link className="patient-primary-button" to="/provider/sign-in">Sign in to the Provider Portal</Link>
  </section>
}
