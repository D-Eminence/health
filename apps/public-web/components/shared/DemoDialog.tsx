'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Display, IconButton, cx } from '@hid/ui'
import { HealthIcon } from './HealthIcon'
import { TurnstileWidget } from './TurnstileWidget'
import {
  DEMO_PRODUCTS,
  ROLE_MAX_LENGTH,
  toDemoSubmission,
  validateDemoRequest,
  type DemoRequest,
  type DemoRequestErrors,
} from '@/lib/demo-request'
import { submitDemoRequest } from '@/lib/commercial-api'
import { getEnvironment } from '@/lib/env'

const EMPTY: DemoRequest = { service: '', facility: '', contactName: '', role: '', otherRole: '', email: '', phone: '', notes: '' }
/** The fields in the order the form shows them. */
const FIELD_ORDER: readonly (keyof DemoRequest)[] = ['service', 'facility', 'contactName', 'role', 'otherRole', 'email', 'phone', 'notes']

/**
 * The demo request dialog.
 *
 * Opened by any `#demo` link on the page, so every call to action on the site
 * reaches it without prop-drilling a handler through a dozen sections.
 *
 * Built on the native `<dialog>` element: focus trapping, Escape to close and
 * inertness of the page behind come from the platform rather than from a
 * hand-rolled implementation that usually gets one of the three wrong.
 *
 * Nothing here collects patient information, and nothing is stored. The
 * submission boundary is documented in lib/demo-request.ts.
 */
