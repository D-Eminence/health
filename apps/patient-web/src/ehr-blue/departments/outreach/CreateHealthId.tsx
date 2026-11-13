import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError, retryAfterSeconds } from '@hid/http'
import { EhrInput } from '@hid/ui/ehr'
import { Copy, IdCard } from 'lucide-react'
import { FormActions } from '../../../kasuwa/parts'
import { Alert, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { staffApi, type OutreachCase, type OutreachHealthIdChannel } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { errorText } from '../parts/errors'
import { controlProps, ErrorBox, OutreachField } from './outreachParts'

/*
 * "Create Health ID" at an outreach event (outreach-api 0119, proposed; owner decisions of 13 November 2026): once the
 * person says they want one (separately from agreeing to be registered), the volunteer makes their Health ID from the
 * registration, confirmed by a code sent to the email the person gives, or, with no email or phone, unverified with a
 * claim code for their slip. Text messages are not available yet. Shown only where Outreach serves it: a registration
 * from such an Outreach carries `healthId` (null while none), and a 404 route-not-served from any of its calls hides it.
 * Under 18: no Health ID here yet (Outreach refuses it).
 */

type Method = 'email' | 'unverified' | 'sms'

/** The 404 codes that mean Outreach does not serve the route (not that the registration is missing). */
const ROUTE_NOT_SERVED: ReadonlySet<string> = new Set(['NOT_FOUND', 'API_ROUTE_NOT_FOUND'])

/** Outreach's refusals, each in words that say what to do next (never whose Health ID a phone or email already has). */
export const HEALTH_ID_PROBLEMS: Readonly<Record<string, string>> = {
  OUTREACH_REGISTRATION_NOT_FOUND: 'This registration can’t be found. It may have been deleted. Go back to the list.',
  OUTREACH_REGISTRATION_REDACTED: 'This person’s details were deleted, so a Health ID can’t be made from them.',
  OUTREACH_HEALTH_ID_NO_PHONE: 'Add the person’s phone number to create a Health ID.',
  OUTREACH_HEALTH_ID_UNDER_18: 'Health IDs for under-18s can’t be created at outreach yet. A parent or guardian can do it later in the app.',
  OUTREACH_HEALTH_ID_NOT_AVAILABLE: 'Health IDs can’t be created for this group.',
  OUTREACH_HEALTH_ID_PHONE_TAKEN: 'This phone number already has a Health ID. Ask them to sign in with it.',
  OUTREACH_HEALTH_ID_EMAIL_TAKEN: 'This email already has a Health ID. Ask them to sign in with it.',
  OUTREACH_HEALTH_ID_EMAIL_INVALID: 'Check the email address.',
  OUTREACH_HEALTH_ID_TOO_MANY_CODES: 'Too many codes for this person today. Try again tomorrow.',
  OUTREACH_HEALTH_ID_UNAVAILABLE: 'Health IDs can’t be created right now. Give them the slip; they can get one later.',
  OUTREACH_HEALTH_ID_CODE_INVALID: 'That code isn’t right. Check the email and try again.',
  OUTREACH_HEALTH_ID_CODE_EXPIRED: 'That code has expired. Send a new one.',
  OUTREACH_HEALTH_ID_TOO_MANY_TRIES: 'Too many wrong codes. Send a new one.',
}
const SMS_UNAVAILABLE = 'Text messages aren’t working right now. Use their email, or give them the slip.'
const FAILED = 'The Health ID could not be created. Please retry.'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What the section shows once a Health ID is made: the claim code only from the answer that made it, once. */
interface Made { readonly healthId: string; readonly claimCode?: string; readonly byEmail: boolean }

export function CreateHealthId({ facilityId, item, canWrite, onCreated }: {
  readonly facilityId: string
  readonly item: OutreachCase
  /** Whether the membership may write registrations: only then can it make a Health ID. */
  readonly canWrite: boolean
  /** A Health ID was made: the cases are read again. */
  readonly onCreated: () => void
}) {
  // The ways Outreach answered it does not serve (404 route-not-served): each hides on its own, as each ships alone.
  const [unserved, setUnserved] = useState<ReadonlySet<'email' | 'unverified'>>(new Set())
  const [wanted, setWanted] = useState(false)
  const [method, setMethod] = useState<Method>('email')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [sent, setSent] = useState<{ readonly hint: string; readonly channel: OutreachHealthIdChannel } | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [justMade, setMade] = useState<Made | null>(null)
  const [wait, setWait] = useState(0)
  // One key per attempt: a new one for each code sent, each code confirmed and each unverified Health ID; the same on a
  // retry of that attempt (the same body).
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const focus = useFocusById()
  const id = (part: string) => `outreach-health-id-${item.id}-${part}`

  useEffect(() => {
    if (wait <= 0) return undefined
    const timer = window.setTimeout(() => setWait(seconds => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  // Served only by an Outreach whose registrations carry `healthId` (0119); hidden on any other.
  if (!('healthId' in item) || unserved.size === 2) return null
  const minor = typeof item.ageYears === 'number' && item.ageYears < 18
  // Made here just now (with its claim code, shown this once), or made before, as the registration says.
  const made: Made | null = justMade ?? (item.healthId ? { healthId: item.healthId, byEmail: false } : null)

  function keyFor(signature: string): string {
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    return attempt.current.key
  }

  /** Says a refusal in plain words, or hides the section when Outreach does not serve the route. */
  function refused(caught: unknown, codeStep: boolean, way: 'email' | 'unverified'): void {
    const problem = isHidApiError(caught) ? caught.code : ''
    if (isHidApiError(caught) && caught.status === 404 && ROUTE_NOT_SERVED.has(problem)) {
      const next = new Set(unserved).add(way)
      setUnserved(next)
      setSent(null)
      if (next.size < 2) {
        const other = way === 'email' ? 'unverified' : 'email'
        setMethod(other)
        setError(way === 'email' ? 'Email codes aren’t available yet. Choose “No email or phone”, or give them the slip.'
          : '“No email or phone” isn’t available yet. Use their email, or give them the slip.')
      }
      return
    }
    if (problem === 'OUTREACH_HEALTH_ID_ALREADY_CREATED') {
      const details = isHidApiError(caught) ? caught.details as { healthId?: unknown } | null : null
      const existing = typeof details?.healthId === 'string' ? details.healthId : null
      if (existing) setMade({ healthId: existing, byEmail: false })
      else setError('This person already has a Health ID. It is shown here once the registration is read again.')
      // Read again: the registration names its Health ID.
      onCreated()
      return
    }
    if (problem === 'OUTREACH_HEALTH_ID_UNAVAILABLE' && method === 'sms') { setError(SMS_UNAVAILABLE); return }
    if (problem === 'OUTREACH_HEALTH_ID_TOO_MANY_CODES') {
      const after = retryAfterSeconds(caught)
      if (after) setWait(after)
    }
    if (problem === 'OUTREACH_HEALTH_ID_EMAIL_INVALID' || problem === 'OUTREACH_HEALTH_ID_EMAIL_TAKEN') {
      setEmailError(HEALTH_ID_PROBLEMS[problem]!)
      setSent(null)
      focus(id('email'))
      return
    }
    if (codeStep && (problem === 'OUTREACH_HEALTH_ID_CODE_INVALID')) {
      setCodeError(HEALTH_ID_PROBLEMS[problem]!)
      focus(id('code'))
      return
    }
    const words = HEALTH_ID_PROBLEMS[problem] ?? errorText(caught, FAILED)
    setError(words)
  }

  async function start() {
    if (busy) return
    setError('')
    setEmailError('')
    setCodeError('')
    let body: { channel: 'email'; email: string } | { channel: 'sms' }
    if (method === 'email') {
      const typed = email.trim()
      if (!EMAIL_PATTERN.test(typed)) { setEmailError('Enter their email address, like name@example.com.'); focus(id('email')); return }
      body = { channel: 'email', email: typed }
    } else body = { channel: 'sms' }
    // A new key for each code sent, including a resend.
    attempt.current = null
    const key = keyFor(JSON.stringify(['start', body, Date.now()]))
    setBusy(true)
    try {
      const answer = await staffApi.startOutreachHealthId(facilityId, item.id, body, key)
      attempt.current = null
      setSent({ hint: answer.destinationHint, channel: answer.channel })
      setCode('')
      setWait(Math.max(0, Math.round(answer.resendAfterSeconds || 0)))
      focus(id('code'))
    } catch (caught) {
      refused(caught, false, 'email')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const typed = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(typed)) { setCodeError('Enter the 6-digit code from the email.'); focus(id('code')); return }
    setCodeError('')
    const key = keyFor(JSON.stringify(['confirm', typed]))
    setBusy(true)
    try {
      const answer = await staffApi.confirmOutreachHealthId(facilityId, item.id, typed, key)
      attempt.current = null
      setMade({ healthId: answer.healthId, byEmail: true })
      focus(id('made'))
      onCreated()
    } catch (caught) {
      refused(caught, true, 'email')
    } finally {
      setBusy(false)
    }
  }

  async function createUnverified() {
    if (busy) return
    setError('')
    const key = keyFor('unverified')
    setBusy(true)
    try {
      const answer = await staffApi.createUnverifiedOutreachHealthId(facilityId, item.id, key)
      attempt.current = null
      setMade({ healthId: answer.healthId, claimCode: answer.claimCode, byEmail: false })
      focus(id('made'))
      onCreated()
    } catch (caught) {
      refused(caught, false, 'unverified')
    } finally {
      setBusy(false)
    }
  }

  let body
  if (made) {
    body = (
      <div className="flex flex-col gap-3">
        <h3 id={id('made')} tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">Their Health ID</h3>
        <p className="m-0 font-mono text-[32px] font-semibold tracking-wide break-all text-ink" aria-label={`Health ID ${made.healthId.split('').join(' ')}`}>{made.healthId}</p>
        {made.claimCode ? <>
          <p className="m-0 text-body text-ink-2">Claim code</p>
          <p className="m-0 font-mono text-[32px] font-semibold tracking-wide break-all text-ink" aria-label={`Claim code ${made.claimCode.split('').join(' ')}`}>{made.claimCode}</p>
          <Alert intent="warning" title="Write this on their slip.">They’ll need the Health ID and this code to start using it later. The code isn’t shown again.</Alert>
        </> : <p className="m-0 text-body text-ink"><strong>Write this on their slip.</strong></p>}
        {made.byEmail ? <p className="m-0 text-body text-ink-2">They’ll get an email to set a password. They can add their details and set a password later in the app.</p> : null}
        <Button icon={Copy} className="self-start" onClick={() => { void navigator.clipboard?.writeText(made.claimCode ? `${made.healthId} ${made.claimCode}` : made.healthId).catch(() => undefined) }}>
          Copy</Button>
      </div>
    )
  } else if (minor) {
    body = <p className="m-0 text-body text-ink-2">A Health ID can’t be created here for under-18s yet.</p>
  } else if (!canWrite) {
    body = <p className="m-0 text-body text-ink-2">No Health ID has been made for this person here.</p>
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <label className="flex items-start gap-3 text-body text-ink" htmlFor={id('wanted')}>
          <input id={id('wanted')} type="checkbox" className="mt-1 size-5" checked={wanted} disabled={busy || sent !== null}
            onChange={event => setWanted(event.target.checked)} />
          <span>They want a Health ID<span className="block text-caption text-ink-3">Ask them. Agreeing to be registered is not agreeing to a Health ID.</span></span>
        </label>
        {wanted && !sent ? <>
          <fieldset className="hid-ehr-field m-0 border-0 p-0">
            <legend className="hid-ehr-label">Send the code by</legend>
            {([['email', 'Email', 'They read you the code from the email.'],
              ['unverified', 'No email or phone', 'A Health ID with a claim code for their slip.'],
              ['sms', 'Text message', 'Text messages aren’t available yet.']] as const)
              .filter(([value]) => value === 'sms' || !unserved.has(value)).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 py-1" htmlFor={id(`method-${value}`)}>
                <input id={id(`method-${value}`)} type="radio" name={id('method')} value={value} checked={method === value}
                  disabled={value === 'sms'} onChange={() => { setMethod(value); setError('') }} />
                <span>{label}<span className="block text-caption text-ink-3">{hint}</span></span>
              </label>
            ))}
          </fieldset>
          {method === 'email' ? <>
            <OutreachField id={id('email')} label="Their email address" required error={emailError || undefined} hint="We send a 6-digit code here.">
              <EhrInput type="email" autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setEmailError('') }}
                {...controlProps(id('email'), emailError || undefined, true)} />
            </OutreachField>
            <Button variant="primary" size="lg" className="self-start hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}
              onClick={() => void start()}>{busy ? 'Sending…' : 'Send code'}</Button>
          </> : null}
          {method === 'unverified' ? (
            <Button variant="primary" size="lg" className="self-start hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}
              onClick={() => void createUnverified()}>{busy ? 'Creating…' : 'Create Health ID'}</Button>
          ) : null}
        </> : null}
        {sent ? (
          <form className="flex flex-col gap-4" noValidate aria-label="Confirm the code" onSubmit={event => void confirm(event)}>
            <p className="m-0 text-body text-ink">We sent a code to {sent.hint}. Ask them to read you the code from the email.</p>
            <OutreachField id={id('code')} label="6-digit code" required error={codeError || undefined}>
              <EhrInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} className="max-w-48 text-[22px] tracking-[0.3em]"
                onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setCodeError('') }} {...controlProps(id('code'), codeError || undefined)} />
            </OutreachField>
            <FormActions sticky={false}>
              <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || wait > 0 || undefined}
                onClick={() => { if (!busy && wait <= 0) void start() }}>{wait > 0 ? `Send a new code in ${wait} s` : 'Send a new code'}</Button>
              <Button type="submit" variant="primary" size="lg" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined}
                aria-disabled={busy || undefined}>{busy ? 'Confirming…' : 'Confirm'}</Button>
            </FormActions>
            <Button variant="link" className="self-start" onClick={() => { if (!busy) { setSent(null); setCode(''); setCodeError(''); setError('') } }}>Use a different email</Button>
          </form>
        ) : null}
        <ErrorBox message={error} />
      </div>
    )
  }

  return (
    <Card aria-labelledby={id('heading')}>
      <CardHeader as="h2" titleId={id('heading')} icon={IdCard} iconTone="brand" title="Create Health ID"
        description={made ? undefined : 'Make their Health ID now from this registration.'} />
      <div className="p-5">{body}</div>
    </Card>
  )
}
