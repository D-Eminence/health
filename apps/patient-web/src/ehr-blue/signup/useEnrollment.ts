import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { providerEnrollmentApi, type ProviderEnrollmentStart } from '../../staff/api'
import { announceStaffSessionChange } from '../../staff/session'
import { organizationTypeNote } from '../../staff/routes/ProviderEnrollment'
import {
  availabilityOf, CAC_REFUSALS, cacProductKey, carriesOtherThan, DAY_MS, DEFAULT_RESEND_SECONDS, isOrganizationType, isProduct,
  MAX_CODE_WAIT_SECONDS, nextCodeAt, OPEN_SIGN_UP_MS, productOptions, refusalOf, registeringOf, secondsUntil, signUpKey,
  type CodeCarries, type OrganizationType, type Product, type Registering, type StartDetails, type StartOutcome, type Step,
  type Support, type Unapplied,
} from './enrollmentRules'

/**
 * The blue registration is Novu only (novu-v1, the backend production and staging build with): BlueProviderEnrollment
 * renders today's page on hid-system main, whose authenticator step and code counting this flow does not draw. Every
 * branch of today's page that `novu` decides is therefore taken as on Novu here.
 */
const NOVU = true

/** The five registration steps of the design (facility-fields.ts registrationSteps). */
export const REGISTRATION_STEPS = ['Your account', 'Facility type', 'CAC number', 'Product', 'Agreements'] as const
export const CAC_STEP = 2
export const REVIEW_STEP = 4

/** A message for the administrator; `at: 'cac'` puts it at the CAC field (a refusal about the organization's number). */
export interface EnrollmentError {
  text: string
  support?: Support
  at?: 'cac'
}

export type Stage = 'details' | 'otp' | 'password' | 'sign-in' | 'done' | 'help'

/**
 * Today's facility sign-up (staff/routes/ProviderEnrollment.tsx EnrollmentSteps, lines 451-978), unchanged underneath:
 * the same state, the same calls to providerEnrollmentApi, the same waits, refusals and panels, ported line for line
 * with the Novu branches taken. What the blue flow adds is where things are shown: the registration's five steps
 * (`regStep`), the "Registration submitted" screen before the code (`submitted`), and a request to move focus to the
 * step heading (`headingFocus`), which the page carries out in a layout effect. Everything is React state: nothing is
 * kept anywhere else.
 */
