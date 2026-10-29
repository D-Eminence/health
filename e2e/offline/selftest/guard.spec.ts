import { createServer } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import type { Browser, BrowserContext, FullConfig, Page } from '@playwright/test'
import { cardEnv, missingVariables, REQUIRED_VARIABLES, runClaimFile, runDir, Secret, SELFTEST_SECRET_VARIABLE, VariableError } from '../support/env'
import globalSetup, { cardsMayRun, gateProblems } from '../support/global-setup'
import { checkNavigation, checkPatientSession, checkStaffSession, checkWrite, DEMO, GuardRefusal, installGuard } from '../support/guard'
import type { DeviceRole, Guard, WritePolicy } from '../support/guard'
import { setSecret } from '../support/devices'

/**
 * The guard and the gate, proved on 127.0.0.1 only. Each check is called as a function that throws, so a refusal is
 * an expectation here rather than the end of the selftest; the runtime tests use a local server with fake session and
 * write endpoints. Every value below is fictional; the ids outside the demo tenant are made up.
 */

const NOT_DEMO_FACILITY = '00000000-0000-4000-8000-0000000000aa'
const NOT_DEMO_ACCOUNT = '00000000-0000-4000-8000-0000000000bb'
const NOT_DEMO_HID = 'HID-ZZZZ0000'

/** A staff session with the live shape: id is the account subject, accountId the account uuid. */
function demoSession(change: (actor: Record<string, unknown>) => void = () => undefined): unknown {
  const actor: Record<string, unknown> = {
    id: DEMO.staff.subject, subject: DEMO.staff.subject, accountId: DEMO.staff.accountId, email: DEMO.staff.email,
    displayName: 'Demo Operations', roles: ['doctor', 'org_admin'], permissions: ['ehr.encounter.read'],
    facilities: [
      { id: DEMO.facilities.hospital, name: 'Demo Hospital', isPrimary: true },
      { id: DEMO.facilities.outreach, name: 'Demo Outreach', isPrimary: false },
    ],
    facility: { id: DEMO.facilities.hospital, name: 'Demo Hospital', isPrimary: true },
  }
  change(actor)
  return { actor }
}

const policy = (device: DeviceRole = 'staff', more: Partial<WritePolicy> = {}): WritePolicy =>
  ({ device, allowLocal: true, noOnlineSignIn: false, revocableGrantIds: new Set(), ...more })

const write = (path: string, o: { headers?: Record<string, string>; body?: unknown; method?: string } = {}) => ({
  method: o.method ?? 'POST', url: `https://${'ehr.healthidentitydirectory.com'}${path}`,
  headers: o.headers ?? { 'x-facility-id': DEMO.facilities.hospital },
  body: o.body === undefined ? null : JSON.stringify(o.body),
})

// --- The local server -------------------------------------------------------------------------------------------

interface Fake {
  server: Server
  origin: string
  host: string
  session: unknown
  received: { method: string; path: string; headers: IncomingHttpHeaders }[]
}

const HOME = `<!doctype html><meta charset="utf-8"><title>Selftest</title><h1>Selftest home</h1>
<iframe id="frame" src="http://frame.invalid/inner"></iframe>
<script>
window.selftestPost = (path, headers, body) =>
  fetch(path, { method: 'POST', headers, body }).then(response => response.status, () => 'blocked')
</script>`

const SIGN_IN = `<!doctype html><meta charset="utf-8"><title>Sign in</title>
<form id="form"><input id="staff-email" type="email"><input id="staff-password" type="password">
<button id="submit" type="submit" disabled>Sign in</button></form><p id="result"></p>
<script>
// Like a React controlled form: the state changes only on input events, and the submit sends the state.
const state = { email: '', password: '' }
document.getElementById('staff-email').addEventListener('input', event => { state.email = event.target.value })
document.getElementById('staff-password').addEventListener('input', event => { state.password = event.target.value })
setTimeout(() => { document.getElementById('submit').disabled = false }, 400)
document.getElementById('form').addEventListener('submit', async event => {
  event.preventDefault()
  const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
  document.getElementById('result').textContent = response.ok ? 'Signed in' : 'Refused'
})
</script>`

