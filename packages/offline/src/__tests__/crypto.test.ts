import { describe, expect, it } from 'vitest'
import {
  addEscrowWrap, calibrateIterations, createVaultKeys, deriveKek, hmacTag, importEscrowKey, iterationsFor, kekOpens, kekSalt,
  mediaAad, open, openBytes, randomBytes, recordAad, rewrapWithEscrow, seal, sealBytes, unwrapVaultKeys, wrapAad,
} from '../crypto'

const VAULT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VAULT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

async function kek(password = 'correct horse battery', email = 'nurse@demo.example', salt = new Uint8Array(16)) {
  return deriveKek(password, await kekSalt(salt, email), 1000)
}

describe('crypto', () => {
  it('derives the KEK salt from the device salt and the trimmed, lower-cased email', async () => {
    const salt = randomBytes(16)
    expect(await kekSalt(salt, '  Nurse@Demo.Example ')).toEqual(await kekSalt(salt, 'nurse@demo.example'))
    expect(await kekSalt(salt, 'nurse@demo.example')).not.toEqual(await kekSalt(randomBytes(16), 'nurse@demo.example'))
  })

  it('round-trips records sealed with DK and QK', async () => {
    const { keys } = await createVaultKeys(await kek(), VAULT_A)
    const aad = recordAad(VAULT_A, 'cache', [VAULT_A, 'tag'])
    const env = await seal(keys.dk, 'dk', aad, { note: 'Fever for two days' })
    expect(env.iv).toHaveLength(12)
    expect(await open(keys.dk, aad, env)).toEqual({ note: 'Fever for two days' })
    const q = await seal(keys.qk, 'qk', aad, [1, 2, 3])
    expect(await open(keys.qk, aad, q)).toEqual([1, 2, 3])
  })

  it('a record moved to another vault, store or key fails to open (AAD)', async () => {
    const { keys } = await createVaultKeys(await kek(), VAULT_A)
    const env = await seal(keys.qk, 'qk', recordAad(VAULT_A, 'outbox', [VAULT_A, 1]), { x: 1 })
    await expect(open(keys.qk, recordAad(VAULT_B, 'outbox', [VAULT_B, 1]), env)).rejects.toThrow()
    await expect(open(keys.qk, recordAad(VAULT_A, 'audit', [VAULT_A, 1]), env)).rejects.toThrow()
    await expect(open(keys.qk, recordAad(VAULT_A, 'outbox', [VAULT_A, 2]), env)).rejects.toThrow()
    await expect(open(keys.dk, recordAad(VAULT_A, 'outbox', [VAULT_A, 1]), env)).rejects.toThrow()
  })

  it('media chunks cannot be swapped, reordered or truncated', async () => {
    const { keys } = await createVaultKeys(await kek(), VAULT_A)
    const chunk = new Uint8Array([1, 2, 3])
    const env = await sealBytes(keys.qk, 'qk', mediaAad(VAULT_A, 'blob', 0, 2, 'abc'), chunk)
    expect(await openBytes(keys.qk, mediaAad(VAULT_A, 'blob', 0, 2, 'abc'), env)).toEqual(chunk)
    await expect(openBytes(keys.qk, mediaAad(VAULT_A, 'blob', 1, 2, 'abc'), env)).rejects.toThrow()
    await expect(openBytes(keys.qk, mediaAad(VAULT_A, 'blob', 0, 1, 'abc'), env)).rejects.toThrow()
    await expect(openBytes(keys.qk, mediaAad(VAULT_A, 'other', 0, 2, 'abc'), env)).rejects.toThrow()
  })

  it('unwrapped keys are not extractable; a wrong password or vault does not open the wraps', async () => {
    const k = await kek()
    const { wraps, keys } = await createVaultKeys(k, VAULT_A)
    expect(keys.dk.extractable).toBe(false)
    expect(keys.ik.extractable).toBe(false)
    expect(keys.qk.extractable).toBe(false)
    expect(await kekOpens(k, VAULT_A, wraps.dk)).toBe(true)
    expect(await kekOpens(await kek('wrong password!!'), VAULT_A, wraps.dk)).toBe(false)
    expect(await kekOpens(await kek(undefined, 'other@demo.example'), VAULT_A, wraps.dk)).toBe(false)
    // The wrap AAD names the vault: the same wrap moved to another vault id does not open.
    expect(await kekOpens(k, VAULT_B, wraps.dk)).toBe(false)
    await expect(unwrapVaultKeys(k, VAULT_B, wraps)).rejects.toThrow()
    expect(wrapAad(VAULT_A, 'qk', 'esc:1')).toBe(`hid-offline/v1|wrap|${VAULT_A}|qk|esc:1`)
  })

  it('tags are stable per key and differ between vaults', async () => {
    const a = await createVaultKeys(await kek(), VAULT_A)
    const b = await createVaultKeys(await kek(), VAULT_B)
    expect(await hmacTag(a.keys.ik, 'patient|p1')).toBe(await hmacTag(a.keys.ik, 'patient|p1'))
    expect(await hmacTag(a.keys.ik, 'patient|p1')).not.toBe(await hmacTag(b.keys.ik, 'patient|p1'))
    expect(await hmacTag(a.keys.ik, 'patient|p1')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('escrow keeps QK across a password change; DK and IK are new', async () => {
    const oldKek = await kek('old password value')
    const escrow = { key: await importEscrowKey(randomBytes(32)), keyVersion: 1 }
    const created = await createVaultKeys(oldKek, VAULT_A)
    const qkEsc = await addEscrowWrap(oldKek, VAULT_A, created.wraps.qkPw, escrow)
    const aad = recordAad(VAULT_A, 'outbox', [VAULT_A, 1])
    const queued = await seal(created.keys.qk, 'qk', aad, { op: 'ehr.note.create' })
    const cached = await seal(created.keys.dk, 'dk', aad, { x: 1 })

    const newKek = await kek('a new password value')
    const re = await rewrapWithEscrow(newKek, VAULT_A, qkEsc, escrow.key)
    expect(await open(re.keys.qk, aad, queued)).toEqual({ op: 'ehr.note.create' })
    await expect(open(re.keys.dk, aad, cached)).rejects.toThrow()
    expect(await kekOpens(newKek, VAULT_A, re.wraps.dk)).toBe(true)
    expect(await kekOpens(oldKek, VAULT_A, re.wraps.dk)).toBe(false)
    // Another escrow key (another account) does not open it.
    await expect(rewrapWithEscrow(newKek, VAULT_A, qkEsc, await importEscrowKey(randomBytes(32)))).rejects.toThrow()
  })

  it('calibrates PBKDF2: 600,000 unless that projects past 2.5 s', async () => {
    expect(iterationsFor(1000)).toBe(600_000)
    expect(iterationsFor(2500)).toBe(600_000)
    expect(iterationsFor(5000)).toBe(310_000)
    expect(iterationsFor(3000)).toBe(500_000)
    expect(iterationsFor(4000)).toBe(380_000)
    expect(iterationsFor(100_000)).toBe(310_000)
    let t = 0
    // 50,000 iterations "take" 300 ms → 3.6 s projected for 600,000 → round10k(600000 × 2.5 / 3.6) = 420,000.
    const it = await calibrateIterations(() => { const now = t; t += 300; return now })
    expect(it).toBe(420_000)
  })

  it('refuses an escrow key that is not 32 bytes', async () => {
    await expect(importEscrowKey(randomBytes(16))).rejects.toThrow()
  })
})
