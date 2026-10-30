import { test, expect } from '../support/devices'
import type { StaffDevice } from '../support/devices'
import { DEMO } from '../support/guard'
import type { ApiRequestRecord } from '../support/guard'
import { CLASS_TITLES, CLINICAL, OFFLINE, OFFLINE_API } from '../support/selectors'

/**
 * T2: a visit, a note, vital signs and a prescription saved offline are applied once when the network returns, and a
 * second reload shows no duplicate. A8.3: without a SafetyProbe, a prescription saved offline may be held for review
 * (CC4); the card records what happens and, if held, sends it as is (it is a fictional draft).
 */

const PATHS = {
  visit: /\/encounters$/,
  note: /\/clinical-notes$/,
  vitals: /\/vitals$/,
  prescription: /\/prescriptions$/,
} as const

/** Per kind: the distinct Idempotency-Keys sent, and how many requests carried each. */
function keysByKind(requests: readonly ApiRequestRecord[]): Record<keyof typeof PATHS, Map<string, ApiRequestRecord[]>> {
  const result = Object.fromEntries(Object.keys(PATHS).map(kind => [kind, new Map<string, ApiRequestRecord[]>()])) as Record<keyof typeof PATHS, Map<string, ApiRequestRecord[]>>
  for (const request of requests) {
    if (request.method !== 'POST') continue
    for (const [kind, pattern] of Object.entries(PATHS) as [keyof typeof PATHS, RegExp][]) {
      if (!pattern.test(request.path)) continue
      const key = request.idempotencyKey ?? '(none)'
      result[kind].set(key, [...(result[kind].get(key) ?? []), request])
    }
  }
  return result
}

async function countOnce(device: StaffDevice, visit: string, note: string, medication: string): Promise<Record<string, number>> {
  await device.openPatient(DEMO.patients.one, DEMO.patientNames.one)
  const visits = await device.page.locator(CLINICAL.encounterRow).filter({ hasText: visit }).count()
  await device.selectEncounter(visit)
  await device.openTab(CLINICAL.tabs.notes)
  const notes = await device.rowsWith(note)
  await device.openTab(CLINICAL.tabs.vitals)
  const vitals = await device.rowsWith('BP 121/79')
  await device.openTab(CLINICAL.tabs.prescriptions)
  const prescriptions = await device.rowsWith(medication)
  return { visits, notes, vitals, prescriptions }
}

test('T02 a visit, note, vitals and prescription saved offline are applied once after the network returns', async ({ ehrA: device, card }) => {
  test.setTimeout(30 * 60_000)
  const visit = card.text('visit')
  const note = card.text('note')
  const medication = card.text('fictional medication')

  await card.step('Online: keep Demo Patient One on this device', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
  })
  const since = device.guard.requests.length

  await card.step('Offline: save a visit, a note, vital signs and a prescription', async () => {
    await device.goOffline()
    await device.startEncounter(visit)
    await device.addNote({ title: note, content: card.text('fictional note for an offline test. Not a real patient.') })
    await device.addVitals({ systolic: 121, diastolic: 79, pulse: 71, temperature: 36.7 })
    await device.addPrescription({ medication, instructions: card.text('fictional, for an offline test only') })
    await expect(device.pendingRows().first()).toBeVisible()
    card.note(`Waiting to send while offline: ${await device.pendingCount()}`)
    await card.snap(device, 'four changes saved on this device')
  })

  await card.step('Online: everything is sent', async () => {
    await device.goOnline()
    const sent = await device.waitUntilSent(5 * 60_000)
    if (await device.attentionCount() > 0) {
      const drawer = await device.openReview()
      await card.snap(device, 'review after reconnecting')
      const held = await drawer.getByText(CLASS_TITLES.CC4).count()
      card.note(held > 0
        ? 'A8.3: the prescription saved offline was held for review (CC4). Sent as is (it is a fictional draft).'
        : 'A change needed attention after reconnecting, but not a CC4 safety hold: see the screenshot.')
      if (held > 0) {
        await device.resolveReview(drawer, CLASS_TITLES.CC4, OFFLINE.review.sendAsIs, card.text('fictional draft, checked'))
        expect(await device.waitUntilSent(5 * 60_000), 'the held prescription was not sent').toBe(true)
      } else {
        await device.closeReview(drawer)
      }
    } else {
      card.note(`A8.3: no review was asked for; the prescription was sent with the rest (${sent ? 'all sent' : 'not all sent yet'}).`)
    }
    expect(await device.pendingCount(), 'changes still wait on this device').toBe(0)
  })

  await card.step('Each change was one command with one off1. key; replays reused it', async () => {
    const byKind = keysByKind(device.guard.requestsSince(since))
    for (const [kind, keys] of Object.entries(byKind)) {
      expect(keys.size, `${kind}: one command, one Idempotency-Key`).toBe(1)
      const [key, requests] = [...keys][0]!
      expect(key.startsWith(OFFLINE_API.keyPrefix), `${kind}: the key is an offline key (off1.)`).toBe(true)
      expect(requests.some(request => request.status !== null && request.status < 300), `${kind}: one answer was 2xx`).toBe(true)
      card.note(`${kind}: ${requests.length} request(s) with key ${key}; statuses ${requests.map(request => request.status ?? request.failure).join(', ')}`)
    }
    card.note(`Order of writes after reconnecting: ${device.guard.requestsSince(since).filter(r => r.method !== 'GET').map(r => `${r.method} ${r.path.replace(/[0-9a-f-]{36}/g, ':id')}`).join(' → ')}`)
  })

  for (const round of ['after reconnecting', 'after a second reload']) {
    await card.step(`No duplicate ${round}`, async () => {
      await device.page.reload()
      await device.ready()
      const counts = await countOnce(device, visit, note, medication)
      expect(counts, `each change is in the chart exactly once ${round}`).toEqual({ visits: 1, notes: 1, vitals: 1, prescriptions: 1 })
      await card.snap(device, `chart ${round}`)
    })
  }
})
