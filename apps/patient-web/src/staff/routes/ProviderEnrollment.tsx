import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Field, Input, PasswordInput, Select } from '@hid/ui'
import './providerSetup.css'
import { AuthLayout } from '../../AuthLayout'
import { useDocumentTitle } from '../../authSteps'
import { Turnstile } from '../../Turnstile'
import { usesNovuBackend } from '../../backendContract'
import {
  PROVIDER_ENROLLMENT_PATH, providerEnrollmentHref, STAFF_SIGN_IN_PATH, staffSignInHref, staffSiteForOrganizationType,
  staffSiteHostname,
} from '../../productHostname'
import { getEnvironment } from '../env'
import { StaffSignInLink, staffSignInAddress } from '../../staffSignIn'
import { providerEnrollmentApi, staffApi, type ProviderEnrollmentAvailability, type ProviderEnrollmentProfile,
  type ProviderEnrollmentStart, type StaffLoginChallenge } from '../api'
import { announceStaffSessionChange } from '../session'
import { StaffMfaSteps, type StaffMfaCalls, type StaffMfaLook } from './StaffMfaSteps'
import { ClinicianSignUpEntry } from '../clinician/ClinicianSignUpEntry'
import { BETWEEN_FACILITIES } from '../betweenFacilities'

type Product = 'ehr' | 'migrate' | 'laboratory' | 'pharmacy'
type OrganizationType = 'clinic' | 'hospital' | 'laboratory' | 'pharmacy' | 'other'

const products: Array<{ code: Product; label: string }> = [
  { code: 'ehr', label: 'Health ID EHR' },
  { code: 'laboratory', label: 'Health ID Laboratory' },
  { code: 'pharmacy', label: 'Health ID Pharmacy' },
  { code: 'migrate', label: 'Health ID Migrate' },
]

const organizationTypes: Array<{ value: OrganizationType; label: string }> = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'other', label: 'Other healthcare provider' },
]

const productOptions: Record<OrganizationType, Product[]> = {
  hospital: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
  clinic: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
  laboratory: ['laboratory'],
  pharmacy: ['pharmacy'],
  other: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
}

/**
 * What a self-signed-up facility gets on Novu, by its type (P4b, owner decision "full access after support's review"),
 * and, for a laboratory or pharmacy, whether orders from other facilities can reach it (P4c: `ordersOn`, from the
 * availability answer's crossFacilityOrders).
 * Activation gives the administrator the Provider Portal at once, with a restricted role that reaches no patient
 * record. When Health ID support has checked the facility, its administrator manages staff and vouches for their
 * licences, and gets the type's own role (doctor or nurse, laboratory scientist, pharmacist) only with a licence support
 * has checked; the facility's type, not its product, decides what opens. Never a workspace the type will not get, and
 * never more than "within one working day". A laboratory's and a pharmacy's sentence on orders from other facilities
 * is betweenFacilities.ts's.
 */
export function organizationTypeNote(type: OrganizationType, ordersOn: boolean): string {
  return type === 'laboratory' ? laboratoryNote(ordersOn) : type === 'pharmacy' ? pharmacyNote(ordersOn) : ORGANIZATION_TYPE_NOTES[type]
}

function laboratoryNote(ordersOn: boolean): string {
  return 'Your Provider Portal opens at once. When Health ID support has checked your facility, usually within one '
    + 'working day, the Laboratory workspace opens, and you can add your laboratory scientists and receptionists. '
    + `${BETWEEN_FACILITIES.laboratory.signUp(ordersOn)} If you are a licensed laboratory scientist, you can also work in the `
    + 'Laboratory workspace yourself.'
}

function pharmacyNote(ordersOn: boolean): string {
  return 'Your Provider Portal opens at once. When Health ID support has checked your facility, usually within one '
    + 'working day, the Pharmacy workspace opens, and you can add your pharmacists and receptionists. '
    + `${BETWEEN_FACILITIES.pharmacy.signUp(ordersOn)} If you are a licensed pharmacist, you can also work in the Pharmacy `
    + 'workspace yourself.'
}

/** The notes while orders between facilities are off, or before the backend says (organizationTypeNote). */
export const ORGANIZATION_TYPE_NOTES: Readonly<Record<OrganizationType, string>> = {
  hospital: 'Your Provider Portal opens at once. When Health ID support has checked your facility, usually within one '
    + 'working day, the clinical record, emergency access and the Laboratory and Pharmacy work lists open, and you can add '
    + 'your doctors, nurses and other staff. If you are a licensed doctor or nurse, you can also get clinical access yourself.',
  clinic: 'Your Provider Portal opens at once. When Health ID support has checked your facility, usually within one '
    + 'working day, the clinical record, emergency access and the Laboratory and Pharmacy work lists open, and you can add '
    + 'your doctors, nurses and other staff. If you are a licensed doctor or nurse, you can also get clinical access yourself.',
  laboratory: laboratoryNote(false),
  pharmacy: pharmacyNote(false),
  other: 'Your Provider Portal opens at once. When Health ID support has checked your facility, usually within one '
    + 'working day, you can add your staff. Health ID support agrees with you which access you need.',
}