const SW_PAGE = `<!doctype html><meta charset="utf-8"><title>Worker</title><p>Worker page</p>
<script>
window.swReady = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready)
window.swPost = async (path, facility) => {
  const registration = await window.swReady
  return await new Promise(resolve => {
    navigator.serviceWorker.addEventListener('message', event => resolve(event.data.status), { once: true })
    registration.active.postMessage({ path, facility })
  })
}
</script>`

const SW = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('message', event => {
  const { path, facility } = event.data
  event.waitUntil(fetch(path, { method: 'POST', headers: { 'X-Facility-ID': facility, 'Content-Type': 'application/json' }, body: '{}' })
    .then(response => event.source.postMessage({ status: response.status }), () => event.source.postMessage({ status: 'blocked' })))
})`

async function startFake(): Promise<Fake> {
  const fake = { session: demoSession(), received: [] } as unknown as Fake
  fake.server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      const send = (status: number, type: string, body: string) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body) }
      if (request.method === 'GET' && path === '/') return send(200, 'text/html', HOME)
      if (request.method === 'GET' && path === '/sign-in') return send(200, 'text/html', SIGN_IN)
      if (request.method === 'GET' && path === '/sw-page') return send(200, 'text/html', SW_PAGE)
      if (request.method === 'GET' && path === '/sw.js') return send(200, 'text/javascript', SW)
      if (request.method === 'GET' && path === '/api/v1/auth/session') return send(200, 'application/json', JSON.stringify(fake.session))
      if (path.startsWith('/api/v1/')) {
        fake.received.push({ method: request.method ?? '', path, headers: request.headers })
        if (path === '/api/v1/auth/login') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { password?: string }
          return send(body.password === process.env[SELFTEST_SECRET_VARIABLE] ? 200 : 401, 'application/json', '{}')
        }
        return send(200, 'application/json', '{"ok":true}')
      }
      send(404, 'text/plain', 'not found')
    })
  })
  await new Promise<void>(resolve => fake.server.listen(0, '127.0.0.1', resolve))
  const port = (fake.server.address() as AddressInfo).port
  fake.host = `127.0.0.1:${port}`
  fake.origin = `http://${fake.host}`
  return fake
}

let fake: Fake
test.beforeAll(async () => { fake = await startFake() })
test.afterAll(async () => { await new Promise(resolve => fake.server.close(resolve)) })
test.beforeEach(() => { fake.received.length = 0; fake.session = demoSession() })

/** A context on the local server, with the guard installed (its trips recorded, never stopping the selftest). */
async function guarded(browser: Browser, role: DeviceRole = 'staff', setup?: (context: BrowserContext) => Promise<void>): Promise<{ context: BrowserContext; page: Page; guard: Guard }> {
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  if (setup) await setup(context)
  const guard = await installGuard(context, { role, label: 'selftest', host: fake.host, allowLocal: true, staffEmail: DEMO.staff.email, patientHid: DEMO.patients.one })
  const page = await context.newPage()
  return { context, page, guard }
}

async function post(page: Page, path: string, headers: Record<string, string>, body: unknown): Promise<number | 'blocked'> {
  return await page.evaluate(([target, sent, data]) =>
    (window as unknown as { selftestPost: (p: string, h: Record<string, string>, b: string) => Promise<number | 'blocked'> }).selftestPost(target, sent, data),
  [path, { 'Content-Type': 'application/json', ...headers }, JSON.stringify(body)] as const)
}

// --- The eight refusals -----------------------------------------------------------------------------------------

