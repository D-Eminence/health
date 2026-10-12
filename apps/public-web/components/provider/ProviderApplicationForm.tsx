'use client'

import { useState, type FormEvent } from 'react'
import { TurnstileWidget } from '@/components/shared/TurnstileWidget'
import { APP_ENTRY, ROUTES } from '@/content/site'
import { getEnvironment } from '@/lib/env'
import {
  APPLICATION_PRODUCTS, ORGANIZATION_TYPES, PRODUCT_OPTIONS,
  initialApplicationSelection, normalizeCacRegistrationNumber,
  organizationApplicationBody, submitOrganizationApplication,
  type ApplicationProductCode, type OrganizationType,
} from '@/lib/provider-application'

const fieldClass = 'min-h-11 w-full rounded-(--radius-control) border border-line-control bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
const labelClass = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'

export function ProviderApplicationForm({ product }: { product?: string }) {
  const [selection, setSelection] = useState(() => initialApplicationSelection(product))
  const [cacRegistrationNumber, setCacRegistrationNumber] = useState('')
  const [administratorName, setAdministratorName] = useState('')
  const [administratorEmail, setAdministratorEmail] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const environment = getEnvironment()
  const siteKey = environment.turnstileSiteKey
  const localWithoutWidget = environment.name === 'local' && !siteKey
    && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(environment.appOrigin).hostname)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || accepted) return
    setError('')
    const localToken = localWithoutWidget && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? 'local-turnstile-disabled' : null
    const verificationToken = turnstileToken ?? localToken
    if (!verificationToken) {
      setError('Complete the security check before submitting your application.')
      return
    }
    try {
      const body = organizationApplicationBody({
        ...selection, cacRegistrationNumber, administratorName, administratorEmail,
      }, verificationToken)
      setBusy(true)
      await submitOrganizationApplication(body)
      setAccepted(true)
      setCacRegistrationNumber('')
      setAdministratorName('')
      setAdministratorEmail('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The application could not be received right now. Try again later.')
    } finally {
      setBusy(false)
      setTurnstileToken(null)
      setResetKey(value => value + 1)
    }
  }

  if (accepted) return (
    <div className="rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8" role="status">
      <h2 className="font-display text-3xl text-ink">Application received</h2>
      <p className="mt-3 text-sm/relaxed text-muted">Health ID will verify the CAC identifier and review your application. This submission does not create an account or grant clinical access.</p>
      <p className="mt-3 text-sm/relaxed text-muted">If your verified CAC record is missing details, you can complete the organization profile after the verification check.</p>
      <div className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
        <a href={`${ROUTES.providerCompletion}?product=${selection.productCode}`} className="text-brand underline underline-offset-4">Complete missing organization details</a>
        <a href={APP_ENTRY.staffSignIn} className="text-brand underline underline-offset-4">Already have access? Sign in</a>
      </div>
    </div>
  )

  return (
    <form onSubmit={event => void submit(event)} className="rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8">
      <h2 className="font-display text-3xl text-ink">Organization details</h2>
      <p className="mt-3 text-sm/relaxed text-muted">Enter your CAC registration identifier and the contact details of your proposed administrator. Health ID reviews every organization before creating staff access.</p>
      {error ? <p role="alert" className="mt-5 rounded-(--radius-control) bg-critical/10 p-3 text-sm text-critical">{error}</p> : null}
      <div className="mt-6 grid gap-5">
        <label className={labelClass}>Facility or service type
          <select className={fieldClass} value={selection.organizationType} onChange={event => {
            const organizationType = event.target.value as OrganizationType
            setSelection(current => ({ organizationType,
              productCode: PRODUCT_OPTIONS[organizationType].includes(current.productCode)
                ? current.productCode : PRODUCT_OPTIONS[organizationType][0]! }))
          }} required>
            {ORGANIZATION_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={labelClass}>Product of interest
          <select className={fieldClass} value={selection.productCode} onChange={event => setSelection(current => ({
            ...current, productCode: event.target.value as ApplicationProductCode,
          }))} required>
            {PRODUCT_OPTIONS[selection.organizationType].map(code => {
              const product = APPLICATION_PRODUCTS.find(item => item.code === code)
              return <option key={code} value={code}>{product?.label}</option>
            })}
          </select>
        </label>
        <label className={labelClass}>CAC registration identifier
          <input className={fieldClass} value={cacRegistrationNumber} onChange={event => setCacRegistrationNumber(normalizeCacRegistrationNumber(event.target.value))}
            type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={22}
            pattern="(RC|BN|IT)[0-9]{4,20}" title="Include the RC, BN, or IT prefix followed by 4 to 20 digits" placeholder="RC123456" required />
          <span className="text-xs font-normal text-muted">Include the RC, BN, or IT prefix. Spaces are removed as you type.</span>
        </label>
        <h3 className="border-t border-line pt-5 font-display text-2xl text-ink">Administrator contact</h3>
        <label className={labelClass}>Administrator full name
          <input className={fieldClass} value={administratorName} onChange={event => setAdministratorName(event.target.value)}
            type="text" autoComplete="name" minLength={2} maxLength={200} required />
        </label>
        <label className={labelClass}>Administrator email
          <input className={fieldClass} value={administratorEmail} onChange={event => setAdministratorEmail(event.target.value)}
            type="email" autoComplete="email" maxLength={254} required />
        </label>
      </div>
      <p className="mt-5 text-xs/relaxed text-muted">Submitting an application does not verify your identity or create credentials. Health ID may need additional evidence before approving access.</p>
      {siteKey ? <div className="mt-5"><TurnstileWidget siteKey={siteKey} action="organization-application" resetKey={resetKey}
        onToken={setTurnstileToken} onError={setError} /></div> : !localWithoutWidget ? (
        <p role="status" className="mt-5 text-sm text-critical">The security check is unavailable. Please try again later.</p>
      ) : null}
      <button type="submit" disabled={busy || !siteKey && !localWithoutWidget}
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-(--radius-control) bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
    </form>
  )
}