function EnrollmentButton({ primary, ...rest }: { primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={primary ? 'patient-primary-button' : 'patient-text-button'} {...rest} />
}

/** The authenticator steps, drawn as the rest of provider enrollment is. */
const ENROLLMENT_MFA_LOOK: StaffMfaLook = {
  headingAs: 'h2',
  classNames: { step: 'patient-form', note: 'patient-field-hint', error: 'patient-inline-error', status: 'patient-field-hint' },
  Button: EnrollmentButton,
}

/**
 * The staff API's sign-in steps, outside the provider workspace. Verify and
 * activation set the session cookies, so the other tabs are told at once (this
 * page does not listen, so the announcement goes on a channel of its own); the
 * page then reloads into the workspace, which reads the session.
 */
const ENROLLMENT_MFA_CALLS: StaffMfaCalls = {
  verify: async proof => {
    const session = await staffApi.verifyMfa(proof)
    announceStaffSessionChange()
    return session
  },
  sendEnrollmentCode: () => staffApi.sendEnrollmentCode(),
  startEnrollment: emailCode => staffApi.startEnrollment(emailCode),
  activate: async code => {
    const activation = await staffApi.activateEnrollment(code)
    announceStaffSessionChange()
    return activation
  },
}

/**
 * On Novu (novu-v1) activation ends with the password, which signs the
 * administrator in (owner decision: a password, no authenticator). hid-system
 * main since #71 adds an authenticator step after it.
 */
const NOVU_STEPS = [['details', 'Organization'], ['otp', 'Email confirmation'], ['password', 'Password']] as const
const MAIN_STEPS = [...NOVU_STEPS, ['authenticator', 'Authenticator']] as const

/** Identity's wait before another code (resendAfterSeconds), when its answer does not give one. */
const DEFAULT_RESEND_SECONDS = 60
/** The longest wait before a new code a Novu answer can give (up to about a day, P4 round 2), with room to spare. */
const MAX_CODE_WAIT_SECONDS = 2 * 24 * 60 * 60

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

/**
 * Identity sends at most 5 codes an hour, and 15 a day, for one sign-up (hid-system 0056). Past either, main still
 * answers a start with a new challenge, but sends no code and keeps the last one in force, so the page sends no
 * start it knows would be one of those. Novu says itself whether a start sent a code (codeSent, P4 round 2), and
 * the page then follows its answer instead of counting.
 */
const CODE_LIMITS = [{ count: 5, windowMs: HOUR_MS }, { count: 15, windowMs: DAY_MS }] as const

/**
 * An open sign-up holds its CAC number and product for the email it was started with until 24 hours after it
 * started (hid-system 0086, A8); after that another email's start closes it, from any network, since a lapse refuses
 * no one (R15). The page says before a start that another email can't finish an open sign-up it knows of yet.
 */
const OPEN_SIGN_UP_MS = DAY_MS

const START_UNAVAILABLE = 'We couldn’t finish checking your details just now. Please try again in a minute. '
  + 'If an email with a code arrives meanwhile, ignore it: you’ll get a new code when you try again.'
const STEP_UNAVAILABLE = 'Facility sign-up is temporarily unavailable. Please try again in a few minutes.'
const CAC_CHECK_BUSY = 'We couldn’t check your CAC registration number just now. Please try again in a minute.'
const OFFLINE = 'We couldn’t reach Health ID. Check your internet connection and try again.'

type Step = 'start' | 'resend' | 'verify' | 'activate'

/** How a message ends: with support's address (SupportContact). */
type Support = 'plain' | 'cac' | 'cac-otherwise' | 'held' | 'help'

/** What the page says or does about a refusal. */
type Refusal =
  | { kind: 'closed' }
  /** An outage, a timeout or a lost connection: the step may be tried again. */
  | { kind: 'unavailable'; text: string }
  | { kind: 'message'; text: string; support?: Support }
  /** Activation's enrollment session is gone: back to the details for a new code. */
  | { kind: 'session-expired' }
  /** Activation may have created the account already: sign in. */
  | { kind: 'maybe-active' }
  /** A panel in place of the step; `restart` offers a new sign-up with another email (Novu closed this one). */
  | { kind: 'help'; title: string; text: string; restart?: boolean }

/**
 * A refusal's own words for the administrator. Identity masks every 5xx detail
 * on Novu, and the production gateway replaces the whole body of any 502, 503
 * or 504 with its own UPSTREAM_UNAVAILABLE, so every status of 500 or more is
 * read as "temporarily unavailable", whatever its code. A closed sign-up is a
 * 423 for that reason (P4).
 */
function refusalOf(reason: unknown, step: Step, activationUncertain: boolean, novu: boolean): Refusal {
  if (!isHidApiError(reason)) return { kind: 'message', text: 'We could not complete facility sign-up. Please try again.' }
  const { status, code } = reason
  if (status === 423 && code === 'PROVIDER_ENROLLMENT_UNAVAILABLE') return { kind: 'closed' }
  const starting = step === 'start' || step === 'resend'
  if (status === 0 && code === 'NETWORK_ERROR') return { kind: 'unavailable', text: starting ? START_UNAVAILABLE : OFFLINE }
  if (status === 0 || status === 408 || status >= 500 || code === 'UPSTREAM_UNAVAILABLE') {
    return { kind: 'unavailable', text: starting ? START_UNAVAILABLE : STEP_UNAVAILABLE }
  }
  // QoreID itself is limiting CAC checks (a 429 Identity passes on). Nothing was sent; a retry at once would only
  // spend the day's CAC checks, so the page waits a minute as for an outage.
  if (code === 'QOREID_RATE_LIMITED') return { kind: 'unavailable', text: CAC_CHECK_BUSY }
  if (step === 'activate') {
    if (status === 401 && code === 'ORGANIZATION_COMPLETION_SESSION_INVALID') {
      // On Novu an earlier try may have created the account before its answer was lost: its session is then used up.
      return novu && activationUncertain ? { kind: 'maybe-active' } : { kind: 'session-expired' }
    }
    // Novu: the account was created, then the sign-in that follows it failed (401, or 405 under OIDC).
    if (novu && (status === 401 || status === 405)) return { kind: 'maybe-active' }
    // On Novu this refusal closes the sign-up, so a start with another email opens a new one at once (hid-system
    // R15). Main keeps it open for this email.
    if (code === 'PROVIDER_EMAIL_ALREADY_REGISTERED') return novu
      ? { kind: 'help', title: 'This email already has a Health ID account', restart: true,
        text: 'The administrator email already belongs to a Health ID account, for example a patient account or a staff '
          + 'account, so it can’t also be this facility’s administrator. This sign-up has been closed, so you can start '
          + 'again at once with another email address for the administrator.' }
      : { kind: 'help', title: 'This email already has a Health ID account',
        text: 'The administrator email already belongs to a Health ID account, for example a patient account, so it can’t '
          + 'also be this facility’s administrator. Signing up again with another email for the same CAC number won’t work '
          + 'either.' }
    if (code === 'ORGANIZATION_REVIEW_REQUIRED') return { kind: 'help', title: 'Health ID needs to check this organization',
      text: 'This organization can’t be set up automatically. It may already be registered with Health ID, for example '
        + 'for another product.' }
  }
  if (code === 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT') return { kind: 'message',
    text: 'This browser is signed in to Health ID, for example to a patient account. Sign out of Health ID first, or '
      + 'open this page in a private (incognito) window, then try again.' }
  // Novu answers this for a CAC number and product already registered, held by a governed application or by an open
  // sign-up with another email, closed on the way, or whose sign-up from this email or network support closed in the
  // last 7 days (0086, A8 and R15; a lapse refuses no one). Only support can say which, so the page promises no wait.
  if (code === 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' && novu) return { kind: 'message', support: 'cac',
    text: 'This organization can’t be set up automatically right now: its CAC number may already be linked to Health '
      + 'ID, another sign-up for it may be in progress, or Health ID support may have recently closed a sign-up for it.' }
  if (code === 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' || code === 'ORGANIZATION_REVIEW_REQUIRED') return { kind: 'message',
    support: 'cac', text: 'This organization needs a check by Health ID before it can be set up, for example because '
      + 'its CAC number is already linked to Health ID or another sign-up for it is in progress.' }
  if (code === 'PROVIDER_ALREADY_REGISTERED') return { kind: 'message', support: 'plain',
    text: 'This organization is already registered with Health ID. If you are its administrator, sign in instead.' }
  if (code === 'PROVIDER_CAC_PROFILE_INCOMPLETE') return { kind: 'message', support: 'cac',
    text: 'We couldn’t set up your organization automatically from its CAC record: the record is missing details we '
      + 'need, or it doesn’t show the company as active.' }
  if (code === 'CAC_NOT_VERIFIED') return { kind: 'message', text: 'We couldn’t verify this CAC registration number. '
    + 'Check the number on your CAC certificate (it starts with RC, BN or IT) and try again.' }
  if (code === 'APPLICATION_RATE_LIMITED') return { kind: 'message',
    text: 'There have been too many sign-up attempts from your network. Please try again later.' }
  if (code === 'VERIFICATION_QUOTA_EXCEEDED') return { kind: 'message',
    text: 'The limit on CAC checks has been reached for now. Please try again later.' }
  if (code === 'VERSION_CONFLICT') return { kind: 'message',
    text: 'Your sign-up changed while we were working on it. Please try again.' }
  if (code === 'ORGANIZATION_COMPLETION_CODE_INVALID') return { kind: 'message',
    text: 'That code isn’t right, or it has expired. Check the latest email from Health ID and try again, or send a new code.' }
  if (code === 'ORIGIN_DENIED') return { kind: 'message',
    text: 'This site isn’t allowed to send facility sign-ups. Open Set up your facility from healthidentitydirectory.com and try again.' }
  if (code.startsWith('TURNSTILE_') && code.endsWith('_MISMATCH')) return { kind: 'message',
    text: 'The security check was made for another Health ID site. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.' }
  if (code.startsWith('TURNSTILE_')) return { kind: 'message',
    text: 'The security check didn’t go through. Please complete it again, then retry.' }
  if (code === 'PROVIDER_ENROLLMENT_DENIED') return { kind: 'message', text: STEP_UNAVAILABLE }
  if (code === 'VALIDATION_FAILED') return { kind: 'message', text: 'Some of the details weren’t accepted. Check them and try again.' }
  return { kind: 'message', text: reason.message }
}

/** Health ID support's address, from the build's support contact (a mailto: link). */
function supportAddress(): string | null {
  let contact: string | null = null
  try { contact = getEnvironment().supportContact } catch { /* a configuration problem is reported where the API is used */ }
  return contact?.startsWith('mailto:') ? contact.slice('mailto:'.length) : null
}

/** "Contact Health ID support …", with the address when the build has it. */
function SupportContact({ purpose }: { purpose: Support | 'register' | 'finish' | 'inline' | 'persist' }) {
  const address = supportAddress()
  const lead = purpose === 'register' ? 'To register your facility, contact Health ID support'
    : purpose === 'inline' ? 'contact Health ID support'
      : purpose === 'persist' ? 'If this keeps happening, contact Health ID support'
        : purpose === 'held' ? 'If it belongs to another company, tell Health ID support'
          : purpose === 'help' ? 'If you need help, contact Health ID support'
            : purpose === 'cac-otherwise' ? 'Otherwise, contact Health ID support' : 'Contact Health ID support'
  const tail = purpose === 'cac' || purpose === 'cac-otherwise' ? ', and give your CAC registration number.' : purpose === 'finish'
    ? ' to finish setting up your facility.' : purpose === 'held' ? ', and give that number, so they can free it.' : '.'
  return <>{lead}{address ? <> at <a className="provider-setup-link" href={`mailto:${address}`}>{address}</a></> : null}{tail}</>
}

/** Where this administrator signs in next time: the EHR site in production, this portal elsewhere. */
function SignInLink({ children }: { children: ReactNode }) {
  const elsewhere = staffSignInHref(window.location.hostname)
  return elsewhere ? <a className="patient-primary-button" href={elsewhere}>{children}</a>
    : <Link className="patient-primary-button" to={STAFF_SIGN_IN_PATH}>{children}</Link>
}

/** A heading that takes focus, in the commit that shows it, when its panel replaces the step before it. */
function FocusedHeading({ id, children }: { id: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  return <h2 id={id} ref={heading} tabIndex={-1} className="hid-mfa-heading">{children}</h2>
}

function isOrganizationType(value: string | null): value is OrganizationType {
  return organizationTypes.some(option => option.value === value)
}

function isProduct(value: string | null): value is Product {
  return products.some(product => product.code === value)
}

/** Whole seconds until `at`, never below zero. */
function secondsUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 1000))
}