test.describe('the guard refuses', () => {
  test('(1) a session whose facility is not Demo Hospital', async ({ browser }) => {
    for (const other of [DEMO.facilities.laboratory, NOT_DEMO_FACILITY]) {
      const session = demoSession(actor => { actor.facility = { id: other, name: 'Elsewhere' } })
      expect(() => checkStaffSession(session, DEMO.staff.email)).toThrow(GuardRefusal)
    }
    expect(() => checkStaffSession(demoSession(actor => { delete actor.facility }), DEMO.staff.email)).toThrow(/no working facility/)
    // At runtime, against the fake session endpoint: the guard trips.
    fake.session = demoSession(actor => { actor.facility = { id: DEMO.facilities.pharmacy, name: 'Demo Pharmacy' } })
    const { context, guard } = await guarded(browser)
    await expect(guard.verifyStaffSession()).rejects.toThrow(/actor\.facility is not Demo Hospital/)
    expect(guard.tripped?.rule).toBe('staff-session')
    await context.close()
  })

  test('(2) a session whose facilities list includes a non-demo id', async ({ browser }) => {
    const session = demoSession(actor => { (actor.facilities as unknown[]).push({ id: NOT_DEMO_FACILITY, name: 'Not demo' }) })
    expect(() => checkStaffSession(session, DEMO.staff.email)).toThrow(/outside the demo tenant/)
    fake.session = session
    const { context, guard } = await guarded(browser)
    await expect(guard.verifyStaffSession()).rejects.toThrow(GuardRefusal)
    await context.close()
  })

  test('(3) a session whose accountId or subject is not the demo staff', async () => {
    expect(() => checkStaffSession(demoSession(actor => { actor.accountId = NOT_DEMO_ACCOUNT }), DEMO.staff.email)).toThrow(/accountId/)
    expect(() => checkStaffSession(demoSession(actor => { actor.id = `sealed-demo:${NOT_DEMO_ACCOUNT}` }), DEMO.staff.email)).toThrow(/actor\.id/)
    // actor.id is the subject: an actor.id holding the account uuid is refused.
    expect(() => checkStaffSession(demoSession(actor => { actor.id = DEMO.staff.accountId }), DEMO.staff.email)).toThrow(/subject/)
    expect(() => checkStaffSession(demoSession(actor => { actor.subject = `sealed-demo:${NOT_DEMO_ACCOUNT}` }), DEMO.staff.email)).toThrow(/subject/)
    expect(() => checkStaffSession(demoSession(actor => { actor.email = 'someone@example.invalid' }), DEMO.staff.email)).toThrow(/email/)
    expect(() => checkStaffSession(demoSession(), 'someone@example.invalid')).toThrow(/HID_DEMO_STAFF_EMAIL/)
  })

  test('(4) a write whose X-Facility-ID is not Demo Hospital', async ({ browser }) => {
    for (const other of [DEMO.facilities.outreach, NOT_DEMO_FACILITY]) {
      expect(() => checkWrite(write('/api/v1/ehr/patients/x/encounters', { headers: { 'x-facility-id': other }, body: {} }), policy())).toThrow(/X-Facility-ID/)
    }
    const { context, page, guard } = await guarded(browser)
    await page.goto(`${fake.origin}/`)
    expect(await post(page, '/api/v1/ehr/patients/x/encounters', { 'X-Facility-ID': NOT_DEMO_FACILITY }, {})).toBe('blocked')
    expect(fake.received).toEqual([])
    expect(guard.tripped?.rule).toBe('write-facility')
    await context.close()
  })

  test('(5) a write whose body hid is not a demo HID', async ({ browser }) => {
    expect(() => checkWrite(write('/api/v1/identity/patient-lookup', { body: { hid: NOT_DEMO_HID, purpose: 'direct-care' } }), policy())).toThrow(/Health ID outside/)
    expect(() => checkWrite(write('/api/v1/identity/access-requests', { body: { hid: ' hid-zzzz0000 ', scope: 'write_records' } }), policy())).toThrow(GuardRefusal)
    expect(() => checkWrite(write('/api/v1/ehr/x', { body: { content: `see ${NOT_DEMO_HID}` } }), policy())).toThrow(GuardRefusal)
    const { context, page, guard } = await guarded(browser)
    await page.goto(`${fake.origin}/`)
    expect(await post(page, '/api/v1/identity/patient-lookup', { 'X-Facility-ID': DEMO.facilities.hospital }, { hid: NOT_DEMO_HID })).toBe('blocked')
    expect(fake.received).toEqual([])
    expect(guard.tripped?.rule).toBe('write-hid')
    await context.close()
  })

  test('(6) a grant close', async ({ browser }) => {
    expect(() => checkWrite(write('/api/v1/identity/consent-grants/11111111-1111-4111-8111-111111111111/close', { body: { reason: 'x' } }), policy())).toThrow(/grant close/)
    const { context, page, guard } = await guarded(browser)
    await page.goto(`${fake.origin}/`)
    expect(await post(page, '/api/v1/identity/consent-grants/g1/close', { 'X-Facility-ID': DEMO.facilities.hospital }, { reason: 'closing' })).toBe('blocked')
    expect(fake.received).toEqual([])
    expect(guard.tripped?.rule).toBe('grant-close')
    await context.close()
  })

  test('(7) a missing environment variable, named without printing values', async () => {
    const provided = Object.fromEntries(REQUIRED_VARIABLES.slice(0, 4).map((name, index) => [name, `value-${index}-${Date.now()}`]))
    let refusal: unknown
    try { cardEnv(provided) } catch (error) { refusal = error }
    expect(refusal).toBeInstanceOf(VariableError)
    const message = (refusal as Error).message
    for (const name of REQUIRED_VARIABLES.slice(4)) expect(message).toContain(name)
    for (const value of Object.values(provided)) expect(message).not.toContain(value)
    expect(missingVariables({})).toEqual([...REQUIRED_VARIABLES])
    // The cards gate names the same variables, and only them.
    const config = { projects: [{ name: 'ehr-cards', use: { headless: false } }] } as unknown as Pick<FullConfig, 'projects'>
    const problems = gateProblems(config, { ...provided, DISPLAY: ':0' }).join('\n')
    for (const name of REQUIRED_VARIABLES.slice(4)) expect(problems).toContain(name)
    for (const value of Object.values(provided)) expect(problems).not.toContain(value)
    // A Secret never prints its value.
    const secret = new Secret('fictional-value-123')
    expect([String(secret), `${secret}`, JSON.stringify({ secret }), inspect({ secret })].join(' ')).not.toContain('fictional-value-123')
  })

  test('(8) a main-frame navigation to a host not on the allowlist, while a subframe to one loads', async ({ browser }) => {
    expect(() => checkNavigation('https://example.invalid/', { allowLocal: false })).toThrow(/not one of the three Health ID hosts/)
    expect(() => checkNavigation('https://ehr.healthidentitydirectory.com.example.invalid/', { allowLocal: false })).toThrow(GuardRefusal)
    expect(() => checkNavigation('http://ehr.healthidentitydirectory.com/', { allowLocal: false })).toThrow(GuardRefusal)
    expect(() => checkNavigation(`${fake.origin}/`, { allowLocal: false })).toThrow(GuardRefusal)
    expect(() => checkNavigation('https://ehr.healthidentitydirectory.com/provider/clinical', { allowLocal: false })).not.toThrow()
    // The subframe's host is served by a route registered before the guard, so the guard decides first.
    const { context, page, guard } = await guarded(browser, 'staff', async ctx => {
      await ctx.route('http://frame.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<p id="inner">frame loaded</p>' }))
    })
    await page.goto(`${fake.origin}/`)
    await expect(page.frameLocator('#frame').locator('#inner')).toHaveText('frame loaded')
    expect(guard.tripped).toBeNull()
    await expect(page.goto('http://frame.invalid/inner')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
    expect(guard.tripped?.rule).toBe('navigation')
    await context.close()
  })
})