export function useEnrollment() {
  const navigate = useNavigate()
  const novu = NOVU
  const [stage, setStage] = useState<Stage>('details')
  // Novu says whether self sign-up is open before the form is filled, and when not, whether it is closed or Identity
  // could not tell ('unavailable').
  const [availability, setAvailability] = useState<'checking' | 'open' | 'closed' | 'unavailable'>('checking')
  const [availabilityAsked, setAvailabilityAsked] = useState(0)
  // Novu since P4c: whether orders between facilities are on, which a laboratory's or pharmacy's note says.
  const [ordersOn, setOrdersOn] = useState(false)
  const [help, setHelp] = useState<{ title: string; text: string; restart?: boolean } | null>(null)
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
  const [cac, setCacValue] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCodeValue] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<EnrollmentError | null>(null)
  // What the last "Send a new code" did: sent one, or sent none (Novu), leaving the last code usable or not.
  const [resent, setResent] = useState<StartOutcome | null>(null)
  // Novu: the code step was reached without a new code, because one was sent less than a minute ago ('recent') or
  // the sign-up or its email has had as many codes as Identity sends for now ('limit').
  const [unsent, setUnsent] = useState<'recent' | 'limit' | null>(null)
  // Novu says whether each start sent a code (codeSent, P4 round 2): the page then follows its answers instead of
  // counting codes, and needs no wait after "Start again".
  const [codesReported, setCodesReported] = useState(false)
  // Novu: the last answer's wait is longer than the minute between codes (a limit), and whether a code can still be entered.
  const [codeLimited, setCodeLimited] = useState(false)
  const [codeInForce, setCodeInForce] = useState(true)
  // A start whose answer was lost (a timeout, or the gateway's 503 at 30 s while Identity carried on) may have sent
  // a code, so it waits as long as a code would.
  const [resendAt, setResendAt] = useState(0)
  // Continue waits until retryAt for the sign-up it applies to (its signUpKey) only: other details are another sign-up.
  const [retryAt, setRetryAt] = useState(0)
  const [retryFor, setRetryFor] = useState('')
  const [now, setNow] = useState(() => Date.now())
  // An activation whose answer was lost may have created the account and used up its session.
  const activationUncertain = useRef(false)
  // The sign-up the last code was sent for, and when each accepted start was answered, by sign-up (CODE_LIMITS, for an
  // answer that does not say whether it sent a code).
  const [codeFor, setCodeFor] = useState('')
  const [sends, setSends] = useState<ReadonlyArray<{ key: string; at: number }>>([])
  // The last code's challenge, kept through "Start again" until it is verified: a start past the limits goes back to it.
  const lastCode = useRef<{ key: string; challengeId: string } | null>(null)
  // What each code this page saw sent carries besides its sign-up (CodeCarries), by challenge.
  const codeCarries = useRef(new Map<string, CodeCarries>())
  // Novu: the last start sent no code for a changed facility type or administrator name (Unapplied).
  const [unapplied, setUnapplied] = useState<Unapplied | null>(null)
  // The details each CAC number and product was first accepted with: Identity keeps its email (OPEN_SIGN_UP_MS).
  const [firstStarts, setFirstStarts] = useState<ReadonlyMap<string, StartDetails & { at: number }>>(new Map())
  // Novu: what the confirmed sign-up registers (…/profile), and whether reading it failed for a fault.
  const [registering, setRegistering] = useState<Registering | null>(null)
  const [registeringFailed, setRegisteringFailed] = useState(false)

  // Blue: the registration step shown, the "Registration submitted" screen, and requests to focus the step heading.
  const [regStep, setRegStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [headingFocus, setHeadingFocus] = useState(0)

  useEffect(() => {
    let active = true
    // A clear no closes the form, and a fault says so (availabilityOf). A 404 (an Identity without self sign-up),
    // an outage or a malformed answer shows it: the start then answers for itself.
    providerEnrollmentApi.availability().then(
      answer => { if (active) { setAvailability(availabilityOf(answer)); setOrdersOn(answer?.crossFacilityOrders === true) } },
      () => { if (active) setAvailability('open') })
    return () => { active = false }
  }, [availabilityAsked])

  const sentFor = (key: string) => sends.filter(send => send.key === key).map(send => send.at)
  // Read each second, as the waits are: Identity's limits on codes for the sign-up the last code went to.
  const codeLimitAt = codeFor ? nextCodeAt(sentFor(codeFor), now) : 0
  const waiting = Math.max(resendAt, retryAt, codeLimitAt, unapplied?.until ?? 0) > now
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [waiting])

  /** Shows registration step `step`, with focus on its heading. */
  function toStep(step: number) {
    setRegStep(step)
    setHeadingFocus(value => value + 1)
  }

  function setType(value: OrganizationType) {
    setOrganizationType(value)
    const allowed = productOptions[value]
    if (!allowed.includes(productCode)) setProductCode(allowed[0]!)
  }

  /** On input, whitespace is stripped and the text put in capitals (ProviderEnrollment.tsx:1036). */
  function setCac(value: string) {
    setCacValue(value.replace(/\s+/g, '').toUpperCase())
  }

  /** Digits only, six at most (ProviderEnrollment.tsx:1095). */
  function setCode(value: string) {
    setCodeValue(value.replace(/\D/g, '').slice(0, 6))
  }

  /**
   * After an outage, Novu's availability says whether sign-up has closed meanwhile. Only a clear 'closed' is: an
   * answer that it is unavailable, or no answer, leaves the step's own message.
   */
  async function closedNow(): Promise<boolean> {
    try { return availabilityOf(await providerEnrollmentApi.availability()) === 'closed' } catch { return false }
  }

  function checkAvailabilityAgain() {
    setAvailability('checking')
    setAvailabilityAsked(value => value + 1)
  }

  /** Continue waits until `at` for these details' sign-up. */
  function holdFor(key: string, at: number) {
    setRetryAt(at); setRetryFor(key); setNow(Date.now())
  }

  function maybeActive() {
    setError(null); setPassword('')
    setStage('sign-in')
  }

  async function refuse(reason: unknown, step: Step, key = codeFor) {
    const refusal = refusalOf(reason, step, activationUncertain.current, novu)
    // Novu: an earlier activation whose answer was lost may have made the account, even if sign-up has closed since.
    const mayBeActive = () => novu && step === 'activate' && activationUncertain.current
    if (refusal.kind === 'closed') {
      if (mayBeActive()) { maybeActive(); return }
      setError(null); setAvailability('closed'); return
    }
    if (refusal.kind === 'unavailable') {
      if (step === 'activate') activationUncertain.current = true
      if (step === 'start' || step === 'resend') holdFor(key, Date.now() + DEFAULT_RESEND_SECONDS * 1000)
      setNow(Date.now())
      if (await closedNow()) {
        if (mayBeActive()) { maybeActive(); return }
        setError(null); setAvailability('closed'); return
      }
      setError({ text: refusal.text })
      return
    }
    if (refusal.kind === 'session-expired') {
      setError({ text: 'Your sign-up session has expired. Check your details and select Continue to get a new code.' })
      setChallengeId(''); setCodeValue(''); setPassword(''); setRegistering(null); setRegisteringFailed(false)
      // An answer that did not say whether it sent a code: a start within resendAfterSeconds of the last code sends none.
      if (!codesReported) holdFor(codeFor, resendAt)
      setStage('details')
      setSubmitted(false)
      toStep(0)
      return
    }
    if (refusal.kind === 'maybe-active') { maybeActive(); return }
    if (refusal.kind === 'help') {
      setError(null); setPassword('')
      setHelp({ title: refusal.title, text: refusal.text, ...(refusal.restart ? { restart: true } : {}) })
      setStage('help')
      return
    }
    // Blue: a refusal about the organization behind the CAC number goes back to the step that holds it.
    const atCac = step === 'start' && isHidApiError(reason) && CAC_REFUSALS.has(reason.code)
    setError({ text: refusal.text, ...(refusal.support ? { support: refusal.support } : {}), ...(atCac ? { at: 'cac' as const } : {}) })
    if (atCac) toStep(CAC_STEP)
  }

  /** The details as Identity takes them. */
  function startDetails(): StartDetails {
    return {
      productCode,
      organizationType,
      cacRegistrationNumber: cac.replace(/\s+/g, '').toUpperCase(),
      administratorName: name.trim(),
      administratorEmail: email.trim().toLowerCase(),
    }
  }

  /**
   * Novu: the sign-up these details' CAC number and product were first accepted with in the last 24 hours, if its
   * email now differs. Identity refuses another email for an open sign-up (0086) until 24 hours after it started, and
   * then lets it replace the sign-up, from any network (R15).
   */
  function otherEmailThanFirst(details: StartDetails): (StartDetails & { at: number }) | null {
    const first = novu ? firstStarts.get(cacProductKey(details)) : undefined
    if (!first || Date.now() - first.at >= OPEN_SIGN_UP_MS) return null
    return first.administratorEmail !== details.administratorEmail ? first : null
  }

  /**
   * Novu: the last start sent no code for these details' sign-up with a changed facility type or administrator name,
   * and Identity would not send one before `until` (Unapplied).
   */
  function changesHeld(details: StartDetails, at: number): Unapplied | null {
    return unapplied && unapplied.key === signUpKey(details) && carriesOtherThan(details, unapplied.carries)
      && unapplied.until > at ? unapplied : null
  }

  /**
   * Records a start Identity accepted. Novu says whether it sent a code (codeSent); when it did not, `challengeId`
   * names the code still in force, or is absent when none can still be entered, and resendAfterSeconds is the real
   * wait before a new one (up to about a day). (ProviderEnrollment.tsx:648-689)
   */
  function accepted(result: ProviderEnrollmentStart, details: StartDetails): { outcome: StartOutcome; until: number } {
    const reported = typeof result.codeSent === 'boolean'
    const given = typeof result.resendAfterSeconds === 'number' && Number.isFinite(result.resendAfterSeconds)
      ? result.resendAfterSeconds : null
    const wait = given === null ? DEFAULT_RESEND_SECONDS : Math.min(Math.max(given, 0), reported ? MAX_CODE_WAIT_SECONDS : 600)
    const outcome: StartOutcome = !reported || result.codeSent ? 'sent' : result.challengeId ? 'in-force' : 'none'
    const at = Date.now()
    const key = signUpKey(details)
    setCodesReported(reported)
    setCodeLimited(reported && wait > DEFAULT_RESEND_SECONDS)
    setCodeInForce(outcome !== 'none')
    setCodeFor(key)
    if (outcome !== 'none') {
      setChallengeId(result.challengeId ?? '')
      lastCode.current = { key, challengeId: result.challengeId ?? '' }
    }
    // A code sent carries this start's facility type and administrator name (R6); one in force keeps its own.
    if (outcome === 'sent' && result.challengeId) {
      codeCarries.current.set(result.challengeId, { organizationType: details.organizationType,
        administratorName: details.administratorName })
    }
    setUnapplied(null)
    // An answer that does not say whether it sent a code: the page counts the codes it asked for (CODE_LIMITS).
    if (!reported) setSends(list => [...list.filter(send => send.at > at - DAY_MS), { key, at }])
    // The first details accepted for a CAC number and product are the ones Identity keeps; a sign-up that has
    // lapsed (24 hours) or ended is replaced by the one just accepted.
    setFirstStarts(map => {
      const first = map.get(cacProductKey(details))
      if (first && first.administratorEmail === details.administratorEmail && at - first.at < OPEN_SIGN_UP_MS) return map
      return new Map(map).set(cacProductKey(details), { ...details, at })
    })
    const until = at + wait * 1000
    setResendAt(until)
    setRetryAt(0)
    setNow(at)
    return { outcome, until }
  }

  /** The registration's submit, once confirmed in the dialog: today's start (the QoreID CAC check and the email code). */
  async function start() {
    const details = startDetails()
    const key = signUpKey(details)
    if (busy || !turnstileToken || (retryFor === key && retryAt > Date.now()) || changesHeld(details, Date.now())) return
    const first = otherEmailThanFirst(details)
    const limitAt = nextCodeAt(sentFor(key), Date.now())
    if (limitAt && lastCode.current?.key === key) {
      // Identity would send no code; back to the last one, which is still the one in force.
      setError(null); setCodeValue(''); setResent(null); setUnsent(null)
      setChallengeId(lastCode.current.challengeId)
      setStage('otp')
      return
    }
    if (limitAt) {
      setError({ text: 'We’ve sent as many codes for these details as we can for now.' })
      holdFor(key, limitAt)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await providerEnrollmentApi.start({ ...details, turnstileToken })
      const { outcome, until } = accepted(result, details)
      setResent(null)
      const unsentBecause = until - Date.now() > DEFAULT_RESEND_SECONDS * 1000 ? 'limit' : 'recent'
      // The facility type and administrator name the code in force was sent with, when this page sent it.
      const carries = outcome === 'in-force' && result.challengeId ? codeCarries.current.get(result.challengeId) : undefined
      if (outcome === 'none') {
        // Novu sent no code, and none can be entered now: Continue waits until Identity would send one.
        setError({ text: unsentBecause === 'limit'
          ? 'We’ve sent as many codes for these details as we can for now.'
          : 'We can’t send a new code for these details yet.' })
        holdFor(key, until)
      } else if (carries && carriesOtherThan(details, carries)) {
        // Novu sent no code, and the code in force carries the type and name it was sent with, which the account would
        // keep: the changes wait for a code that carries them, or the code in force is entered with the earlier ones.
        const expires = typeof result.expiresInSeconds === 'number' && Number.isFinite(result.expiresInSeconds)
          ? Date.now() + Math.max(result.expiresInSeconds, 0) * 1000 : until
        setUnapplied({ key, challengeId: result.challengeId!, carries, unsent: unsentBecause, until, enterableUntil: expires })
        setError({ text: (unsentBecause === 'limit'
          ? 'We didn’t send a new code, because we’ve sent as many as we can for now, '
          : `We didn’t send a new code, because one was sent to ${details.administratorEmail} less than a minute ago, `)
          + 'so your changes haven’t been applied.' })
      } else {
        setUnsent(outcome === 'sent' ? null : unsentBecause)
        setSubmitted(true)
        setStage('otp')
      }
    } catch (reason) {
      if (first && isHidApiError(reason) && reason.code === 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW') {
        // Another email for a sign-up that is open: only its own email can finish it.
        setError({ text: `This CAC number’s sign-up was started with ${first.administratorEmail}, so it can’t use another `
          + `email yet. Finish it with the code sent to ${first.administratorEmail}, or sign up with the new email 24 hours `
          + 'after the first sign-up started.', support: 'cac-otherwise' })
      } else await refuse(reason, 'start', key)
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  /** "Send a new code": the start again, with the same details and a new security check. */
  async function resend() {
    const details = startDetails()
    if (busy || !turnstileToken || Math.max(resendAt, retryAt) > Date.now()
      || nextCodeAt(sentFor(signUpKey(details)), Date.now())) return
    setBusy(true)
    setError(null)
    setResent(null)
    setUnsent(null)
    try {
      const { outcome } = accepted(await providerEnrollmentApi.start({ ...details, turnstileToken }), details)
      if (outcome === 'sent') setCodeValue('')
      setResent(outcome)
    } catch (reason) {
      await refuse(reason, 'resend', signUpKey(details))
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  async function verify() {
    if (busy || !challengeId || !/^\d{6}$/.test(code)) return
    setBusy(true)
    setError(null)
    try {
      await providerEnrollmentApi.verify(challengeId, code)
    } catch (reason) {
      await refuse(reason, 'verify')
      setBusy(false)
      return
    }
    lastCode.current = null
    // The code is used: a start with changed details now waits only for Identity's own answer.
    setUnapplied(null)
    setCodeValue('')
    setResent(null)
    setUnsent(null)
    activationUncertain.current = false
    // Novu: what the confirmed sign-up registers, so the administrator can check the organization is theirs before
    // the account is made (P4 round 2).
    if (await readRegistering()) setStage('password')
    setBusy(false)
  }

  /**
   * Novu: …/profile. A 404 (an Identity without the route) leaves the CAC number to check, and a fault can be tried
   * again; neither stops the account being made. Returns false when the page has moved on instead: sign-up has
   * closed (423), or the enrollment session is gone (401), as activation would answer.
   */
  async function readRegistering(): Promise<boolean> {
    setRegistering(null)
    setRegisteringFailed(false)
    try {
      setRegistering(registeringOf(await providerEnrollmentApi.profile()))
      return true
    } catch (reason) {
      const status = isHidApiError(reason) ? reason.status : 0
      const code = isHidApiError(reason) ? reason.code : ''
      if ((status === 423 && code === 'PROVIDER_ENROLLMENT_UNAVAILABLE')
        || (status === 401 && code === 'ORGANIZATION_COMPLETION_SESSION_INVALID')) {
        await refuse(reason, 'activate')
        return false
      }
      if (code === 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT') await refuse(reason, 'activate')
      else if (status !== 404) setRegisteringFailed(true)
      return true
    }
  }

  async function readRegisteringAgain() {
    if (busy) return
    setBusy(true)
    setError(null)
    await readRegistering()
    setBusy(false)
  }

  async function activate() {
    if (busy || password.length < 12) return
    setBusy(true)
    setError(null)
    try {
      const activated = await providerEnrollmentApi.activate(password)
      setPassword('')
      // An authenticator challenge instead of a session (hid-system main since #71, ProviderEnrollment.tsx:842-849;
      // Novu's contract never answers it): the account exists, but this browser is not signed in, so nothing is
      // announced and the page never says it is. This flow does not draw today's authenticator steps (main keeps
      // today's page), so it ends where today's Novu page ends when those steps cannot go on (stage 'sign-in',
      // ProviderEnrollment.tsx:1160-1163): Your account may already be ready, and sign in.
      if (activated.status === 'mfa_enrollment_required' || activated.status === 'mfa_required') {
        maybeActive()
        setBusy(false)
        return
      }
      // Novu answers with the session, which the browser now holds: the other tabs are told.
      announceStaffSessionChange()
      // On Novu the administrator is told first where to sign in next time (ProviderEnrollment.tsx:850-854).
      setStage('done'); setBusy(false)
    } catch (reason) {
      await refuse(reason, 'activate')
      setBusy(false)
    }
  }

  /** The workspace reads the session the browser now holds. */
  function openWorkspace() {
    navigate('/provider', { replace: true })
    window.location.reload()
  }

  /** Back to the registration, values kept, at step `step` (today's "Start again"). */
  function startAgain(step = 0) {
    setStage('details'); setCodeValue(''); setChallengeId(''); setError(null); setResent(null); setUnsent(null)
    setRegistering(null); setRegisteringFailed(false)
    setSubmitted(false)
    // An answer that did not say whether it sent a code: a start within resendAfterSeconds of the last code sends none.
    if (!codesReported) holdFor(codeFor, resendAt)
    toStep(step)
  }

  /**
   * "This isn't my organization": the confirmed sign-up is closed (Novu, P4b: …/withdraw, from the enrollment cookie),
   * so a mistyped CAC number no longer holds another company's, and the page goes back to the details, kept, to correct
   * them: to the Regulatory identity step, which holds the CAC number. (ProviderEnrollment.tsx:875-921)
   */
  async function notMine() {
    if (busy) return
    setBusy(true)
    setError(null)
    let outcome: 'withdrawn' | 'kept' | 'fault' = 'kept'
    try {
      await providerEnrollmentApi.withdraw()
      outcome = 'withdrawn'
    } catch (reason) {
      const refusal = refusalOf(reason, 'activate', false, novu)
      if (refusal.kind === 'closed') { setBusy(false); setPassword(''); setAvailability('closed'); return }
      // A browser signed in to Health ID can neither close nor finish the sign-up: it stays at the password step.
      if (refusal.kind === 'message' && isHidApiError(reason) && reason.code === 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT') {
        setBusy(false)
        setError({ text: refusal.text })
        return
      }
      if (refusal.kind === 'unavailable') outcome = 'fault'
    }
    setBusy(false)
    setPassword('')
    if (outcome === 'withdrawn') {
      // The closed sign-up no longer holds its CAC number for its email: another email may sign up for it at once.
      const closedSignUp = cacProductKey(startDetails())
      setFirstStarts(map => {
        if (!map.has(closedSignUp)) return map
        const next = new Map(map)
        next.delete(closedSignUp)
        return next
      })
      setUnapplied(null)
    }
    startAgain(CAC_STEP)
    const check = 'Check your details, and the CAC registration number on your CAC certificate. Correct them, then select '
      + 'Continue. No account has been created.'
    setError(outcome === 'withdrawn'
      ? { text: `${check} We’ve closed that sign-up, so the CAC number you entered is free again.` }
      : { text: `${outcome === 'fault' ? 'We couldn’t close that sign-up just now. ' : ''}${check} For up to 24 hours, `
        + 'nobody else can sign up with the CAC number you entered.', support: 'held' })
  }

  /** Back to the code in force, with the facility type and administrator name it carries (Unapplied). */
  function enterCodeInForce(previous: Unapplied) {
    setName(previous.carries.administratorName)
    setType(previous.carries.organizationType)
    setChallengeId(previous.challengeId)
    setCodeValue(''); setError(null); setResent(null)
    setUnsent(previous.unsent)
    setSubmitted(false)
    setStage('otp')
  }

  /**
   * Novu: the administrator email already has an account, and Identity closed this sign-up (R15). Its CAC number and
   * product no longer hold this email, so the details are kept, with the email emptied, for a new sign-up at once.
   */
  function anotherEmail() {
    const closedSignUp = cacProductKey(startDetails())
    setFirstStarts(map => {
      if (!map.has(closedSignUp)) return map
      const next = new Map(map)
      next.delete(closedSignUp)
      return next
    })
    lastCode.current = null
    setUnapplied(null)
    setHelp(null)
    setPassword('')
    setEmail('')
    startAgain(0)
  }

  /** The email a CAC number and product were first accepted with, back in the form. */
  function firstEmail(first: StartDetails) {
    setEmail(first.administratorEmail)
    setError(null)
  }

  const closed = availability === 'closed'
  const details = startDetails()
  // Changed details that the last start sent no code for (changesHeld): Continue with them waits for a code.
  const carried = stage === 'details' ? changesHeld(details, now) : null
  const retryIn = Math.max(retryFor === signUpKey(details) ? secondsUntil(retryAt, now) : 0,
    carried ? secondsUntil(carried.until, now) : 0)
  const resendIn = secondsUntil(Math.max(resendAt, retryAt), now)
  // How long until a new code past a limit: the page's own count of its codes, or Novu's own long wait.
  const codeLimitIn = secondsUntil(codeLimitAt, now) || (codeLimited ? resendIn : 0)
  // Back at the details of a sign-up Identity accepted, with its email changed (otherEmailThanFirst).
  const kept = stage === 'details' ? otherEmailThanFirst(details) : null
  const productNote = organizationTypeNote(organizationType, ordersOn)
  // The address as Identity has it: the code was sent to it, and the administrator signs in with it.
  const administratorEmail = email.trim().toLowerCase()
  const accountEmail = registering?.administratorEmail ?? administratorEmail
  // The CAC number as Identity has it (spaces removed, capitals), which the organization will be registered under.
  const cacNumber = registering?.registrationNumber ?? cac

  return {
    stage, availability, closed, ordersOn, help, organizationType, productCode, cac, name, email, code, password, busy, error,
    resent, unsent, codesReported, codeInForce, turnstileToken, resetKey, registering, registeringFailed, regStep, submitted,
    headingFocus, carried, retryIn, resendIn, codeLimitIn, kept, productNote, administratorEmail, accountEmail, cacNumber, now,
    setType, setProductCode, setCac, setName, setEmail, setCode, setPassword, setTurnstileToken, setError, setSubmitted,
    toStep, checkAvailabilityAgain, start, resend, verify, readRegisteringAgain, activate, openWorkspace, startAgain, notMine,
    enterCodeInForce, anotherEmail, firstEmail,
  }
}

export type Enrollment = ReturnType<typeof useEnrollment>