function seconds(count: number): string {
  return `${count} second${count === 1 ? '' : 's'}`
}

/** A wait in words: seconds, minutes, then hours. */
function waitWords(totalSeconds: number): string {
  if (totalSeconds <= 90) return seconds(totalSeconds)
  const minutes = Math.ceil(totalSeconds / 60)
  return minutes <= 90 ? `${minutes} minutes` : `about ${Math.ceil(minutes / 60)} hours`
}

/** What a start sends that Identity keys a sign-up on. */
interface StartDetails {
  productCode: Product
  organizationType: OrganizationType
  cacRegistrationNumber: string
  administratorName: string
  administratorEmail: string
}

/** Identity's sign-up (its application, and its codes) for a CAC number, product and administrator email. */
function signUpKey(details: StartDetails): string {
  return `${details.cacRegistrationNumber}|${details.productCode}|${details.administratorEmail}`
}

/** What one open sign-up holds for its email: a CAC number and product (hid-system 0086). */
function cacProductKey(details: StartDetails): string {
  return `${details.cacRegistrationNumber}|${details.productCode}`
}

/**
 * What a code carries besides its sign-up (Novu, R6): the facility type and administrator name of the start that sent
 * it. The account and organization take them from the code that confirms the email. A start that sends no code
 * stores its own type and name nowhere (0086 begin_self_service_provider_enrollment), so the code in force keeps its own.
 */
