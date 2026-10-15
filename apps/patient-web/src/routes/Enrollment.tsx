import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { isHidApiError, retryAfterSeconds } from '@hid/http'
import { ENROLLMENT_PROFILE_FIELDS, type EnrollmentFacilityRoute, type EnrollmentGender, type EnrollmentOnlineRoute, type EnrollmentProfile,
  type EnrollmentProfileField, type EnrollmentProgress } from '../api'
import { GoogleButton } from '../GoogleButton'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { useSession } from '../session'
import { isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { useActionFocus } from './actionFocus'
import { useResendWait } from './recoveryWait'
import { NinStep } from './enrollment/NinStep'
import { ContactStep } from './enrollment/ContactStep'
import { ContactCodeStep } from './enrollment/ContactCodeStep'
import { DATE_OF_BIRTH_RULE, PasswordStep, plausibleDateOfBirth } from './enrollment/PasswordStep'
import { Complete } from './enrollment/Complete'
import { RegistrationClosed } from './enrollment/RegistrationClosed'
import { routesOf, type OwnershipRoutes } from './enrollment/availability'
import { NIN_CHECK_UNAVAILABLE, STEP_UNAVAILABLE, refusedWith, registrationClosed, temporarilyUnavailable } from './enrollment/problems'
import { ONLINE_NOT_FOR_RECORD, ONLINE_OFF, RouteChoice } from './enrollment/RouteChoice'
import { HolderCodeStep } from './enrollment/HolderCodeStep'
import { FacilityStep } from './enrollment/FacilityStep'
import { AlreadyRegistered, RegistrationEnded } from './enrollment/Outcomes'

/**
 * The stages of a registration. Since hid-system #84 (ADR-062) every start
 * answers `verify_holder`: the patient proves they hold the NIN at `holder`
 * (the choice), `holder_code` (a code texted to the phone on the NIN record)
 * or `facility` (an in-person check, #85, ADR-063) before the contact. An
 * Identity before #84 goes from `nin` to `contact`. `already_registered` and
 * `registration_ended` are endings, with no step shown.
 */
type Stage = 'nin' | 'holder' | 'holder_code' | 'facility' | 'contact' | 'otp' | 'password' | 'complete'
  | 'already_registered' | 'registration_ended'
/** Where a registration waits for its holder proof (its cookie is live). */
const HOLDER_STAGES: readonly Stage[] = ['holder', 'holder_code', 'facility']
/** Where the steps are listed: not at an ending. */
const STEP_STAGES: readonly Stage[] = ['nin', ...HOLDER_STAGES, 'contact', 'otp', 'password', 'complete']
/**
 * Where a Google sign-up is offered (build-flag gated): before a start, or once
 * the NIN holder is proved. While it is being proved a Google account would be
 * bound to a registration nobody has shown is theirs.
 */
const GOOGLE_STAGES: readonly Stage[] = ['nin', 'contact', 'otp', 'password']
const NO_ONLINE: EnrollmentOnlineRoute = { available: false }
const NO_FACILITY: EnrollmentFacilityRoute = { available: false }

/** 422 OTP_INVALID at the holder code: wrong, expired, used, or its five attempts spent. */
const HOLDER_CODE_REFUSED = 'That code is wrong or has expired. Check the latest text message, or ask for a new code.'
/** 429 NIN_HOLDER_ROUTE_LIMITED: a send or failure budget is spent, three codes were sent, or the phone proved five other NINs. */
const HOLDER_LIMITED = 'This NIN can\'t be proved by a text message code now. Use a participating facility to register.'
/** 503 OTP_DELIVERY_UNAVAILABLE: the provider refused the text, which still counts as one of the codes. */
const DELIVERY_FAILED = 'We couldn\'t send the code just now. Try again later, or register at a participating facility. Each try counts toward this registration\'s 3 codes.'
/** 409 NIN_HOLDER_PROOF_CONFLICT: an in-person proof of this NIN is open at a facility. */
const PROOF_AT_FACILITY = 'Registration for this NIN is in progress at a facility. Finish it there: show your desk code to the staff member.'
/** "I have been checked" found the facility route closed (no facility takes part, or the flag is off). */
const FACILITY_CLOSED = 'Registration at a facility is not available now, so no check can be recorded. Try again later, or get a code by text message if you can.'
/** GET .../current at verify_contact after "I have been checked". */
const CHECKED_AT_FACILITY = 'Your identity was checked at the facility. Now add a contact we can send a code to.'
/** The start's 409 IDEMPOTENCY_KEY_REUSED: that registration ended, and only a new key starts again. */
const ATTEMPT_ENDED = 'That registration has ended. Select Continue to start again.'
const resendWaitText = (seconds: number) => `A code was sent recently. You can ask for a new code in ${seconds} seconds.`

/**
 * Identity refuses every enrollment call while the browser holds a sign-in, a
 * provider's included (hid-system patient-enrollment.controller.ts, and the Google
 * exchange for an enrollment): trying again cannot help until it is signed out.
 */
const SIGN_OUT_FIRST = new Set(['PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT', 'GOOGLE_ONBOARDING_REQUIRES_SIGN_OUT'])
const requiresSignOut = (reason: unknown) => isHidApiError(reason) && reason.status === 409 && SIGN_OUT_FIRST.has(reason.code)

/**
 * A registration this page no longer finds answers 404 ENROLLMENT_NOT_FOUND
 * (patient-enrollment.service.ts requireEnrollment): since hid-system #50 every
 * sign-in, refresh and sign-out in this browser expires its cookie, and since
 * #84 and #85 (0093, 0094) it is also removed by a later proof of the same NIN
 * elsewhere, after 409 NIN_ALREADY_REGISTERED, or after 24 hours (Health-id
 * alignment row 10). The start key is kept for as long as this page is: the
 * same key and NIN resume a registration whose cookie alone was lost. A new
 * key is a new registration and a new paid NIN lookup since #84, never a
 * refusal (row 17).
 */
const enrollmentEnded = (reason: unknown) => isHidApiError(reason) && reason.status === 404 && reason.code === 'ENROLLMENT_NOT_FOUND'
const ENDED = 'This registration is no longer open on this device. It may have expired after 24 hours, been replaced by a newer registration for the same NIN, or ended when someone signed in or out in this browser.'
const ENDED_HERE = `${ENDED} Enter your NIN to start again.`
/**
 * 409 ENROLLMENT_HOLDER_PROOF_REQUIRED at activation (hid-system #84, ADR-062):
 * the database finds no valid holder proof, for example after the facility
 * stopped taking part. The kept key would only resume that registration, so it
 * is dropped and the patient starts again at the NIN step (row 9).
 */
const HOLDER_PROOF_REQUIRED = 'We could not confirm that this NIN is yours, so this registration can\'t be finished. Start again with your NIN, and prove it with a code or at a participating facility.'
const ENDS_ENROLLMENT = 'Signing out also ends an enrollment in progress on this device; continue it by entering the same NIN before reloading this page.'
/**
 * Whether a new enrollment may start (hid-system#68, FE-4): only `200 { open: true }`
 * from the availability read says so, and a read that failed is said as such. Only
 * the start is refused while registration is closed, a start with the same key
 * included, so an enrollment in progress continues whatever it says, and one that
 * ended here is told to enter its NIN again only once a read finds it open.
 * Until then, while the read has failed, Try again stands in for the NIN step,
 * focus included. Since hid-system #84 (ADR-062) the answer also names the
 * routes that prove the NIN holder, `{ open, online, facility }`, and `open`
 * stays the only gate (Health-id alignment row 14); with no route on, every
 * start answers 503 PATIENT_REGISTRATION_NOT_OPEN. The notice is Identity's own
 * wording for that 503.
 */
type Registration = 'open' | 'closed' | 'unknown'
/**
 * A contact proved more than 30 minutes before activation is proved again
 * (hid-system#68, N2(c), ADR-048): activation answers 409 and has already sent
 * the enrollment back to the contact step without its contact, so the page goes
 * there too. At the password step a second try would only be refused.
 */
const contactReverifyRequired = (reason: unknown) => isHidApiError(reason) && reason.status === 409
  && reason.code === 'ENROLLMENT_CONTACT_REVERIFY_REQUIRED'
const REVERIFY_CONTACT = 'Your contact was verified more than 30 minutes ago, so it must be verified again before activation. Send a new code, enter it, then choose your password.'
const REVERIFY_CODE_SENT = 'Your contact was verified more than 30 minutes ago, so it must be verified again before activation. Enter the new code sent to it, then choose your password.'
/**
 * That return seen without its 409, which was lost or answered another tab's
 * activation: any further activation is refused as not at the password step
 * (409 ENROLLMENT_STAGE_INVALID), so the enrollment's stage is read again and
 * the page goes where Identity has it.
 */
const notAtPasswordStep = (reason: unknown) => isHidApiError(reason) && reason.status === 409
  && reason.code === 'ENROLLMENT_STAGE_INVALID'
/**
 * A NIN record without a date of birth or gender (hid-system ADR-061, on main
 * since #82): activation refuses a field the record lacks and was not sent, and
 * one it gives that was. Both mean the page's list of fields is out of date, so
 * it is read again; a date outside 1900 to today is refused at its field.
 */
const profileRefusal = (reason: unknown, code: 'ENROLLMENT_PROFILE_REQUIRED' | 'ENROLLMENT_PROFILE_FIELD_VERIFIED' | 'DATE_OF_BIRTH_INVALID') =>
  isHidApiError(reason) && reason.status === 400 && reason.code === code
/** The fields a progress answer names, in Identity's order; none from an Identity before ADR-061. */
const profileFieldsOf = (fields: unknown): EnrollmentProfileField[] | null =>
  Array.isArray(fields) ? ENROLLMENT_PROFILE_FIELDS.filter(field => fields.includes(field)) : null

export function Enrollment() {
  const { state, api, acceptGoogleSession, otherPortalSession, retrySessionCheck } = useSession()
  const navigate = useNavigate()
  useDocumentTitle('Get your Health ID · Health ID')
  const stepFocus = useStepFocus()
  const [stage, setStage] = useState<Stage>('nin')
  const [nin, setNin] = useState('')
  const [channel, setChannel] = useState<'phone' | 'email'>('phone')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  // What the NIN record lacks (ADR-061), and what the patient entered for it: memory only.
  const [profileFields, setProfileFields] = useState<EnrollmentProfileField[]>([])
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState<EnrollmentGender | ''>('')
  const [profileError, setProfileError] = useState<EnrollmentProfileField | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [hidCode, setHidCode] = useState('')
  const [maskedContact, setMaskedContact] = useState('')
  const [googleRequired, setGoogleRequired] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [googleTurnstileToken, setGoogleTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [googleResetKey, setGoogleResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState(false)
  const [checkKey, setCheckKey] = useState(0)
  const [registration, setRegistration] = useState<Registration>('unknown')
  // The routes the last availability read named; null from an Identity before the holder step.
  const [routes, setRoutes] = useState<OwnershipRoutes | null>(null)
  const [signOutRequired, setSignOutRequired] = useState(false)
  // Focus moves to the note when a check the person asked for, or a step, finds
  // the sign-in: it is read there, and its message is an alert only otherwise, so
  // it is not read twice (as errorAlert below).
  const [signOutAlert, setSignOutAlert] = useState(true)
  const signOutNote = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState(false)
  // An error about the field is spoken by its description once focus moves there,
  // and is an alert only when focus is already in the field (Enter) or it is not
  // about the field.
  const [errorAlert, setErrorAlert] = useState(true)
  // What a refusal at the code or password step may mean, said under that step.
  const [stepHint, setStepHint] = useState<'code' | 'activation' | null>(null)
  // A step done that is not an error, said once (role status): the facility's check recorded.
  const [notice, setNotice] = useState<string | null>(null)
  // The holder step (ADR-062, ADR-063): what Identity last said of each route, in page state only.
  const [online, setOnline] = useState<EnrollmentOnlineRoute>(NO_ONLINE)
  const [facility, setFacility] = useState<EnrollmentFacilityRoute>(NO_FACILITY)
  // Why the online route cannot help this registration now, as Identity said (409, 429 or 503).
  const [onlineRefusal, setOnlineRefusal] = useState<string | null>(null)
  const [holderChallenge, setHolderChallenge] = useState<string | null>(null)
  const [holderExpiresIn, setHolderExpiresIn] = useState<number | null>(null)
  const [holderCodeError, setHolderCodeError] = useState(false)
  const [notRecordedYet, setNotRecordedYet] = useState(false)
  // Identity has the holder step: the availability read named its routes, or a progress was at verify_holder.
  const [holderSeen, setHolderSeen] = useState(false)
  // The reference Health ID support asks for after 409 NIN_ALREADY_REGISTERED (the problem's correlationId).
  const [reference, setReference] = useState<string | null>(null)
  const resend = useResendWait()
  const [resendWaitSeconds, setResendWaitSeconds] = useState(0)
  const startKey = useRef<{ nin: string; key: string } | null>(null)
  // 'Try again' and 'Check again' are replaced while the check runs: focus then
  // goes to the step's field, or to what replaced them when the check finds
  // the same again (PR-04).
  const retriedCheck = useRef(false)
  const checkRetry = useRef<HTMLButtonElement>(null)
  // The availability read's Try again is also the NIN step's focus target (above).
  const retryInPlaceOfNin = useCallback((element: HTMLButtonElement | null) => {
    checkRetry.current = element
    stepFocus.target(element)
  }, [stepFocus.target])
  const focusAfter = useActionFocus()
  // The step shown, for the check, which runs apart from any one render.
  const stageShown = useRef<Stage>(stage)
  useEffect(() => { stageShown.current = stage }, [stage])

  // Back to the NIN step, the enrollment's challenge and contact gone with it.
  const forgetProfile = () => { setProfileFields([]); setDateOfBirth(''); setGender(''); setProfileError(null) }
  const forgetHolder = () => {
    setOnline(NO_ONLINE); setFacility(NO_FACILITY); setOnlineRefusal(null); setHolderChallenge(null); setHolderExpiresIn(null)
    setHolderCodeError(false); setNotRecordedYet(false); resend.reset()
  }
  const restartAtNin = () => {
    setStage('nin'); setChallengeId(null); setMaskedContact(''); setCode(''); setPassword(''); setStepHint(null); forgetProfile(); forgetHolder()
    setNotice(null); setError(ENDED_HERE); setFieldError(false); setErrorAlert(true)
  }
  /** Back to the NIN step with a new key: the next start is a new registration (and a new NIN lookup). */
  const freshStart = () => {
    startKey.current = null
    // Nothing typed for the last registration is carried into the next, which may be someone else's on a shared phone.
    setStage('nin'); setNin(''); setCode(''); setChallengeId(null); setMaskedContact(''); setPassword(''); setStepHint(null)
    setContact(''); setChannel('phone'); setReference(null)
    forgetProfile(); forgetHolder(); setNotice(null)
  }
  /** GET .../current answered 404 after a desk check (P31): the staff member's direction, not the same NIN again. */
  const endAfterFacility = () => {
    freshStart(); setStage('registration_ended'); setError(null); setFieldError(false); setErrorAlert(true)
  }
  // The wait before a new holder code, said in seconds until it has passed.
  const beginResendWait = (seconds: unknown) => {
    resend.begin(seconds)
    setResendWaitSeconds(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0)
  }

  const applyProgress = (progress: EnrollmentProgress) => {
    setGoogleRequired(progress.googleOnboardingRequired === true)
    const fields = profileFieldsOf(progress.requiredProfileFields)
    if (fields) setProfileFields(fields)
    if (progress.stage === 'verify_holder') {
      // Nothing is verified as the patient's until Identity says so: the patient proves the NIN first.
      const onlineNow = progress.online ?? NO_ONLINE
      const facilityNow = progress.facility ?? NO_FACILITY
      // A refusal of the online route (a spent budget, say) stays said: availability does not reflect it.
      setHolderSeen(true); setOnline(onlineNow); setFacility(facilityNow)
      if (onlineNow.challengeId) {
        setHolderChallenge(onlineNow.challengeId)
        setHolderExpiresIn(typeof onlineNow.expiresInSeconds === 'number' ? onlineNow.expiresInSeconds : null)
        beginResendWait(onlineNow.resendAfterSeconds)
      }
      // The route the patient is on stays shown while it still applies; after a reload, a desk code, then an open code.
      const shown = stageShown.current
      setStage(shown === 'facility' && facilityNow.available ? 'facility'
        : shown === 'holder' ? 'holder'
          : shown === 'holder_code' && onlineNow.challengeId ? 'holder_code'
            : facilityNow.deskCode ? 'facility' : onlineNow.challengeId ? 'holder_code' : 'holder')
      return
    }
    if (HOLDER_STAGES.includes(stageShown.current)) forgetHolder()
    setMaskedContact(progress.maskedContact ?? '')
    setChallengeId(progress.challengeId ?? null)
    if (progress.stage === 'active') { setHidCode(progress.hidCode ?? ''); setStage('complete') }
    else if (progress.stage === 'set_password') setStage('password')
    else setStage(progress.challengeId ? 'otp' : 'contact')
  }

  useEffect(() => {
    let active = true
    setChecking(true)
    setCheckError(false)
    setSignOutRequired(false)
    void Promise.allSettled([api.enrollmentCurrent(), api.googleOnboarding(), api.enrollmentAvailability()]).then(([progress, google, availability]) => {
      if (!active) return
      const registrationNow: Registration = availability.status === 'rejected' ? 'unknown'
        : availability.value?.open === true ? 'open' : 'closed'
      setRegistration(registrationNow)
      setRoutes(availability.status === 'fulfilled' ? routesOf(availability.value) : null)
      // The enrollment's own progress must be known before starting, as must
      // availability before a new one (below). A failed check for a pending
      // Google sign-up (for example a browser that sends no Referer, which that
      // check needs when no Origin is sent) counts as none pending: an
      // enrollment that requires Google still says so.
      const unavailable = progress.status === 'rejected'
        && (!isHidApiError(progress.reason) || ![401, 404].includes(progress.reason.status))
      const retried = retriedCheck.current
      retriedCheck.current = false
      if (progress.status === 'rejected' && requiresSignOut(progress.reason)) {
        setSignOutRequired(true)
        setSignOutAlert(!retried)
        setChecking(false)
        if (retried) focusAfter(() => signOutNote.current)
        return
      }
      if (unavailable) {
        setCheckError(true)
        setChecking(false)
        if (retried) focusAfter(() => checkRetry.current)
        return
      }
      // An enrollment this page had reached a step of is gone: it ended here.
      const ended = progress.status === 'rejected' && enrollmentEnded(progress.reason)
        && [...HOLDER_STAGES, 'contact', 'otp', 'password'].includes(stageShown.current)
      if (progress.status === 'fulfilled') applyProgress(progress.value)
      // After a desk check, follow the staff member's direction rather than ask for the same NIN (P31).
      else if (ended && stageShown.current === 'facility') endAfterFacility()
      else if (ended) restartAtNin()
      if (availability.status === 'fulfilled' && routesOf(availability.value)) setHolderSeen(true)
      if (google.status === 'fulfilled' && new Date(google.value.expiresAt).getTime() > Date.now()) setGooglePending(true)
      setChecking(false)
      // At the NIN step, a failed availability read is offered Try again in place of the step.
      const atNin = progress.status === 'rejected' && (ended || stageShown.current === 'nin')
      if (retried && atNin && registrationNow === 'unknown') focusAfter(() => checkRetry.current)
      else if (retried) stepFocus.focus()
    })
    return () => { active = false }
  }, [api, checkKey, focusAfter, stepFocus.focus])

  if (state.status === 'authenticated') return <Navigate to="/" replace />

  const displayError = (reason: unknown, fromField = false, stepCodes: readonly string[] = []) => {
    if (enrollmentEnded(reason)) return restartAtNin()
    if (requiresSignOut(reason)) {
      setSignOutRequired(true); setSignOutAlert(false); setError(null); setFieldError(false)
      focusAfter(() => signOutNote.current)
      return
    }
    const aboutField = isFieldProblem(reason, stepCodes)
    setError(isHidApiError(reason) ? reason.message : 'We could not complete that step. Please try again.')
    setFieldError(aboutField)
    setErrorAlert(!aboutField || fromField)
  }
  const clearError = () => { setError(null); setFieldError(false); setErrorAlert(true); setNotice(null); setHolderCodeError(false); setNotRecordedYet(false) }
  /** An error that is not about a field, read as an alert. */
  const sayError = (message: string) => { setError(message); setFieldError(false); setErrorAlert(true) }

  /**
   * 409 NIN_ALREADY_REGISTERED, said only after a holder proof (ADR-062): the
   * registration is gone. Account recovery, sign-in and support with the
   * reference; nothing typed for it is kept, and the start key is dropped
   * (Health-id alignment row 8).
   */
  const showAlreadyRegistered = (reason: unknown) => {
    freshStart(); setStage('already_registered')
    setReference(isHidApiError(reason) ? reason.requestId : null)
    setGoogleRequired(false); setGooglePending(false); clearError()
  }

  /**
   * A refusal on the holder step (hid-system #84, ADR-062; "The NIN holder
   * step" in INTERFACE_CONTRACT.md). Where the online route cannot help, the
   * choice says why and offers the facility; an outage keeps the step as it is
   * and never signs anyone out.
   */
  const holderRefusal = async (reason: unknown, fromField = false): Promise<void> => {
    // After a desk check a registration that is gone follows the staff member's direction (P31).
    if (enrollmentEnded(reason) && stageShown.current === 'facility') return endAfterFacility()
    if (requiresSignOut(reason) || enrollmentEnded(reason)) return displayError(reason)
    if (refusedWith(reason, 409, 'NIN_ALREADY_REGISTERED')) return showAlreadyRegistered(reason)
    if (refusedWith(reason, 422, 'OTP_INVALID')) {
      setHolderCodeError(true); setError(HOLDER_CODE_REFUSED); setFieldError(true); setErrorAlert(fromField)
      return
    }
    if (refusedWith(reason, 429, 'OTP_RESEND_COOLDOWN')) {
      // Identity names the wait in the progress (online.resendAfterSeconds); a gateway may say it in Retry-After.
      // The code another tab asked for is read too, so it can be entered here.
      let seconds = retryAfterSeconds(reason)
      try {
        const progress = await api.enrollmentCurrent()
        applyProgress(progress)
        // Proved in another tab meanwhile: the page goes on, and no wait applies.
        if (progress.stage !== 'verify_holder') return
        if (progress.online?.challengeId) setStage('holder_code')
        seconds ??= typeof progress.online?.resendAfterSeconds === 'number' ? progress.online.resendAfterSeconds : null
      } catch (again) {
        if (enrollmentEnded(again) || requiresSignOut(again)) return holderRefusal(again)
      }
      const wait = Math.max(1, Math.ceil(seconds ?? 60))
      beginResendWait(wait); sayError(resendWaitText(wait))
      return
    }
    if (refusedWith(reason, 409, 'NIN_HOLDER_ROUTE_UNAVAILABLE') || refusedWith(reason, 503, 'NIN_HOLDER_ROUTE_UNAVAILABLE')
      || refusedWith(reason, 429, 'NIN_HOLDER_ROUTE_LIMITED')) {
      // The 409 also answers a registration past the holder step (another tab): Identity's stage is read again.
      if (refusedWith(reason, 409, 'NIN_HOLDER_ROUTE_UNAVAILABLE')) {
        try {
          const progress = await api.enrollmentCurrent()
          if (progress.stage !== 'verify_holder') { applyProgress(progress); return }
        } catch (again) {
          // A registration that is gone is said as such; an outage leaves the refusal to be said below.
          if (enrollmentEnded(again) || requiresSignOut(again)) return holderRefusal(again)
        }
      }
      const text = refusedWith(reason, 429, 'NIN_HOLDER_ROUTE_LIMITED') ? HOLDER_LIMITED : (reason as Error).message
      setOnlineRefusal(text); setHolderChallenge(null); setCode(''); setStage('holder'); sayError(text)
      return
    }
    if (refusedWith(reason, 503, 'OTP_DELIVERY_UNAVAILABLE')) { setStage('holder'); sayError(DELIVERY_FAILED); return }
    if (refusedWith(reason, 409, 'NIN_HOLDER_PROOF_CONFLICT')) { setCode(''); setStage('facility'); sayError(PROOF_AT_FACILITY); return }
    if (temporarilyUnavailable(reason)) return sayError(STEP_UNAVAILABLE)
    displayError(reason, fromField)
  }

  /** Texts a code, or a new one, to the phone on the NIN record (POST .../holder, no body). */
  const sendHolderCode = async () => {
    if (busy) return
    setBusy(true); clearError()
    try {
      const sent = await api.enrollmentHolderCode()
      setHolderChallenge(sent.challengeId)
      setHolderExpiresIn(typeof sent.expiresInSeconds === 'number' ? sent.expiresInSeconds : null)
      beginResendWait(sent.resendAfterSeconds)
      setCode(''); setStage('holder_code')
    } catch (reason) { await holderRefusal(reason) }
    finally { setBusy(false); stepFocus.focus() }
  }

  const submitHolderCode = async (event: FormEvent) => {
    event.preventDefault()
    // Sent with Enter in the code field: a refusal about the code is read there, not also as an alert.
    const form = event.currentTarget
    const fromField = form instanceof HTMLFormElement && document.activeElement instanceof HTMLInputElement && form.contains(document.activeElement)
    if (busy || !holderChallenge || !/^\d{6}$/.test(code)) return
    setBusy(true); clearError()
    try {
      const proved = await api.enrollmentHolderVerify(holderChallenge, code)
      const fields = profileFieldsOf(proved?.requiredProfileFields)
      if (fields) setProfileFields(fields)
      setCode(''); forgetHolder(); setStage('contact')
    } catch (reason) { await holderRefusal(reason, fromField) }
    finally { setBusy(false); stepFocus.focus() }
  }

  /** The desk code this device shows at the facility (POST .../facility-code): only when asked. */
  const getDeskCode = async () => {
    if (busy) return
    setBusy(true); clearError()
    try { applyProgress(await api.enrollmentFacilityCode()) }
    catch (reason) {
      if (refusedWith(reason, 409, 'ASSISTED_REGISTRATION_UNAVAILABLE')) {
        sayError(`${(reason as Error).message} ${online.available && !onlineRefusal ? 'You can get a code by text message instead, or try again later.' : 'Try again later.'}`)
      } else if (refusedWith(reason, 429, 'ASSISTED_DESK_CODE_LIMITED')) sayError((reason as Error).message)
      else if (refusedWith(reason, 409, 'ENROLLMENT_STAGE_INVALID')) {
        // The holder step is done (another tab, or the check): go where Identity has the registration.
        try { applyProgress(await api.enrollmentCurrent()) } catch (again) { await holderRefusal(again) }
      } else await holderRefusal(reason)
    }
    finally { setBusy(false); stepFocus.focus() }
  }

  /** "I have been checked": GET .../current says whether the facility recorded the check (ADR-063). */
  const checkedAtFacility = async () => {
    if (busy) return
    setBusy(true); clearError()
    try {
      const progress = await api.enrollmentCurrent()
      applyProgress(progress)
      if (progress.stage === 'verify_holder') {
        // The facility route closed meanwhile: applyProgress has left the facility stage, so say why.
        if (progress.facility?.available) setNotRecordedYet(true)
        else sayError(FACILITY_CLOSED)
      } else if (progress.stage === 'verify_contact') setNotice(CHECKED_AT_FACILITY)
    } catch (reason) {
      if (enrollmentEnded(reason)) endAfterFacility()
      else await holderRefusal(reason)
    }
    finally { setBusy(false); stepFocus.focus() }
  }

  /** "Use a different NIN" or "Start again": the next start is a new registration, with a new key. */
  const startAgain = () => {
    if (busy) return
    freshStart(); clearError(); stepFocus.focus()
  }

  const submitNin = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = stepFocus.onTarget()
    if (!/^\d{11}$/.test(nin) || !turnstileToken || busy) return
    if (googleRequired && !googlePending) { setError('Reconnect Google before continuing.'); setFieldError(false); return }
    setBusy(true); clearError()
    if (startKey.current?.nin !== nin) startKey.current = { nin, key: crypto.randomUUID() }
    try {
      const progress = await api.enrollmentStart(nin, turnstileToken, startKey.current.key)
      applyProgress(progress)
      setNin('')
    } catch (reason) {
      if (registrationClosed(reason)) {
        // As an availability read would now say: the closed notice, and no NIN step.
        setNin(''); setRegistration('closed')
      } else if (refusedWith(reason, 409, 'IDEMPOTENCY_KEY_REUSED')) {
        // The registration this key started was activated meanwhile (another tab): only a new key starts again.
        startKey.current = null
        sayError(ATTEMPT_ENDED)
      } else if (temporarilyUnavailable(reason)) {
        // Identity's own text for a lookup it could not complete, said for any outage: the step is kept.
        setError(NIN_CHECK_UNAVAILABLE); setFieldError(false); setErrorAlert(true)
      } else displayError(reason, fromField)
    }
    finally { setTurnstileToken(null); setResetKey(value => value + 1); setBusy(false); stepFocus.focus() }
  }

  const submitContact = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = stepFocus.onTarget()
    if (busy || !contact.trim()) return
    setBusy(true); clearError()
    try {
      const result = await api.enrollmentContact(channel, contact.trim())
      setChallengeId(result.challengeId)
      setMaskedContact(contact.trim())
      // Kept, so 'Request another code' comes back to it filled in (PA-10).
      setStage('otp')
    } catch (reason) { displayError(reason, fromField, ['CONTACT_ALREADY_REGISTERED']) }
    finally { setBusy(false); stepFocus.focus() }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = stepFocus.onTarget()
    if (busy || !challengeId || !/^\d{6}$/.test(code)) return
    setBusy(true); clearError()
    try {
      const result = await api.enrollmentVerify(challengeId, code)
      const fields = profileFieldsOf(result?.requiredProfileFields)
      if (fields) setProfileFields(fields)
      setCode(''); setStepHint(null); setStage('password')
    }
    catch (reason) {
      if (isHidApiError(reason) && reason.code === 'OTP_INVALID') setStepHint('code')
      displayError(reason, fromField)
    }
    finally { setBusy(false); stepFocus.focus() }
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = stepFocus.onTarget()
    const missing = profileFields.some(field => field === 'dateOfBirth' ? dateOfBirth === '' : gender === '')
    if (busy || password.length < 12 || missing) return
    if (googleRequired && !googlePending) { setError('Reconnect Google before activation.'); setFieldError(false); return }
    if (profileFields.includes('dateOfBirth') && !plausibleDateOfBirth(dateOfBirth)) {
      setProfileError('dateOfBirth'); setError(DATE_OF_BIRTH_RULE); setFieldError(true); setErrorAlert(fromField); stepFocus.focus()
      return
    }
    // Only the fields the record lacks are sent: Identity refuses one it gives.
    const profile: EnrollmentProfile = {
      ...(profileFields.includes('dateOfBirth') ? { dateOfBirth } : {}),
      ...(profileFields.includes('gender') && gender !== '' ? { gender } : {}),
    }
    setBusy(true); clearError(); setProfileError(null)
    try {
      const result = await api.enrollmentActivate(password, profile)
      setPassword(''); forgetProfile()
      setHidCode(result.hidCode)
      setStepHint(null)
      setStage('complete')
    } catch (reason) {
      // The NIN was bound since the holder proof (row 8), or the proof is no longer valid (row 9).
      if (refusedWith(reason, 409, 'NIN_ALREADY_REGISTERED')) { showAlreadyRegistered(reason); return }
      if (refusedWith(reason, 409, 'ENROLLMENT_HOLDER_PROOF_REQUIRED')) { freshStart(); sayError(HOLDER_PROOF_REQUIRED); return }
      if (contactReverifyRequired(reason)) {
        // The contact typed on this page is kept, so a new code goes to it with one press (PA-10).
        setStage('contact'); setChallengeId(null); setMaskedContact(''); setCode(''); setPassword(''); setStepHint(null)
        setError(REVERIFY_CONTACT); setFieldError(false); setErrorAlert(true)
        return
      }
      if (profileRefusal(reason, 'DATE_OF_BIRTH_INVALID') && profileFields.includes('dateOfBirth')) {
        setProfileError('dateOfBirth'); setError((reason as Error).message); setFieldError(true); setErrorAlert(fromField)
        return
      }
      if (profileRefusal(reason, 'ENROLLMENT_PROFILE_REQUIRED') || profileRefusal(reason, 'ENROLLMENT_PROFILE_FIELD_VERIFIED')) {
        // The fields are read again; the refusal is said at the first one still missing, or as an alert.
        let fields = profileFields
        try { fields = profileFieldsOf((await api.enrollmentCurrent()).requiredProfileFields) ?? fields } catch { /* the refusal is shown */ }
        setProfileFields(fields)
        const unsent = profileRefusal(reason, 'ENROLLMENT_PROFILE_REQUIRED')
          ? fields.find(field => !(field in profile)) ?? null : null
        setProfileError(unsent); setError((reason as Error).message); setFieldError(unsent !== null)
        setErrorAlert(unsent === null || fromField)
        return
      }
      if (notAtPasswordStep(reason)) {
        let progress: EnrollmentProgress
        try { progress = await api.enrollmentCurrent() } catch (again) { displayError(again); return }
        // Still at the password step, the refusal is about something else and is shown below.
        if (progress.stage !== 'set_password') {
          applyProgress(progress); setCode(''); setPassword(''); setStepHint(null)
          if (progress.stage === 'verify_contact') {
            setError(progress.challengeId ? REVERIFY_CODE_SENT : REVERIFY_CONTACT); setFieldError(false); setErrorAlert(true)
          }
          return
        }
      }
      if (isHidApiError(reason) && reason.status === 429) setStepHint('activation')
      displayError(reason, fromField)
    }
    finally { setBusy(false); stepFocus.focus() }
  }

  const onGoogle = async (idToken: string) => {
    if (!googleTurnstileToken) return
    setBusy(true); clearError()
    try {
      const result = await api.googleExchange(idToken, googleTurnstileToken, 'enroll')
      if ('actor' in result) { acceptGoogleSession(result); navigate('/', { replace: true }); return }
      setGooglePending(true)
      // Binding answers only that it bound; the enrollment's own progress is read
      // again, so a patient already past the contact step is not sent back to it.
      if (stage !== 'nin') { await api.enrollmentBindGoogle(); applyProgress(await api.enrollmentCurrent()) }
    } catch (reason) { displayError(reason); setFieldError(false); setErrorAlert(true) }
    finally { setGoogleTurnstileToken(null); setGoogleResetKey(value => value + 1); setBusy(false); stepFocus.focus() }
  }

  // No step is offered while the check runs, after it failed, or while a sign-in blocks enrollment.
  const ready = !checking && !checkError && !signOutRequired
  // A new enrollment is offered only while registration is open; one in progress continues.
  const startOffered = GOOGLE_STAGES.includes(stage) && (stage !== 'nin' || registration === 'open')
  const closed = ready && stage === 'nin' && registration === 'closed'
  // The holder step is listed only where Identity has it.
  const steps: Array<[string, readonly Stage[]]> = [['NIN', ['nin']],
    ...(holderSeen ? [['Prove it\'s yours', HOLDER_STAGES] as [string, readonly Stage[]]] : []),
    ['Contact', ['contact']], ['Code', ['otp']], ['Activate', ['password']]]
  const onlineOpen = online.available && onlineRefusal === null
  const onlineNote = onlineRefusal ?? (routes?.online === false ? ONLINE_OFF : ONLINE_NOT_FOR_RECORD)
  // The error is about the stage's field when the server refused its value.
  const invalid = fieldError ? true as const : undefined
  const errorId = fieldError ? 'enroll-error' : undefined
  const stepProps = { focusTarget: stepFocus.target, busy, invalid, errorId }

  return <main className="patient-auth-page">
    <section className="patient-auth-card patient-enroll-card" aria-labelledby="enroll-title">
      <Link to="/" className="patient-auth-brand"><BrandLogo /></Link>
      <p className="patient-eyebrow">Patient enrollment</p>
      <h1 id="enroll-title" className="patient-page-title">Get your Health ID.</h1>
      <p className="patient-page-copy">Verify your identity, confirm a contact, and activate your account.</p>
      {!closed && STEP_STAGES.includes(stage) && <ol className="patient-step-list" aria-label="Enrollment steps">
        {steps.map(([label, stages]) => <li key={label} aria-current={stages.includes(stage) ? 'step' : undefined}>{label}</li>)}
      </ol>}
      {checking ? <p role="status">Checking for an enrollment in progress…</p> : null}
      {checkError && <div className="patient-inline-error" role="alert"><p>We could not check for an enrollment in progress. Try again before starting.</p><button ref={checkRetry} type="button" className="patient-secondary-button" onClick={() => { retriedCheck.current = true; setCheckKey(value => value + 1) }}>Try again</button></div>}
      {signOutRequired && <div ref={signOutNote} tabIndex={-1} role="group" aria-labelledby="enroll-sign-out" className="patient-inline-error patient-session-note">
        {otherPortalSession ? <>
          <p id="enroll-sign-out" role={signOutAlert ? 'alert' : undefined}>A provider sign-in is active in this browser. Sign out of the provider portal before starting a new Health ID.</p>
          <p>{ENDS_ENROLLMENT}</p>
          <Link to="/provider">Go to the provider portal</Link>
        </> : <>
          <p id="enroll-sign-out" role={signOutAlert ? 'alert' : undefined}>This browser is still signed in to Health ID. Sign out of the patient or provider portal before starting a new Health ID.</p>
          {/* No link to the patient portal: this tab has no patient session, so it would open sign-in. Check again opens it once the session check finds the patient. */}
          <p>If a patient is signed in, Check again opens the patient portal, where you can sign out.</p>
          <p>{ENDS_ENROLLMENT}</p>
          <Link to="/provider">Go to the provider portal</Link>
        </>}
        {/* Once it is signed out elsewhere, as asked, the browser's session and the enrollment are checked again. */}
        <button type="button" className="patient-secondary-button" onClick={() => { retriedCheck.current = true; retrySessionCheck(); setCheckKey(value => value + 1) }}>Check again</button>
      </div>}
      {error && <p id="enroll-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error === ENDED_HERE && registration !== 'open' ? ENDED : error}</p>}
      {notice && <p role="status" className="patient-inline-success">{notice}</p>}
      {/* Not at a NIN step that offers no start, where Google is not offered either. */}
      {googleRequired && !googlePending && startOffered && <p role="status" className="patient-inline-error">Reconnect the Google account used to start this enrollment.</p>}
      {ready && stage === 'nin' && registration === 'unknown' && <div className="patient-inline-error" role="alert"><p>We could not check whether new Health ID registration is open. Try again before starting.</p><button ref={retryInPlaceOfNin} type="button" className="patient-secondary-button" onClick={() => { retriedCheck.current = true; setCheckKey(value => value + 1) }}>Try again</button></div>}
      {closed && <RegistrationClosed focusTarget={stepFocus.target} />}
      {ready && stage === 'nin' && registration === 'open' && <NinStep {...stepProps} nin={nin} onNin={setNin} onSubmit={event => void submitNin(event)}
        turnstile={<Turnstile action="patient-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />}
        blocked={!turnstileToken || (googleRequired && !googlePending)} routes={routes} />}
      {ready && stage === 'holder' && <RouteChoice focusTarget={stepFocus.target} busy={busy} online={onlineOpen} onlineNote={onlineNote}
        facility={facility.available} onSend={() => void sendHolderCode()} onFacility={() => { clearError(); setStage('facility'); stepFocus.focus() }}
        onDifferentNin={startAgain} />}
      {ready && stage === 'holder_code' && <HolderCodeStep focusTarget={stepFocus.target} busy={busy} codeError={holderCodeError && fieldError}
        errorId={errorId} expiresInSeconds={holderExpiresIn} code={code} onCode={setCode} onSubmit={event => void submitHolderCode(event)}
        resendReady={resend.ready} resendWaitSeconds={resendWaitSeconds} onResend={() => void sendHolderCode()}
        onOtherWay={() => { clearError(); setCode(''); setStage('holder'); stepFocus.focus() }} onDifferentNin={startAgain} />}
      {ready && stage === 'facility' && <FacilityStep focusTarget={stepFocus.target} api={api} busy={busy} deskCode={facility.deskCode ?? null}
        deskCodeExpiresAt={facility.deskCodeExpiresAt ?? null} notRecordedYet={notRecordedYet} online={onlineOpen}
        onGetCode={() => void getDeskCode()} onChecked={() => void checkedAtFacility()}
        onOnline={() => { clearError(); setStage('holder'); stepFocus.focus() }} onDifferentNin={startAgain} />}
      {ready && stage === 'already_registered' && <AlreadyRegistered focusTarget={stepFocus.target} reference={reference} />}
      {ready && stage === 'registration_ended' && <RegistrationEnded focusTarget={stepFocus.target} onStartAgain={startAgain} />}
      {ready && stage === 'contact' && <ContactStep {...stepProps} channel={channel} onChannel={setChannel} contact={contact} onContact={setContact}
        onSubmit={event => void submitContact(event)} />}
      {ready && stage === 'otp' && <ContactCodeStep {...stepProps} maskedContact={maskedContact} code={code} onCode={setCode} onSubmit={event => void submitCode(event)}
        onAnotherCode={() => { setCode(''); setChallengeId(null); setStepHint(null); clearError(); setStage('contact'); stepFocus.focus() }}
        budgetNote={stepHint === 'code'} />}
      {ready && stage === 'password' && <PasswordStep {...stepProps} password={password} onPassword={setPassword} onSubmit={event => void submitPassword(event)}
        blocked={googleRequired && !googlePending} limitNote={stepHint === 'activation'}
        profileFields={profileFields} dateOfBirth={dateOfBirth} onDateOfBirth={setDateOfBirth} gender={gender} onGender={setGender}
        errorField={fieldError ? profileError ?? 'password' : null} />}
      {ready && stage === 'complete' && <Complete focusTarget={stepFocus.target} hidCode={hidCode} />}
      {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && ready && startOffered && stage !== 'complete' && !googlePending && <section className="patient-auth-separator" aria-label="Google enrollment">
        <span>{googleRequired ? 'Reconnect Google' : 'Continue with Google'}</span>
        <Turnstile action="patient-login" onTokenChange={setGoogleTurnstileToken} resetKey={googleResetKey} />
        <GoogleButton text="signup_with" disabled={busy || !googleTurnstileToken} onCredential={onGoogle}
          disabledReason={googleTurnstileToken ? undefined : 'Complete the security check to continue with Google.'} />
      </section>}
      {googlePending && !checkError && startOffered && stage !== 'complete' && <p role="status" className="patient-field-hint">Google identity confirmed for this enrollment.</p>}
      <p className="patient-auth-footer">Already have a Health ID? <Link to="/sign-in">Sign in</Link></p>
    </section>
  </main>
}
