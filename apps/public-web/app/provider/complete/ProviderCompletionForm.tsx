'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { Button, Card, Field, Input, Select } from '@hid/ui'
import { TurnstileWidget } from '@/components/shared/TurnstileWidget'
import { APP_ENTRY, ROUTES } from '@/content/site'
import { getEnvironment } from '@/lib/env'
import {
  APPLICATION_PRODUCTS,
  getOrganizationCompletionProfile,
  normalizeCacRegistrationNumber,
  saveOrganizationCompletionProfile,
  startOrganizationCompletion,
  validateOrganizationProfileEntries,
  verifyOrganizationCompletion,
  type ApplicationProductCode,
  type OrganizationCompletionProfile,
  type OrganizationProfileErrors,
  type OrganizationProfileFieldName,
  type OrganizationProfilePatch,
} from '@/lib/provider-application'

const PROFILE_FIELDS: readonly {
  name: OrganizationProfileFieldName
  label: string
  hint: string
}[] = [
  { name: 'companyName', label: 'Registered organization name', hint: 'Use the name on your CAC record.' },
  { name: 'entityType', label: 'Legal entity type', hint: 'For example, business name or limited company.' },
  { name: 'registrationDate', label: 'Registration date', hint: 'Use the date on your CAC record.' },
  { name: 'address', label: 'Registered address', hint: 'Use your organization’s registered address.' },
  { name: 'registryStatus', label: 'Registry status', hint: 'A self reported status is reviewed by Health ID.' },
]

/**
 * A refusal's own message for a 4xx, which hid-system words for the applicant
 * and sanitises. A server failure's detail is withheld, so it keeps the fallback.
 */
function applicationError(reason: unknown, fallback: string): string {
  if (isHidApiError(reason)) return reason.status >= 400 && reason.status < 500 ? reason.message : fallback
  return reason instanceof Error ? reason.message : fallback
}

