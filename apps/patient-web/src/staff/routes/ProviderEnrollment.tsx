import { useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Field, Input, PasswordInput, Select } from '@hid/ui'
import './providerSetup.css'
import { AuthLayout } from '../../AuthLayout'
import { useDocumentTitle } from '../../authSteps'
import { Turnstile } from '../../Turnstile'
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

const STEPS = [['details', 'Organization'], ['otp', 'Email confirmation'], ['password', 'Password'], ['authenticator', 'Authenticator']] as const

function isOrganizationType(value: string | null): value is OrganizationType {
  return organizationTypes.some(option => option.value === value)
}

function isProduct(value: string | null): value is Product {
  return products.some(product => product.code === value)
}

function errorMessage(reason: unknown): string {
  if (isHidApiError(reason)) return reason.message
  return reason instanceof Error ? reason.message : 'We could not complete provider enrollment. Please try again.'
}

export function ProviderEnrollment() {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const navigate = useNavigate()
  // After activation the administrator's account is active, but signed in only once its authenticator is (hid-system #71).
  const [stage, setStage] = useState<'details' | 'otp' | 'password' | 'authenticator' | 'sign-in'>('details')
  const [challenge, setChallenge] = useState<StaffLoginChallenge | null>(null)
  const [signInReason, setSignInReason] = useState<string | null>(null)
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
  const [error, setError] = useState('')

  function setType(value: OrganizationType) {
    setOrganizationType(value)
    const allowed = productOptions[value]
    if (!allowed.includes(productCode)) setProductCode(allowed[0]!)
  }

  async function start(event: FormEvent) {
    event.preventDefault()
    if (busy || !turnstileToken) return
    setBusy(true)
    setError('')
    try {
      const result = await providerEnrollmentApi.start({
        productCode,
        organizationType,
        cacRegistrationNumber: cac.replace(/\s+/g, '').toUpperCase(),
        administratorName: name.trim(),
        administratorEmail: email.trim().toLowerCase(),
        turnstileToken,
      })
      setChallengeId(result.challengeId)
      setStage('otp')
    } catch (reason) {
      setError(errorMessage(reason))
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
    setError('')
    try {
      await providerEnrollmentApi.verify(challengeId, code)
      setCode('')
      setStage('password')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function activate(event: FormEvent) {
    event.preventDefault()
    if (busy || password.length < 12) return
    setBusy(true)
    setError('')
    try {
      const activated = await providerEnrollmentApi.activate(password)
      setPassword('')
      // Since hid-system #71 activation opens the administrator's first staff sign-in, whose second
      // step comes next: an authenticator set up on the activation's own proof, or the code of one the
      // account already has. An Identity before #71 answered with the session instead.
      if (activated.status === 'mfa_enrollment_required' || activated.status === 'mfa_required') {
        setChallenge({ status: activated.status, expiresAt: activated.expiresAt })
        setStage('authenticator')
        setBusy(false)
        return
      }
      // An older Identity's activation answered with the session, which the browser now holds: the other tabs are told.
      announceStaffSessionChange()
      openWorkspace()
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }

  /** The workspace reads the session the browser now holds. */
  function openWorkspace() {
    navigate('/provider', { replace: true })
    window.location.reload()
  }

  const currentStep = stage === 'sign-in' ? 'authenticator' : stage

  return (
    <AuthLayout brandTo="/provider/sign-in" brandLabel="Health ID provider sign in"
      headerLink={{ to: '/provider/sign-in', label: 'Sign in' }}
      title="Set up your facility." titleId="provider-enroll-title"
      lede="Verify your CAC registration and your facility can start using Health ID straight away."
      steps={STEPS.map(([step, label]) => ({ label, current: step === currentStep }))} stepsLabel="Provider enrollment steps">
        {error ? <p role="alert" className="patient-inline-error">{error}</p> : null}

        {stage === 'details' && (
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
                <Select id="provider-product" value={productCode} onChange={event => setProductCode(event.target.value as Product)}>
                  {productOptions[organizationType].map(code => <option key={code} value={code}>{products.find(product => product.code === code)?.label}</option>)}
                </Select>
              </Field>

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
              <button type="submit" className="patient-primary-button provider-setup-submit" disabled={busy || !turnstileToken}>
                {busy ? 'Verifying CAC…' : 'Continue'}
              </button>
              <p className="provider-setup-fineprint">We check your CAC against the official registry. Registrations already linked to Health ID are reviewed by our team before activation.</p>
            </div>
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={event => void verify(event)} className="patient-form">
            <h2>Confirm your administrator email</h2>
            <p className="patient-field-hint">Enter the six digit code sent to {email}.</p>
            <label>Email verification code
              <Input required inputMode="numeric" autoComplete="one-time-code" value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                pattern="[0-9]{6}" maxLength={6} />
            </label>
            <button type="submit" className="patient-primary-button" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Verify email'}
            </button>
            <button type="button" className="patient-text-button" onClick={() => { setStage('details'); setCode(''); setChallengeId('') }}>
              Start again
            </button>
          </form>
        )}

        {stage === 'password' && (
          <form onSubmit={event => void activate(event)} className="patient-form">
            <h2>Create your provider account</h2>
            <p id="provider-password-hint" className="patient-field-hint">Choose a password of at least 12 characters. After activation, you will set up an authenticator app, then enter the Provider Portal as your facility administrator.</p>
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

        {stage === 'sign-in' && <SignInToFinish reason={signInReason} />}

        {/* Clinician self sign-up (hid-system ADR-064): a doctor or nurse applies with their own account, not this one. */}
        <p className="patient-auth-footer">Provider enrollment sets up a facility and its administrator's account, which can't also hold a
          clinical role there: doctors and nurses apply with their own email address.</p>
        <ClinicianSignUpEntry className="patient-auth-footer" />
    </AuthLayout>
  )
}

/**
 * The activation's own challenge can no longer go on (it expired, ran out of
 * attempts, or the account's authenticator must be reset). The account is
 * active: an ordinary staff sign-in opens a new challenge, and sets up the
 * authenticator with a code emailed to the administrator.
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
