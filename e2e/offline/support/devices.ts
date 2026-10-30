import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test as base, expect } from '@playwright/test'
import type { BrowserContext, BrowserType, CDPSession, Locator, Page, TestInfo } from '@playwright/test'
import { cardEnv, guardStopFile, KIT_ROOT, PROFILES_DIR, readRunClaim, releaseMarkerFile, secretValuesForScan } from './env'
import type { CardEnv, Secret } from './env'
import { DEMO, GuardRefusal, HOSTS, installGuard } from './guard'
import type { DeviceRole, Guard, HostName } from './guard'
import { CLINICAL, FACILITY, NAV, OFFLINE, PATIENTS, PORTAL, ROUTES, STAFF_SIGN_IN } from './selectors'
import { describeReport, storageReport } from './storage'
import type { StorageReport } from './storage'

/**
 * Devices: one persistent browser profile per device (never tabs in one window: the staff workspace locks as soon as
 * its page is hidden), the network and clock switches the cards use, the sign-in and the EHR and portal steps, and the
 * fixtures the cards are written with.
 *
 * Profiles live under out/profiles/: A (ehr. and migrate.), B (ehr.), patient1 and patient2; T1 uses a fresh one of its
 * own, out/profiles/<run id>/A-t1, because the one-time offline choice only appears while a device has no vault. Each
 * profile keeps the browser's password manager off, and holds session cookies: delete out/ after the test day.
 */

// --- Secrets into inputs ----------------------------------------------------------------------------------------

/** Sets a value as typing would for React: the native value setter, then a bubbling input event. Runs in the page. */
function writeValue(element: Element, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error('This element has no value to set')
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * The one way a HID_* value enters a page. Playwright names fill, type, pressSequentially and keyboard steps after
 * the text they enter, and those titles reach every report; this step is named "Evaluate" and carries no value.
 */
export async function setSecret(locator: Locator, secret: Secret): Promise<void> {
  await locator.evaluate(writeValue, secret.reveal())
}

/*
 * Playwright 1.64 copies a password input's value into two places the selftest found: the page snapshot an assertion
 * stores when it fails (its "error context", in the step and the test error), and the page snapshot taken when a
 * failed test ends. So, while a secret is in a field, the kit runs no assertion (it waits with locator.waitFor, which
 * stores no snapshot); the human check is waited for with the fields still empty; and every password field, and any
 * field holding a secret value, is emptied when a test ends, before Playwright's own snapshot.
 */

/** Empties these fields if they are on the page now (no waiting). Never throws. */
export async function scrubFields(page: Page, selectors: readonly string[]): Promise<void> {
  await page.evaluate(list => {
    const prototype = (element: Element) => element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    for (const selector of list) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.value === '') continue
        Object.getOwnPropertyDescriptor(prototype(element), 'value')?.set?.call(element, '')
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }, selectors).catch(() => undefined)
}

/** Empties every password field, and every field whose value is one of `secrets`, on every page of a context. */
export async function scrubContext(context: BrowserContext, secrets: readonly string[]): Promise<void> {
  for (const page of context.pages()) {
    await page.evaluate(values => {
      const wanted = values.map(value => value.trim().toLowerCase())
      for (const element of Array.from(document.querySelectorAll('input, textarea'))) {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.value === '') continue
        const secret = element instanceof HTMLInputElement && element.type === 'password'
        if (!secret && !wanted.includes(element.value.trim().toLowerCase())) continue
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, '')
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }, secrets).catch(() => undefined)
  }
}

/** Long, non-secret text (T14's 9 KB note), without a 9 KB step title. */
export async function setText(locator: Locator, text: string): Promise<void> {
  await locator.evaluate(writeValue, text)
}

// --- Profiles and launching -------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Turns the password manager off before Chromium starts, so nothing is saved even if someone clicks "Save password". */
export function prepareProfile(dir: string): void {
  const preferences = join(dir, 'Default', 'Preferences')
  mkdirSync(dirname(preferences), { recursive: true })
  let current: Record<string, unknown> = {}
  if (existsSync(preferences)) {
    try { const parsed: unknown = JSON.parse(readFileSync(preferences, 'utf8')); if (isRecord(parsed)) current = parsed } catch { current = {} }
  }
  current.credentials_enable_service = false
  current.profile = { ...(isRecord(current.profile) ? current.profile : {}), password_manager_enabled: false }
  writeFileSync(preferences, JSON.stringify(current))
}

/** Launches a persistent profile. A profile the previous worker is still closing is waited for, up to a minute. */
export async function launchProfile(chromium: BrowserType, dir: string, headless: boolean): Promise<BrowserContext> {
  prepareProfile(dir)
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      return await chromium.launchPersistentContext(dir, {
        headless,
        args: ['--password-store=basic'],
        serviceWorkers: 'allow',
        viewport: { width: 1366, height: 900 },
        acceptDownloads: false,
      })
    } catch (error) {
      if (Date.now() > deadline || !/ProcessSingleton|SingletonLock|already in use/i.test(String(error))) throw error
      await sleep(2000)
    }
  }
}

// --- Run control ------------------------------------------------------------------------------------------------

const OPEN_DEVICES = new Set<Device>()

/**
 * The guard's answer to a refusal: write the stop file (every later card refuses to start), take a last screenshot,
 * and close every open device, so the card in progress fails on its next step. With --max-failures=1 the run ends.
 */