export function ProviderCompletionForm({ initialProduct }: { readonly initialProduct: ApplicationProductCode }) {
  const [productCode, setProductCode] = useState<ApplicationProductCode>(initialProduct)
  const [cacRegistrationNumber, setCacRegistrationNumber] = useState('')
  const [administratorEmail, setAdministratorEmail] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [profile, setProfile] = useState<OrganizationCompletionProfile | null>(null)
  const [entries, setEntries] = useState<OrganizationProfilePatch>({})
  const [fieldErrors, setFieldErrors] = useState<OrganizationProfileErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const environment = getEnvironment()
  const siteKey = environment.turnstileSiteKey
  const localNoWidget = environment.name === 'local' && !siteKey
    && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(environment.appOrigin).hostname)
  const securityCheckAvailable = Boolean(siteKey || localNoWidget)

  useEffect(() => {
    let active = true
    void getOrganizationCompletionProfile().then(result => {
      if (active) setProfile(result)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    setNotice('')
    const localToken = localNoWidget && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? 'local-turnstile-disabled' : null
    const verificationToken = turnstileToken ?? localToken
    if (!verificationToken) {
      setError('Complete the security verification before requesting an email code.')
      return
    }
    setBusy(true)
    try {
      const result = await startOrganizationCompletion({
        productCode, cacRegistrationNumber, administratorEmail, turnstileToken: verificationToken,
      })
      setChallengeId(result.challengeId)
      setNotice('If this application is eligible for profile completion, a code was sent to the administrator email on the application.')
    } catch (reason) {
      setError(applicationError(reason, 'The code request could not be completed. Check your details and try again later.'))
    } finally {
      setTurnstileToken(null)
      setTurnstileResetKey(value => value + 1)
      setBusy(false)
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!challengeId || busy) return
    setError('')
    setBusy(true)
    try {
      await verifyOrganizationCompletion(challengeId, code)
      setProfile(await getOrganizationCompletionProfile())
      setNotice('')
      setCode('')
    } catch (reason) {
      setError(applicationError(reason, 'The email code is invalid or expired. Request a new code if needed.'))
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || busy) return
    setError('')
    const found = validateOrganizationProfileEntries(entries)
    setFieldErrors(found)
    if (Object.keys(found).length > 0) {
      setError('Check the details marked below.')
      return
    }
    setBusy(true)
    try {
      const result = await saveOrganizationCompletionProfile(profile, entries)
      setProfile(result)
      setEntries({})
      setNotice(result.status === 'ready_for_review'
        ? 'Your facility profile is complete and awaiting Health ID review.'
        : 'Your details were saved. Complete the remaining fields to continue.')
    } catch (reason) {
      setError(applicationError(reason, 'The profile could not be saved. Reload your profile and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto mt-10 grid max-w-[720px] gap-5">
      {error ? <p role="alert" className="rounded-(--radius-card) border border-critical/30 bg-surface px-5 py-4 text-sm text-critical">{error}</p> : null}
      {notice ? <p role="status" className="rounded-(--radius-card) border border-line bg-surface px-5 py-4 text-sm text-ink">{notice}</p> : null}

      {profile ? (
        <Card className="p-6 sm:p-8">
          <h2 className="font-display text-2xl text-ink">{profile.status === 'ready_for_review' ? 'Profile submitted for review' : 'Organization details'}</h2>
          <p className="mt-3 text-sm/relaxed text-muted">CAC lookup verified <strong>{profile.registrationNumber}</strong>. Registry values are locked; details you add remain subject to Health ID review.</p>
          <form className="mt-7 grid gap-5" onSubmit={event => { void save(event) }}>
            {PROFILE_FIELDS.map(({ name, label, hint }) => {
              const field = profile.fields[name]
              const editable = profile.status === 'pending_verification' && field.source !== 'qoreid'
              const value = entries[name] ?? field.value ?? ''
              const fieldHint = field.source === 'qoreid'
                ? 'Provided by the registry'
                : field.source === 'user_provided' ? 'Provided by applicant; subject to review' : hint

              const fieldError = editable ? fieldErrors[name] : undefined
              return <Field key={name} label={label} htmlFor={`completion-${name}`} hint={fieldHint} error={fieldError}>
                {editable && name === 'registryStatus' ? (
                  <Select id={`completion-${name}`} value={value}
                    onChange={event => setEntries(current => ({ ...current, [name]: event.target.value }))}>
                    <option value="">Select status</option>
                    <option value="active">Active (self reported)</option>
                  </Select>
                ) : (
                  <Input id={`completion-${name}`} value={value} readOnly={!editable}
                    invalid={Boolean(fieldError)} aria-describedby={fieldError ? `completion-${name}-error` : undefined}
                    type={name === 'registrationDate' ? 'date' : 'text'}
                    maxLength={name === 'address' ? 1000 : name === 'companyName' ? 200 : 120}
                    onChange={editable ? event => setEntries(current => ({ ...current, [name]: event.target.value })) : undefined} />
                )}
              </Field>
            })}
            {profile.status === 'pending_verification' ? (
              <Button type="submit" disabled={busy} className="justify-self-start">{busy ? 'Saving…' : 'Save missing details'}</Button>
            ) : null}
          </form>
          <p className="mt-6 text-xs/relaxed text-muted">CAC verification does not establish authority to act for this organization. Health ID reviews that separately before granting access.</p>
          <a className="mt-5 inline-flex text-sm font-semibold text-brand hover:text-brand-hover" href={ROUTES.chooser}>Return to home</a>
        </Card>
      ) : challengeId ? (
        <Card className="p-6 sm:p-8">
          <form className="grid gap-5" onSubmit={event => { void verify(event) }}>
            <h2 className="font-display text-2xl text-ink">Confirm administrator email</h2>
            <p className="text-sm/relaxed text-muted">Enter the six digit code if one was sent to the application contact email.</p>
            <Field label="Email code" htmlFor="completion-code" required>
              <Input id="completion-code" value={code} onChange={event => setCode(event.target.value)}
                inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required />
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</Button>
              <button type="button" className="text-sm font-semibold text-brand hover:text-brand-hover"
                onClick={() => { setChallengeId(null); setCode(''); setNotice('') }}>Request a new code</button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="p-6 sm:p-8">
          <form className="grid gap-5" onSubmit={event => { void start(event) }}>
            <h2 className="font-display text-2xl text-ink">Find your application</h2>
            <p className="text-sm/relaxed text-muted">Use the same product, CAC registration identifier, and administrator email from your application. Completion is available after a successful CAC check.</p>
            <Field label="Product" htmlFor="completion-product" required>
              <Select id="completion-product" value={productCode}
                onChange={event => setProductCode(event.target.value as ApplicationProductCode)} required>
                {APPLICATION_PRODUCTS.map(product => <option key={product.code} value={product.code}>{product.label}</option>)}
              </Select>
            </Field>
            <Field label="CAC registration identifier" htmlFor="completion-cac" required
              hint="Include the RC, BN, or IT prefix followed by 4 to 20 digits.">
              <Input id="completion-cac" value={cacRegistrationNumber}
                onChange={event => setCacRegistrationNumber(normalizeCacRegistrationNumber(event.target.value))}
                autoCapitalize="characters" autoComplete="off" spellCheck={false}
                pattern="(RC|BN|IT)[0-9]{4,20}" maxLength={22} placeholder="RC123456" required />
            </Field>
            <Field label="Administrator email" htmlFor="completion-email" required>
              <Input id="completion-email" type="email" value={administratorEmail}
                onChange={event => setAdministratorEmail(event.target.value)} autoComplete="email" maxLength={254} required />
            </Field>
            {localNoWidget ? <p className="text-xs text-muted">Local development: security verification is disabled on the local gateway.</p>
              : <TurnstileWidget siteKey={siteKey} action="organization-completion" resetKey={turnstileResetKey}
                  onToken={setTurnstileToken} onError={setError} />}
            <Button type="submit" disabled={busy || !securityCheckAvailable || (!turnstileToken && !localNoWidget)}
              className="justify-self-start">{busy ? 'Requesting…' : 'Send email code'}</Button>
          </form>
        </Card>
      )}
      <p className="text-center text-sm text-muted">Already have facility access? <a className="font-semibold text-brand hover:text-brand-hover" href={APP_ENTRY.staffSignIn}>Sign in</a></p>
    </div>
  )
}