interface CodeCarries {
  organizationType: OrganizationType
  administratorName: string
}

function carriesOtherThan(details: StartDetails, carries: CodeCarries): boolean {
  return details.organizationType !== carries.organizationType || details.administratorName !== carries.administratorName
}

/**
 * Novu sent no code for changed details, and the code in force carries the earlier ones: Continue with the changes
 * waits until `until`, when Identity would send a code that carries them; the code in force can be entered with the
 * earlier details until `enterableUntil`.
 */
interface Unapplied {
  key: string
  challengeId: string
  carries: CodeCarries
  unsent: 'recent' | 'limit'
  until: number
  enterableUntil: number
}

/** When Identity would send another code, given when it sent the last ones (CODE_LIMITS); 0 when it would now. */
function nextCodeAt(sentAt: readonly number[], now: number): number {
  let at = 0
  for (const { count, windowMs } of CODE_LIMITS) {
    const recent = sentAt.filter(sent => sent > now - windowMs).sort((a, b) => a - b)
    if (recent.length >= count) at = Math.max(at, recent[recent.length - count]! + windowMs)
  }
  return at > now ? at : 0
}

/**
 * What the password step shows from …/profile (Novu, P4 round 2); a missing or blank value is null, and so is a
 * facility type the page does not know.
 */
interface Registering {
  organizationName: string | null
  registrationNumber: string | null
  organizationType: OrganizationType | null
  administratorName: string | null
  administratorEmail: string | null
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function registeringOf(answer: unknown): Registering {
  const value = (typeof answer === 'object' && answer !== null ? answer : {}) as Partial<Record<keyof ProviderEnrollmentProfile, unknown>>
  const organizationType = textOf(value.organizationType)
  return { organizationName: textOf(value.organizationName), registrationNumber: textOf(value.registrationNumber),
    organizationType: isOrganizationType(organizationType) ? organizationType : null,
    administratorName: textOf(value.administratorName), administratorEmail: textOf(value.administratorEmail) }
}

/** The facility type in the password step's sentence: "…, as a hospital, …". */
const ORGANIZATION_TYPE_PHRASES: Readonly<Record<OrganizationType, string>> = {
  hospital: 'a hospital',
  clinic: 'a clinic',
  laboratory: 'a laboratory',
  pharmacy: 'a pharmacy',
  other: 'another kind of healthcare provider',
}

/** What the account will keep besides the organization (R6), for the password step: ", as a hospital, with … as its administrator". */
function registeringDetails(registering: Registering | null): string {
  if (!registering) return ''
  return (registering.organizationType ? `, as ${ORGANIZATION_TYPE_PHRASES[registering.organizationType]}` : '')
    + (registering.administratorName ? `, with ${registering.administratorName} as its administrator` : '')
}

function organizationTypeLabel(value: OrganizationType): string {
  return organizationTypes.find(option => option.value === value)?.label ?? value
}

/**
 * What Novu's availability answer means for the page. `{ open: false }` with reason 'closed', or with no reason
 * (Identity before P4 round 2, whose { open: false } meant closed), is closed; any other reason ('unavailable', a
 * fault) is not, so a fault never tells an applicant that sign-up is closed. A malformed answer shows the form.
 */
function availabilityOf(answer: ProviderEnrollmentAvailability | null | undefined): 'open' | 'closed' | 'unavailable' {
  if (answer?.open !== false) return 'open'
  return (answer.reason ?? 'closed') === 'closed' ? 'closed' : 'unavailable'
}

/** What an accepted start did: sent a code, or sent none and left one that can still be entered, or none. */
type StartOutcome = 'sent' | 'in-force' | 'none'

export function ProviderEnrollment() {
  // hid-system accepts the sign-up's security check only on the main site: a staff product host (a bookmark, an old
  // link) sends the administrator there, keeping only a product it knows.
  const elsewhere = providerEnrollmentHref(window.location.hostname)
  return elsewhere === PROVIDER_ENROLLMENT_PATH ? <EnrollmentSteps /> : <EnrollOnMainSite href={elsewhere} />
}

function EnrollOnMainSite({ href }: { href: string }) {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const [params] = useSearchParams()
  const product = params.get('product')
  const target = isProduct(product) ? `${href}?product=${product}` : href
  return <AuthLayout brandTo="/provider/sign-in" brandLabel="Health ID provider sign in"
    headerLink={{ to: '/provider/sign-in', label: 'Sign in' }}
    title="Set up your facility." titleId="provider-enroll-title"
    lede="Facility sign-up is done on the main Health ID site.">
    <p><a className="patient-primary-button" href={target}>Continue to facility sign-up</a></p>
  </AuthLayout>
}

function EnrollmentSteps() {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const navigate = useNavigate()
  const novu = usesNovuBackend()
  // On main (hid-system #71) the administrator's account is active after activation, but signed in only once its
  // authenticator is; on Novu activation signs them in ('done').
  const [stage, setStage] = useState<'details' | 'otp' | 'password' | 'authenticator' | 'sign-in' | 'done' | 'help'>('details')
  // Novu says whether self sign-up is open before the form is filled, and when not, whether it is closed or Identity
  // could not tell ('unavailable'); main has no such read.
  const [availability, setAvailability] = useState<'checking' | 'open' | 'closed' | 'unavailable'>(novu ? 'checking' : 'open')
  const [availabilityAsked, setAvailabilityAsked] = useState(0)
  // Novu since P4c: whether orders between facilities are on, which a laboratory's or pharmacy's note says.
  const [ordersOn, setOrdersOn] = useState(false)
  const [challenge, setChallenge] = useState<StaffLoginChallenge | null>(null)
  const [signInReason, setSignInReason] = useState<string | null>(null)
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
  const [cac, setCac] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; support?: Support } | null>(null)
  // What the last "Send a new code" did: sent one, or sent none (Novu), leaving the last code usable or not.
  const [resent, setResent] = useState<StartOutcome | null>(null)
  // Novu: the code step was reached without a new code, because one was sent less than a minute ago ('recent') or
  // the sign-up or its email has had as many codes as Identity sends for now ('limit').
  const [unsent, setUnsent] = useState<'recent' | 'limit' | null>(null)
  // Novu says whether each start sent a code (codeSent, P4 round 2): the page then follows its answers instead of
  // counting codes, and needs no wait after "Start again". Main's answers do not say.
  const [codesReported, setCodesReported] = useState(false)
  // Novu: the last answer's wait is longer than the minute between codes (a limit), and whether a code can still be entered.
  const [codeLimited, setCodeLimited] = useState(false)
  const [codeInForce, setCodeInForce] = useState(true)
  // Identity sends no new code within resendAfterSeconds of the last one, yet main still answers the start
  // (hid-system 0056): a new code is offered only after that wait. A start whose answer was lost (a timeout, or
  // the gateway's 503 at 30 s while Identity carried on) may have sent a code, so it waits as long.
  const [resendAt, setResendAt] = useState(0)
  // Continue waits until retryAt for the sign-up it applies to (its signUpKey) only: other details are another sign-up.
  const [retryAt, setRetryAt] = useState(0)
  const [retryFor, setRetryFor] = useState('')
  const [now, setNow] = useState(() => Date.now())
  // An activation whose answer was lost may have created the account and used up its session.
  const activationUncertain = useRef(false)
  // The sign-up the last code was sent for, and when each accepted start was answered, by sign-up (CODE_LIMITS; main).
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

