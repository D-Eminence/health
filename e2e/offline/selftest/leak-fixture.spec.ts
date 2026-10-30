import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { PROFILES_DIR, runIdOrLocal, Secret, SELFTEST_SECRET_VARIABLE } from '../support/env'
import type { CardEnv } from '../support/env'
import { DEMO, installGuard } from '../support/guard'
import { launchProfile, scrubbedTest as test, setSecret, StaffDevice } from '../support/devices'

/**
 * Not run on its own: selftest/leak.spec.ts starts it as an invocation of its own (project selftest-leak, a fresh run
 * id), then searches that run's whole folder for the throwaway password. One test signs in with it through setSecret
 * on a persistent profile, as the cards do; the other is expected to fail with the password field filled, so the
 * failure attachments (error context with its page snapshot, the call log, the screenshot) exist to be searched.
 */

const SIGN_IN = `<!doctype html><meta charset="utf-8"><title>Sign in</title>
<form id="form"><label for="staff-email">Work email</label><input id="staff-email" type="email">
<label for="staff-password">Password</label><input id="staff-password" type="password">
<button id="submit" type="submit" disabled>Sign in</button></form><p id="result"></p>
<script>
const state = { email: '', password: '' }
document.getElementById('staff-email').addEventListener('input', event => { state.email = event.target.value })
document.getElementById('staff-password').addEventListener('input', event => { state.password = event.target.value })
setTimeout(() => { document.getElementById('submit').disabled = false }, 300)
document.getElementById('form').addEventListener('submit', async event => {
  event.preventDefault()
  const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
  document.getElementById('result').textContent = response.ok ? 'Signed in' : 'Refused'
})
</script>`

/** The EHR sign-in's shape (ids, button, alert), refusing every password, and keeping it in its field as the app does. */
const STAFF_SIGN_IN = `<!doctype html><meta charset="utf-8"><title>Sign in</title>
<main><h1 id="staff-sign-in-title">Welcome back.</h1>
<form class="staff-form" id="form"><label for="staff-email">Work email</label><input id="staff-email" type="email">
<label for="staff-password">Password</label><input id="staff-password" type="password">
<p class="staff-error" role="alert" hidden id="error">Invalid email or password.</p>
<button id="submit" type="submit" disabled>Sign in</button></form></main>
<script>
const state = { email: '', password: '' }
document.getElementById('staff-email').addEventListener('input', event => { state.email = event.target.value })
document.getElementById('staff-password').addEventListener('input', event => { state.password = event.target.value })
setTimeout(() => { document.getElementById('submit').disabled = false }, 300)
document.getElementById('form').addEventListener('submit', async event => {
  event.preventDefault()
  document.getElementById('error').hidden = true
  const response = await fetch('/api/v1/auth/login?refuse=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
  if (!response.ok) document.getElementById('error').hidden = false
})
</script>`

let server: Server
let origin = ''

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      if (request.url === '/api/v1/auth/login?refuse=1') {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        response.end('{}')
        return
      }
      if (request.url === '/provider/sign-in') {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end(STAFF_SIGN_IN)
        return
      }
      if (request.url === '/api/v1/auth/login' && request.method === 'POST') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { password?: string }
        response.writeHead(body.password === process.env[SELFTEST_SECRET_VARIABLE] ? 200 : 401, { 'Content-Type': 'application/json' })
        response.end('{}')
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(SIGN_IN)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)) })

function fakePassword(): Secret {
  const value = process.env[SELFTEST_SECRET_VARIABLE]
  if (!value) throw new Error('The config sets the selftest password')
  return new Secret(value)
}

test('leak fixture: sign in with the throwaway password through setSecret on a persistent profile', async ({ playwright }) => {
  const runId = runIdOrLocal()
  const profile = join(PROFILES_DIR, runId, 'selftest')
  const context = await launchProfile(playwright.chromium, profile, true)
  try {
    const host = new URL(origin).host
    const guard = await installGuard(context, { role: 'staff', label: 'leak fixture', host, allowLocal: true, staffEmail: DEMO.staff.email })
    const page = context.pages()[0] ?? await context.newPage()
    // A canary in the kit's own step title: leak.spec.ts finds it inside the HTML report's zip, proving the search reaches it.
    await test.step(`Sign in (canary-${runId})`, async () => {
      await page.goto(`${origin}/sign-in`)
      await setSecret(page.locator('#staff-email'), new Secret('selftest@example.invalid'))
      await setSecret(page.locator('#staff-password'), fakePassword())
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.locator('#result')).toHaveText('Signed in')
    })
    expect(guard.tripped).toBeNull()
  } finally { await context.close() }
  // The profile was prepared with the password manager off.
  const preferences = JSON.parse(readFileSync(join(profile, 'Default', 'Preferences'), 'utf8')) as { credentials_enable_service?: boolean; profile?: { password_manager_enabled?: boolean } }
  expect(preferences.credentials_enable_service).toBe(false)
  expect(preferences.profile?.password_manager_enabled).toBe(false)
  expect(existsSync(profile)).toBe(true)
})

test('leak fixture: a failure with the password field filled', async ({ page }) => {
  test.fail(true, 'Expected to fail, so the failure attachments exist')
  await page.goto(`${origin}/sign-in`)
  await setSecret(page.locator('#staff-password'), fakePassword())
  await setSecret(page.locator('#staff-email'), new Secret('selftest@example.invalid'))
  // Fails with the password still in its field: an action timeout with its call log, as a card step can fail. (An
  // assertion is never made while a secret is in a field; see devices.ts.) The screenshot, the call log and the
  // error context with its page snapshot are written, and leak.spec.ts searches each of them.
  await page.locator('#never-shown').click({ timeout: 1000 })
})

test('leak fixture: a refused staff sign-in through the kit\'s own sign-in steps', async ({ playwright }) => {
  test.fail(true, 'The local server refuses the sign-in, and the kit stops without retrying')
  const runId = runIdOrLocal()
  const fictional = (value: string) => new Secret(value)
  const env: CardEnv = {
    staffEmail: fictional(DEMO.staff.email), staffPassword: fakePassword(),
    patient1Email: fictional('patient1@example.invalid'), patient1Password: fictional('not-used-1'),
    patient2Email: fictional('patient2@example.invalid'), patient2Password: fictional('not-used-2'),
    runId, releaseCard: null, t7Mode: null, offlineMode: 'setoffline',
  }
  const device = new StaffDevice({
    name: 'selftest-staff', role: 'staff', origin, profileDir: join(PROFILES_DIR, runId, 'selftest-staff'),
    chromium: playwright.chromium, headless: true, allowLocal: true, staffEmail: env.staffEmail, offlineMode: 'setoffline',
    onTrip: () => undefined,
  }, env, 'leave', '/provider/sign-in')
  await device.open()
  try {
    await device.page.goto(`${origin}/provider/sign-in`)
    await device.signIn()
  } finally { await device.close() }
})
