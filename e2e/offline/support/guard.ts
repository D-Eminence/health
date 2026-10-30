import type { APIResponse, BrowserContext, Request, Response, Route } from '@playwright/test'
import type { Secret } from './env'

/**
 * The guard: runs before any card acts, and stops the whole run on the first thing that is not the sealed demo tenant.
 *
 * Each check is a plain function that throws GuardRefusal, so the selftest can prove every refusal without stopping
 * itself. installGuard() wires them into a browser context:
 *   a. main-frame navigations only to the three Health ID hosts (127.0.0.1 too in the selftest);
 *   b. the staff session is the demo login, working at Demo Hospital, with only demo facilities;
 *   c. the patient session is a demo patient with a login (HID-ZDEMAAA2 or HID-ZDEMAAA3);
 *   d. every write under /api/v1/ is checked, then continued or aborted; a body is never changed;
 *   e. a request watcher applies (d) again to everything the context reports, service worker requests included, and
 *      stops the run if a write that breaks it got past routing.
 *
 * A refusal message never contains a secret, a facility id or a Health ID from the request: it names the rule.
 */

export const HOSTS = {
  ehr: 'ehr.healthidentitydirectory.com',
  migrate: 'migrate.healthidentitydirectory.com',
  app: 'app.healthidentitydirectory.com',
} as const
export type HostName = keyof typeof HOSTS
const PRODUCTION_HOSTS: ReadonlySet<string> = new Set(Object.values(HOSTS))
export const LOCAL_HOST = '127.0.0.1'

/** The sealed demo tenant (hid-system migration 0098). Fictional; safe to commit. */
export const DEMO = {
  facilities: {
    hospital: '98d00002-0000-4000-8000-000000000001',
    laboratory: '98d00002-0000-4000-8000-000000000002',
    pharmacy: '98d00002-0000-4000-8000-000000000003',
    outreach: '98d00002-0000-4000-8000-000000000004',
  },
  hospitalName: 'Demo Hospital',
  staff: {
    accountId: '98d00003-0000-4000-8000-000000000001',
    /** actor.id is the account SUBJECT, not the account id. */
    subject: 'sealed-demo:98d00003-0000-4000-8000-000000000001',
    email: 'operations@healthidentitydirectory.com',
  },
  patients: { one: 'HID-ZDEMAAA2', two: 'HID-ZDEMAAA3' },
  patientNames: { one: 'Demo Patient One', two: 'Demo Patient Two' },
  /** Demo patients without a login (emergency access in T13 uses one of these only). */
  noLogin: ['HID-ZDEMBBB2', 'HID-ZDEMBBB3', 'HID-ZDEMBBB4', 'HID-ZDEMBBB5', 'HID-ZDEMBBB6', 'HID-ZDEMBBB7', 'HID-ZDEMBBB8', 'HID-ZDEMBBB9'],
} as const

const DEMO_FACILITY_IDS: ReadonlySet<string> = new Set(Object.values(DEMO.facilities))
const LOGIN_HIDS: ReadonlySet<string> = new Set([DEMO.patients.one, DEMO.patients.two])
const NO_LOGIN_HIDS: ReadonlySet<string> = new Set(DEMO.noLogin)
export const DEMO_HIDS: ReadonlySet<string> = new Set([...LOGIN_HIDS, ...NO_LOGIN_HIDS])

export class GuardRefusal extends Error {
  constructor(readonly rule: string, message: string) {
    super(`Guard refused (${rule}): ${message}`)
    this.name = 'GuardRefusal'
  }
}

