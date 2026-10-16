'use client'

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Button, cx } from '@hid/ui'
import { TurnstileWidget } from '@/components/shared/TurnstileWidget'
import { submitDemoRequest } from '@/lib/commercial-api'
import { getEnvironment } from '@/lib/env'
import {
  EMPTY_REFERRAL, FACILITY_TYPES, REFERRAL_PRODUCTS, toReferralSubmission, validateReferral,
  type ReferralErrors, type ReferralRequest,
} from '@/lib/referral'

const FIELD_ORDER: readonly (keyof ReferralRequest)[] = [
  'referrerName', 'referrerEmail', 'referrerPhone', 'facilityName', 'facilityType', 'facilityLocation',
  'product', 'facilityContact', 'notes', 'consent',
]

const CONTROL = 'h-11 w-full rounded-(--radius-control) border bg-surface px-3 text-[15px] text-ink focus:outline-2 focus:outline-offset-0 focus:outline-brand'

function Label({ text, optional }: { readonly text: string; readonly optional?: boolean }) {
  return <span className="text-[13px] font-medium text-muted">{text}{optional ? <span className="font-normal text-faint"> (optional)</span> : null}</span>
}

function Problem({ id, text }: { readonly id: string; readonly text?: string }) {
  return text ? <span id={id} className="text-[12px] font-medium text-critical">{text}</span> : null
}

/**
 * The referral form on /earn. It sends a tagged enquiry (lib/referral.ts) and
 * stores nothing in the browser.
 */