export async function stopRun(runId: string, refusal: GuardRefusal, device: Device | null): Promise<void> {
  const file = guardStopFile(runId)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${new Date().toISOString()} ${device?.label ?? 'kit'}: ${refusal.message}\n`, { flag: 'a' })
  let info: TestInfo | null = null
  try { info = base.info() } catch { info = null }
  info?.annotations.push({ type: 'guard', description: `${device?.label ?? 'kit'}: ${refusal.message}` })
  for (const open of OPEN_DEVICES) await scrubContext(open.context, secretValuesForScan())
  if (device && info) {
    const path = info.outputPath('guard-stopped.png')
    await device.page.screenshot({ path, timeout: 5000 }).then(() => info?.attach('guard stopped the run', { path, contentType: 'image/png' }), () => undefined)
  }
  await Promise.all([...OPEN_DEVICES].map(open => open.close().catch(() => undefined)))
}

// --- Devices ----------------------------------------------------------------------------------------------------

export interface DeviceSetup {
  /** 'A', 'B', 'A-t1', 'patient1', 'patient2' (or a selftest name). */
  name: string
  role: DeviceRole
  /** 'https://ehr.healthidentitydirectory.com', or http://127.0.0.1:<port> in the selftest. */
  origin: string
  profileDir: string
  chromium: BrowserType
  headless: boolean
  allowLocal?: boolean
  staffEmail?: Secret
  patientHid?: string
  offlineMode: CardEnv['offlineMode']
  onTrip: (refusal: GuardRefusal, device: Device) => void | Promise<void>
}

export class Device {
  context!: BrowserContext
  page!: Page
  guard!: Guard
  offline = false
  private readonly cdp = new Map<Page, CDPSession>()
  private previousRequests: Guard['requests'] = []

  constructor(readonly setup: DeviceSetup) {}

  get label(): string { return `${this.setup.name} (${new URL(this.setup.origin).host})` }
  get host(): string { return new URL(this.setup.origin).host }
  url(path: string): string { return new URL(path, this.setup.origin).toString() }

  async open(): Promise<this> {
    this.context = await launchProfile(this.setup.chromium, this.setup.profileDir, this.setup.headless)
    this.guard = await installGuard(this.context, {
      role: this.setup.role, label: this.label, host: this.host, allowLocal: this.setup.allowLocal === true,
      ...(this.setup.staffEmail ? { staffEmail: this.setup.staffEmail } : {}),
      ...(this.setup.patientHid ? { patientHid: this.setup.patientHid } : {}),
      onTrip: refusal => this.setup.onTrip(refusal, this),
    })
    this.guard.requests.unshift(...this.previousRequests)
    this.page = this.context.pages()[0] ?? await this.context.newPage()
    this.context.on('page', page => { if (this.offline && this.setup.offlineMode === 'cdp') void this.emulate(page, { offline: true }) })
    OPEN_DEVICES.add(this)
    return this
  }

  async close(): Promise<void> {
    OPEN_DEVICES.delete(this)
    this.cdp.clear()
    if (!this.context) return
    // Playwright snapshots a page as its context closes in a failed test: no secret may be in a field then.
    await scrubContext(this.context, secretValuesForScan())
    await this.context.close().catch(() => undefined)
  }

  /** A fresh browser on the same profile: drops offline emulation and an installed clock (neither survives). */
  async relaunch(): Promise<void> {
    this.previousRequests = [...this.guard.requests]
    await this.close()
    this.offline = false
    await this.open()
  }

  /** Throws if the guard has refused anything on this device. */
  checkGuard(): void { this.guard.assertNotTripped() }

  /** Moves within the app without reloading it (a reload pauses offline use on a tab): history.pushState + popstate. */
  async navigate(path: string): Promise<void> {
    this.checkGuard()
    if (!this.page.url().startsWith(this.setup.origin)) { await this.page.goto(this.url(path)); return }
    await this.page.evaluate(target => {
      window.history.pushState({}, '', target)
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    }, path)
  }

  // --- Network ---

  private async session(page: Page): Promise<CDPSession> {
    let session = this.cdp.get(page)
    if (!session) {
      session = await this.context.newCDPSession(page)
      await session.send('Network.enable')
      this.cdp.set(page, session)
    }
    return session
  }

  private async emulate(page: Page, o: { offline: boolean; latency?: number }): Promise<void> {
    const session = await this.session(page)
    await session.send('Network.emulateNetworkConditions', { offline: o.offline, latency: o.latency ?? 0, downloadThroughput: -1, uploadThroughput: -1 })
  }

  /**
   * Chromium's own offline emulation: context.setOffline, or with HID_E2E_OFFLINE_MODE=cdp,
   * Network.emulateNetworkConditions on every page (whether setOffline also cuts off the active /sw.js is a first-run
   * check). Neither survives a relaunch.
   */
  async goOffline(): Promise<void> {
    if (this.setup.offlineMode === 'cdp') { for (const page of this.context.pages()) await this.emulate(page, { offline: true }) }
    else await this.context.setOffline(true)
    this.offline = true
  }

  async goOnline(): Promise<void> {
    if (this.setup.offlineMode === 'cdp') { for (const page of this.context.pages()) await this.emulate(page, { offline: false }) }
    else await this.context.setOffline(false)
    this.offline = false
  }

  /** Slow connection: 3000 ms of added latency (CDP), or none. */
  async slow(on: boolean): Promise<void> {
    for (const page of this.context.pages()) await this.emulate(page, { offline: false, latency: on ? 3000 : 0 })
  }

  /** Flapping: offline and online in turn, every 5 seconds, for `durationMs`; ends online. */
  async flap(durationMs: number, everyMs = 5000): Promise<number> {
    const end = Date.now() + durationMs
    let toggles = 0
    while (Date.now() < end) {
      if (this.offline) await this.goOnline(); else await this.goOffline()
      toggles++
      await sleep(everyMs)
    }
    await this.goOnline()
    return toggles
  }

  // --- Clock (page.clock; installed for the whole context, so a card that installs one relaunches afterwards) ---

  /** Installs the fake clock; call before a load, then reload. `time` sets where Date starts (T11: 10 minutes back). */
  async installClock(time?: Date): Promise<void> {
    await this.page.clock.install(time ? { time } : {})
  }

  /** T8: jump the page's timers forward (5 minutes idle). */
  async fastForward(ms: number): Promise<void> {
    await this.page.clock.fastForward(ms)
  }

  async storage(): Promise<StorageReport> { return await storageReport(this.page) }
}

// --- Staff device (ehr. and migrate.) ---------------------------------------------------------------------------

export type OfflineChoice = 'keep' | 'decline' | 'leave'

/** The human check (Turnstile) waits for a person: about 3 minutes. */
export const HUMAN_CHECK_MS = 3 * 60_000

export class StaffDevice extends Device {
  constructor(setup: DeviceSetup, private readonly env: CardEnv, private readonly choice: OfflineChoice, private readonly landing: string) {
    super(setup)
  }

  workspace(): Locator { return this.page.locator('.staff-topbar-actions') }
  private lockScreen(): Locator { return this.page.locator(OFFLINE.lock.title) }
  private offlineSignInScreen(): Locator { return this.page.locator(OFFLINE.signIn.title) }
  private facilityChoice(): Locator { return this.page.locator(FACILITY.choiceTitle) }
  private passwordField(): Locator { return this.page.locator(STAFF_SIGN_IN.password) }
  pausedBanner(): Locator { return this.page.locator('.offline-update').filter({ hasText: OFFLINE.lock.pausedBanner }) }
  syncButton(): Locator { return this.page.getByRole('button', { name: OFFLINE.panel.button, exact: true }) }

  /** What the page shows now, waiting up to `timeout` for one of the known screens. */
  async screen(timeout = 60_000): Promise<'offline-sign-in' | 'locked' | 'checking' | 'sign-in' | 'facility-choice' | 'workspace'> {
    const screens = [
      ['offline-sign-in', this.offlineSignInScreen()], ['locked', this.lockScreen()], ['checking', this.page.locator(FACILITY.sessionCheck)],
      ['sign-in', this.passwordField()], ['facility-choice', this.facilityChoice()], ['workspace', this.workspace()],
    ] as const
    await expect(screens.map(([, locator]) => locator).reduce((all, one) => all.or(one)).first(),
      `${this.label}: none of the known EHR screens appeared`).toBeVisible({ timeout })
    for (const [name, locator] of screens) if (await locator.isVisible()) return name
    return 'workspace'
  }

  /**
   * Online and signed in at Demo Hospital, unlocked, and (with `offline: true`) with offline in use on this device.
   * Signs in again when the profile's session is gone (a person completes the human check).
   */
  async ready(o: { offline?: boolean } = {}): Promise<void> {
    this.checkGuard()
    await this.page.bringToFront()
    if (this.offline) await this.goOnline()
    if (!this.page.url().startsWith(this.setup.origin)) await this.page.goto(this.url(this.landing))
    for (let round = 0; round < 5; round++) {
      const shown = await this.screen()
      if (shown === 'offline-sign-in') {
        // Left from an offline reload: load the page again, now online.
        if (round === 0) { await this.page.goto(this.url(this.landing)); continue }
        throw new Error(`${this.label}: Health ID cannot be reached while the device is online`)
      }
      if (shown === 'sign-in') { await this.signIn(); continue }
      if (shown === 'locked') {
        // Never tried twice: each refusal may count towards the five that wipe the readable copy.
        const result = await this.unlock()
        if (result !== 'unlocked') throw new Error(`${this.label}: the workspace did not unlock: ${result}`)
        continue
      }
      if (shown === 'checking') {
        // The workspace's own session check after the page was hidden; "Try again" if it could not confirm.
        const retry = this.page.getByRole('button', { name: 'Try again', exact: true })
        if (await retry.isVisible()) await retry.click()
        await this.page.locator(FACILITY.sessionCheck).waitFor({ state: 'hidden', timeout: 60_000 })
        continue
      }
      if (shown === 'facility-choice') { await this.chooseDemoHospital(); continue }
      if (await this.pausedBanner().waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) { await this.resumeOffline(); continue }
      break
    }
    await this.guard.verifyStaffSession()
    await this.verifyWorkingAtDemoHospital()
    if (o.offline) await this.requireOfflineInUse()
  }

  /** The online sign-in, with the human check left to a person. Never retried: wrong passwords lock the shared login. */
  async signIn(o: { choice?: OfflineChoice } = {}): Promise<void> {
    const page = this.page
    this.guard.enforce(() => {
      if (this.env.staffEmail.reveal().trim().toLowerCase() !== DEMO.staff.email) {
        throw new GuardRefusal('staff-session', 'HID_DEMO_STAFF_EMAIL is not the demo staff login')
      }
    })
    if (!page.url().startsWith(this.url(ROUTES.staff.signIn))) await page.goto(this.url(ROUTES.staff.signIn))
    const email = page.locator(STAFF_SIGN_IN.email)
    const password = this.passwordField()
    await expect(password, `${this.label}: the sign-in form did not appear`).toBeVisible({ timeout: 60_000 })
    const submit = page.getByRole('button', { name: STAFF_SIGN_IN.submit, exact: true })
    // The fields stay empty while a person completes the human check: nothing secret is on the page during the wait.
    tell(`${this.label}: please complete the human check in this window (up to 3 minutes); the kit then signs in`)
    await expect(submit, `${this.label}: the human check did not finish within 3 minutes. If it keeps looping, stop and report it to the coordinator; do not try to get around it.`)
      .toBeEnabled({ timeout: HUMAN_CHECK_MS })
    const refused = page.locator(STAFF_SIGN_IN.error)
    try {
      await setSecret(email, this.env.staffEmail)
      await setSecret(password, this.env.staffPassword)
      await submit.click({ timeout: 10_000 })
      // waitFor, not an assertion, while the password may still be in its field. An earlier refusal clears first.
      await refused.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
      await refused.or(this.workspace()).or(this.facilityChoice()).first().waitFor({ state: 'visible', timeout: 90_000 })
      if (await refused.isVisible()) {
        throw new Error(`${this.label}: Health ID refused the sign-in. The kit never retries a sign-in (five wrong passwords lock the shared login for 15 minutes).`)
      }
    } finally {
      await scrubFields(page, [STAFF_SIGN_IN.email, STAFF_SIGN_IN.password])
    }
    if (await this.facilityChoice().isVisible()) await this.chooseDemoHospital()
    await this.guard.verifyStaffSession()
    await this.verifyWorkingAtDemoHospital()
    const choice = o.choice ?? this.choice
    if (choice === 'leave') return
    const offered = page.locator(OFFLINE.choice.title)
    if (await offered.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)) {
      await page.getByRole('button', { name: choice === 'keep' ? OFFLINE.choice.keep : OFFLINE.choice.decline, exact: true }).click()
      await expect(offered).toBeHidden({ timeout: 60_000 })
      note(`${this.label}: the one-time offline choice appeared; chose "${choice === 'keep' ? OFFLINE.choice.keep : OFFLINE.choice.decline}"`)
    } else {
      note(`${this.label}: the one-time offline choice did not appear (the device already has a vault, or offline is not on for Demo Hospital)`)
    }
  }

  /** "Where are you working?": Demo Hospital, never anywhere else; the guard checks the session again afterwards. */
  async chooseDemoHospital(): Promise<void> {
    await this.page.getByRole('radio', { name: DEMO.hospitalName, exact: true }).check()
    await this.page.getByRole('button', { name: FACILITY.choiceSubmit, exact: true }).click()
    await expect(this.facilityChoice()).toBeHidden({ timeout: 60_000 })
    await this.guard.verifyStaffSession()
  }

  /** "Working at" shows Demo Hospital. */
  async verifyWorkingAtDemoHospital(): Promise<void> {
    const select = this.page.locator(FACILITY.switch)
    if (!await select.isVisible()) return
    const value = await select.inputValue()
    this.guard.enforce(() => {
      if (value !== DEMO.facilities.hospital) throw new GuardRefusal('staff-session', '"Working at" is not Demo Hospital')
    })
  }

  async requireOfflineInUse(): Promise<void> {
    await expect(this.syncButton(), `${this.label}: offline is not in use on this device at Demo Hospital `
      + '(no "Offline and sync" in the top bar). Is the production offline config live, and was the one-time choice accepted?').toBeVisible({ timeout: 20_000 })
  }

  /** The lock screen: the password, through setSecret. */
  async unlock(password: Secret = this.env.staffPassword): Promise<'unlocked' | string> {
    const field = this.page.locator(OFFLINE.lock.password)
    await expect(field).toBeVisible({ timeout: 30_000 })
    const refused = this.page.locator('section[aria-labelledby="offline-unlock-title"] [role=alert]')
    try {
      await setSecret(field, password)
      await this.page.locator('section[aria-labelledby="offline-unlock-title"]').getByRole('button', { name: OFFLINE.lock.submit, exact: true }).click({ timeout: 10_000 })
      await refused.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
      await refused.or(this.workspace()).first().waitFor({ state: 'visible', timeout: 60_000 })
      if (await refused.isVisible()) return (await refused.innerText()).trim()
      return 'unlocked'
    } finally { await scrubFields(this.page, [OFFLINE.lock.password]) }
  }

  /** "Offline use is paused on this tab: Unlock", after an online reload. */
  async resumeOffline(): Promise<void> {
    await this.pausedBanner().getByRole('button', { name: OFFLINE.lock.pausedAction, exact: true }).click()
    const result = await this.unlock()
    if (result !== 'unlocked') throw new Error(`${this.label}: the offline copy did not unlock: ${result}`)
  }

  /**
   * The offline sign-in (Health ID can't be reached). Asserts the screen first, so a failed offline emulation never
   * sends a password to the online sign-in. Returns 'opened' or the refusal shown.
   */
  async offlineSignIn(password: Secret = this.env.staffPassword): Promise<'opened' | string> {
    await expect(this.offlineSignInScreen(), `${this.label}: the offline sign-in screen is not shown`).toBeVisible({ timeout: 60_000 })
    const email = this.page.locator(OFFLINE.signIn.email)
    const field = this.page.locator(OFFLINE.signIn.password)
    const refused = this.page.locator('.offline-sign-in [role=alert]')
    try {
      await setSecret(email, this.env.staffEmail)
      await setSecret(field, password)
      await this.page.getByRole('button', { name: OFFLINE.signIn.submit, exact: true }).click({ timeout: 10_000 })
      await refused.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
      await refused.or(this.workspace()).first().waitFor({ state: 'visible', timeout: 60_000 })
      if (await refused.isVisible()) return (await refused.innerText()).trim()
      return 'opened'
    } finally {
      await scrubFields(this.page, [OFFLINE.signIn.password, OFFLINE.signIn.email])
    }
  }

  async signOut(): Promise<void> {
    await this.workspace().getByRole('button', { name: FACILITY.signOut, exact: true }).click()
  }

  // --- Patients ---

  /** Opens a patient's chart. Online: Patient access, Verify access, Open clinical record. Offline: On this device. */
  async openPatient(hid: string, displayName: string): Promise<void> {
    this.checkGuard()
    const page = this.page
    if (!this.offline) {
      await this.navigate(ROUTES.staff.patients)
      await expect(page.locator(PATIENTS.title)).toBeVisible({ timeout: 30_000 })
      await page.locator(PATIENTS.hid).fill(hid)
      await page.getByRole('button', { name: PATIENTS.verify, exact: true }).click()
    } else {
      await this.navigate(ROUTES.staff.patients)
      await page.getByRole('button', { name: `${OFFLINE.onDevice.open} ${displayName}`, exact: true }).click()
    }
    const open = page.getByRole('link', { name: PATIENTS.openRecord })
    await expect(open.or(page.locator(CLINICAL.encounterType)).first(), `${this.label}: the patient's chart could not be opened`).toBeVisible({ timeout: 45_000 })
    if (await open.isVisible()) await open.click()
    await expect(page).toHaveURL(/\/provider\/clinical/, { timeout: 30_000 })
  }

  /** "Keep available offline" on the open chart (online only). */
  async keepAvailableOffline(): Promise<void> {
    await this.page.getByRole('button', { name: OFFLINE.keep.button, exact: true }).click()
    await expect(this.page.getByText(OFFLINE.keep.done)).toBeVisible({ timeout: 120_000 })
  }

  /** Online: open the chart and keep it on this device, ready for an offline card. */
  async keepPatientOffline(hid: string, displayName: string): Promise<void> {
    await this.ready({ offline: true })
    await this.openPatient(hid, displayName)
    await this.keepAvailableOffline()
  }

  // --- Clinical record ---

  async startEncounter(chiefComplaint: string, type = 'ambulatory'): Promise<void> {
    const page = this.page
    await page.locator(CLINICAL.encounterType).selectOption(type)
    await page.locator(CLINICAL.chiefComplaint).fill(chiefComplaint)
    await page.getByRole('button', { name: CLINICAL.startEncounter, exact: true }).click()
    await expect(page.getByText(chiefComplaint).first(), `${this.label}: the new visit is not listed`).toBeVisible({ timeout: 45_000 })
    await this.selectEncounter(chiefComplaint)
  }

  /** TODO(stream-b): how a visit saved on this device (not sent yet) is selected is to be checked after Stream B merges. */
  async selectEncounter(chiefComplaint: string): Promise<void> {
    const row = this.page.locator(CLINICAL.encounterRow).filter({ hasText: chiefComplaint }).first()
    if (await row.isVisible()) {
      if (await row.getAttribute('aria-current') !== 'true') await row.click()
    } else {
      await this.page.locator(OFFLINE.pending.row).filter({ hasText: chiefComplaint }).first().click()
    }
    await expect(this.page.locator(CLINICAL.documentationTitle)).toBeVisible({ timeout: 30_000 })
  }

  async openTab(name: string): Promise<void> {
    await this.page.getByRole('tablist', { name: CLINICAL.tabList }).getByRole('tab', { name, exact: true }).click()
  }

  /** Waits for a save to show: the row online, or "Saved on this device" offline. */
  private async saved(text: string): Promise<void> {
    const shown = this.offline ? this.page.getByText(OFFLINE.savedHere).first().or(this.page.getByText(text).first()) : this.page.getByText(text).first()
    await expect(shown.first(), `${this.label}: "${text.slice(0, 60)}" did not appear after saving`).toBeVisible({ timeout: 45_000 })
  }

  async addNote(o: { title: string; content: string; type?: string; waitFor?: string }): Promise<void> {
    await this.openTab(CLINICAL.tabs.notes)
    await this.page.locator(CLINICAL.note.type).fill(o.type ?? 'Consultation')
    await this.page.locator(CLINICAL.note.title).fill(o.title)
    if (o.content.length > 500) await setText(this.page.locator(CLINICAL.note.content), o.content)
    else await this.page.locator(CLINICAL.note.content).fill(o.content)
    await this.page.getByRole('button', { name: CLINICAL.note.save, exact: true }).click()
    if (o.waitFor !== '') await this.saved(o.waitFor ?? o.title)
  }

  async addVitals(o: { systolic: number; diastolic: number; pulse: number; temperature: number; waitFor?: string }): Promise<void> {
    await this.openTab(CLINICAL.tabs.vitals)
    await this.page.locator(CLINICAL.vitals.systolic).fill(String(o.systolic))
    await this.page.locator(CLINICAL.vitals.diastolic).fill(String(o.diastolic))
    await this.page.locator(CLINICAL.vitals.pulse).fill(String(o.pulse))
    await this.page.locator(CLINICAL.vitals.temperature).fill(String(o.temperature))
    await this.page.getByRole('button', { name: CLINICAL.vitals.save, exact: true }).click()
    if (o.waitFor !== '') await this.saved(o.waitFor ?? `BP ${o.systolic}/${o.diastolic}`)
  }

  async addPrescription(o: { medication: string; instructions: string }): Promise<void> {
    await this.openTab(CLINICAL.tabs.prescriptions)
    const p = CLINICAL.prescription
    await this.page.locator(p.medication).fill(o.medication)
    await this.page.locator(p.doseQuantity).fill('1')
    await this.page.locator(p.doseUnit).fill('tablet')
    await this.page.locator(p.route).fill('oral')
    await this.page.locator(p.frequency).fill('Once daily')
    await this.page.locator(p.instructions).fill(o.instructions)
    await this.page.getByRole('button', { name: p.save, exact: true }).click()
    await this.saved(o.medication)
  }

  /** A revision of the note with this title (Review note content, Add a note revision). */
  async reviseNote(title: string, content: string, reason: string): Promise<void> {
    await this.openTab(CLINICAL.tabs.notes)
    const card = this.page.locator('.staff-list-item').filter({ has: this.page.getByText(title, { exact: true }) }).first()
    const toggle = card.getByRole('button', { name: CLINICAL.noteReview })
    if (await toggle.isVisible()) await toggle.click()
    await card.locator(CLINICAL.noteRevisionContent).fill(content)
    await card.locator(CLINICAL.noteRevisionReason).fill(reason)
    await card.getByRole('button', { name: CLINICAL.noteRevisionSubmit, exact: true }).click()
  }

  async uploadDocument(file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    await this.openTab(CLINICAL.tabs.documents)
    await this.page.locator(CLINICAL.document.input).setInputFiles(file)
    await this.page.getByRole('button', { name: CLINICAL.document.upload, exact: true }).click()
  }

  /** How many rows of this kind are shown in the open tab (the run's own text makes them unique). */
  async rowsWith(text: string): Promise<number> {
    return await this.page.locator('.staff-list-item, .staff-select-row').filter({ hasText: text }).count()
  }

  pendingRows(): Locator { return this.page.locator(OFFLINE.pending.row) }

  /** "Waiting to send" in Offline and sync, as a number (0 for "Nothing waiting to send"). */
  async pendingCount(): Promise<number> {
    const panel = this.page.locator(OFFLINE.panel.id)
    const opened = !await panel.isVisible()
    if (opened) await this.syncButton().click()
    await expect(panel).toBeVisible({ timeout: 15_000 })
    const text = await panel.locator('dl').innerText()
    if (opened) await this.syncButton().click()
    if (text.includes(OFFLINE.panel.nothingPending)) return 0
    const match = /(\d+) changes? saved on this device/.exec(text)
    if (!match) throw new Error(`${this.label}: "Waiting to send" could not be read from Offline and sync`)
    return Number(match[1])
  }

  /** The indicator's "N changes need attention", or 0. */
  async attentionCount(): Promise<number> {
    const text = await this.page.locator(OFFLINE.indicator.selector).innerText().catch(() => '')
    const match = /(\d+) changes? needs? attention/.exec(text)
    return match ? Number(match[1]) : 0
  }

  /** Waits until a change needs attention (a review class). */
  async waitForAttention(timeoutMs: number): Promise<void> {
    await expect(this.page.locator(OFFLINE.indicator.selector), `${this.label}: no change needed attention`).toHaveText(OFFLINE.attention, { timeout: timeoutMs })
  }

  /** Opens Offline and sync, waits until nothing waits to be sent, and closes it. Returns false on timeout. */
  async waitUntilSent(timeoutMs: number): Promise<boolean> {
    const panel = this.page.locator(OFFLINE.panel.id)
    if (!await panel.isVisible()) await this.syncButton().click()
    const done = await panel.getByText(OFFLINE.panel.nothingPending).waitFor({ timeout: timeoutMs }).then(() => true, () => false)
    if (await panel.isVisible()) await this.syncButton().click()
    return done
  }

  /** The review drawer (a modal dialog), from Offline and sync, Review. */
  async openReview(): Promise<Locator> {
    const panel = this.page.locator(OFFLINE.panel.id)
    if (!await panel.isVisible()) await this.syncButton().click()
    await panel.getByRole('button', { name: OFFLINE.panel.review, exact: true }).click()
    const drawer = this.page.getByRole('dialog', { name: OFFLINE.review.title })
    await expect(drawer).toBeVisible({ timeout: 30_000 })
    return drawer
  }

  /**
   * Resolves the first review entry of a class: its action, a reason of at least 8 characters, Confirm; then closes
   * the drawer (it is modal, so nothing behind it can be used while it is open).
   */
  async resolveReview(drawer: Locator, classTitle: string, action: string, reason: string): Promise<void> {
    const entry = drawer.locator(OFFLINE.review.item).filter({ hasText: classTitle }).first()
    await entry.getByRole('radio', { name: action, exact: true }).check()
    await entry.getByLabel(OFFLINE.review.reason, { exact: true }).fill(reason)
    await entry.getByRole('button', { name: OFFLINE.review.confirm, exact: true }).click()
    await expect(entry).toBeHidden({ timeout: 60_000 })
    await this.closeReview(drawer)
  }

  async closeReview(drawer: Locator): Promise<void> {
    await drawer.getByRole('button', { name: OFFLINE.review.close, exact: true }).first().click()
    await expect(drawer).toBeHidden({ timeout: 30_000 })
  }

  // --- Access ---

  /** Patient access, Request: sends an access request and returns its id (from the app's own response). */
  async requestAccess(hid: string, o: { reason: string; minutes?: number }): Promise<string> {
    const page = this.page
    await this.navigate(ROUTES.staff.patients)
    await page.locator(PATIENTS.hid).fill(hid)
    await page.getByRole('group', { name: 'Access method' }).getByRole('button', { name: PATIENTS.methods.request, exact: true }).click()
    await page.locator(PATIENTS.requestScope).selectOption('write_records')
    await page.locator(PATIENTS.requestReason).fill(o.reason)
    if (o.minutes !== undefined && await page.locator(PATIENTS.requestDuration).isVisible()) {
      await page.locator(PATIENTS.requestDuration).selectOption(String(o.minutes))
    }
    const answer = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/identity/access-requests', { timeout: 60_000 })
    await page.getByRole('button', { name: PATIENTS.submitRequest, exact: true }).click()
    const response = await answer
    expect(response.ok(), `${this.label}: the access request was refused (${response.status()})`).toBe(true)
    const body = await response.json() as { accessRequestId?: unknown }
    if (typeof body.accessRequestId !== 'string') throw new Error(`${this.label}: the access request answer has no id`)
    return body.accessRequestId
  }

  /** Patient access, Emergency (T13 only, a demo patient without a login): opens the read-only summary. */
  async emergencyAccess(hid: string, reason: string): Promise<void> {
    const page = this.page
    await this.navigate(ROUTES.staff.patients)
    await page.locator(PATIENTS.hid).fill(hid)
    await page.getByRole('group', { name: 'Access method' }).getByRole('button', { name: PATIENTS.methods.emergency, exact: true }).click()
    await page.locator(PATIENTS.emergencyReason).fill(reason)
    await page.getByRole('button', { name: PATIENTS.submitEmergency, exact: true }).click()
    const open = page.getByRole('link', { name: PATIENTS.openEmergency })
    await expect(open).toBeVisible({ timeout: 45_000 })
    await open.click()
  }

  /** In-app navigation by the sidebar's own link. */
  async goTo(link: keyof typeof NAV): Promise<void> {
    await this.page.getByRole('complementary', { name: 'Provider navigation' }).getByRole('link', { name: NAV[link], exact: true }).click()
  }
}

