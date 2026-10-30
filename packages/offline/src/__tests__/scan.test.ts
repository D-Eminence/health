import { describe, expect, it } from 'vitest'
import type { Json } from '../contracts'
import { PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, settle, signIn, until } from './harness'

// Fictional values only.
const NAME = 'Adaeze Testcase-Okonkwo'
const HID = 'HID-7Q4-SCANTEST'
const NOTE = 'Unique note text zebra quartz lantern'

function strings(value: unknown, out: string[] = []): string[] {
  if (value === null || value === undefined) return out
  if (typeof value === 'string') { out.push(value); return out }
  if (typeof value === 'number' || typeof value === 'boolean') { out.push(String(value)); return out }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    out.push(new TextDecoder('utf-8', { fatal: false }).decode(bytes))
    out.push(String.fromCharCode(...bytes))
    return out
  }
  if (Array.isArray(value)) { for (const v of value) strings(v, out); return out }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) { out.push(k); strings(v, out) }
  }
  return out
}

describe('storage scan (I9, T12)', () => {
  it('no plaintext identifiers or clinical text anywhere in IndexedDB', async () => {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv() })
    await signIn(rt)
    await rt.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
    await rt.rememberPatient({ patientId: PATIENT, displayName: NAME, hidCode: HID, grantExpiresAt: null })
    await rt.reads.read({ method: 'records', args: [PATIENT, 'clinical-notes'], patientId: PATIENT,
      network: async () => ({ patient: { name: NAME, hid: HID }, notes: [{ text: NOTE }] }) })
    server.state.offline = true
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: NOTE } as Json, { awaitMs: 0 })
    await rt.stageMedia(new Blob([`%PDF-1.4 ${NOTE} ${NAME}`], { type: 'application/pdf' }), { index: 1 })
    rt.audit.recordOpen(PATIENT, 'clinical-notes')
    await settle(rt)
    const store = (await rt.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)

    const dump = await store.dump()
    const haystack = strings(dump).join('\n').toLowerCase()
    for (const needle of [NAME, HID, NOTE, PATIENT, SESSION.email, SESSION.displayName, SESSION.accountId, SESSION.membershipId,
      SESSION.facilityName, 'zebra', 'testcase']) {
      expect(haystack.includes(needle.toLowerCase()), `found "${needle}" in plaintext`).toBe(false)
    }
    // Everything is really there, sealed.
    expect(dump.cache.length).toBeGreaterThan(0)
    expect(dump.outbox.length).toBe(1)
    expect(dump.media.length).toBe(1)
  })
})