// --- The pass case ----------------------------------------------------------------------------------------------

test.describe('the guard passes', () => {
  test('a valid demo session and a valid demo write', async ({ browser }) => {
    expect(() => checkStaffSession(demoSession(), DEMO.staff.email)).not.toThrow()
    expect(() => checkStaffSession(demoSession(actor => { delete actor.facility }), DEMO.staff.email, { requireFacility: false })).not.toThrow()
    expect(checkWrite(write('/api/v1/identity/patient-lookup', { body: { hid: DEMO.patients.one, purpose: 'direct-care' } }), policy())).toBe('allowed')
    expect(checkWrite(write('/api/v1/identity/break-glass', { body: { hid: 'HID-ZDEMBBB2', reason: 'E2E fictional', durationMinutes: 30 } }), policy())).toBe('allowed')
    expect(checkWrite(write('/api/v1/ehr/patients/x', { method: 'GET' }), policy())).toBe('read')
    expect(checkWrite(write('/assets/app.js', {}), policy())).toBe('not-api')
    expect(() => checkPatientSession({ actor: { kind: 'patient', patientId: 'p1' } }, { hid: DEMO.patients.one, patientId: 'p1' }, DEMO.patients.one)).not.toThrow()

    const { context, page, guard } = await guarded(browser)
    await guard.verifyStaffSession()
    await page.goto(`${fake.origin}/`)
    expect(await post(page, '/api/v1/identity/patient-lookup', { 'X-Facility-ID': DEMO.facilities.hospital, 'Idempotency-Key': 'off1.00000000-0000-4000-8000-000000000001' },
      { hid: DEMO.patients.one, purpose: 'direct-care' })).toBe(200)
    expect(fake.received.map(item => item.path)).toEqual(['/api/v1/identity/patient-lookup'])
    expect(fake.received[0]?.headers['x-facility-id']).toBe(DEMO.facilities.hospital)
    expect(guard.tripped).toBeNull()
    const record = guard.requests.find(item => item.path === '/api/v1/identity/patient-lookup')
    expect(record?.idempotencyKey).toBe('off1.00000000-0000-4000-8000-000000000001')
    expect(record?.status).toBe(200)
    await context.close()
  })
})

