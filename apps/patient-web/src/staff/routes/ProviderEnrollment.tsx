import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Field, Input, Select } from '@hid/ui'
import { BrandLogo } from '../../BrandLogo'
import { useDocumentTitle } from '../../authSteps'
import { Turnstile } from '../../Turnstile'
import { providerEnrollmentApi } from '../api'

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

function errorMessage(reason: unknown): string {
  if (isHidApiError(reason)) return reason.message
  return reason instanceof Error ? reason.message : 'We could not complete provider enrollment. Please try again.'
}

export function ProviderEnrollment() {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const navigate = useNavigate()
  const [stage, setStage] = useState<'details' | 'otp' | 'password'>('details')
  const [organizationType, setOrganizationType] = useState<OrganizationType>('hospital')
  const [productCode, setProductCode] = useState<Product>('ehr')
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
      await providerEnrollmentApi.activate(password)
      navigate('/provider', { replace: true })
      window.location.reload()
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <main className="patient-auth-page">
      <section className="patient-auth-card" aria-labelledby="provider-enroll-title">
        <Link to="/provider/sign-in" className="patient-auth-brand"><BrandLogo /></Link>
        <p className="patient-eyebrow">Provider enrollment</p>
        <h1 id="provider-enroll-title" className="patient-page-title">Set up your Health ID facility.</h1>
        <p className="patient-page-copy">Verify your organization with CAC, confirm your administrator email, and create your provider account. Verified organizations can activate without waiting for routine HID Team approval.</p>

        {error ? <p role="alert" className="patient-inline-error">{error}</p> : null}

        <ol className="patient-step-list" aria-label="Provider enrollment steps">
          {['CAC', 'Email', 'Password'].map((label, index) => (
            <li key={label} aria-current={['details', 'otp', 'password'][index] === stage ? 'step' : undefined}>{label}</li>
          ))}
        </ol>

        {stage === 'details' && (
          <form onSubmit={event => void start(event)} className="patient-form">
            <label>Facility type
              <Select value={organizationType} onChange={event => setType(event.target.value as OrganizationType)}>
                {organizationTypes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </label>

            <label>Product
              <Select value={productCode} onChange={event => setProductCode(event.target.value as Product)}>
                {productOptions[organizationType].map(code => <option key={code} value={code}>{products.find(product => product.code === code)?.label}</option>)}
              </Select>
            </label>

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

            <p className="patient-field-hint">Your CAC registration is checked against the official registry. If the CAC is already linked to an HID organization or needs manual resolution, enrollment will stop and require HID Team review.</p>

            <Turnstile action="provider-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />
            <button type="submit" className="patient-primary-button" disabled={busy || !turnstileToken}>
              {busy ? 'Verifying CAC…' : 'Verify CAC and continue'}
            </button>
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
            <p className="patient-field-hint">Choose a password of at least 12 characters. After activation, you will enter the Provider Portal as your facility administrator.</p>
            <label>Password
              <Input required type="password" autoComplete="new-password" minLength={12} maxLength={256}
                value={password} onChange={event => setPassword(event.target.value)} />
            </label>
            <button type="submit" className="patient-primary-button" disabled={busy || password.length < 12}>
              {busy ? 'Creating provider account…' : 'Create provider account'}
            </button>
          </form>
        )}

        <p className="patient-auth-footer">Already have provider access? <Link to="/provider/sign-in">Sign in</Link></p>
      </section>
    </main>
  )
}