// --- Patient device (app.) ------------------------------------------------------------------------------------

export class PatientDevice extends Device {
  constructor(setup: DeviceSetup, private readonly email: Secret, private readonly password: Secret) {
    super(setup)
  }

  shell(): Locator { return this.page.locator('.patient-app') }

  /** Signed in as this demo patient (a person completes the human check if a sign-in is needed). */
  async ready(): Promise<void> {
    this.checkGuard()
    await this.page.bringToFront()
    if (!this.page.url().startsWith(this.setup.origin)) await this.page.goto(this.url(ROUTES.portal.home))
    const password = this.page.locator(PORTAL.signInPassword)
    await expect(password.or(this.shell()).first(), `${this.label}: the portal did not load`).toBeVisible({ timeout: 60_000 })
    if (await password.isVisible()) await this.signIn()
    await this.guard.verifyPatientSession()
  }

  async signIn(): Promise<void> {
    const page = this.page
    const principal = page.getByLabel(PORTAL.signInPrincipal)
    const password = page.locator(PORTAL.signInPassword)
    const submit = page.getByRole('button', { name: PORTAL.signInSubmit, exact: true })
    // Empty fields while a person completes the human check; no assertion while a secret is in a field.
    tell(`${this.label}: please complete the human check in this window (up to 3 minutes); the kit then signs in`)
    await expect(submit, `${this.label}: the human check did not finish within 3 minutes. If it keeps looping, stop and report it to the coordinator.`)
      .toBeEnabled({ timeout: HUMAN_CHECK_MS })
    const refused = page.locator('.auth-alert[role=alert]')
    try {
      await setSecret(principal, this.email)
      await setSecret(password, this.password)
      await submit.click({ timeout: 10_000 })
      await refused.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
      await refused.or(this.shell()).first().waitFor({ state: 'visible', timeout: 90_000 })
      if (await refused.isVisible()) throw new Error(`${this.label}: Health ID refused the sign-in. The kit never retries a sign-in.`)
    } finally {
      await scrubFields(page, [PORTAL.signInPassword, 'form.patient-form input[autocomplete="username"]'])
    }
  }

