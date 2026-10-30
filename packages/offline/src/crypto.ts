/**
 * Every key the offline vault uses, and the only file allowed to derive,
 * generate, import, export or wrap one (docs/OFFLINE-CONTRACT.md §2.5; the
 * NO_KEY_HANDLING lint rule enforces it).
 *
 * Keys
 *   DK  AES-GCM-256   cache and vault header (disposable)     wrapped by KEK_pw
 *   IK  HMAC-SHA-256  tags for keys and indexes                wrapped by KEK_pw
 *   QK  AES-GCM-256   outbox, audit, media, receipts           wrapped by KEK_pw and by ESC_v
 *
 * Keys are generated extractable only inside `createVaultKeys`, wrapped at
 * once, and from then on only ever unwrapped as non-extractable handles. A
 * re-wrap (escrow added later, or a password change) unwraps into an
 * extractable handle inside this file and wraps it again straight away; raw
 * key bytes never reach JavaScript after creation.
 *
 * Honest limit: this protects a locked or stolen device and other accounts on
 * the same browser profile. It does not protect against malicious same-origin
 * script while the vault is unlocked; that is the CSP's job.
 */

import { LIMITS } from './contracts'

export type KeyName = 'dk' | 'ik' | 'qk'
export type WrapBy = 'pw' | `esc:${number}`

export interface Wrap { iv: Uint8Array; ct: ArrayBuffer }
export interface Envelope { v: 1; k: 'dk' | 'qk'; iv: Uint8Array; ct: ArrayBuffer }

/** Unwrapped, non-extractable handles for an open vault. */
export interface VaultKeys { dk: CryptoKey; ik: CryptoKey; qk: CryptoKey }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function subtleCrypto(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new Error('Web Crypto is not available')
  return s
}

/** True when this browser can keep an offline copy safely. */
export function cryptoSupported(): boolean {
  return typeof globalThis.crypto?.subtle?.wrapKey === 'function' && typeof globalThis.crypto.getRandomValues === 'function'
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n))
  globalThis.crypto.getRandomValues(out)
  return out
}

export function randomUuid(): string {
  return globalThis.crypto.randomUUID()
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(s)
  const out = new Uint8Array(new ArrayBuffer(bytes.length))
  out.set(bytes)
  return out
}

function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length))
  out.set(bytes)
  return out
}

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of view) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const s = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4))
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i)
  return out
}