// --- More rules the cards rely on -------------------------------------------------------------------------------

test.describe('the guard also refuses', () => {
  test('a non-demo patient, and the wrong demo patient for a device', () => {
    const session = { actor: { kind: 'patient', patientId: 'p1' } }
    expect(() => checkPatientSession(session, { hid: NOT_DEMO_HID, patientId: 'p1' }, DEMO.patients.one)).toThrow(/not a demo patient/)
    expect(() => checkPatientSession(session, { hid: DEMO.patients.two, patientId: 'p1' }, DEMO.patients.one)).toThrow(/not the demo patient/)
    expect(() => checkPatientSession({ actor: { kind: 'staff' } }, { hid: DEMO.patients.one }, DEMO.patients.one)).toThrow(/not a patient session/)
  })

  test('a revoke from Patient One, and any revoke from Patient Two but its armed Demo Hospital share', () => {
    const revoke = write('/api/v1/identity/me/consent-grants/g-hospital/revoke', { headers: {}, body: { reason: 'E2E' } })
    expect(() => checkWrite(revoke, policy('patient1'))).toThrow(/Patient One/)
    expect(() => checkWrite(revoke, policy('patient2'))).toThrow(/only the Demo Hospital share/)
    expect(() => checkWrite(revoke, policy('patient2', { revocableGrantIds: new Set(['g-outreach']) }))).toThrow(GuardRefusal)
    expect(checkWrite(revoke, policy('patient2', { revocableGrantIds: new Set(['g-hospital']) }))).toBe('allowed')
    expect(() => checkWrite(revoke, policy('staff', { revocableGrantIds: new Set(['g-hospital']) }))).toThrow(GuardRefusal)
  })

  test('an online sign-in during T9 and T11, emergency access for a patient with a login, a read-only write, a body that is not JSON', () => {
    const login = write('/api/v1/auth/login', { headers: {}, body: { email: 'x', password: 'y' } })
    expect(checkWrite(login, policy())).toBe('allowed')
    expect(() => checkWrite(login, policy('staff', { noOnlineSignIn: true }))).toThrow(/online sign-in/)
    expect(() => checkWrite(write('/api/v1/identity/break-glass', { body: { hid: DEMO.patients.one, reason: 'x' } }), policy())).toThrow(/Emergency access/)
    expect(() => checkWrite(write('/api/v1/ehr/x', { body: {} }), policy('reader'))).toThrow(/read-only/)
    expect(checkWrite(write('/api/v1/auth/refresh', { headers: {}, body: {} }), policy('reader'))).toBe('allowed')
    expect(() => checkWrite({ ...write('/api/v1/ehr/x'), body: 'not json' }, policy())).toThrow(/not JSON/)
    expect(() => checkWrite(write('/api/v1/auth/facility', { headers: {}, body: { facilityId: DEMO.facilities.outreach } }), policy())).toThrow(/facility switch|not Demo Hospital/)
    expect(() => checkWrite({ ...write('/api/v1/ehr/x', { body: {} }), url: 'https://api.example.invalid/api/v1/ehr/x' }, policy())).toThrow(/not one of the three/)
    expect(() => checkWrite(write('/api/v1/identity/me/access-pin', { headers: {}, body: { pin: '0000' } }), policy('patient1'))).toThrow(/account settings/)
  })

  test('a write made by a service worker (routed and aborted, or caught by the request watcher)', async ({ browser }) => {
    const { context, page, guard } = await guarded(browser)
    await page.goto(`${fake.origin}/sw-page`)
    await page.evaluate(() => (window as unknown as { swReady: Promise<unknown> }).swReady)
    const status = await page.evaluate(path => (window as unknown as { swPost: (p: string, f: string) => Promise<number | 'blocked'> })
      .swPost(path, '00000000-0000-4000-8000-0000000000aa'), '/api/v1/ehr/from-worker')
    expect(guard.tripped?.rule).toBe('write-facility')
    test.info().annotations.push({ type: 'note', description: status === 'blocked'
      ? 'This Playwright and Chromium route service worker requests: the write was aborted before it left the browser.'
      : 'This Playwright and Chromium do not route this service worker request: it reached the server, and the request watcher stopped the run.' })
    expect(fake.received.filter(item => item.path === '/api/v1/ehr/from-worker').length).toBe(status === 'blocked' ? 0 : 1)
    await context.close()
  })
})