  /** Access and consent, loaded afresh so its lists are read again (the portal keeps no offline copy). */
  async openAccess(): Promise<void> {
    this.checkGuard()
    await this.page.goto(this.url(ROUTES.portal.access))
    await expect(this.page.getByRole('heading', { name: 'Access history' })).toBeVisible({ timeout: 45_000 })
  }

  async approve(accessRequestId: string): Promise<void> {
    await this.openAccess()
    const button = this.page.locator(PORTAL.approve(accessRequestId))
    await expect(button, `${this.label}: the access request is not shown to the patient`).toBeVisible({ timeout: 120_000 })
    await button.click()
    await expect(this.page.getByText('Request approved.')).toBeVisible({ timeout: 45_000 })
  }

  /** T7 revoke mode only (Patient Two). The guard allows the revoke only for a share it learned is Demo Hospital's. */
  async revokeDemoHospitalShare(reason: string): Promise<string> {
    if (this.setup.role !== 'patient2') throw new Error('Only Patient Two revokes, and only in T7')
    await this.openAccess()
    const active = [...this.guard.grants].filter(([, grant]) => grant.demoHospital && /active/i.test(grant.status)).map(([id]) => id)
    if (active.length !== 1) throw new Error(`${this.label}: expected one active Demo Hospital share, found ${active.length}`)
    const grantId = active[0]!
    this.guard.armDemoHospitalRevoke(true)
    try {
      await this.page.locator(PORTAL.revoke(grantId)).click()
      await this.page.locator(PORTAL.revokeReason(grantId)).fill(reason)
      await this.page.getByRole('button', { name: PORTAL.confirmRevocation, exact: true }).click()
      await expect(this.page.getByText('Access grant revoked.')).toBeVisible({ timeout: 45_000 })
    } finally { this.guard.armDemoHospitalRevoke(false) }
    return grantId
  }

