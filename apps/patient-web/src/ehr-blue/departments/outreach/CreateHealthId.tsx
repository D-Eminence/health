import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError, retryAfterSeconds } from '@hid/http'
import { EhrInput } from '@hid/ui/ehr'
import { Copy, IdCard, Printer } from 'lucide-react'
import { FormActions } from '../../../kasuwa/parts'
import { Alert, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { staffApi, type OutreachCase, type OutreachHealthIdChannel } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { errorText } from '../parts/errors'
import { controlProps, ErrorBox, OutreachField } from './outreachParts'
import { keepClaimCode, keptClaimCode, readTab, writeTab } from './tabMemory'

/*
 * "Create Health ID" at an outreach event (outreach-api 0119, proposed; owner decisions of 13 November 2026): once the
 * person says they want one (separately from agreeing to be registered), the volunteer makes their Health ID from the
 * registration, confirmed by a code sent to the email the person gives, or, with no email (phone or not), unverified
 * with a claim code for their slip. Text messages are not available yet. Shown only where Outreach serves it: a registration
 * from such an Outreach carries `healthId` (null while none), and a 404 route-not-served from any of its calls hides it.
 * Under 18: no Health ID here yet (Outreach refuses it).
 *
 * A reload while waiting for the 6-digit code keeps the code box: this tab keeps (sessionStorage, tabMemory.ts) that a
 * code was sent and when, where, the email typed and the Idempotency-Key in use, never the code. A claim code is shown
 * on screen once; it is kept for 15 minutes for the slip only, so an accidental reload before it was written down does
 * not lose it (Health ID never answers it again).
 */

type Method = 'email' | 'unverified' | 'sms'

/** The 404 codes that mean Outreach does not serve the route (not that the registration is missing). */
const ROUTE_NOT_SERVED: ReadonlySet<string> = new Set(['NOT_FOUND', 'API_ROUTE_NOT_FOUND'])

/**
 * The ways Outreach answered it does not serve (404 route-not-served), for as long as this page stays loaded: kept in
 * memory only, so each new case does not offer them again. A reload asks again.
 */
const unservedWays = new Set<'email' | 'unverified'>()

/** Forgets the ways found not served, as a reload does (each test is a page of its own). */
export function forgetUnservedHealthIdWays(): void {
  unservedWays.clear()
}

/** What leaving the case view must wait for: a Health ID being made, or a claim code not yet printed or written down. */
export type HealthIdHold = 'creating' | 'claim' | null

/**
 * Outreach's refusals, each in words that say what to do next and fit every variant it is answered in (never whose
 * Health ID a phone or email already has, never "Please retry" where a retry can't help, never the API's own detail).
 */
export const HEALTH_ID_PROBLEMS: Readonly<Record<string, string>> = {
  OUTREACH_REGISTRATION_NOT_FOUND: 'This registration can’t be found. It may have been deleted. Go back to the list.',
  OUTREACH_REGISTRATION_REDACTED: 'This person’s details were deleted, so a Health ID can’t be made from them.',
  OUTREACH_HEALTH_ID_NO_PHONE: 'Add the person’s phone number to create a Health ID.',
  OUTREACH_HEALTH_ID_UNDER_18: 'Health IDs for under-18s can’t be created at outreach yet. A parent or guardian can do it later in the app.',
  OUTREACH_HEALTH_ID_NOT_AVAILABLE: 'Health IDs can’t be created for this group.',
  // Any Health ID with that phone, the person's own or a shared family phone's.
  OUTREACH_HEALTH_ID_PHONE_TAKEN: 'This phone number is already on a Health ID. If it’s their own, ask them to sign in. If the phone is shared, they can’t get one here today. Give them their slip.',
  // Any sign-in with that email: theirs, a relative's Health ID or a staff login.
  OUTREACH_HEALTH_ID_EMAIL_TAKEN: 'This email is already used by a Health ID or another account. If it’s their own Health ID, they already have one. If not, use another email or choose “No email”.',
  OUTREACH_HEALTH_ID_EMAIL_INVALID: 'Check the email address.',
  // With no wait to say: the daily limits, per person, per email (shared by a family) or per volunteer.
  OUTREACH_HEALTH_ID_TOO_MANY_CODES: 'Too many codes today. Try another email or choose “No email”. If neither works, give them their slip.',
  OUTREACH_HEALTH_ID_UNAVAILABLE: 'Health IDs can’t be created right now. Give them the slip; they can get one later.',
  OUTREACH_HEALTH_ID_CODE_INVALID: 'That code isn’t right. Check the email and try again.',
  OUTREACH_HEALTH_ID_CODE_EXPIRED: 'That code has expired. Send a new one.',
  // The code's 5 wrong tries (a new code helps), or the day's tries for this email (another email helps).
  OUTREACH_HEALTH_ID_TOO_MANY_TRIES: 'Too many wrong codes. Press Send a new code. If this shows again, use another email or choose “No email”.',
  OUTREACH_HEALTH_ID_NAME_INVALID: 'The name on this registration can’t be used for a Health ID. Check it with them, then register them again with their name written correctly.',
  OUTREACH_ORGANISER_SUSPENDED: 'Health ID has paused this group. Give them their slip.',
}
const SMS_UNAVAILABLE = 'Text messages aren’t working right now. Use their email, or give them the slip.'
/** 409 OUTREACH_HEALTH_ID_REQUEST_USED: the code of that request has ended (its email failed, or it expired), so its key is refused for good. */
export const REQUEST_USED = 'That code has ended. Press Send code to send a new one.'
/** 503 at start: the email could not be sent, which ends that code. */
export const START_UNAVAILABLE = 'The email couldn’t be sent just now. Press Send code again in a minute, or choose “No email”.'
const FAILED = 'The Health ID could not be created. Please retry.'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What the section shows once a Health ID is made: the claim code only from the answer that made it, once. */
/** byEmail is unknown (undefined) when Health ID only said one was made already: the registration, read again, says. */
interface Made { readonly healthId: string; readonly claimCode?: string; readonly byEmail?: boolean; readonly codeLost?: boolean }

/** A Health ID made here just now, its claim code when it was made with no email, and whether by email. */
export interface MadeHere {
  readonly healthId: string
  readonly claimCode?: string
  /** Until when the claim code works (0120's claimExpiresAt), for the slip. */
  readonly claimExpiresAt?: string
  readonly byEmail?: boolean
}

/**
 * 0119 makes the Health ID with no password and sends no email after the code: the person sets one with "Forgot
 * password" in the app, with the email they gave.
 */
export const NO_PASSWORD_YET = 'They have no password yet. To start using it, they open the Health ID app, tap “Forgot password” and enter the email they gave you. They can add the rest of their details then.'

/**
 * Whether the registration's Health ID was made at outreach from an email the person proved (0119): 0120 says so in
 * `healthIdStatus` ('verified'); before 0120 every Health ID made at outreach was made that way.
 */
export function healthIdMadeByEmail(item: OutreachCase): boolean {
  if (!item.healthId) return false
  const status = (item as { readonly healthIdStatus?: unknown }).healthIdStatus
  return status === undefined ? item.healthIdCreatedByOutreach === true : status === 'verified'
}

/**
 * A confirm whose answer was lost, or a 503 at confirm: the Health ID may already be made. Confirm again is safe: once
 * made, the code is spent and Outreach answers "already created" with the Health ID.
 */
export const CONFIRM_UNANSWERED = 'We couldn’t tell if the Health ID was made. Press Confirm again.'

/** A create with no email whose answer was lost (no signal, or a timeout): it may have been made. */
export const CREATE_UNANSWERED = 'We couldn’t tell if the Health ID was made. Keep the person with you and press Create Health ID again when you have signal.'

/**
 * A Health ID made with no email whose claim code this page never got (a lost answer, then "already created"), or an
 * unclaimed one with no claim code kept in this tab: the code is never answered again (0120 has no reissue).
 */
export const CLAIM_CODE_LOST = 'This Health ID was made, but its claim code can’t be shown again. Write the Health ID on their slip. They will need Health ID support to start using it. Don’t ask them to sign up again.'

/** Said once a Health ID made before (or before a reload) is shown: the claim code is never shown again. */
export const CLAIM_CODE_ON_SLIP = 'Made with no email. Its claim code was shown once, when it was made. Check it is on their slip.'
export const MADE_BEFORE = 'Their Health ID has been made. Print their slip, or write the Health ID on it.'

/** What a reload needs to keep the code box: never the code itself. */
interface CodeStep {
  readonly email: string
  readonly hint: string
  readonly channel: OutreachHealthIdChannel
  readonly sentAt: string
  /** When another code may be sent (ms since 1970). */
  readonly resendAt: number
  readonly sends: number
  readonly attempt: { readonly signature: string; readonly key: string } | null
}

export function CreateHealthId({ facilityId, item, canWrite, onCreated, onPrintSlip, onHold }: {
  readonly facilityId: string
  readonly item: OutreachCase
  /** Whether the membership may write registrations: only then can it make a Health ID. */
  readonly canWrite: boolean
  /**
   * A Health ID was made (or found already made): the cases are read again. Told what was made here, claim code
   * included, so the slip can print it; the claim code is held in memory only, never stored.
   */
  readonly onCreated: (made?: MadeHere) => void
  /** "Print slip", once a Health ID is shown. */
  readonly onPrintSlip?: () => void
  /**
   * What leaving the view must wait for, as it changes: while a confirm or a create with no email is sent (a page left
   * then loses the answer, and with it a claim code for good), and while a claim code is shown until the slip is printed
   * or "I've written it down" is pressed.
   */
  readonly onHold?: (hold: HealthIdHold) => void
}) {
  // A code step under way before a reload, kept for this tab by account, facility and registration.
  const { actorId } = useDeptAccess()
  const stepKey = actorId && canWrite ? `health-id:${actorId}:${facilityId}:${item.id}` : null
  const [step] = useState(() => stepKey && !item.healthId ? readTab<CodeStep>(stepKey) : null)
  // The ways Outreach answered it does not serve (404 route-not-served): each hides on its own, as each ships alone.
  const [unserved, setUnserved] = useState<ReadonlySet<'email' | 'unverified'>>(() => new Set(unservedWays))
  const [wanted, setWanted] = useState(step !== null)
  const [method, setMethod] = useState<Method>(() => unservedWays.has('email') ? 'unverified' : 'email')
  const [email, setEmail] = useState(step?.email ?? '')
  const [emailError, setEmailError] = useState('')
  const [sent, setSent] = useState<{ readonly hint: string; readonly channel: OutreachHealthIdChannel } | null>(
    step ? { hint: step.hint, channel: step.channel } : null)
  const sentAt = useRef(step?.sentAt ?? '')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // A confirm or a create with no email under way: leaving now would lose its answer.
  const [creating, setCreating] = useState(false)
  // The claim code shown has been printed or written down.
  const [noted, setNoted] = useState(false)
  // A create with no email from this view went unanswered: "already created" after it means its claim code was lost.
  const unanswered = useRef(false)
  const [justMade, setMade] = useState<Made | null>(null)
  const [wait, setWait] = useState(() => step ? Math.max(0, Math.ceil((step.resendAt - Date.now()) / 1000)) : 0)
  // One key per attempt: a new one for each code sent, each code confirmed and each unverified Health ID; the same on a
  // retry of that attempt (the same body), after a reload too.
  const attempt = useRef<{ signature: string; key: string } | null>(step?.attempt ?? null)
  // Codes sent so far in this view: part of the start request's identity, so a retry reuses its key.
  const sends = useRef(step?.sends ?? 0)
  const focus = useFocusById()
  const id = (part: string) => `outreach-health-id-${item.id}-${part}`

  // The code step is kept as it changes, and dropped once the Health ID is made or another email is to be used.
  const resendAt = useRef(step?.resendAt ?? 0)
  useEffect(() => {
    if (!stepKey || busy) return
    writeTab(stepKey, sent && !justMade && !item.healthId ? {
      email, hint: sent.hint, channel: sent.channel, sentAt: sentAt.current, resendAt: resendAt.current, sends: sends.current, attempt: attempt.current,
    } satisfies CodeStep : null)
  }, [stepKey, sent, email, justMade, busy, item.healthId])

  const hold: HealthIdHold = creating ? 'creating' : justMade?.claimCode && !noted ? 'claim' : null
  useEffect(() => {
    onHold?.(hold)
    return () => { if (hold) onHold?.(null) }
  }, [hold, onHold])
  // Closing or reloading the page asks first while an answer is awaited (a claim code shown is kept for the slip).
  useEffect(() => {
    if (!creating) return undefined
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [creating])

  useEffect(() => {
    if (wait <= 0) return undefined
    const timer = window.setTimeout(() => setWait(seconds => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  // Served only by an Outreach whose registrations carry `healthId` (0119); hidden on any other.
  if (!('healthId' in item) || unserved.size === 2) return null
  const minor = typeof item.ageYears === 'number' && item.ageYears < 18
  // Made here just now (with its claim code, shown this once), or made before, as the registration says.
  const made: Made | null = justMade ?? (item.healthId ? { healthId: item.healthId, byEmail: healthIdMadeByEmail(item) } : null)
  // Lost only when this view knows the code never arrived (its own create went unanswered). A Health ID made with no
  // email that this page holds no code for was most likely shown, and printed, elsewhere or earlier: say to check the slip.
  const unclaimed = (item as { readonly healthIdStatus?: unknown }).healthIdStatus === 'unclaimed'
  const codeLost = made !== null && !made.claimCode && made.codeLost === true
  const codeOnSlip = made !== null && !made.claimCode && !codeLost && unclaimed && made.healthId === item.healthId
    && !keptClaimCode(actorId, facilityId, item.id, item.healthId)
  const madeByEmail = made !== null && (made.byEmail ?? healthIdMadeByEmail(item))

  function keyFor(signature: string): string {
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    return attempt.current.key
  }

  /** Says a refusal in plain words, or hides the section when Outreach does not serve the route. */
  function refused(caught: unknown, call: 'start' | 'confirm' | 'unverified'): void {
    const problem = isHidApiError(caught) ? caught.code : ''
    const way = call === 'unverified' ? 'unverified' : 'email'
    if (isHidApiError(caught) && caught.status === 404 && ROUTE_NOT_SERVED.has(problem)) {
      unservedWays.add(way)
      const next = new Set(unserved).add(way)
      setUnserved(next)
      setSent(null)
      if (next.size < 2) {
        const other = way === 'email' ? 'unverified' : 'email'
        setMethod(other)
        setError(way === 'email' ? 'Email codes aren’t available yet. Choose “No email”, or give them the slip.'
          : '“No email” isn’t available yet. Use their email, or give them the slip.')
      }
      return
    }
    if (problem === 'OUTREACH_HEALTH_ID_ALREADY_CREATED') {
      const details = isHidApiError(caught) ? caught.details as { healthId?: unknown } | null : null
      const existing = typeof details?.healthId === 'string' ? details.healthId : null
      // At confirm, it was made from the code just proved (a retry after a lost answer): by email. Anywhere else it is not
      // known how it was made (a confirm whose answer was lost, another station): the registration read again says. After
      // this view's own create with no email went unanswered, it was made then, and its claim code is never answered again.
      const byEmail = call === 'confirm' ? true : undefined
      const lost = call === 'unverified' && unanswered.current
      if (existing) setMade({ healthId: existing, byEmail, codeLost: lost })
      else if (lost) setError(CLAIM_CODE_LOST)
      else setError('This person already has a Health ID. It is shown here once the registration is read again.')
      // Read again: the registration names its Health ID.
      onCreated(existing ? { healthId: existing, byEmail } : undefined)
      return
    }
    if (problem === 'OUTREACH_HEALTH_ID_UNAVAILABLE' && method === 'sms') { setError(SMS_UNAVAILABLE); return }
    // That code has ended (409 REQUEST_USED), or its email could not be sent (503 at start, which ends it): the key is
    // refused for good, so it is dropped (here and, as `sent` goes, from what a reload keeps) and the next press makes a
    // new one. The code box goes too: no code of that request can be confirmed.
    if (problem === 'OUTREACH_HEALTH_ID_REQUEST_USED' || (call === 'start' && problem === 'OUTREACH_HEALTH_ID_UNAVAILABLE')) {
      attempt.current = null
      setSent(null)
      setCode('')
      setError(problem === 'OUTREACH_HEALTH_ID_REQUEST_USED' ? REQUEST_USED : START_UNAVAILABLE)
      return
    }
    if (problem === 'OUTREACH_HEALTH_ID_TOO_MANY_CODES') {
      const after = retryAfterSeconds(caught)
      // A short wait is a cooldown between codes, not the daily limit (which another email may get past, so the
      // buttons are not held for it).
      if (after && after < 3600) {
        setWait(after)
        setError(after <= 90 ? `Wait ${after} seconds, then send the code again.` : `Wait ${Math.ceil(after / 60)} minutes, then send the code again.`)
        return
      }
    }
    if (problem === 'OUTREACH_HEALTH_ID_EMAIL_INVALID' || problem === 'OUTREACH_HEALTH_ID_EMAIL_TAKEN') {
      setEmailError(HEALTH_ID_PROBLEMS[problem]!)
      setSent(null)
      focus(id('email'))
      return
    }
    if (call === 'confirm' && (problem === 'OUTREACH_HEALTH_ID_CODE_INVALID')) {
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
    // The same key when the same request is tried again (an answer that never arrived must not cost a second code);
    // a new key once a code was sent, so "send again" asks for a new code, and for a different email.
    const key = keyFor(JSON.stringify(['start', body, sends.current]))
    setBusy(true)
    try {
      const answer = await staffApi.startOutreachHealthId(facilityId, item.id, body, key)
      attempt.current = null
      sends.current += 1
      sentAt.current = new Date().toISOString()
      const after = Math.max(0, Math.round(answer.resendAfterSeconds || 0))
      resendAt.current = Date.now() + after * 1000
      setSent({ hint: answer.destinationHint, channel: answer.channel })
      setCode('')
      setWait(after)
      focus(id('code'))
    } catch (caught) {
      // The http client wraps a lost answer as status 0 (no network) or 408 (timeout).
      if ((!isHidApiError(caught) || caught.status === 0 || caught.status === 408) && method === 'email') {
        // The answer was lost: the code may have been sent. Let them type it, or try again with the same request (the
        // same key, so the open code is sent again, not a second one).
        sentAt.current = new Date().toISOString()
        setSent({ hint: body.channel === 'email' ? body.email : '', channel: 'email' })
        setError('We couldn’t tell if the code was sent. If an email arrived, ask them for the code. If not, send the code again.')
        return
      }
      refused(caught, 'start')
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
    setCreating(true)
    try {
      const answer = await staffApi.confirmOutreachHealthId(facilityId, item.id, typed, key)
      attempt.current = null
      setMade({ healthId: answer.healthId, byEmail: true })
      focus(id('made'))
      onCreated({ healthId: answer.healthId, byEmail: true })
    } catch (caught) {
      const unavailable = isHidApiError(caught) && caught.code === 'OUTREACH_HEALTH_ID_UNAVAILABLE'
      if (unavailable || !isHidApiError(caught) || caught.status === 0 || caught.status === 408 || caught.status === 504) {
        // A lost answer keeps the key, so Confirm again replays it; after a 503 the next Confirm is a request of its own.
        if (unavailable) attempt.current = null
        setError(CONFIRM_UNANSWERED)
        return
      }
      refused(caught, 'confirm')
    } finally {
      setBusy(false)
      setCreating(false)
    }
  }

  async function createUnverified() {
    if (busy) return
    setError('')
    const key = keyFor('unverified')
    setBusy(true)
    setCreating(true)
    try {
      const answer = await staffApi.createUnverifiedOutreachHealthId(facilityId, item.id, key)
      attempt.current = null
      // For the slip only, for 15 minutes: an accidental reload before it is written down does not lose it.
      if (actorId && answer.claimCode) keepClaimCode(actorId, facilityId, item.id, { healthId: answer.healthId, claimCode: answer.claimCode })
      setMade({ healthId: answer.healthId, claimCode: answer.claimCode, byEmail: false })
      focus(id('made'))
      const until = (answer as { readonly claimExpiresAt?: unknown }).claimExpiresAt
      onCreated({ healthId: answer.healthId, claimCode: answer.claimCode, claimExpiresAt: typeof until === 'string' ? until : undefined })
    } catch (caught) {
      // The answer was lost (no signal, or a timeout): it may have been made, and its claim code with it. outreach-api
      // answers 503 OUTREACH_HEALTH_ID_UNAVAILABLE (or the gateway 502) when Identity did not answer in time, which may
      // also come after it was made.
      if (!isHidApiError(caught) || caught.status === 0 || caught.status === 408 || caught.status === 502 || caught.status === 504
        || caught.code === 'OUTREACH_HEALTH_ID_UNAVAILABLE') {
        unanswered.current = true
        setError(CREATE_UNANSWERED)
        return
      }
      refused(caught, 'unverified')
    } finally {
      setBusy(false)
      setCreating(false)
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
        </> : codeLost ? <Alert intent="warning">{CLAIM_CODE_LOST}</Alert>
          : codeOnSlip ? <p className="m-0 text-body text-ink">{CLAIM_CODE_ON_SLIP}</p>
          : justMade ? <p className="m-0 text-body text-ink"><strong>Write this on their slip.</strong></p>
          : <p className="m-0 text-body text-ink">{MADE_BEFORE}</p>}
        {madeByEmail ? <p className="m-0 text-body text-ink-2">{NO_PASSWORD_YET}</p> : null}
        <div className="flex flex-wrap gap-2">
          {onPrintSlip ? <Button icon={Printer} variant={made.claimCode ? 'primary' : undefined} onClick={() => { setNoted(true); onPrintSlip() }}>Print slip</Button> : null}
          {made.claimCode && !noted ? <Button onClick={() => setNoted(true)}>I’ve written it down</Button> : null}
          {/* The Health ID only: a claim code left on a shared phone's clipboard could let someone else claim it. */}
          <Button icon={Copy} onClick={() => { void navigator.clipboard?.writeText(made.healthId).catch(() => undefined) }}>
            Copy</Button>
        </div>
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
            onChange={event => { setWanted(event.target.checked); if (!event.target.checked) setError('') }} />
          <span>They want a Health ID<span className="block text-caption text-ink-3">Ask them. Agreeing to be registered is not agreeing to a Health ID.</span></span>
        </label>
        {wanted && !sent ? <>
          <fieldset className="hid-ehr-field m-0 border-0 p-0">
            <legend className="hid-ehr-label">How should we make their Health ID?</legend>
            {/* "No email" is for anyone without an email, phone or not: a phone alone can't get a code yet. */}
            {([['email', 'Email', 'We send a 6-digit code. They read it to you.'],
              ['unverified', 'No email', 'Even if they have a phone. They get a claim code on their slip.'],
              ['sms', 'Text message', 'Not available yet.']] as const)
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
              <EhrInput type="email" autoComplete="off" name="person-email-at-outreach" inputMode="email" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setEmailError('') }}
                {...controlProps(id('email'), emailError || undefined, true)} />
            </OutreachField>
            {/* Held by the same wait as "Send a new code": after "Use a different email" the wait between codes still holds. */}
            <Button variant="primary" size="lg" className="self-start hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || wait > 0 || undefined}
              onClick={() => { if (wait <= 0) void start() }}>{busy ? 'Sending…' : wait > 0 ? `Send code in ${wait} s` : 'Send code'}</Button>
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
        description={made || minor ? undefined : 'Make their Health ID now from this registration.'} />
      <div className="p-5">{body}</div>
    </Card>
  )
}