  useEffect(() => {
    if (!novu) return
    let active = true
    // A clear no closes the form, and a fault says so (availabilityOf). A 404 (an Identity without self sign-up),
    // an outage or a malformed answer shows it: the start then answers for itself.
    providerEnrollmentApi.availability().then(
      answer => { if (active) { setAvailability(availabilityOf(answer)); setOrdersOn(answer?.crossFacilityOrders === true) } },
      () => { if (active) setAvailability('open') })
    return () => { active = false }
  }, [novu, availabilityAsked])

  const sentFor = (key: string) => sends.filter(send => send.key === key).map(send => send.at)
  // Read each second, as the waits are: Identity's limits on codes for the sign-up the last code went to.
  const codeLimitAt = codeFor ? nextCodeAt(sentFor(codeFor), now) : 0
  const waiting = Math.max(resendAt, retryAt, codeLimitAt, unapplied?.until ?? 0) > now
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [waiting])

  function setType(value: OrganizationType) {
    setOrganizationType(value)
    const allowed = productOptions[value]
    if (!allowed.includes(productCode)) setProductCode(allowed[0]!)
  }

  /**
   * After an outage, Novu's availability says whether sign-up has closed meanwhile. Only a clear 'closed' is: an
   * answer that it is unavailable, or no answer, leaves the step's own message.
   */
  async function closedNow(): Promise<boolean> {
    if (!novu) return false
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
    setSignInReason(null)
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
      setChallengeId(''); setCode(''); setPassword(''); setRegistering(null); setRegisteringFailed(false)
      // Main: a start within resendAfterSeconds of the last code sends none (hid-system 0056); Novu says so itself.
      if (!codesReported) holdFor(codeFor, resendAt)
      setStage('details')
      return
    }
    if (refusal.kind === 'maybe-active') { maybeActive(); return }
    if (refusal.kind === 'help') {
      setError(null); setPassword('')
      setHelp({ title: refusal.title, text: refusal.text, ...(refusal.restart ? { restart: true } : {}) })
      setStage('help')
      return
    }
    setError({ text: refusal.text, ...(refusal.support ? { support: refusal.support } : {}) })
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
   * then lets it replace the sign-up, from any network (R15). A changed administrator name or facility type is sent:
   * a code that start sends carries it, and the account keeps it (R6). A start that sends no code does not
   * (changesHeld).
   */
  function otherEmailThanFirst(details: StartDetails): (StartDetails & { at: number }) | null {
    const first = novu ? firstStarts.get(cacProductKey(details)) : undefined
    if (!first || Date.now() - first.at >= OPEN_SIGN_UP_MS) return null
    return first.administratorEmail !== details.administratorEmail ? first : null
  }

  /**
   * Novu: the last start sent no code for these details' sign-up with a changed facility type or administrator name,
   * and Identity would not send one before `until` (Unapplied). Other details (another CAC number, product or email,
   * or the type and name the code in force carries) are not held by it.
   */
  function changesHeld(details: StartDetails, at: number): Unapplied | null {
    return unapplied && unapplied.key === signUpKey(details) && carriesOtherThan(details, unapplied.carries)
      && unapplied.until > at ? unapplied : null
  }

  /**
   * Records a start Identity accepted. Main always sends a code. Novu says whether it did (codeSent); when it did
   * not, `challengeId` names the code still in force, or is absent when none can still be entered, and
   * resendAfterSeconds is the real wait before a new one (up to about a day).
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
    // Main: the page counts the codes it asked for (CODE_LIMITS). Novu counts them itself.
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

  async function start(event: FormEvent) {
    event.preventDefault()
    const details = startDetails()
    const key = signUpKey(details)
    if (busy || !turnstileToken || (retryFor === key && retryAt > Date.now()) || changesHeld(details, Date.now())) return
    const first = otherEmailThanFirst(details)
    const limitAt = nextCodeAt(sentFor(key), Date.now())
    if (limitAt && lastCode.current?.key === key) {
      // Main: Identity would send no code; back to the last one, which is still the one in force.
      setError(null); setCode(''); setResent(null); setUnsent(null)
      setChallengeId(lastCode.current.challengeId)
      setStage('otp')
      return
    }
    if (limitAt) {
      // Main: the last code was used ("This isn't my organization", then the same details): none can be sent until then.
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
      if (outcome === 'sent') setCode('')
      setResent(outcome)
    } catch (reason) {
      await refuse(reason, 'resend', signUpKey(details))
    } finally {
      setTurnstileToken(null)
      setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
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
    setCode('')
    setResent(null)
    setUnsent(null)
    activationUncertain.current = false
    // Novu: what the confirmed sign-up registers, so the administrator can check the organization is theirs before
    // the account is made (P4 round 2).
    if (!novu || await readRegistering()) setStage('password')
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

  async function activate(event: FormEvent) {
    event.preventDefault()
    if (busy || password.length < 12) return
    setBusy(true)
    setError(null)
    try {
      const activated = await providerEnrollmentApi.activate(password)
      setPassword('')
      // hid-system main since #71: activation opens the administrator's first staff sign-in, whose second step comes
      // next: an authenticator set up on the activation's own proof, or the code of one the account already has.
      if (activated.status === 'mfa_enrollment_required' || activated.status === 'mfa_required') {
        setChallenge({ status: activated.status, expiresAt: activated.expiresAt })
        setStage('authenticator')
        setBusy(false)
        return
      }
      // Novu (and main before #71) answers with the session, which the browser now holds: the other tabs are told.
      announceStaffSessionChange()
      // On Novu the administrator is told first where to sign in next time; main keeps its own path.
      if (novu) { setStage('done'); setBusy(false) }
      else openWorkspace()
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

  function startAgain() {
    setStage('details'); setCode(''); setChallengeId(''); setError(null); setResent(null); setUnsent(null)
    setRegistering(null); setRegisteringFailed(false)
    // Main: a start within resendAfterSeconds of the last code sends none (hid-system 0056), yet answers as if it
    // had. Novu says when it sends none, so Continue need not wait.
    if (!codesReported) holdFor(codeFor, resendAt)
  }

  /**
   * "This isn't my organization": the confirmed sign-up is closed (Novu, P4b: …/withdraw, from the enrollment cookie),
   * so a mistyped CAC number no longer holds another company's, and the page goes back to the details, kept, to correct
   * them. Withdrawing refuses no one later. When it can't be closed (an Identity without the route, a session that has
   * ended, a fault), the sign-up may still hold the number for up to 24 hours (0086, A8): the page says so, and asks
   * for the number to be passed to support, who can reject it (Open applications).
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
    startAgain()
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
    setCode(''); setError(null); setResent(null)
    setUnsent(previous.unsent)
    // Kept: changed again after "Start again", the details still wait for a code that carries them.
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
    startAgain()
  }

  /** The email a CAC number and product were first accepted with, back in the form. */
  function firstEmail(first: StartDetails) {
    setEmail(first.administratorEmail)
    setError(null)
  }

  const steps = novu ? NOVU_STEPS : MAIN_STEPS
  const currentStep = stage === 'sign-in' ? 'authenticator' : stage
  const closed = availability === 'closed'
  const details = startDetails()
  // Changed details that the last start sent no code for (changesHeld): Continue with them waits for a code.
  const carried = stage === 'details' ? changesHeld(details, now) : null
  const retryIn = Math.max(retryFor === signUpKey(details) ? secondsUntil(retryAt, now) : 0,
    carried ? secondsUntil(carried.until, now) : 0)
  const resendIn = secondsUntil(Math.max(resendAt, retryAt), now)
  // How long until a new code past a limit: main's count of its own codes, or Novu's own long wait.
  const codeLimitIn = secondsUntil(codeLimitAt, now) || (codeLimited ? resendIn : 0)
  // Back at the details of a sign-up Identity accepted, with its email changed (otherEmailThanFirst).
  const kept = stage === 'details' ? otherEmailThanFirst(details) : null
  const productNote = novu ? organizationTypeNote(organizationType, ordersOn) : null
  // The address as Identity has it: the code was sent to it, and the administrator signs in with it.
  const administratorEmail = email.trim().toLowerCase()
  const accountEmail = registering?.administratorEmail ?? administratorEmail
  // The CAC number as Identity has it (spaces removed, capitals), which the organization will be registered under.
  const cacNumber = registering?.registrationNumber ?? cac
  // Staff sign in on the EHR site from the production portal (staffSignIn.tsx), and on this site elsewhere.
  const signIn = staffSignInAddress()

  return (
    <AuthLayout brandTo={signIn} brandLabel="Health ID provider sign in" headerLink={{ to: signIn, label: 'Sign in' }}
      title="Set up your facility." titleId="provider-enroll-title"
      lede={novu
        ? 'Verify your CAC registration, confirm your email and choose a password. Your administrator account is ready straight away.'
        : 'Verify your CAC registration and your facility can start using Health ID straight away.'}
      steps={closed || availability === 'checking' || availability === 'unavailable' || stage === 'help'
        ? undefined : steps.map(([step, label]) => ({ label, current: step === currentStep }))}
      stepsLabel="Provider enrollment steps">
        {error && !closed ? <p role="alert" className="patient-inline-error">{error.text}
          {error.support ? <> <SupportContact purpose={error.support} /></> : null}</p> : null}

        {availability === 'checking' && <p role="status" className="patient-field-hint">Checking that facility sign-up is open…</p>}

        {closed && <section className="patient-form" aria-labelledby="provider-enroll-closed-title">
          <FocusedHeading id="provider-enroll-closed-title">Facility sign-up isn’t open right now</FocusedHeading>
          <p className="patient-field-hint">Hospitals, laboratories and pharmacies can’t sign themselves up on Health ID at the
            moment. <SupportContact purpose="register" /></p>
          <p className="patient-field-hint">If your facility already uses Health ID, sign in instead.</p>
        </section>}

        {/* Identity answered that it could not tell whether sign-up is open (a fault): not closed, so it says so. */}
        {availability === 'unavailable' && <section className="patient-form" aria-labelledby="provider-enroll-unavailable-title">
          <FocusedHeading id="provider-enroll-unavailable-title">Facility sign-up is temporarily unavailable</FocusedHeading>
          <p className="patient-field-hint">We can’t take facility sign-ups just now because of a problem on our side. Please
            try again in a few minutes. <SupportContact purpose="persist" /></p>
          <button type="button" className="patient-primary-button" onClick={checkAvailabilityAgain}>Try again</button>
        </section>}

        {availability === 'open' && stage === 'details' && (
          <form onSubmit={event => void start(event)} className="auth-form provider-setup-form">
            <fieldset className="provider-setup-choice">
              <legend>Facility type</legend>
              <div className="provider-setup-options">
                {organizationTypes.map(option => (
                  <label key={option.value} className="provider-setup-option">
                    <input type="radio" name="provider-facility-type" value={option.value}
                      checked={organizationType === option.value} onChange={() => setType(option.value)} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="provider-setup-fields">
              <Field label="Product" htmlFor="provider-product">
                <Select id="provider-product" value={productCode} onChange={event => setProductCode(event.target.value as Product)}
                  aria-describedby={productNote ? 'provider-product-note' : undefined}>
                  {productOptions[organizationType].map(code => <option key={code} value={code}>{products.find(product => product.code === code)?.label}</option>)}
                </Select>
              </Field>
              {productNote && <p id="provider-product-note" className="patient-field-hint">{productNote}</p>}

              <Field label="CAC registration number" htmlFor="provider-cac">
                <Input id="provider-cac" required value={cac}
                  onChange={event => setCac(event.target.value.replace(/\s+/g, '').toUpperCase())}
                  autoCapitalize="characters" autoComplete="off" spellCheck={false}
                  pattern="(RC|BN|IT)[0-9]{4,20}" maxLength={22} placeholder="RC123456" />
              </Field>

              <Field label="Administrator full name" htmlFor="provider-admin-name">
                <Input id="provider-admin-name" required minLength={2} maxLength={200}
                  autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
              </Field>

              <Field label="Administrator email" htmlFor="provider-admin-email">
                <Input id="provider-admin-email" required type="email" maxLength={254}
                  autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
              </Field>
            </div>

            {kept && <div className="provider-setup-kept">
              <p className="patient-field-hint">A sign-up for {kept.cacRegistrationNumber} was started with {kept.administratorEmail},
                {' '}and only that email can finish it until 24 hours after it started. You can still correct the CAC number.</p>
              <button type="button" className="patient-text-button" onClick={() => firstEmail(kept)}>Use the email I first gave</button>
            </div>}

            {carried && <div className="provider-setup-kept">
              <p className="patient-field-hint">A new facility type or administrator name takes effect only with a new code. The
                {' '}code already sent is for the facility type {organizationTypeLabel(carried.carries.organizationType)}, with
                {' '}{carried.carries.administratorName} as administrator.</p>
              {carried.enterableUntil > now && <button type="button" className="patient-text-button"
                onClick={() => enterCodeInForce(carried)}>Use the details I gave before</button>}
            </div>}

            <div className="provider-setup-actions">
              <Turnstile action="provider-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />
              <button type="submit" className="patient-primary-button provider-setup-submit" disabled={busy || !turnstileToken || retryIn > 0}>
                {busy ? 'Verifying CAC…' : 'Continue'}
              </button>
              {retryIn > 0 && !busy && <p className="patient-field-hint">{carried
                ? 'You can continue with your changes in ' : 'You can try again in '}{waitWords(retryIn)}.</p>}
              {/* Novu has no review before activation: a CAC number already linked is refused (P4 review). */}
              <p className="provider-setup-fineprint">{novu
                ? 'We check your CAC against the official registry, and Health ID support checks every new facility within one '
                  + 'working day.'
                : 'We check your CAC against the official registry. Registrations already linked to Health ID are reviewed by '
                  + 'our team before activation.'}</p>
            </div>
          </form>
        )}

        {availability === 'open' && stage === 'otp' && (<>
          <form onSubmit={event => void verify(event)} className="patient-form">
            <h2>Confirm your administrator email</h2>
            <p className="patient-field-hint">{unsent === 'recent'
              ? `We didn’t send a new code, because one was sent to ${administratorEmail} less than a minute ago. Enter the six `
                + 'digit code from that email.'
              : unsent === 'limit'
                ? 'We didn’t send a new code, because we’ve sent as many as we can for now. Enter the six digit code from the '
                  + `latest email Health ID sent to ${administratorEmail}.`
                : `Enter the six digit code sent to ${administratorEmail}.`}</p>
            <label>Email verification code
              <Input required inputMode="numeric" autoComplete="one-time-code" value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                pattern="[0-9]{6}" maxLength={6} />
            </label>
            <button type="submit" className="patient-primary-button" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Verify email'}
            </button>
            <button type="button" className="patient-text-button" onClick={startAgain}>
              Start again
            </button>
          </form>
          <section className="patient-form provider-setup-resend" aria-labelledby="provider-enroll-resend-title">
            <h3 id="provider-enroll-resend-title">Didn’t get the code?</h3>
            <p className="patient-field-hint">Check your spam or junk folder first. A new code replaces the last one.</p>
            <Turnstile action="provider-enrollment" onTokenChange={setTurnstileToken} resetKey={resetKey} />
            <button type="button" className="patient-secondary-button" onClick={() => void resend()}
              disabled={busy || !turnstileToken || resendIn > 0 || codeLimitIn > 0}>Send a new code</button>
            {codeLimitIn > 0
              ? <p className="patient-field-hint">We’ve sent as many codes as we can for now. {codeInForce
                ? <>Use the code in the latest email from{' '}Health ID, or ask for a new one in {waitWords(codeLimitIn)}.</>
                : <>You can ask for a new one in {waitWords(codeLimitIn)}.</>}</p>
              : resendIn > 0 && <p className="patient-field-hint">You can ask for a new code in {codesReported
                ? waitWords(resendIn) : seconds(resendIn)}.</p>}
            <div role="status">{resent && <p className="patient-field-hint">{resent === 'sent'
              ? `We’ve sent a new code to ${administratorEmail}.`
              : resent === 'in-force' ? 'We didn’t send a new code: the code in the latest email from Health ID still works.'
                : 'We didn’t send a new code, and the last one can no longer be used.'}</p>}</div>
          </section>
        </>)}

        {availability === 'open' && stage === 'password' && (
          <form onSubmit={event => void activate(event)} className="patient-form">
            <h2>Create your provider account</h2>
            {novu && <div className="provider-setup-registering">
              {/* The facility type and administrator are the confirmed code's (R6), which a start that sent no code may
                  not have changed: shown so they can be checked too. */}
              <p id="provider-registering" className="patient-field-hint">{registering?.organizationName
                ? <>You’re registering <strong>{registering.organizationName}</strong>, CAC number {cacNumber}
                  {registeringDetails(registering)}. Check that this is your organization before you create the account.</>
                : <>You’re registering the organization with CAC number {cacNumber}{registeringDetails(registering)}. Check
                  {' '}that this is your organization’s number before you create the account.</>}</p>
              {registeringFailed && <p className="patient-field-hint">We couldn’t load your organization’s registered name just
                now. <button type="button" className="patient-text-button" disabled={busy}
                  onClick={() => void readRegisteringAgain()}>Try again</button></p>}
              <button type="button" className="patient-text-button" disabled={busy} onClick={() => void notMine()}>This isn’t my organization</button>
            </div>}
            <p id="provider-password-hint" className="patient-field-hint">{novu
              ? `Choose a password of at least 12 characters. You’ll use it with ${accountEmail} to sign in. Once your account `
                + 'is created, you go straight into the Provider Portal as your facility’s administrator.'
              : 'Choose a password of at least 12 characters. After activation, you will set up an authenticator app, then enter '
                + 'the Provider Portal as your facility administrator.'}</p>
            {/* Lets a password manager save the new password with its email. */}
            <input type="email" hidden readOnly autoComplete="username" value={accountEmail} />
            <Field label="Password" htmlFor="provider-password">
              <PasswordInput id="provider-password" required autoComplete="new-password" minLength={12} maxLength={256}
                aria-describedby="provider-password-hint" value={password} onChange={event => setPassword(event.target.value)} />
            </Field>
            <button type="submit" className="patient-primary-button" disabled={busy || password.length < 12}>
              {busy ? 'Creating provider account…' : 'Create provider account'}
            </button>
          </form>
        )}

        {stage === 'authenticator' && challenge && (
          <StaffMfaSteps challenge={challenge} proof={challenge.status === 'mfa_enrollment_required' ? 'activation' : undefined}
            calls={ENROLLMENT_MFA_CALLS} look={ENROLLMENT_MFA_LOOK} doneLabel="Continue to the Provider Portal"
            onSignedIn={openWorkspace} onRestart={reason => { setChallenge(null); setSignInReason(reason); setStage('sign-in') }} />
        )}

        {!closed && stage === 'sign-in' && (novu ? <MaybeActive email={accountEmail} /> : <SignInToFinish reason={signInReason} />)}

        {!closed && stage === 'done' && <FacilityReady email={accountEmail} ordersOn={ordersOn}
          organizationType={registering?.organizationType ?? organizationType} onContinue={openWorkspace} />}

        {!closed && stage === 'help' && help && <section className="patient-form" aria-labelledby="provider-enroll-help-title">
          <FocusedHeading id="provider-enroll-help-title">{help.title}</FocusedHeading>
          {help.restart ? <>
            <p className="patient-field-hint">{help.text} <SupportContact purpose="help" /></p>
            <button type="button" className="patient-primary-button" onClick={anotherEmail}>Start again with another email</button>
          </> : <p className="patient-field-hint">{help.text} <SupportContact purpose="finish" /></p>}
        </section>}

        {/* Clinician self sign-up (hid-system ADR-066): a doctor or nurse applies with their own account, not this one.
            On Novu (P4b) the administrator adds the facility's staff, and may get clinical access with their own licence. */}
        {novu
          ? <p className="patient-auth-footer">Provider enrollment sets up a facility and its administrator’s account. Once Health
            ID support has checked the facility, its administrator adds the doctors, nurses and other staff on the Staff page.</p>
          : <p className="patient-auth-footer">Provider enrollment sets up a facility and its administrator's account, which can't also hold a
            clinical role there: doctors and nurses apply with their own email address.</p>}
        <ClinicianSignUpEntry className="patient-auth-footer" />
    </AuthLayout>
  )
}

/**
 * Novu: the administrator is signed in on this site (the session cookies are
 * this host's only), and in production signs in on the staff site of the
 * facility's type from then on (P4b: ehr for a hospital, clinic or other
 * provider, lab for a laboratory, pharmacy for a pharmacy), where support's
 * check sends them once it is done. What the account opens is said as it is
 * (ORGANIZATION_TYPE_NOTES).
 */
function FacilityReady({ email, organizationType, ordersOn, onContinue }: { email: string; organizationType: OrganizationType; ordersOn: boolean; onContinue: () => void }) {
  const hostname = window.location.hostname
  const site = staffSignInHref(hostname) !== null ? staffSiteHostname(staffSiteForOrganizationType(organizationType), hostname) : null
  return <section className="patient-form" aria-labelledby="provider-enroll-done-title">
    <FocusedHeading id="provider-enroll-done-title">Your facility is set up</FocusedHeading>
    <p className="patient-field-hint">You’re signed in as your facility’s administrator.</p>
    <p className="patient-field-hint">{site
      ? `Next time, sign in at ${site} with ${email} and the password you just chose.`
      : `Next time, sign in to the Provider Portal with ${email} and the password you just chose.`}</p>
    <p className="patient-field-hint">{organizationTypeNote(organizationType, ordersOn)}</p>
    <button type="button" className="patient-primary-button" onClick={onContinue}>Continue to the Provider Portal</button>
  </section>
}

/**
 * Novu: activation's answer was lost, or the sign-in that follows it failed,
 * after the account may have been created. A new activation would be refused
 * (its session is used up), so the administrator signs in instead.
 */
function MaybeActive({ email }: { email: string }) {
  return <section className="patient-form" aria-labelledby="provider-enroll-sign-in-title">
    <FocusedHeading id="provider-enroll-sign-in-title">Your account may already be ready</FocusedHeading>
    <p className="patient-field-hint">We couldn’t confirm that your facility was set up, but it may have been. Sign in with
      {email ? ` ${email}` : ' your administrator email'} and the password you chose. If you can’t sign in,
      {' '}<SupportContact purpose="inline" /></p>
    <SignInLink>Sign in to the Provider Portal</SignInLink>
  </section>
}

/**
 * hid-system main (#71): the activation's own challenge can no longer go on
 * (it expired, ran out of attempts, or the account's authenticator must be
 * reset). The account is active: an ordinary staff sign-in opens a new
 * challenge, and sets up the authenticator with a code emailed to the
 * administrator.
 */
function SignInToFinish({ reason }: { reason: string | null }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  return <section className="patient-form" aria-labelledby="provider-enroll-sign-in-title">
    <h2 id="provider-enroll-sign-in-title" ref={heading} tabIndex={-1} className="hid-mfa-heading">Sign in to finish setting up</h2>
    {reason && <p role="alert" className="patient-inline-error">{reason}</p>}
    <p className="patient-field-hint">Your provider account is active. Sign in with your administrator email and the password you chose,
      then set up your authenticator app.</p>
    <StaffSignInLink className="patient-primary-button">Sign in to the Provider Portal</StaffSignInLink>
  </section>
}