  /** The patient's allergies text (Profile, Health information), opening the section if needed. */
  async allergies(): Promise<Locator> {
    await this.navigate(ROUTES.portal.profile)
    const toggle = this.page.locator('button.patient-section-toggle').filter({ hasText: PORTAL.healthSection }).first()
    await expect(toggle).toBeVisible({ timeout: 45_000 })
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    const field = this.page.locator(PORTAL.allergies)
    await expect(field).toBeVisible({ timeout: 45_000 })
    return field
  }

  async setAllergies(text: string): Promise<void> {
    const field = await this.allergies()
    await field.fill(text)
    const saved = this.page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === '/api/v1/ehr/me/health-profile', { timeout: 60_000 })
    await this.page.getByRole('button', { name: PORTAL.saveHealth, exact: true }).click()
    const response = await saved
    expect(response.ok(), `${this.label}: the health information was not saved (${response.status()})`).toBe(true)
  }
}

// --- Notes, screenshots and the card helper ---------------------------------------------------------------------

/** Adds a note to the running card's report (never a secret: the kit writes these itself). */
export function note(text: string): void {
  try { base.info().annotations.push({ type: 'note', description: text }) } catch { /* outside a test */ }
}

/** Tells the person at the computer (the list reporter shows a card's output as it runs), and notes it. */
export function tell(text: string): void {
  process.stdout.write(`\n[Health ID cards] ${text}\n`)
  note(text)
}