export async function sha256(bytes: Uint8Array | string): Promise<Uint8Array> {
  const input = typeof bytes === 'string' ? utf8(bytes) : copy(bytes)
  return new Uint8Array(await subtleCrypto().digest('SHA-256', input))
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  return [...await sha256(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// --- AAD strings (§2.5) ------------------------------------------------------

export function wrapAad(vaultId: string, key: KeyName, by: WrapBy): string {
  return `hid-offline/v1|wrap|${vaultId}|${key}|${by}`
}

export function recordAad(vaultId: string, store: string, primaryKey: readonly (string | number)[]): string {
  return `hid-offline/v1|${vaultId}|${store}|${primaryKey.join('|')}`
}

export function mediaAad(vaultId: string, blobId: string, chunkNo: number, chunkCount: number, fileSha256Hex: string): string {
  return `hid-offline/v1|${vaultId}|media|${blobId}|${chunkNo}|${chunkCount}|${fileSha256Hex}`
}

// --- KEK (§2.5 "KEK_pw (staff)") --------------------------------------------

/** salt = SHA-256("hid-offline-kek/v1" ‖ 0x00 ‖ deviceSalt ‖ 0x00 ‖ UTF8(trim(email).toLowerCase())) */
export async function kekSalt(deviceSalt: Uint8Array, email: string): Promise<Uint8Array> {
  const label = encoder.encode('hid-offline-kek/v1')
  const mail = encoder.encode(email.trim().toLowerCase())
  const buf = new Uint8Array(label.length + 1 + deviceSalt.length + 1 + mail.length)
  buf.set(label, 0)
  buf[label.length] = 0
  buf.set(deviceSalt, label.length + 1)
  buf[label.length + 1 + deviceSalt.length] = 0
  buf.set(mail, label.length + 2 + deviceSalt.length)
  return sha256(buf)
}

/**
 * KEK = PBKDF2-SHA-256(password, salt, iterations) → AES-GCM-256, non-extractable,
 * usages wrapKey and unwrapKey. The caller drops its reference to the password
 * afterwards (JavaScript cannot zero a string).
 */
export async function deriveKek(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const s = subtleCrypto()
  const base = await s.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey'])
  return s.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: copy(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

/**
 * Iterations from a timing of 50,000 (§2.5): 600,000 unless that is projected
 * to take more than 2.5 s, then max(310,000, round10k(600,000 × 2.5 s / projected)).
 */
export function iterationsFor(projectedMsFor600k: number): number {
  if (!(projectedMsFor600k > LIMITS.pbkdf2TargetMs)) return LIMITS.pbkdf2Default
  const scaled = Math.round((LIMITS.pbkdf2Default * LIMITS.pbkdf2TargetMs / projectedMsFor600k) / 10_000) * 10_000
  return Math.max(LIMITS.pbkdf2Floor, scaled)
}

export async function calibrateIterations(now: () => number = () => performance.now()): Promise<number> {
  const s = subtleCrypto()
  const base = await s.importKey('raw', utf8('calibration'), 'PBKDF2', false, ['deriveBits'])
  const started = now()
  await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: randomBytes(16), iterations: 50_000 }, base, 256)
  const elapsed = now() - started
  return iterationsFor(elapsed * (LIMITS.pbkdf2Default / 50_000))
}

// --- Vault keys ----------------------------------------------------------------

const AES: AesKeyGenParams = { name: 'AES-GCM', length: 256 }
const HMAC: HmacKeyGenParams = { name: 'HMAC', hash: 'SHA-256', length: 256 }

function algorithmFor(key: KeyName): AesKeyGenParams | HmacKeyGenParams {
  return key === 'ik' ? HMAC : AES
}

function usagesFor(key: KeyName): KeyUsage[] {
  return key === 'ik' ? ['sign'] : ['encrypt', 'decrypt']
}

async function wrapWith(key: CryptoKey, wrapping: CryptoKey, aad: string): Promise<Wrap> {
  const iv = randomBytes(12)
  const ct = await subtleCrypto().wrapKey('raw', key, wrapping, { name: 'AES-GCM', iv, additionalData: utf8(aad) })
  return { iv, ct }
}

async function unwrapWith(wrap: Wrap, wrapping: CryptoKey, aad: string, key: KeyName, extractable: boolean): Promise<CryptoKey> {
  return subtleCrypto().unwrapKey(
    'raw', wrap.ct, wrapping, { name: 'AES-GCM', iv: copy(wrap.iv), additionalData: utf8(aad) },
    algorithmFor(key), extractable, usagesFor(key),
  )
}

export interface VaultWraps { dk: Wrap; ik: Wrap; qkPw: Wrap; qkEsc?: Wrap & { keyVersion: number } }

/** Generate DK, IK and QK, wrap them under the KEK (and QK under escrow when given), and return non-extractable handles. */
export async function createVaultKeys(
  kek: CryptoKey, vaultId: string, escrow?: { key: CryptoKey; keyVersion: number },
): Promise<{ wraps: VaultWraps; keys: VaultKeys }> {
  const s = subtleCrypto()
  const dk = await s.generateKey(AES, true, ['encrypt', 'decrypt'])
  const ik = await s.generateKey(HMAC, true, ['sign'])
  const qk = await s.generateKey(AES, true, ['encrypt', 'decrypt'])
  const wraps: VaultWraps = {
    dk: await wrapWith(dk, kek, wrapAad(vaultId, 'dk', 'pw')),
    ik: await wrapWith(ik, kek, wrapAad(vaultId, 'ik', 'pw')),
    qkPw: await wrapWith(qk, kek, wrapAad(vaultId, 'qk', 'pw')),
  }
  if (escrow) {
    wraps.qkEsc = { ...await wrapWith(qk, escrow.key, wrapAad(vaultId, 'qk', `esc:${escrow.keyVersion}`)), keyVersion: escrow.keyVersion }
  }
  // The extractable handles go out of scope here; only non-extractable ones are kept.
  return { wraps, keys: await unwrapVaultKeys(kek, vaultId, wraps) }
}

/** Unwrap all three keys with the KEK. Throws when the KEK is not this vault's (wrong password or account). */
export async function unwrapVaultKeys(kek: CryptoKey, vaultId: string, wraps: Pick<VaultWraps, 'dk' | 'ik' | 'qkPw'>): Promise<VaultKeys> {
  return {
    dk: await unwrapWith(wraps.dk, kek, wrapAad(vaultId, 'dk', 'pw'), 'dk', false),
    ik: await unwrapWith(wraps.ik, kek, wrapAad(vaultId, 'ik', 'pw'), 'ik', false),
    qk: await unwrapWith(wraps.qkPw, kek, wrapAad(vaultId, 'qk', 'pw'), 'qk', false),
  }
}

/** The cheap trial used to find which vault a KEK opens (§2.5: trial-unwrap of each vault's `dk`). */
export async function kekOpens(kek: CryptoKey, vaultId: string, dkWrap: Wrap): Promise<boolean> {
  try {
    await unwrapWith(dkWrap, kek, wrapAad(vaultId, 'dk', 'pw'), 'dk', false)
    return true
  } catch {
    return false
  }
}

/** Import the 32-byte escrow key from C4 as a non-extractable wrapping key. It is never stored. */
export async function importEscrowKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('Escrow key must be 32 bytes')
  return subtleCrypto().importKey('raw', copy(raw), { name: 'AES-GCM' }, false, ['wrapKey', 'unwrapKey'])
}

/** Add an escrow wrap of QK to a vault that has none yet (the KEK is in memory while unlocked). */
export async function addEscrowWrap(
  kek: CryptoKey, vaultId: string, qkPw: Wrap, escrow: { key: CryptoKey; keyVersion: number },
): Promise<Wrap & { keyVersion: number }> {
  const qk = await unwrapWith(qkPw, kek, wrapAad(vaultId, 'qk', 'pw'), 'qk', true)
  return { ...await wrapWith(qk, escrow.key, wrapAad(vaultId, 'qk', `esc:${escrow.keyVersion}`)), keyVersion: escrow.keyVersion }
}

/**
 * After a password change (§2.5 "ESC_v"): recover QK through escrow, generate
 * a new DK and IK (the old cache becomes unreadable and is wiped by the
 * caller), and wrap everything under the new KEK. Throws when the escrow key
 * does not open this vault's QK.
 */
export async function rewrapWithEscrow(
  newKek: CryptoKey, vaultId: string, qkEsc: Wrap & { keyVersion: number }, escrowKey: CryptoKey,
): Promise<{ wraps: VaultWraps; keys: VaultKeys }> {
  const s = subtleCrypto()
  const qk = await unwrapWith(qkEsc, escrowKey, wrapAad(vaultId, 'qk', `esc:${qkEsc.keyVersion}`), 'qk', true)
  const dk = await s.generateKey(AES, true, ['encrypt', 'decrypt'])
  const ik = await s.generateKey(HMAC, true, ['sign'])
  const wraps: VaultWraps = {
    dk: await wrapWith(dk, newKek, wrapAad(vaultId, 'dk', 'pw')),
    ik: await wrapWith(ik, newKek, wrapAad(vaultId, 'ik', 'pw')),
    qkPw: await wrapWith(qk, newKek, wrapAad(vaultId, 'qk', 'pw')),
    qkEsc,
  }
  return { wraps, keys: await unwrapVaultKeys(newKek, vaultId, wraps) }
}

// --- Sealing records -------------------------------------------------------------

/** Seal raw bytes under DK or QK with the given AAD. A fresh 96-bit IV each time. */
export async function sealBytes(key: CryptoKey, k: 'dk' | 'qk', aad: string, bytes: Uint8Array): Promise<Envelope> {
  const iv = randomBytes(12)
  const ct = await subtleCrypto().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, copy(bytes))
  return { v: 1, k, iv, ct }
}

export async function openBytes(key: CryptoKey, aad: string, env: Envelope): Promise<Uint8Array> {
  if (env.v !== 1) throw new Error('Unknown envelope version')
  const pt = await subtleCrypto().decrypt({ name: 'AES-GCM', iv: copy(env.iv), additionalData: utf8(aad) }, key, env.ct)
  return new Uint8Array(pt)
}

/** Seal a JSON-serialisable value. */
export async function seal(key: CryptoKey, k: 'dk' | 'qk', aad: string, value: unknown): Promise<Envelope> {
  return sealBytes(key, k, aad, encoder.encode(JSON.stringify(value)))
}

export async function open<T>(key: CryptoKey, aad: string, env: Envelope): Promise<T> {
  return JSON.parse(decoder.decode(await openBytes(key, aad, env))) as T
}

/** tag = b64url(HMAC-SHA256(IK, logicalKey)). */
export async function hmacTag(ik: CryptoKey, logical: string): Promise<string> {
  return b64url(await subtleCrypto().sign('HMAC', ik, utf8(logical)))
}
