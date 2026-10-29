import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { CLINICAL, OFFLINE, STAFF_SIGN_IN } from '../support/selectors'

/**
 * T10 (A8.11): signing out offline wipes the readable copy and the vault header (outbox, audit and media stay). On the
 * next online load /api/v1/auth/logout is sent first, and the waiting note is still sent after an online sign-in
 * (a person completes the human check).
 */
test('T10 sign out offline: /auth/logout is sent first on the next online load, and waiting work is sent after sign-in', async ({ ehrA: device, card }) => {
  test.setTimeout(30 * 60_000)
  const visit = card.text('visit')
  const note = card.text('note waiting through sign-out')

  await card.step('Online: keep Demo Patient One and start a visit', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(visit)
  })

  await card.step('Offline: a note waits; sign out', async () => {
    await device.goOffline()
    await device.addNote({ title: note, content: card.text('fictional note, sent after signing in again') })
    await device.signOut()
    await expect(device.page.locator(STAFF_SIGN_IN.password).or(device.page.locator(OFFLINE.signIn.title)).first()).toBeVisible({ timeout: 60_000 })
    await card.snap(device, 'signed out offline')
  })
  const since = device.guard.requests.length

  await card.step('Online load: /auth/logout is the first write', async () => {
    await device.goOnline()
    const logout = device.page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/auth/logout', { timeout: 90_000 })
    await device.page.goto(device.url('/provider'))
    await logout
    const writes = device.guard.requestsSince(since).filter(request => request.method !== 'GET' && request.method !== 'HEAD')
    card.note(`Writes after the online load, in order: ${writes.map(request => `${request.method} ${request.path.replace(/[0-9a-f-]{36}/g, ':id')}`).join(' → ')}`)
    expect(writes[0]?.path, 'the first write after reconnecting').toBe('/api/v1/auth/logout')
  })

  await card.step('Sign in again: the note that waited is sent, once', async () => {
    await device.ready({ offline: true })
    expect(await device.waitUntilSent(10 * 60_000), 'the waiting note was not sent after sign-in').toBe(true)
    const login = device.guard.requestsSince(since).findIndex(request => request.path === '/api/v1/auth/login')
    const sent = device.guard.requestsSince(since).findIndex(request => request.method === 'POST' && /\/clinical-notes$/.test(request.path))
    expect(sent, 'the note was sent').toBeGreaterThanOrEqual(0)
    if (login >= 0) expect(sent, 'the note was sent after the sign-in').toBeGreaterThan(login)
    await device.openPatient(DEMO.patients.one, DEMO.patientNames.one)
    await device.selectEncounter(visit)
    await device.openTab(CLINICAL.tabs.notes)
    expect(await device.rowsWith(note), 'the note is in the chart once').toBe(1)
    await card.snap(device, 'note sent after sign-in')
  })
})