/**
 * A release card's wait: the window stays offline until the runner creates out/runs/<id>/release-live, once the
 * coordinator says the release is live. The guard is checked while waiting.
 */
export async function waitForReleaseMarker(runId: string, device: Device, maxMs: number): Promise<void> {
  const marker = releaseMarkerFile(runId)
  tell(`Phase 1 is done. Leave this window open and offline. When the coordinator says the release is live, create the file ${relative(KIT_ROOT, marker)} `
    + `(in e2e/offline: touch ${relative(KIT_ROOT, marker)}). The card then goes online and observes.`)
  const end = Date.now() + maxMs
  while (!existsSync(marker)) {
    device.checkGuard()
    if (Date.now() > end) throw new Error(`No ${relative(KIT_ROOT, marker)} after ${Math.round(maxMs / 60_000)} minutes`)
    await sleep(10_000)
  }
  tell('The release marker is there: going online to observe.')
}

export class Card {
  private shots = 0
  constructor(readonly id: string, readonly info: TestInfo, readonly runId: string) {}

  /** 'E2E <run id> <card> <what>': every written row carries it, with fictional content only. */
  text(what: string): string { return `E2E ${this.runId} ${this.id} ${what}` }

  note(text: string): void { this.info.annotations.push({ type: 'note', description: text }) }

  async snap(device: Device, label: string): Promise<void> {
    this.shots++
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    const path = this.info.outputPath(`${String(this.shots).padStart(2, '0')}-${device.setup.name}-${slug}.png`)
    await device.page.screenshot({ path })
    await this.info.attach(`${device.setup.name}: ${label}`, { path, contentType: 'image/png' })
  }

  async step<T>(title: string, body: () => Promise<T>): Promise<T> {
    return await base.step(title, body)
  }
}

// --- T17 and T19: the kill-switch observation -------------------------------------------------------------------