// --- The gate ---------------------------------------------------------------------------------------------------

test.describe('the cards gate', () => {
  test('acts unless only localhost projects are selected', () => {
    expect(cardsMayRun(['node', 'playwright', 'test', '--project=selftest'])).toBe(false)
    expect(cardsMayRun(['node', 'playwright', 'test', '--project', 'selftest'])).toBe(false)
    expect(cardsMayRun(['node', 'playwright', 'test'])).toBe(true)
    expect(cardsMayRun(['node', 'playwright', 'test', '--project=selftest', '--project=ehr-cards'])).toBe(true)
    expect(cardsMayRun(['node', 'playwright', 'test', '--project', 'selftest', 'ehr-cards'])).toBe(true)
    expect(cardsMayRun(['node', 'playwright', 'test', '--project=*'])).toBe(true)
  })

  test('refuses headless, CI, no display, a used run id, "local", and T7 with a release card', () => {
    const all = Object.fromEntries(REQUIRED_VARIABLES.map(name => [name, `fictional-${name.toLowerCase()}`]))
    const headed = { projects: [{ name: 'ehr-cards', use: { headless: false } }] } as unknown as Pick<FullConfig, 'projects'>
    const headless = { projects: [{ name: 'ehr-cards', use: { headless: true } }] } as unknown as Pick<FullConfig, 'projects'>
    const used = `selftest-used-${Date.now()}`
    mkdirSync(runDir(used), { recursive: true })
    try {
      const fresh = { ...all, HID_E2E_RUN_ID: `selftest-fresh-${Date.now()}`, DISPLAY: ':0' }
      expect(gateProblems(headed, fresh)).toEqual([])
      expect(gateProblems(headless, fresh).join()).toContain('not headed')
      expect(gateProblems(headed, { ...fresh, CI: 'true' }).join()).toContain('CI is set')
      if (process.platform === 'linux') expect(gateProblems(headed, { ...fresh, DISPLAY: '' }).join()).toContain('no display')
      expect(gateProblems(headed, { ...fresh, HID_E2E_RUN_ID: used }).join()).toContain('already exists')
      expect(gateProblems(headed, { ...fresh, HID_E2E_RUN_ID: 'local' }).join()).toContain('"local"')
      expect(gateProblems(headed, { ...fresh, HID_E2E_RUN_ID: '../escape' }).join()).toContain('HID_E2E_RUN_ID')
      expect(gateProblems(headed, { ...fresh, HID_E2E_T7_MODE: 'revoke', HID_E2E_RELEASE_CARD: 'T16' }).join()).toContain('both set')
      expect(gateProblems(headed, { ...fresh, HID_E2E_RELEASE_CARD: 'T18' }).join()).toContain('HID_E2E_RELEASE_CARD')
      // Values never appear in a refusal.
      for (const value of Object.values(all)) expect(gateProblems(headless, { ...fresh, CI: '1' }).join()).not.toContain(value)
    } finally { rmSync(runDir(used), { recursive: true, force: true }) }
  })
})

