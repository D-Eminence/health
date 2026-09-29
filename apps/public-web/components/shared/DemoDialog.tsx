'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Display, IconButton, cx } from '@hid/ui'
import { HealthIcon } from './HealthIcon'
import {
  DEMO_INBOX,
  buildDemoMailto,
  validateDemoRequest,
  type DemoRequest,
  type DemoRequestErrors,
} from '@/lib/demo-request'

const EMPTY: DemoRequest = { service: '', facility: '', contactName: '', role: '', otherRole: '', email: '', phone: '', notes: '' }

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

  const close = useCallback(() => {
    dialogRef.current?.close()
  }, [])

  const onDialogClose = useCallback(() => {
    setRequest(EMPTY)
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus())
  }, [])

  useEffect(() => {
    const open = (opener: HTMLElement) => {
      setSent(false)
      setErrors({})
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
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = validateDemoRequest(request)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    // Hands off to the visitor's mail client. See lib/demo-request.ts for why
    // this is not a network call yet.
    window.location.href = buildDemoMailto(request)
    setSent(true)
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
            {sent ? 'Demo request ready to send' : 'Book a demo'}
          </Display>
          <p className="mt-1 text-sm text-muted">
            {sent
              ? 'Your email app should have opened with the details filled in.'
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
          <p className="text-[15px]/relaxed text-muted">
            If nothing opened, email us directly at{' '}
            <a href={`mailto:${DEMO_INBOX}`} className="font-semibold text-brand">
              {DEMO_INBOX}
            </a>{' '}
            and we will take it from there.
          </p>
          <Button onClick={close} className="self-start">
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 px-5 py-5">
          <Field label="Service of interest" name="service" value={request.service} error={errors.service} onChange={update('service')} />
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
          <Field label="Your role" name="role" value={request.role} error={errors.role} onChange={update('role')} autoComplete="organization-title" />
          {request.role === 'Other' ? <Field label="Specify your role" name="otherRole" value={request.otherRole} error={errors.otherRole} onChange={update('otherRole')} /> : null}
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
              className="min-h-28 resize-y rounded-(--radius-control) border border-line-strong bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand"
            />
            <span className="text-[12px] text-faint">
              Please do not include any patient information.
            </span>
          </label>

          <div className="mt-1 flex items-center gap-3">
            <Button type="submit">Send request</Button>
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
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cx(
          'h-[38px] rounded-(--radius-control) border bg-surface px-3 py-2.5 text-[14px] text-ink focus:outline-2 focus:outline-offset-0 focus:outline-brand',
          error ? 'border-critical' : 'border-line-strong focus:border-brand',
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