/**
 * A8.5, observe only, around a release the coordinator makes (T17: offline mode "off"; T19: Demo Hospital removed from
 * the pilot list). Phase 1 queues changes offline and waits for the release marker; phase 2 loads online and watches
 * the readable copy and the shell caches go, the waiting changes still go out, and then the vault go. The vault's key
 * is derived only at a sign-in (A8.5), so if nothing is sent after an online load the card signs out and in again.
 */
export async function killSwitchObservation(device: StaffDevice, card: Card, runId: string, what: string): Promise<void> {
  await card.step('Phase 1, before the release: changes wait on the device, offline', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(card.text('visit'))
    await device.goOffline()
    for (let index = 1; index <= 3; index++) {
      await device.addNote({ title: card.text(`note ${index} waiting through the ${what}`), content: card.text('fictional note') })
    }
    card.note(`Before the release: ${describeReport(await device.storage())}`)
    await card.snap(device, 'phase 1: changes waiting offline')
  })

  await waitForReleaseMarker(runId, device, 5 * 3_600_000)

  await card.step(`Phase 2: online load after the ${what}`, async () => {
    await device.goOnline()
    await device.page.reload()
    await device.ready()
    card.note(`Right after the online load: ${describeReport(await device.storage())}`)
    await card.snap(device, `online after the ${what}`)
  })

  await card.step('The readable copy and the shell caches are wiped', async () => {
    await expect.poll(async () => {
      const report = await device.storage()
      return { cache: report.database.stores.cache ?? 0, shellCaches: Object.keys(report.shellCaches).length }
    }, { timeout: 10 * 60_000, message: 'the readable copy or the shell caches are still on the device' }).toEqual({ cache: 0, shellCaches: 0 })
  })

  await card.step('The waiting changes are still sent; then the vault goes', async () => {
    const outbox = async () => (await device.storage()).database.stores.outbox ?? 0
    const drained = await expect.poll(outbox, { timeout: 3 * 60_000 }).toBe(0).then(() => true, () => false)
    if (!drained) {
      card.note('Nothing was sent after the online load (the send-only vault needs the key a sign-in derives, A8.5): signing out and in again.')
      await device.signOut()
      await device.page.locator(STAFF_SIGN_IN.password).waitFor({ state: 'visible', timeout: 60_000 })
      await device.ready()
    }
    await expect.poll(outbox, { timeout: 30 * 60_000, message: 'changes still wait in the outbox' }).toBe(0)
    const report = await device.storage()
    card.note(`At the end: ${describeReport(report)}`)
    expect.soft(report.database.stores.vaults ?? 0, 'the vault is deleted once its outbox is empty').toBe(0)
    await card.snap(device, 'after the waiting changes were sent')
  })
}

// --- The camera: a fictional photo with fake EXIF (T15) -----------------------------------------------------------

/** Written into the fake EXIF "Make" field: if it survives the upload, EXIF was not stripped. */
export const FAKE_EXIF_MAKE = 'E2E-FICTIONAL-CAMERA'

/** A tiny TIFF block: Make, Model and a GPS IFD at a fictional position (0°0'0.01" N, 0°0'0.01" E). */
function fakeExifTiff(): Buffer {
  const make = Buffer.from(`${FAKE_EXIF_MAKE}\0`, 'ascii')
  const model = Buffer.from('Health ID offline kit\0', 'ascii')
  const ifd0 = 8
  const ifd0Size = 2 + 3 * 12 + 4
  const makeAt = ifd0 + ifd0Size
  const modelAt = makeAt + make.length
  const gps = (modelAt + model.length + 1) & ~1
  const gpsSize = 2 + 4 * 12 + 4
  const latitudeAt = gps + gpsSize
  const longitudeAt = latitudeAt + 24
  const tiff = Buffer.alloc(longitudeAt + 24)
  tiff.write('II', 0, 'ascii')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(ifd0, 4)
  let at = 0
  const entry = (tag: number, type: number, count: number, value: number | Buffer) => {
    tiff.writeUInt16LE(tag, at); tiff.writeUInt16LE(type, at + 2); tiff.writeUInt32LE(count, at + 4)
    if (typeof value === 'number') tiff.writeUInt32LE(value, at + 8); else value.copy(tiff, at + 8)
    at += 12
  }
  at = ifd0
  tiff.writeUInt16LE(3, at); at += 2
  entry(0x010f, 2, make.length, makeAt)
  entry(0x0110, 2, model.length, modelAt)
  entry(0x8825, 4, 1, gps)
  tiff.writeUInt32LE(0, at)
  make.copy(tiff, makeAt)
  model.copy(tiff, modelAt)
  at = gps
  tiff.writeUInt16LE(4, at); at += 2
  entry(0x0001, 2, 2, Buffer.from('N\0', 'ascii'))
  entry(0x0002, 5, 3, latitudeAt)
  entry(0x0003, 2, 2, Buffer.from('E\0', 'ascii'))
  entry(0x0004, 5, 3, longitudeAt)
  tiff.writeUInt32LE(0, at)
  const position = [[0, 1], [0, 1], [1, 100]] as const
  for (const start of [latitudeAt, longitudeAt]) {
    position.forEach(([numerator, denominator], index) => {
      tiff.writeUInt32LE(numerator, start + index * 8)
      tiff.writeUInt32LE(denominator, start + index * 8 + 4)
    })
  }
  return tiff
}

/** Puts an EXIF APP1 segment straight after the JPEG's start-of-image marker. */
export function withFakeExif(jpeg: Buffer): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG')
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), fakeExifTiff()])
  const header = Buffer.from([0xff, 0xe1, 0, 0])
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)])
}

/** What a JPEG carries: an EXIF APP1 segment, a GPS IFD pointer in it, and the fake Make anywhere in the file. */
export function jpegMetadata(bytes: Buffer): { jpeg: boolean; exif: boolean; gps: boolean; fakeMake: boolean } {
  const result = { jpeg: bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8, exif: false, gps: false, fakeMake: bytes.includes(Buffer.from(FAKE_EXIF_MAKE)) }
  if (!result.jpeg) return result
  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!
    if (marker === 0xd9 || marker === 0xda) break
    const length = bytes.readUInt16BE(at + 2)
    const segment = bytes.subarray(at + 4, at + 2 + length)
    if (marker === 0xe1 && segment.subarray(0, 6).equals(Buffer.from('Exif\0\0', 'binary'))) {
      result.exif = true
      const little = segment.subarray(6, 8).toString('ascii') === 'II'
      const tag = little ? Buffer.from([0x25, 0x88]) : Buffer.from([0x88, 0x25])
      result.gps ||= segment.includes(tag)
    }
    at += 2 + length
  }
  return result
}