export function DemoDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const [request, setRequest] = useState<DemoRequest>(EMPTY)
  const [errors, setErrors] = useState<DemoRequestErrors>({})
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const submissionKeyRef = useRef<string | null>(null)
  const environment = getEnvironment()
  const siteKey = environment.turnstileSiteKey
  const localNoWidget = environment.name === 'local' && !siteKey
    && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(environment.appOrigin).hostname)

  const close = useCallback(() => {
    dialogRef.current?.close()
  }, [])

  const onDialogClose = useCallback(() => {
    setRequest(EMPTY)
    setTurnstileToken(null)
    setSubmitError(null)
    submissionKeyRef.current = null
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus())
  }, [])

  useEffect(() => {
    const open = (opener: HTMLElement) => {
      setSent(false)
      setErrors({})
      setSubmitError(null)
      setVerificationError(null)
      openerRef.current = opener

      const dialog = dialogRef.current
      if (dialog && !dialog.open) dialog.showModal()
    }

    // Any link to #demo opens the dialog. Intercepting the click rather than
    // relying on the hash keeps the URL clean and avoids the page jumping to an
    // anchor before the dialog appears.
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest('a')
      if (!target) return
      if (target.getAttribute('href') !== '#demo') return
      event.preventDefault()
      open(target)
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  const update = (field: keyof DemoRequest) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { value } = event.target
    setRequest(current => ({ ...current, [field]: value }))
    submissionKeyRef.current = null
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const found = validateDemoRequest(request)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      // Nothing announces the errors: the first field to correct takes focus once
      // it is marked, and its error is read with it.
      const first = FIELD_ORDER.find(name => found[name])
      if (first) requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus())
      return
    }
    const localToken = localNoWidget && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? 'local-turnstile-disabled' : null
    const verificationToken = turnstileToken ?? localToken
    if (!verificationToken) {
      setVerificationError('Complete the security verification to continue.')
      return
    }

    setPending(true)
    setSubmitError(null)
    setVerificationError(null)
    try {
      const context = {
        sourcePage: window.location.pathname,
        sourceSection: 'demo-dialog',
        ctaLabel: openerRef.current?.textContent?.trim() || 'Book a demo',
      }
      const body = toDemoSubmission(request, context, verificationToken)
      submissionKeyRef.current ??= crypto.randomUUID()
      await submitDemoRequest(body, submissionKeyRef.current)
      setSent(true)
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'The request could not be sent. Please try again.')
    } finally {
      setPending(false)
      setTurnstileToken(null)
      setResetKey(key => key + 1)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="demo-dialog-title"
      aria-modal="true"
      onClose={onDialogClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(500px,calc(100vw-2rem))] overflow-y-auto rounded-(--radius-dialog) border-[0.5px] border-line-strong bg-surface p-0 text-ink backdrop:bg-ink/45"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-5">
        <div>
          <Display as="h2" size="sm" id="demo-dialog-title">
            {sent ? 'Demo request received' : 'Book a demo'}
          </Display>
          <p className="mt-1 text-sm text-muted">
            {sent
              ? 'Our team has your request and can follow up by email.'
              : 'Tell us about your facility and we will arrange a walkthrough.'}
          </p>
        </div>
        <IconButton
          autoFocus
          onClick={close}
          aria-label="Close"
          size="md"
          className="border-line-strong hover:border-brand-border"
        >
          <HealthIcon name="close" size={15} />
        </IconButton>
      </div>

      {sent ? (
        <div className="flex flex-col gap-4 px-5 py-5">
          <p className="text-[15px]/relaxed text-muted">We will contact you at {request.email.trim()}.</p>
          <Button onClick={close} className="self-start">
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 px-5 py-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink">Service of interest</span>
            <select name="service" value={request.service}
              onChange={event => { setRequest(current => ({ ...current, service: event.target.value as DemoRequest['service'] })); submissionKeyRef.current = null }}
              aria-invalid={Boolean(errors.service)} aria-describedby={errors.service ? 'service-error' : undefined}
              className={cx(
                'h-[38px] rounded-(--radius-control) border bg-surface px-3 text-[14px] text-ink',
                errors.service ? 'border-critical' : 'border-line-control',
              )}>
              <option value="">Select a service</option>
              {DEMO_PRODUCTS.map(product => <option key={product.code} value={product.code}>{product.label}</option>)}
            </select>
            {errors.service ? <span id="service-error" className="text-[12px] font-medium text-critical">{errors.service}</span> : null}
          </label>
          <Field
            label="Facility"
            name="facility"
            value={request.facility}
            error={errors.facility}
            onChange={update('facility')}
            autoComplete="organization"
          />
          <Field
            label="Your name"
            name="contactName"
            value={request.contactName}
            error={errors.contactName}
            onChange={update('contactName')}
            autoComplete="name"
          />
          <Field label="Your role" name="role" value={request.role} error={errors.role} onChange={update('role')} autoComplete="organization-title" maxLength={ROLE_MAX_LENGTH} />
          {request.role === 'Other' ? <Field label="Specify your role" name="otherRole" value={request.otherRole} error={errors.otherRole} onChange={update('otherRole')} maxLength={ROLE_MAX_LENGTH} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Email"
              name="email"
              type="email"
              value={request.email}
              error={errors.email}
              onChange={update('email')}
              autoComplete="email"
            />
            <Field
              label="Phone"
              name="phone"
              type="tel"
              optional
              value={request.phone}
              error={errors.phone}
              onChange={update('phone')}
              autoComplete="tel"
            />
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink">
              Anything we should know <span className="font-normal text-faint">(optional)</span>
            </span>
            <textarea
              name="notes"
              rows={3}
              value={request.notes}
              onChange={update('notes')}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={errors.notes ? 'notes-error' : undefined}
              className={cx(
                'min-h-28 resize-y rounded-(--radius-control) border bg-surface px-3 py-2.5 text-[14px] text-ink focus:outline-2 focus:outline-offset-0 focus:outline-brand',
                errors.notes ? 'border-critical' : 'border-line-control focus:border-brand',
              )}
            />
            {errors.notes ? <span id="notes-error" className="text-[12px] font-medium text-critical">{errors.notes}</span> : null}
            <span className="text-[12px] text-faint">
              Please do not include any patient information.
            </span>
          </label>

          {localNoWidget
            ? <p className="text-xs text-muted">Local development: security verification is disabled on the local gateway.</p>
            : <TurnstileWidget siteKey={siteKey} action="book-demo" resetKey={resetKey}
                onToken={setTurnstileToken} onError={setVerificationError} />}
          {verificationError ? <p role="alert" className="text-sm text-critical">{verificationError}</p> : null}
          {submitError ? <p role="alert" className="text-sm text-critical">{submitError}</p> : null}

          <div className="mt-1 flex items-center gap-3">
            <Button type="submit" disabled={pending || (!turnstileToken && !localNoWidget)}>{pending ? 'Sending…' : 'Send request'}</Button>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-[38px] items-center px-2 text-[14px] font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}

interface FieldProps {
  readonly label: string
  readonly name: string
  readonly value: string
  readonly onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  readonly error?: string
  readonly type?: string
  readonly optional?: boolean
  readonly autoComplete?: string
  readonly maxLength?: number
}

function Field({
  label,
  name,
  value,
  onChange,
  error,
  type = 'text',
  optional = false,
  autoComplete,
  maxLength,
}: FieldProps) {
  const errorId = `${name}-error`

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink">
        {label}
        {optional ? <span className="font-normal text-faint"> (optional)</span> : null}
      </span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        {...(autoComplete ? { autoComplete } : {})}
        {...(maxLength ? { maxLength } : {})}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cx(
          'h-[38px] rounded-(--radius-control) border bg-surface px-3 py-2.5 text-[14px] text-ink focus:outline-2 focus:outline-offset-0 focus:outline-brand',
          error ? 'border-critical' : 'border-line-control focus:border-brand',
        )}
      />
      {error ? (
        <span id={errorId} className="text-[12px] font-medium text-critical">
          {error}
        </span>
      ) : null}
    </label>
  )
}