export function ReferralForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [request, setRequest] = useState<ReferralRequest>(EMPTY_REFERRAL)
  const [errors, setErrors] = useState<ReferralErrors>({})
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const submissionKey = useRef<string | null>(null)
  const environment = getEnvironment()
  const siteKey = environment.turnstileSiteKey
  const localNoWidget = environment.name === 'local' && !siteKey
    && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(environment.appOrigin).hostname)

  function set<K extends keyof ReferralRequest>(field: K, value: ReferralRequest[K]) {
    setRequest(current => ({ ...current, [field]: value }))
    submissionKey.current = null
  }
  const text = (field: Exclude<keyof ReferralRequest, 'consent'>) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(field, event.target.value as never)

  const border = (field: keyof ReferralRequest) => errors[field] ? 'border-critical' : 'border-line-control focus:border-brand'
  const described = (field: keyof ReferralRequest) => errors[field] ? `${field}-error` : undefined

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const found = validateReferral(request)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const first = FIELD_ORDER.find(name => found[name])
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
      return
    }
    const token = turnstileToken ?? (localNoWidget ? 'local-turnstile-disabled' : null)
    if (!token) {
      setVerificationError('Complete the security verification to continue.')
      return
    }
    setPending(true)
    setSubmitError(null)
    setVerificationError(null)
    try {
      submissionKey.current ??= crypto.randomUUID()
      await submitDemoRequest(toReferralSubmission(request, window.location.pathname, token), submissionKey.current)
      setSent(true)
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'Your referral could not be sent. Please try again.')
    } finally {
      setPending(false)
      setTurnstileToken(null)
      setResetKey(key => key + 1)
    }
  }

  if (sent) {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-(--radius-card) border border-line-strong p-6">
        <h3 className="text-lg font-semibold text-ink">Thank you. Your referral is in.</h3>
        <p className="text-[15px]/relaxed text-muted">
          We will email {request.referrerEmail.trim()} once we have contacted {request.facilityName.trim()}.
        </p>
        <button type="button" onClick={() => { setRequest(EMPTY_REFERRAL); setErrors({}); setSent(false); submissionKey.current = null }}
          className="self-start text-sm font-semibold text-brand underline-offset-4 hover:underline">
          Refer another facility
        </button>
      </div>
    )
  }

  return (
    <form ref={formRef} noValidate onSubmit={event => void onSubmit(event)} className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-[15px] font-semibold text-ink">About you</legend>
        <label className="flex flex-col gap-2">
          <Label text="Your full name" />
          <input name="referrerName" autoComplete="name" value={request.referrerName} onChange={text('referrerName')}
            aria-invalid={errors.referrerName ? true : undefined} aria-describedby={described('referrerName')} className={cx(CONTROL, border('referrerName'))} />
          <Problem id="referrerName-error" text={errors.referrerName} />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <Label text="Your email" />
            <input name="referrerEmail" type="email" autoComplete="email" value={request.referrerEmail} onChange={text('referrerEmail')}
              aria-invalid={errors.referrerEmail ? true : undefined} aria-describedby={described('referrerEmail')} className={cx(CONTROL, border('referrerEmail'))} />
            <Problem id="referrerEmail-error" text={errors.referrerEmail} />
          </label>
          <label className="flex flex-col gap-2">
            <Label text="Your phone" optional />
            <input name="referrerPhone" type="tel" autoComplete="tel" value={request.referrerPhone} onChange={text('referrerPhone')}
              aria-invalid={errors.referrerPhone ? true : undefined} aria-describedby={described('referrerPhone')} className={cx(CONTROL, border('referrerPhone'))} />
            <Problem id="referrerPhone-error" text={errors.referrerPhone} />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-[15px] font-semibold text-ink">The facility</legend>
        <label className="flex flex-col gap-2">
          <Label text="Facility name" />
          <input name="facilityName" autoComplete="off" value={request.facilityName} onChange={text('facilityName')}
            aria-invalid={errors.facilityName ? true : undefined} aria-describedby={described('facilityName')} className={cx(CONTROL, border('facilityName'))} />
          <Problem id="facilityName-error" text={errors.facilityName} />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <Label text="Type of facility" />
            <select name="facilityType" value={request.facilityType} onChange={text('facilityType')}
              aria-invalid={errors.facilityType ? true : undefined} aria-describedby={described('facilityType')} className={cx(CONTROL, border('facilityType'))}>
              <option value="">Choose a type</option>
              {FACILITY_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <Problem id="facilityType-error" text={errors.facilityType} />
          </label>
          <label className="flex flex-col gap-2">
            <Label text="City or state" optional />
            <input name="facilityLocation" value={request.facilityLocation} onChange={text('facilityLocation')} maxLength={120}
              aria-invalid={errors.facilityLocation ? true : undefined} aria-describedby={described('facilityLocation')} className={cx(CONTROL, border('facilityLocation'))} />
            <Problem id="facilityLocation-error" text={errors.facilityLocation} />
          </label>
        </div>
        <label className="flex flex-col gap-2">
          <Label text="What they need" optional />
          <select name="product" value={request.product} onChange={text('product')} className={cx(CONTROL, border('product'))}>
            <option value="">Not sure</option>
            {REFERRAL_PRODUCTS.filter(product => product.code !== 'general').map(product => <option key={product.code} value={product.code}>{product.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <Label text="Who we should speak to" optional />
          <input name="facilityContact" value={request.facilityContact} onChange={text('facilityContact')} maxLength={300}
            placeholder="Name and role, for example the medical director"
            aria-invalid={errors.facilityContact ? true : undefined} aria-describedby={errors.facilityContact ? 'facilityContact-error' : 'facilityContact-hint'} className={cx(CONTROL, border('facilityContact'))} />
          <span id="facilityContact-hint" className="text-[12px] text-faint">Share someone’s phone or email only if they have agreed to it.</span>
          <Problem id="facilityContact-error" text={errors.facilityContact} />
        </label>
        <label className="flex flex-col gap-2">
          <Label text="Anything else" optional />
          <textarea name="notes" rows={3} value={request.notes} onChange={text('notes')} maxLength={800}
            aria-invalid={errors.notes ? true : undefined} aria-describedby={errors.notes ? 'notes-error' : 'notes-hint'}
            className={cx(CONTROL, 'h-auto min-h-24 resize-y py-2.5', border('notes'))} />
          <span id="notes-hint" className="text-[12px] text-faint">Please do not include any patient information.</span>
          <Problem id="notes-error" text={errors.notes} />
        </label>
      </fieldset>

      <label className="flex items-start gap-3 text-[14px]/relaxed text-ink">
        <input name="consent" type="checkbox" checked={request.consent} onChange={event => set('consent', event.target.checked)}
          aria-invalid={errors.consent ? true : undefined} aria-describedby={described('consent')}
          className="mt-1 h-4 w-4 shrink-0 accent-brand" />
        <span>The facility knows I am introducing them to Health ID.</span>
      </label>
      <Problem id="consent-error" text={errors.consent} />

      {localNoWidget
        ? <p className="text-xs text-muted">Local development: security verification is disabled on the local gateway.</p>
        : <TurnstileWidget siteKey={siteKey} action="book-demo" resetKey={resetKey} onToken={setTurnstileToken} onError={setVerificationError} />}
      {verificationError ? <p role="alert" className="text-sm text-critical">{verificationError}</p> : null}
      {submitError ? <p role="alert" className="text-sm text-critical">{submitError}</p> : null}

      <Button type="submit" disabled={pending || (!turnstileToken && !localNoWidget)} className="h-12 w-full text-[15px]">
        {pending ? 'Sending…' : 'Send referral'}
      </Button>
    </form>
  )
}