/** A fictional page photo: drawn and encoded as JPEG by Chromium itself (so it is valid), then given fake EXIF. */
export async function fictionalPhoto(page: Page, caption: string): Promise<Buffer> {
  const base64 = await page.evaluate(async text => {
    const canvas = new OffscreenCanvas(480, 320)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D canvas')
    context.fillStyle = '#f6f3ec'
    context.fillRect(0, 0, 480, 320)
    context.fillStyle = '#1d1d1d'
    context.font = '18px sans-serif'
    context.fillText(text, 16, 48)
    context.fillText('Fictional page for an offline test. Not a real patient.', 16, 84)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, caption)
  return withFakeExif(Buffer.from(base64, 'base64'))
}

// --- Fixtures ---------------------------------------------------------------------------------------------------

/** Sign-in fixtures wait for a person to complete the human check. */
export const SIGN_IN_FIXTURE_TIMEOUT = 8 * 60_000

export interface Kit {
  env: CardEnv
  chromium: BrowserType
  headless: boolean
  /** A staff device on ehr. or migrate.; `profile` defaults to the device name. */
  staff(name: string, host: Exclude<HostName, 'app'>, o?: { choice?: OfflineChoice; profileDir?: string }): Promise<StaffDevice>
  patient(which: 'patient1' | 'patient2'): Promise<PatientDevice>
  /** A device that only reads (T18): every write is refused. */
  reader(name: string, host: HostName): Promise<Device>
  /** Whether the runner has created out/runs/<id>/release-live. */
  releaseLive(): boolean
}

interface WorkerFixtures {
  kit: Kit
  ehrA: StaffDevice
  ehrB: StaffDevice
  migrateA: StaffDevice
  patient1: PatientDevice
  patient2: PatientDevice
}

interface TestFixtures {
  card: Card
  cardGate: void
}

/** Observe-only cards, each its own invocation around a release. */
const RELEASE_CARDS: ReadonlySet<string> = new Set(['T16', 'T17', 'T19'])

function cardIdOf(title: string): string {
  return /^(T\d\d|R\d)/.exec(title)?.[1] ?? title.split(' ')[0] ?? title
}

const LANDING: Readonly<Record<Exclude<HostName, 'app'>, string>> = { ehr: ROUTES.staff.clinical, migrate: ROUTES.staff.ocr }

export const test = base.extend<TestFixtures, WorkerFixtures>({
  kit: [async ({ playwright }, use, workerInfo) => {
    const env = cardEnv()
    const headless = workerInfo.project.use.headless !== false
    const onTrip = (refusal: GuardRefusal, device: Device) => stopRun(env.runId, refusal, device)
    const setup = (name: string, role: DeviceRole, host: HostName, profileDir?: string): DeviceSetup => ({
      name, role, origin: `https://${HOSTS[host]}`, profileDir: profileDir ?? join(PROFILES_DIR, name),
      chromium: playwright.chromium, headless, offlineMode: env.offlineMode, onTrip,
    })
    const kit: Kit = {
      env, chromium: playwright.chromium, headless,
      async staff(name, host, o = {}) {
        const device = new StaffDevice({ ...setup(name, 'staff', host, o.profileDir), staffEmail: env.staffEmail }, env, o.choice ?? 'keep', LANDING[host])
        return await device.open()
      },
      async patient(which) {
        const hid = which === 'patient1' ? DEMO.patients.one : DEMO.patients.two
        const email = which === 'patient1' ? env.patient1Email : env.patient2Email
        const password = which === 'patient1' ? env.patient1Password : env.patient2Password
        return await new PatientDevice({ ...setup(which, which, 'app'), patientHid: hid }, email, password).open()
      },
      async reader(name, host) {
        return await new Device(setup(name, 'reader', host)).open()
      },
      releaseLive: () => existsSync(releaseMarkerFile(env.runId)),
    }
    await use(kit)
  }, { scope: 'worker' }],

  ehrA: [async ({ kit }, use) => {
    const device = await kit.staff('A', 'ehr')
    await device.ready()
    await use(device)
    await device.close()
  }, { scope: 'worker', timeout: SIGN_IN_FIXTURE_TIMEOUT }],

  ehrB: [async ({ kit }, use) => {
    const device = await kit.staff('B', 'ehr')
    await device.ready()
    await use(device)
    await device.close()
  }, { scope: 'worker', timeout: SIGN_IN_FIXTURE_TIMEOUT }],

  migrateA: [async ({ kit }, use) => {
    const device = await kit.staff('A', 'migrate')
    await device.ready()
    await use(device)
    await device.close()
  }, { scope: 'worker', timeout: SIGN_IN_FIXTURE_TIMEOUT }],

  patient1: [async ({ kit }, use) => {
    const device = await kit.patient('patient1')
    await device.ready()
    await use(device)
    await device.close()
  }, { scope: 'worker', timeout: SIGN_IN_FIXTURE_TIMEOUT }],

  patient2: [async ({ kit }, use) => {
    const device = await kit.patient('patient2')
    await device.ready()
    await use(device)
    await device.close()
  }, { scope: 'worker', timeout: SIGN_IN_FIXTURE_TIMEOUT }],

  /**
   * Before every card: the gate must have claimed this run (out/runs/<id>/run.json, written by this invocation's
   * runner), the guard must not have stopped it, and an invocation for T7 or a release card runs that card only.
   */
  cardGate: [async ({ kit }, use, testInfo) => {
    const claim = readRunClaim(kit.env.runId)
    if (!claim || claim.pid !== process.ppid) throw new Error('The cards gate did not claim this run (out/runs/<id>/run.json). Start the cards with npm run cards.')
    if (existsSync(guardStopFile(kit.env.runId))) throw new Error(`The guard stopped this run earlier (see ${guardStopFile(kit.env.runId)}); no further card may act.`)
    // Decided here, before any device fixture signs in (auto fixtures are set up first).
    const id = cardIdOf(testInfo.title)
    if (kit.env.releaseCard) { if (id !== kit.env.releaseCard) testInfo.skip(true, `This invocation is for release card ${kit.env.releaseCard} only`) }
    else if (RELEASE_CARDS.has(id)) testInfo.skip(true, `Runs only with HID_E2E_RELEASE_CARD=${id}, as its own invocation started before the release`)
    if (kit.env.t7Mode) { if (id !== 'T07') testInfo.skip(true, 'This invocation is for T7 only') }
    else if (id === 'T07') testInfo.skip(true, 'Runs only with HID_E2E_T7_MODE=revoke or wait, as its own invocation after the main run, once the coordinator decides')
    await use()
    // Before Playwright's end-of-test page snapshot (its own fixture tears down after this one).
    for (const device of OPEN_DEVICES) await scrubContext(device.context, secretValuesForScan())
  }, { auto: true }],

  card: async ({ kit }, use, testInfo) => {
    await use(new Card(cardIdOf(testInfo.title), testInfo, kit.env.runId))
  },
})

export { expect }

/**
 * For a test that uses Playwright's own page (the selftest's leak fixture): its context's secret fields are emptied
 * when the test ends, before Playwright snapshots the page (this fixture depends on context, so it tears down first).
 */
export const scrubbedTest = base.extend<{ scrubPages: void }>({
  scrubPages: [async ({ context }, use) => {
    await use()
    await scrubContext(context, secretValuesForScan())
  }, { auto: true }],
})

/** T1's own fresh profile: deleted first, because the one-time choice only appears while a device has no vault. */
export function freshProfileDir(runId: string, name: string): string {
  const dir = join(PROFILES_DIR, runId, name)
  rmSync(dir, { recursive: true, force: true })
  return dir
}
