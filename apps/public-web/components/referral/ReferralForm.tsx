'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Button, cx } from '@hid/ui'
import { TurnstileWidget } from '@/components/shared/TurnstileWidget'
import { submitDemoRequest } from '@/lib/commercial-api'
import { getEnvironment } from '@/lib/env'
import {
  EMPTY_REFERRAL, FACILITY_FIELDS, FACILITY_TYPES, REFERRER_FIELDS, stepErrors, toReferralSubmission, validateReferral,
  type ReferralErrors, type ReferralRequest,
} from '@/lib/referral'

type TextField = Exclude<keyof ReferralRequest, 'consent'>

const CONTROL = 'h-12 w-full rounded-(--radius-control) border bg-surface px-3.5 text-[15px] text-ink focus:outline-2 focus:outline-offset-0 focus:outline-brand'
const STEPS = ['The facility', 'About you'] as const

/**
 * The referral form on /earn, in two short steps: the facility, then the
 * referrer. It sends a tagged enquiry (lib/referral.ts) and stores nothing in
 * the browser.
 */
export function ReferralForm({ lede }: { readonly lede?: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [step, setStep] = useState<0 | 1>(0)
  const [request, setRequest] = useState<ReferralRequest>(EMPTY_REFERRAL)
  const [errors, setErrors] = useState<ReferralErrors>({})
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const moved = useRef(false)
  const submissionKey = useRef<string | null>(null)
  const environment = getEnvironment()
  const siteKey = environment.turnstileSiteKey
  const localNoWidget = environment.name === 'local' && !siteKey
    && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(environment.appOrigin).hostname)

  // Move focus to the step's heading when the step changes, not on first load.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus()
  }, [step, sent])

  function set<K extends keyof ReferralRequest>(field: K, value: ReferralRequest[K]) {
    setRequest(current => ({ ...current, [field]: value }))
    if (errors[field]) setErrors(current => ({ ...current, [field]: undefined }))
    submissionKey.current = null
  }
  const text = (field: TextField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(field, event.target.value as never)

  function focusFirst(found: ReferralErrors, fields: readonly (keyof ReferralRequest)[]) {
    const first = fields.find(name => found[name])
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
  }

  function go(next: 0 | 1) {
    moved.current = true
    setStep(next)
  }

  function onContinue() {
    const found = stepErrors(validateReferral(request), FACILITY_FIELDS)
    setErrors(found)
    if (Object.keys(found).length > 0) return focusFirst(found, FACILITY_FIELDS)
    go(1)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step === 0) return onContinue()
    if (pending) return
    const all = validateReferral(request)
    const facility = stepErrors(all, FACILITY_FIELDS)
    if (Object.keys(facility).length > 0) {
      setErrors(facility)
      return go(0)
    }
    const found = stepErrors(all, REFERRER_FIELDS)
    setErrors(found)
    if (Object.keys(found).length > 0) return focusFirst(found, REFERRER_FIELDS)
    const token = turnstileToken ?? (localNoWidget ? 'local-turnstile-disabled' : null)
    if (!token) {
      setVerificationError('Complete the security check to continue.')
      return
    }
    setPending(true)
    setSubmitError(null)
    setVerificationError(null)
    try {
      submissionKey.current ??= crypto.randomUUID()
      await submitDemoRequest(toReferralSubmission(request, window.location.pathname, token), submissionKey.current)
      moved.current = true
      setSent(true)
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'Your referral could not be sent. Please try again.')
    } finally {
      setPending(false)
      setTurnstileToken(null)
      setResetKey(key => key + 1)
    }
  }

  function startOver() {
    setRequest(EMPTY_REFERRAL)
    setErrors({})
    setSent(false)
    submissionKey.current = null
    go(0)
  }

  if (sent) {
    return (
      <div role="status" className="mt-6 flex flex-col gap-4">
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-ink focus:outline-none">Thank you. Your referral is in.</h3>
        <p className="text-[15px]/relaxed text-muted">
          We will contact {request.facilityName.trim()} and email you at {request.referrerEmail.trim()} once we have.
        </p>
        <button type="button" onClick={startOver}
          className="mt-2 self-start text-sm font-semibold text-brand underline-offset-4 hover:underline">
          Refer another facility
        </button>
      </div>
    )
  }

  const field = (name: keyof ReferralRequest) => ({
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    className: cx(CONTROL, errors[name] ? 'border-critical' : 'border-line-control focus:border-brand'),
  })

  return (
    <form ref={formRef} noValidate onSubmit={event => void onSubmit(event)} className="mt-1.5 flex flex-col gap-6">
      {lede ? <p className="-mb-1 text-[15px] text-muted">{lede}</p> : null}
      <div>
        <p className="text-[13px] font-medium text-muted">Step {step + 1} of 2</p>
        <h3 ref={headingRef} tabIndex={-1} className="mt-1 text-lg font-semibold text-ink focus:outline-none">{STEPS[step]}</h3>
        <div aria-hidden="true" className="mt-3 grid grid-cols-2 gap-1.5">
          <span className="h-1 rounded-full bg-brand" />
          <span className={cx('h-1 rounded-full', step === 1 ? 'bg-brand' : 'bg-line')} />
        </div>
      </div>

      {step === 0 ? (
        <div className="flex flex-col gap-5">
          <Field label="Facility name" error={errors.facilityName} name="facilityName">
            <input {...field('facilityName')} autoComplete="off" value={request.facilityName} onChange={text('facilityName')} />
          </Field>
          <Field label="Type of facility" error={errors.facilityType} name="facilityType">
            <select {...field('facilityType')} value={request.facilityType} onChange={text('facilityType')}>
              <option value="">Choose a type</option>
              {FACILITY_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </Field>
          <Field label="City or state" optional error={errors.facilityLocation} name="facilityLocation">
            <input {...field('facilityLocation')} maxLength={120} value={request.facilityLocation} onChange={text('facilityLocation')} />
          </Field>
          <Field label="Who should we speak to?" optional error={errors.facilityContact} name="facilityContact"
            hint="A name and role is enough, for example the medical director.">
            <input {...field('facilityContact')} maxLength={300} value={request.facilityContact} onChange={text('facilityContact')}
              aria-describedby={errors.facilityContact ? 'facilityContact-error' : 'facilityContact-hint'} />
          </Field>
          <Button type="submit" className="mt-1 h-12! w-full text-[15px]">Continue</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="rounded-(--radius-control) bg-surface-sunk px-3.5 py-3 text-[14px] text-muted">
            Referring <span className="font-semibold text-ink">{request.facilityName.trim()}</span>.{' '}
            <button type="button" onClick={() => go(0)} className="font-semibold text-brand underline-offset-4 hover:underline">Change</button>
          </p>
          <Field label="Your full name" error={errors.referrerName} name="referrerName">
            <input {...field('referrerName')} autoComplete="name" value={request.referrerName} onChange={text('referrerName')} />
          </Field>
          <Field label="Your email" error={errors.referrerEmail} name="referrerEmail">
            <input {...field('referrerEmail')} type="email" autoComplete="email" value={request.referrerEmail} onChange={text('referrerEmail')} />
          </Field>
          <Field label="Your phone" optional error={errors.referrerPhone} name="referrerPhone">
            <input {...field('referrerPhone')} type="tel" autoComplete="tel" value={request.referrerPhone} onChange={text('referrerPhone')} />
          </Field>

          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-3 text-[15px]/relaxed text-ink">
              <input name="consent" type="checkbox" checked={request.consent} onChange={event => set('consent', event.target.checked)}
                aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? 'consent-error' : undefined}
                className="mt-1 h-4 w-4 shrink-0 accent-brand" />
              <span>The facility knows I am introducing them to Health ID.</span>
            </label>
            <Problem id="consent-error" text={errors.consent} />
          </div>

          {localNoWidget
            ? <p className="text-xs text-muted">Local development: security verification is disabled on the local gateway.</p>
            : <TurnstileWidget siteKey={siteKey} action="book-demo" resetKey={resetKey} onToken={setTurnstileToken} onError={setVerificationError} />}
          {verificationError ? <p role="alert" className="text-sm text-critical">{verificationError}</p> : null}
          {submitError ? <p role="alert" className="text-sm text-critical">{submitError}</p> : null}

          <div className="mt-1 flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" onClick={() => go(0)}
              className="h-12 rounded-(--radius-button) border border-line-strong px-6 text-[15px] font-semibold text-ink hover:bg-surface-hover sm:w-auto">
              Back
            </button>
            <Button type="submit" disabled={pending || (!turnstileToken && !localNoWidget)} className="h-12! w-full text-[15px] sm:w-auto sm:flex-1">
              {pending ? 'Sending…' : 'Send referral'}
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}

function Field({ label, optional, error, name, hint, children }: {
  readonly label: string
  readonly optional?: boolean
  readonly error?: string
  readonly name: string
  readonly hint?: string
  readonly children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[14px] font-medium text-ink">{label}{optional ? <span className="font-normal text-faint"> (optional)</span> : null}</span>
      {children}
      {hint && !error ? <span id={`${name}-hint`} className="text-[13px] text-faint">{hint}</span> : null}
      <Problem id={`${name}-error`} text={error} />
    </label>
  )
}

function Problem({ id, text }: { readonly id: string; readonly text?: string }) {
  return text ? <span id={id} className="text-[13px] font-medium text-critical">{text}</span> : null
}