function refuse(rule: string, message: string): never {
  throw new GuardRefusal(rule, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const normalEmail = (value: string) => value.trim().toLowerCase()
const normalHid = (value: string) => value.trim().toUpperCase()

// --- a. Navigation --------------------------------------------------------------------------------------------

/** A main-frame navigation may go only to the three Health ID hosts (and 127.0.0.1 in the selftest). */
export function checkNavigation(url: string, o: { allowLocal: boolean }): void {
  let parsed: URL
  try { parsed = new URL(url) } catch { refuse('navigation', 'A main-frame navigation to an address that cannot be read') }
  if (parsed.protocol === 'https:' && parsed.port === '' && PRODUCTION_HOSTS.has(parsed.hostname)) return
  if (o.allowLocal && parsed.protocol === 'http:' && parsed.hostname === LOCAL_HOST) return
  refuse('navigation', `A main-frame navigation to ${parsed.protocol}//${parsed.host}, which is not one of the three Health ID hosts`
    + (o.allowLocal ? ' or 127.0.0.1' : ''))
}

/**
 * Whether a request came from a service worker. Playwright's request.frame() throws for exactly two kinds of request:
 * a service worker's, and a navigation issued before its frame exists (a new window's first load).
 */
export function madeByServiceWorker(request: Request): boolean {
  if (request.isNavigationRequest()) return false
  try { request.frame(); return false } catch { return true }
}

/**
 * Only main-frame navigations are checked; subframes (the Turnstile iframe) and page resources pass. A navigation
 * with no frame yet is a new window's first load, so it is a main-frame navigation too.
 */
export function isMainFrameNavigation(request: Request): boolean {
  if (!request.isNavigationRequest()) return false
  try { return request.frame().parentFrame() === null } catch { return true }
}

// --- b. Staff session -----------------------------------------------------------------------------------------

/**
 * GET /api/v1/auth/session (or the sign-in answer) must be the demo staff login: accountId and subject, the email in
 * HID_DEMO_STAFF_EMAIL (which must be the demo login's), working at Demo Hospital, every facility a demo one.
 * `requireFacility: false` accepts a session whose facility is not chosen yet ("Where are you working?").
 */
export function checkStaffSession(session: unknown, expectedEmail: string, o: { requireFacility: boolean } = { requireFacility: true }): void {
  const actor = isRecord(session) ? session.actor : undefined
  if (!isRecord(actor)) refuse('staff-session', 'The session has no actor')
  if (actor.kind === 'patient' || actor.kind === 'platform') refuse('staff-session', 'The session is not a staff session')
  if (actor.accountId !== DEMO.staff.accountId) refuse('staff-session', 'actor.accountId is not the demo staff account')
  if (actor.id !== DEMO.staff.subject) {
    refuse('staff-session', 'actor.id is not the demo staff subject (actor.id is the account subject, not the account id)')
  }
  if (actor.subject !== undefined && actor.subject !== DEMO.staff.subject) refuse('staff-session', 'actor.subject is not the demo staff subject')
  if (normalEmail(expectedEmail) !== normalEmail(DEMO.staff.email)) {
    refuse('staff-session', 'HID_DEMO_STAFF_EMAIL is not the demo staff login')
  }
  if (typeof actor.email !== 'string' || normalEmail(actor.email) !== normalEmail(DEMO.staff.email)) {
    refuse('staff-session', 'actor.email is not the demo staff login')
  }
  const facilities = actor.facilities
  if (!Array.isArray(facilities) || facilities.length === 0) refuse('staff-session', 'The session lists no facilities')
  for (const facility of facilities) {
    if (!isRecord(facility) || typeof facility.id !== 'string' || !DEMO_FACILITY_IDS.has(facility.id)) {
      refuse('staff-session', 'actor.facilities lists a facility outside the demo tenant')
    }
  }
  if (Array.isArray(actor.facilityIds) && actor.facilityIds.some(id => typeof id !== 'string' || !DEMO_FACILITY_IDS.has(id))) {
    refuse('staff-session', 'actor.facilityIds lists a facility outside the demo tenant')
  }
  if (actor.facility === undefined || actor.facility === null) {
    if (o.requireFacility) refuse('staff-session', 'The session has no working facility yet; choose Demo Hospital')
    return
  }
  if (!isRecord(actor.facility) || actor.facility.id !== DEMO.facilities.hospital) {
    refuse('staff-session', 'actor.facility is not Demo Hospital')
  }
}

// --- c. Patient session ---------------------------------------------------------------------------------------

/** The portal's session must be a patient's, and its profile (GET identity/me) the expected demo patient's. */
export function checkPatientSession(session: unknown, profile: unknown, expectedHid: string): void {
  const actor = isRecord(session) ? session.actor : undefined
  if (!isRecord(actor) || actor.kind !== 'patient') refuse('patient-session', 'The portal session is not a patient session')
  if (!LOGIN_HIDS.has(normalHid(expectedHid))) refuse('patient-session', 'The device expects a Health ID outside the demo tenant')
  if (!isRecord(profile) || typeof profile.hid !== 'string') refuse('patient-session', 'The portal profile has no Health ID')
  const hid = normalHid(profile.hid)
  if (!LOGIN_HIDS.has(hid)) refuse('patient-session', 'The signed-in patient is not a demo patient')
  if (hid !== normalHid(expectedHid)) refuse('patient-session', 'The signed-in patient is not the demo patient this device is for')
  if (typeof actor.patientId === 'string' && typeof profile.patientId === 'string' && actor.patientId !== profile.patientId) {
    refuse('patient-session', 'The session and the profile name different patients')
  }
}

// --- d. Writes ------------------------------------------------------------------------------------------------

/** Which side of the product a context is: it decides the patient-only rules. 'reader' may not write at all. */
export type DeviceRole = 'staff' | 'patient1' | 'patient2' | 'reader'

export interface WriteRequest {
  method: string
  url: string
  /** Lower-case names, as Playwright reports them. */
  headers: Readonly<Record<string, string>>
  body: string | null
}

export interface WritePolicy {
  device: DeviceRole
  allowLocal: boolean
  /** T9 and T11: wrong passwords stay on the device, so an online sign-in is refused. */
  noOnlineSignIn: boolean
  /** Patient Two's Demo Hospital share, armed only by T7 in revoke mode. Empty otherwise. */
  revocableGrantIds: ReadonlySet<string>
}

const API_PREFIX = '/api/v1/'
const GRANT_CLOSE = /^\/api\/v1\/identity\/consent-grants\/[^/]+\/close\/?$/
const PATIENT_REVOKE = /^\/api\/v1\/identity\/me\/consent-grants\/([^/]+)\/revoke\/?$/
const LOGIN = /^\/api\/v1\/auth\/login\/?$/
const FACILITY_SELECT = /^\/api\/v1\/auth\/facility\/?$/
const BREAK_GLASS = /^\/api\/v1\/identity\/break-glass\/?$/
/** The reader may keep its session alive, nothing else. */
const READER_ALLOWED = /^\/api\/v1\/auth\/refresh\/?$/
/** Changes to a shared demo patient's own account settings: no card needs one. */
const PATIENT_ACCOUNT_WRITES = [
  /^\/api\/v1\/identity\/me\/access-pin/,
  /^\/api\/v1\/identity\/me\/contact-changes/,
  /^\/api\/v1\/identity\/me\/profile-details/,
  /^\/api\/v1\/identity\/me\/photo/,
  /^\/api\/v1\/identity\/me\/[^/]*deletion/,
  /password/i,
]
const HID_SHAPE = /\bHID-[A-Z0-9]{4,16}\b/gi

function apiHostAllowed(url: URL, allowLocal: boolean): boolean {
  if (url.protocol === 'https:' && url.port === '' && PRODUCTION_HOSTS.has(url.hostname)) return true
  return allowLocal && url.protocol === 'http:' && url.hostname === LOCAL_HOST
}

/** Every Health ID-shaped string, and every value under a key named hid, anywhere in a JSON body. */
function healthIdsIn(value: unknown, found: string[] = [], key = ''): string[] {
  if (typeof value === 'string') {
    if (key.toLowerCase() === 'hid') found.push(normalHid(value))
    for (const match of value.matchAll(HID_SHAPE)) found.push(normalHid(match[0]))
  } else if (Array.isArray(value)) {
    for (const item of value) healthIdsIn(item, found, key)
  } else if (isRecord(value)) {
    for (const [name, item] of Object.entries(value)) healthIdsIn(item, found, name)
  }
  return found
}

/**
 * Decides one request: 'read' (GET or HEAD), 'not-api' (not under /api/v1/) or 'allowed'; anything else throws.
 * It never looks at or changes more than it needs, and never reports what it found.
 */
export function checkWrite(request: WriteRequest, policy: WritePolicy): 'read' | 'not-api' | 'allowed' {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') return 'read'
  let url: URL
  try { url = new URL(request.url) } catch { refuse('write', 'A write to an address that cannot be read') }
  if (!url.pathname.startsWith(API_PREFIX)) return 'not-api'
  const path = url.pathname
  if (!apiHostAllowed(url, policy.allowLocal)) refuse('write-host', `A write to ${url.host}, which is not one of the three Health ID hosts`)
  if (policy.device === 'reader' && !READER_ALLOWED.test(path)) refuse('read-only', 'A write from a read-only card')

  const facility = request.headers['x-facility-id']
  if (facility !== undefined && facility.trim() !== DEMO.facilities.hospital) {
    refuse('write-facility', 'A write carries an X-Facility-ID that is not Demo Hospital')
  }
  if (GRANT_CLOSE.test(path)) refuse('grant-close', 'A grant close (identity/consent-grants/*/close) is never sent by a card')
  const revoke = PATIENT_REVOKE.exec(path)
  if (revoke) {
    if (policy.device === 'patient1') refuse('revoke', 'A revoke from the Patient One profile')
    if (policy.device !== 'patient2') refuse('revoke', 'A revoke from a device that is not Patient Two')
    if (!policy.revocableGrantIds.has(decodeURIComponent(revoke[1] ?? ''))) {
      refuse('revoke', 'Patient Two may revoke only the Demo Hospital share, and only in T7 revoke mode')
    }
  }
  if (policy.noOnlineSignIn && LOGIN.test(path)) refuse('online-sign-in', 'An online sign-in during T9 or T11')
  if ((policy.device === 'patient1' || policy.device === 'patient2') && PATIENT_ACCOUNT_WRITES.some(pattern => pattern.test(path))) {
    refuse('patient-account', 'A change to a demo patient\'s account settings')
  }

  let body: unknown = null
  if (request.body !== null && request.body.trim() !== '') {
    try { body = JSON.parse(request.body) } catch { refuse('write-body', 'A write body under /api/v1/ that is not JSON') }
  }
  const hids = healthIdsIn(body)
  if (hids.some(hid => !DEMO_HIDS.has(hid))) refuse('write-hid', 'A write body names a Health ID outside the demo tenant')
  if (BREAK_GLASS.test(path)) {
    const hid = isRecord(body) && typeof body.hid === 'string' ? normalHid(body.hid) : ''
    if (!NO_LOGIN_HIDS.has(hid)) refuse('emergency', 'Emergency access is used only for a demo patient without a login (HID-ZDEMBBB2 to HID-ZDEMBBB9)')
  }
  if (isRecord(body) && body.facilityId !== undefined && body.facilityId !== DEMO.facilities.hospital) {
    refuse('write-facility', 'A write body names a facility that is not Demo Hospital')
  }
  if (FACILITY_SELECT.test(path) && (!isRecord(body) || body.facilityId !== DEMO.facilities.hospital)) {
    refuse('write-facility', 'A facility switch to a facility that is not Demo Hospital')
  }
  return 'allowed'
}

// --- Runtime --------------------------------------------------------------------------------------------------

/** What the cards may read of the API traffic: no bodies, no cookies, no other headers. */
export interface ApiRequestRecord {
  at: number
  method: string
  path: string
  idempotencyKey: string | null
  offlineCommand: string | null
  capturedAt: string | null
  clock: string | null
  fromServiceWorker: boolean
  status: number | null
  failure: string | null
}

export interface GuardOptions {
  role: DeviceRole
  /** For messages only: "ehr A", "patient1". */
  label: string
  /** The device's own host (staff and patient sessions are checked there). */
  host: string
  allowLocal?: boolean
  /** The staff login the session must be (staff devices). */
  staffEmail?: Secret | string
  /** The demo patient the portal session must be (patient devices). */
  patientHid?: string
  /** Called once, with the first refusal. The cards stop the run here; the selftest records it. */
  onTrip?: (refusal: GuardRefusal, guard: Guard) => void | Promise<void>
}

const reveal = (value: Secret | string | undefined) => value === undefined ? '' : typeof value === 'string' ? value : value.reveal()

export class Guard {
  readonly requests: ApiRequestRecord[] = []
  readonly refusals: GuardRefusal[] = []
  tripped: GuardRefusal | null = null
  /** Patient Two's grants by id, learned from GET identity/me/access-history: true for a Demo Hospital share. */
  readonly grants = new Map<string, { demoHospital: boolean; status: string }>()
  private noOnlineSignIn = false
  private revokeArmed = false
  private readonly records = new WeakMap<Request, ApiRequestRecord>()
  private installed = false

  constructor(readonly context: BrowserContext, readonly options: GuardOptions) {}

  get policy(): WritePolicy {
    const revocable = this.revokeArmed && this.options.role === 'patient2'
      ? new Set([...this.grants].filter(([, grant]) => grant.demoHospital).map(([id]) => id))
      : new Set<string>()
    return { device: this.options.role, allowLocal: this.options.allowLocal === true, noOnlineSignIn: this.noOnlineSignIn, revocableGrantIds: revocable }
  }

  /** T9 and T11. */
  setNoOnlineSignIn(on: boolean): void { this.noOnlineSignIn = on }

  /** T7 revoke mode only: lets Patient Two revoke the Demo Hospital share (never the Demo Outreach one). */
  armDemoHospitalRevoke(on: boolean): void { this.revokeArmed = on }

  /** Records the refusal; the first one trips the guard, and from then on every request of this context is aborted. */
  trip(refusal: GuardRefusal): GuardRefusal {
    this.refusals.push(refusal)
    if (this.tripped) return refusal
    this.tripped = refusal
    void Promise.resolve(this.options.onTrip?.(refusal, this)).catch(() => undefined)
    return refusal
  }

  assertNotTripped(): void {
    if (this.tripped) throw this.tripped
  }

  /** Runs one check and trips the guard if it refuses. */
  enforce(check: () => void): void {
    try { check() }
    catch (error) {
      if (error instanceof GuardRefusal) throw this.trip(error)
      throw error
    }
  }

  private evaluate(request: Request): GuardRefusal | null {
    try {
      if (isMainFrameNavigation(request)) checkNavigation(request.url(), { allowLocal: this.options.allowLocal === true })
      // The body is read only for /api/v1/ requests (an upload to document storage can be megabytes).
      const api = (() => { try { return new URL(request.url()).pathname.startsWith(API_PREFIX) } catch { return true } })()
      checkWrite({ method: request.method(), url: request.url(), headers: request.headers(), body: api ? request.postDataBuffer()?.toString('utf8') ?? null : null }, this.policy)
      return null
    } catch (error) {
      if (error instanceof GuardRefusal) return error
      // Fail closed: a request the guard cannot read is not sent.
      return new GuardRefusal('guard-error', 'The guard could not read a request')
    }
  }

  private async onRoute(route: Route): Promise<void> {
    const request = route.request()
    if (this.tripped) { await route.abort('blockedbyclient').catch(() => undefined); return }
    const refusal = this.evaluate(request)
    if (refusal) {
      this.trip(refusal)
      const record = this.records.get(request)
      if (record) record.failure = 'aborted by the guard'
      await route.abort('blockedbyclient').catch(() => undefined)
      return
    }
    // fallback, not continue: a later-registered handler (the selftest's) still sees the request. Nothing is changed.
    await route.fallback().catch(() => undefined)
  }

  private onRequest(request: Request): void {
    let url: URL
    try { url = new URL(request.url()) } catch { return }
    if (url.pathname.startsWith(API_PREFIX)) {
      const header = (name: string) => request.headers()[name] ?? null
      const record: ApiRequestRecord = {
        at: Date.now(), method: request.method(), path: url.pathname, idempotencyKey: header('idempotency-key'),
        offlineCommand: header('x-hid-offline-command'), capturedAt: header('x-hid-captured-at'), clock: header('x-hid-clock'),
        fromServiceWorker: madeByServiceWorker(request), status: null, failure: null,
      }
      this.records.set(request, record)
      this.requests.push(record)
    }
    // (e) Routing may not see a request a service worker makes: whatever the context reports is checked again.
    if (this.tripped) return
    const refusal = this.evaluate(request)
    if (refusal) {
      const source = madeByServiceWorker(request) ? 'from the service worker, ' : ''
      this.trip(new GuardRefusal(refusal.rule, `${refusal.message.replace(/^Guard refused \([^)]*\): /, '')} (${source}seen by the request watcher)`))
    }
  }

  private async onResponse(response: Response): Promise<void> {
    const request = response.request()
    const record = this.records.get(request)
    if (record) record.status = response.status()
    if (!response.ok()) return
    let path: string
    try { path = new URL(response.url()).pathname } catch { return }
    const method = request.method()
    const json = async () => { try { return await response.json() as unknown } catch { return undefined } }
    // (b) again, on every session the app itself reads: a facility switch away from Demo Hospital stops the run.
    if (this.options.role === 'staff' && ((method === 'GET' && path === '/api/v1/auth/session')
      || (method === 'POST' && (LOGIN.test(path) || FACILITY_SELECT.test(path))))) {
      const body = await json()
      if (isRecord(body) && isRecord(body.actor)) {
        const refusal = this.evaluateSession(() => checkStaffSession(body, reveal(this.options.staffEmail), { requireFacility: false }))
        if (refusal) this.trip(refusal)
      }
    }
    // (c) again, on every profile the portal reads.
    if ((this.options.role === 'patient1' || this.options.role === 'patient2') && method === 'GET' && path === '/api/v1/identity/me') {
      const body = await json()
      if (isRecord(body) && typeof body.hid === 'string') {
        const refusal = this.evaluateSession(() => checkPatientSession({ actor: { kind: 'patient' } }, body, this.options.patientHid ?? ''))
        if (refusal) this.trip(refusal)
      }
    }
    // Patient Two's shares, so T7 can revoke the Demo Hospital one only.
    if (this.options.role === 'patient2' && method === 'GET' && path === '/api/v1/identity/me/access-history') {
      const body = await json()
      const items = isRecord(body) && Array.isArray(body.items) ? body.items : []
      for (const item of items) {
        if (!isRecord(item) || typeof item.consentGrantId !== 'string') continue
        this.grants.set(item.consentGrantId, { demoHospital: item.facilityName === DEMO.hospitalName, status: String(item.status ?? '') })
      }
    }
  }

  private evaluateSession(check: () => void): GuardRefusal | null {
    try { check(); return null } catch (error) { return error instanceof GuardRefusal ? error : new GuardRefusal('guard-error', 'The guard could not read a session') }
  }

  async install(): Promise<this> {
    if (this.installed) return this
    this.installed = true
    this.context.on('request', request => this.onRequest(request))
    this.context.on('response', response => { void this.onResponse(response) })
    this.context.on('requestfailed', request => {
      const record = this.records.get(request)
      if (record && !record.failure) record.failure = request.failure()?.errorText ?? 'failed'
    })
    await this.context.route('**/*', route => this.onRoute(route))
    return this
  }

  // --- GET-only reads for the session checks (they share the context's cookies) ---

  /** A GET from the kit itself, only to this device's own host. Never anything else. */
  async get(path: string, headers: Readonly<Record<string, string>> = {}): Promise<APIResponse> {
    if (!path.startsWith('/api/v1/')) throw new Error('The kit reads only /api/v1/ paths')
    const scheme = this.options.allowLocal && this.options.host.startsWith(`${LOCAL_HOST}:`) ? 'http' : 'https'
    const url = new URL(path, `${scheme}://${this.options.host}`)
    if (!apiHostAllowed(url, this.options.allowLocal === true)) throw this.trip(new GuardRefusal('write-host', `A kit read from ${url.host}`))
    const facility = headers['X-Facility-ID'] ?? headers['x-facility-id']
    if (facility !== undefined && facility !== DEMO.facilities.hospital) throw this.trip(new GuardRefusal('write-facility', 'A kit read for a facility that is not Demo Hospital'))
    return await this.context.request.get(url.toString(), { headers: { Accept: 'application/json', ...headers }, failOnStatusCode: false })
  }

  /** (b): the session at this device's host, strictly (Demo Hospital chosen). Trips the guard on refusal. */
  async verifyStaffSession(): Promise<void> {
    this.assertNotTripped()
    const response = await this.get('/api/v1/auth/session')
    const body = response.ok() ? await response.json().catch(() => null) as unknown : null
    this.enforce(() => {
      if (!response.ok()) refuse('staff-session', `GET /api/v1/auth/session answered ${response.status()}`)
      checkStaffSession(body, reveal(this.options.staffEmail))
    })
  }

  /** (c): the portal session and profile. Trips the guard on refusal. */
  async verifyPatientSession(): Promise<void> {
    this.assertNotTripped()
    const sessionResponse = await this.get('/api/v1/auth/session')
    const session = sessionResponse.ok() ? await sessionResponse.json().catch(() => null) as unknown : null
    const profileResponse = await this.get('/api/v1/identity/me')
    const profile = profileResponse.ok() ? await profileResponse.json().catch(() => null) as unknown : null
    this.enforce(() => checkPatientSession(session, profile, this.options.patientHid ?? ''))
  }

  /** API requests after `since` (an index into `requests`), oldest first. */
  requestsSince(since: number): ApiRequestRecord[] { return this.requests.slice(since) }
}

export async function installGuard(context: BrowserContext, options: GuardOptions): Promise<Guard> {
  return await new Guard(context, options).install()
}
