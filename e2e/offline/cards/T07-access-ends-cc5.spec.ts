import { setTimeout as sleep } from 'node:timers/promises'
import { test, expect } from '../support/devices'
import type { PatientDevice, StaffDevice } from '../support/devices'
import { DEMO } from '../support/guard'
import type { ApiRequestRecord } from '../support/guard'
import { CLASS_TITLES, OFFLINE, OFFLINE_API } from '../support/selectors'

/**
 * T7: access ends while device A is offline with Demo Patient Two's chart kept and a note waiting. On reconnecting the
 * chart is removed and the note is held (CC5); after a new access request is approved, the note is sent with the same
 * Idempotency-Key. Demo Patient Two only, and its own invocation, last: skipped unless HID_E2E_T7_MODE is set, which
 * the coordinator does only after deciding that T7 may revoke Patient Two's Demo Hospital share.
 *
 * - revoke: Patient Two revokes the Demo Hospital share in the portal (never the Demo Outreach one). The guard allows
 *   that one revoke only, for the grant it read as Demo Hospital's in GET identity/me/access-history.
 * - wait: the share must already be gone. A new 60-minute request grant expires while A is offline (about an hour).
 *
 * The seeded shares are never re-seeded: README.md says how Patient Two shares again afterwards. Request bodies are
 * never changed (for example to shorten durationMinutes): that is a question in the PR instead.
 */

const NOTE_PATH = /\/clinical-notes$/

function notePosts(requests: readonly ApiRequestRecord[]): ApiRequestRecord[] {
  return requests.filter(request => request.method === 'POST' && NOTE_PATH.test(request.path))
}

async function activeDemoHospitalShares(patient: PatientDevice): Promise<number> {
  await patient.openAccess()
  return [...patient.guard.grants.values()].filter(grant => grant.demoHospital && /active/i.test(grant.status)).length
}

async function heldForAccess(device: StaffDevice, card: { snap: (device: StaffDevice, label: string) => Promise<void> }): Promise<void> {
  await device.waitForAttention(10 * 60_000)
  const drawer = await device.openReview()
  await expect(drawer.getByText(CLASS_TITLES.CC5)).toBeVisible({ timeout: 30_000 })
  await card.snap(device, 'note held: access ended (CC5)')
  await device.closeReview(drawer)
}

test('T07 access ends while offline: chart removed, note held (CC5), sent with the same key after access is approved again', async ({ kit, ehrA: device, patient2, card }) => {
  // Skipped by the card gate (devices.ts) unless HID_E2E_T7_MODE is set, before any device signs in.
  const mode = kit.env.t7Mode ?? 'revoke'
  test.setTimeout((mode === 'wait' ? 3 * 60 : 60) * 60_000)
  card.note(`T7 mode: ${mode}`)
  const two = DEMO.patients.two
  const name = DEMO.patientNames.two

  await card.step('Patient Two\'s Demo Hospital share is in the state this mode needs', async () => {
    await patient2.ready()
    const shares = await activeDemoHospitalShares(patient2)
    card.note(`Active Demo Hospital shares for Patient Two: ${shares}`)
    if (mode === 'revoke') expect(shares, 'revoke mode needs the seeded Demo Hospital share; it is gone (use wait mode)').toBe(1)
    else expect(shares, 'wait mode needs the Demo Hospital share gone, so only a 60-minute grant gives access').toBe(0)
    await card.snap(patient2, 'access history before')
  })

  if (mode === 'wait') {
    await card.step('A asks for 60 minutes of access; Patient Two approves', async () => {
      await device.ready({ offline: true })
      const id = await device.requestAccess(two, { reason: card.text('60 minutes of access for an offline test'), minutes: 60 })
      await patient2.approve(id)
    })
  }

  await card.step('A, online: keep Patient Two\'s chart and start a visit', async () => {
    await device.keepPatientOffline(two, name)
    await device.startEncounter(card.text('visit'))
  })
  const since = device.guard.requests.length

  await card.step('A, offline: a note waits on the device', async () => {
    await device.goOffline()
    await device.addNote({ title: card.text('note held for access'), content: card.text('fictional note, sent once access is approved again') })
    await card.snap(device, 'note waiting')
  })

  if (mode === 'revoke') {
    await card.step('Patient Two revokes the Demo Hospital share (only that one)', async () => {
      await patient2.page.bringToFront()
      const grant = await patient2.revokeDemoHospitalShare(card.text('revoked for offline test T7'))
      card.note(`Revoked the Demo Hospital share ${grant}. README.md: how Patient Two shares again.`)
      await card.snap(patient2, 'share revoked')
    })
  } else {
    await card.step('Wait offline until the 60-minute grant has expired', async () => {
      const until = Date.now() + 62 * 60_000
      while (Date.now() < until) { device.checkGuard(); await sleep(60_000) }
    })
  }

  await card.step('A, online: the chart is removed and the note is held (CC5)', async () => {
    await device.page.bringToFront()
    await device.ready()
    await heldForAccess(device, card)
    expect(await device.pendingCount() + await device.attentionCount(), 'the note is still on the device').toBeGreaterThan(0)
    await device.navigate('/provider/patients')
    await expect(device.page.getByRole('button', { name: `${OFFLINE.onDevice.open} ${name}`, exact: true }), 'the chart is no longer on this device').toHaveCount(0)
    await card.snap(device, 'chart removed from this device')
  })
  const firstKey = notePosts(device.guard.requestsSince(since))[0]?.idempotencyKey ?? null
  card.note(firstKey ? `The held note was sent with key ${firstKey} and refused` : 'The held note was not sent before access ended (held on the receipt check)')

  await card.step('A asks for access again; Patient Two approves; the note is sent', async () => {
    const id = await device.requestAccess(two, { reason: card.text('access again for the held note') })
    await patient2.page.bringToFront()
    await patient2.approve(id)
    await device.page.bringToFront()
    await device.openPatient(two, name)
    expect(await device.waitUntilSent(10 * 60_000), 'the held note was not sent after access was approved').toBe(true)
  })

  await card.step('The note was sent with the same Idempotency-Key', async () => {
    const posts = notePosts(device.guard.requestsSince(since))
    const keys = new Set(posts.map(post => post.idempotencyKey))
    card.note(`Note requests: ${posts.map(post => `${post.status ?? post.failure} (${post.idempotencyKey})`).join(', ')}`)
    expect(keys.size, 'one key for the held note').toBe(1)
    expect([...keys][0]?.startsWith(OFFLINE_API.keyPrefix)).toBe(true)
    expect(posts.some(post => post.status !== null && post.status < 300), 'the note was applied').toBe(true)
    if (firstKey) expect([...keys][0]).toBe(firstKey)
  })
})