test.describe('the cards gate itself (global-setup.ts, called as Playwright calls it, with fake values)', () => {
  const cards = ['node', 'playwright', 'test', '--project=ehr-cards', '--project=migrate-cards', '--project=portal-cards', '--max-failures=1']
  const headed = { projects: [{ name: 'ehr-cards', use: { headless: false } }, { name: 'selftest', use: { headless: true } }] } as unknown as FullConfig
  const headless = { projects: [{ name: 'ehr-cards', use: { headless: true } }] } as unknown as FullConfig
  const fictional = () => Object.fromEntries(REQUIRED_VARIABLES.map(name => [name, `fictional-${name.toLowerCase()}-${Date.now()}`]))

  test('does nothing for the selftest', async () => {
    await expect(globalSetup(headless, ['node', 'playwright', 'test', '--project=selftest'], {})).resolves.toBeUndefined()
  })

  test('refuses without the variables, naming only the missing ones', async () => {
    const some = fictional()
    delete some.HID_DEMO_PATIENT2_PASSWORD
    delete some.HID_E2E_RUN_ID
    const refusal = await globalSetup(headed, cards, { ...some, DISPLAY: ':0' }).then(() => null, (error: Error) => error.message)
    expect(refusal).toContain('HID_DEMO_PATIENT2_PASSWORD')
    expect(refusal).toContain('HID_E2E_RUN_ID')
    for (const value of Object.values(some)) expect(refusal).not.toContain(value)
    const none = await globalSetup(headed, cards, { DISPLAY: ':0' }).then(() => null, (error: Error) => error.message)
    for (const name of REQUIRED_VARIABLES) expect(none).toContain(name)
  })

  test('refuses headless, and a used run id; claims a fresh one', async () => {
    const env = { ...fictional(), HID_E2E_RUN_ID: `selftest-gate-${Date.now()}`, DISPLAY: ':0' }
    await expect(globalSetup(headless, cards, env)).rejects.toThrow(/not headed/)
    try {
      await expect(globalSetup(headed, cards, env)).resolves.toBeUndefined()
      const claim = JSON.parse(readFileSync(runClaimFile(env.HID_E2E_RUN_ID), 'utf8')) as { runId: string; pid: number }
      expect(claim).toMatchObject({ runId: env.HID_E2E_RUN_ID, pid: process.pid })
      // The same run id again: refused.
      await expect(globalSetup(headed, cards, env)).rejects.toThrow(/already exists/)
    } finally { rmSync(runDir(env.HID_E2E_RUN_ID), { recursive: true, force: true }) }
    expect(existsSync(runDir(env.HID_E2E_RUN_ID))).toBe(false)
  })
})

// --- setSecret --------------------------------------------------------------------------------------------------

test('setSecret signs in with the fake password the way React sees typing', async ({ browser }) => {
  const fakePassword = process.env[SELFTEST_SECRET_VARIABLE]
  if (!fakePassword) throw new Error('The config sets the selftest password')
  const { context, page, guard } = await guarded(browser)
  await page.goto(`${fake.origin}/sign-in`)
  await setSecret(page.locator('#staff-email'), new Secret('selftest@example.invalid'))
  await setSecret(page.locator('#staff-password'), new Secret(fakePassword))
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The server compares the password it received with the fake one: proof the value was set, not shown.
  await expect(page.locator('#result')).toHaveText('Signed in')
  expect(guard.tripped).toBeNull()
  await context.close()
})
