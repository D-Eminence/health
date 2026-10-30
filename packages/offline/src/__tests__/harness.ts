import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { OFFLINE_PATHS, type Json } from '../contracts'
import { b64url } from '../crypto'
import { createOfflineRuntime, type OfflineRuntimeHandle, type OfflineRuntimeOptions } from '../runtime'
import type { createMemoryLocks } from '../testing'
import { TransportError, type SendSpec, type SendResult } from '../types'
import { ALL_DEFS, PASSWORD, SESSION } from './fixtures'

export interface ServerCall { spec: SendSpec; bodyText: string }
export type Fault = { status: number | null; code?: string; problem?: boolean; networkError?: boolean; retryAfterMs?: number; body?: unknown }

/**
 * A scripted stand-in for ehr-api: idempotent keyed writes (a replay returns
 * the stored resource), C1 receipts from that table, C2 audit ingest, C4
 * escrow derived per vault, and the ping. Faults are queued per call.
 */
export function createServer() {
  const calls: ServerCall[] = []
  /** Every write body the server applied (first application only, as with the idempotency table). */
  const applied: string[] = []
  const keys = new Map<string, { status: number; body: unknown; operationPath: string }>()
  const faults: Fault[] = []
  const rules: { when: (spec: SendSpec, bodyText: string) => boolean; faults: Fault[] }[] = []
  const audit: { vaultId: string; events: { eventId: string; seq: number; action: string }[] }[] = []
  const state = {
    offline: false,
    escrow: true,
    /** The newest escrow key version (rotation), and every keyVersion asked for. */
    escrowVersion: 1,
    escrowAsked: [] as (number | null)[],
    /** Answer C2 with this refusal instead of accepting. */
    auditRefusal: null as { status: number; code: string } | null,
    /** C2 answers 503 (audit unavailable), so offline audit stays queued. */
    auditDown: false,
    receiptsDown: false,
    /** Apply the write but lose the answer (network error after commit). */
    loseNextAnswer: false,
    /** Hold every clinical write until this promise settles. */
    gate: null as Promise<void> | null,
    /** Apply the write and never answer (the tab is closed mid-send). */
    hangNextAnswer: false,
    rereadBody: null as unknown,
    auditReject: new Set<number>(),
    /** The signed-in account, as the cookie session would tell the real server. */
    account: SESSION.accountId,
  }
  let n = 0

  // Like the server's HKDF: bound to the signed-in account and the facility the request names (§2.10 C4).
  async function escrowKey(vaultId: string, facilityId: string, version: number): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`server-secret-v${version}|${state.account}|${facilityId}|${vaultId}`))
    return b64url(new Uint8Array(digest))
  }

  const transport = async (spec: SendSpec): Promise<SendResult> => {
    const bodyText = spec.body === undefined ? '' : JSON.stringify(spec.body)
    calls.push({ spec, bodyText })
    if (state.offline) throw new TransportError({ status: null, networkError: true })
    // The WAF refuses bodies over 8 KB with a 403 that is not problem+json.
    if (new TextEncoder().encode(bodyText).length > 8192) throw new TransportError({ status: 403, problem: false })
    if (spec.path === OFFLINE_PATHS.ping) return { status: 200, body: { service: 'ehr-api', serverTime: new Date().toISOString() }, date: null }
    if (spec.path === OFFLINE_PATHS.receipts) {
      if (state.receiptsDown) throw new TransportError({ status: null, networkError: true })
      const asked = (spec.body as { keys: string[] }).keys
      return {
        status: 200, date: null,
        body: {
          receipts: asked.filter(k => keys.has(k)).map(k => ({
            key: k, operation: 'x', state: 'completed', resourceType: 'record',
            resourceId: (keys.get(k)!.body as { id: string }).id, responseStatus: keys.get(k)!.status,
          })),
          unknown: asked.filter(k => !keys.has(k)),
        },
      }
    }
    if (spec.path === OFFLINE_PATHS.escrow) {
      if (!state.escrow) throw new TransportError({ status: 503, code: 'OFFLINE_ESCROW_UNAVAILABLE', problem: true })
      const asked = spec.body as { vaultId: string; keyVersion: number | null }
      state.escrowAsked.push(asked.keyVersion)
      // null means the newest version (new wraps); a recovery names the version stored with the wrap (A10.5).
      const version = asked.keyVersion ?? state.escrowVersion
      return { status: 200, date: null, body: { keyVersion: version, key: await escrowKey(asked.vaultId, spec.headers?.['X-Facility-ID'] ?? '', version), algorithm: 'HKDF-SHA256' } }
    }
    if (spec.path === OFFLINE_PATHS.audit) {
      if (state.auditDown) throw new TransportError({ status: 503, code: 'OFFLINE_AUDIT_UNAVAILABLE', problem: true })
      if (state.auditRefusal) throw new TransportError({ ...state.auditRefusal, problem: true })
      const b = spec.body as { vaultId: string; events: { eventId: string; seq: number; action: string }[] }
      audit.push(b)
      return {
        status: 200, date: null,
        body: {
          accepted: b.events.filter(e => !state.auditReject.has(e.seq)).map(e => e.eventId), duplicate: [],
          rejected: b.events.filter(e => state.auditReject.has(e.seq)).map(e => ({ eventId: e.eventId, code: 'INVALID_EVENT' })),
        },
      }
    }
    if (state.gate && !spec.path.startsWith('/api/v1/ehr/offline/')) await state.gate
    const ruled = rules.findIndex(r => r.when(spec, bodyText))
    if (ruled >= 0) {
      const r = rules[ruled]!
      const f = r.faults.shift()
      if (r.faults.length === 0) rules.splice(ruled, 1)
      if (f) throw new TransportError({ ...f, problem: f.problem ?? (f.status !== null && f.status >= 400) })
    }
    const fault = faults.shift()
    if (fault) throw new TransportError({ ...fault, problem: fault.problem ?? (fault.status !== null && fault.status >= 400) })
    const key = spec.headers?.['Idempotency-Key']
    if (spec.path.endsWith('/complete')) return { status: 200, body: { ok: true }, date: null }
    if (key && keys.has(key)) {
      const prior = keys.get(key)!
      return { status: prior.status, body: prior.body, date: null }
    }
    n += 1
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const body = spec.path.endsWith('/upload-intents')
      ? { document: { id }, upload: { method: 'PUT', url: `https://storage.example/${id}?sig=${n}`, requiredHeaders: { 'Content-Type': 'application/pdf' }, expiresInSeconds: 300 } }
      : { id, rowVersion: 1 }
    if (key) keys.set(key, { status: 201, body, operationPath: spec.path })
    applied.push(bodyText)
    if (state.hangNextAnswer) {
      state.hangNextAnswer = false
      return new Promise<SendResult>(() => undefined)
    }
    if (state.loseNextAnswer) {
      state.loseNextAnswer = false
      throw new TransportError({ status: null, networkError: true })
    }
    return { status: spec.method === 'PATCH' ? 200 : 201, body, date: null }
  }

  return {
    transport, calls, keys, audit, state, applied,
    fail(...f: Fault[]) { faults.push(...f) },
    /** Faults for the requests whose body contains `text`, in order. */
    failWhenBody(text: string, ...f: Fault[]) { rules.push({ when: (_s, b) => b.includes(text), faults: f }) },
    writes: () => calls.filter(c => !Object.values(OFFLINE_PATHS).includes(c.spec.path as never)),
  }
}

export type Server = ReturnType<typeof createServer>

export interface Env {
  wall: number
  mono: number
  /**
   * Feed a server `Date` through onResponseMeta on every response (as the app's HTTP client does), so the runtime
   * has a trusted anchor. The server's clock is `server` when set, else the device's `wall`.
   */
  serverClock?: boolean
  server?: number
}

const clocked = new WeakMap<OfflineRuntimeHandle, () => void>()

export function makeEnv(): Env {
  return { wall: Date.parse('2026-10-29T09:00:00.000Z'), mono: 1_000_000 }
}

export function makeRuntime(o: {
  server: Server; env: Env; idb?: IDBFactory; locks?: ReturnType<typeof createMemoryLocks> | null; mode?: string
  extra?: Partial<OfflineRuntimeOptions>
}): OfflineRuntimeHandle {
  const date = () => new Date(o.env.server ?? o.env.wall).toUTCString()
  const meta = (spec: SendSpec, status: number | null, networkError: boolean) => ({
    method: spec.method, path: spec.path, status, date: status === null ? null : date(), problem: false, code: null, networkError,
    authenticated: spec.auth !== 'none',
  })
  const transport = !o.env.serverClock ? o.server.transport : async (spec: SendSpec): Promise<SendResult> => {
    try {
      const res = await o.server.transport(spec)
      runtime.onResponseMeta(meta(spec, res.status, false))
      return res
    } catch (error) {
      const status = error instanceof TransportError ? error.status : null
      runtime.onResponseMeta(meta(spec, status, status === null))
      throw error
    }
  }
  const runtime = createOfflineRuntime({
    appHost: 'ehr',
    env: { mode: o.mode ?? 'pilot', facilities: SESSION.facilityId, hosts: 'ehr,ocr' },
    transport,
    idbFactory: o.idb ?? new IDBFactory(),
    locks: o.locks === undefined ? null : o.locks,
    BroadcastChannel: null,
    storage: null,
    wall: () => o.env.wall,
    mono: () => o.env.mono,
    random: () => 0.5,
    calibrate: async () => 1000,
    reencode: null,
    timers: false,
    networkFirstMs: 50,
    ...o.extra,
  })
  runtime.commands.register(ALL_DEFS)
  // The sign-in request itself is a server response the runtime sees before attachSession.
  if (o.env.serverClock) clocked.set(runtime, () => runtime.onResponseMeta(meta({ method: 'POST', path: '/api/v1/auth/staff/login' }, 200, false)))
  return runtime
}

/** The sign-in's own server response, for tests that call offer() or attachSession() directly. */
export function serverContact(runtime: OfflineRuntimeHandle): void {
  clocked.get(runtime)?.()
}

/** Sign in online with the one-time choice accepted. */
export async function signIn(runtime: OfflineRuntimeHandle, o: { optIn?: boolean; password?: string; session?: typeof SESSION; server?: Server } = {}) {
  if (o.server) o.server.state.account = (o.session ?? SESSION).accountId
  runtime.prepareFromSignIn((o.session ?? SESSION).email, o.password ?? PASSWORD)
  clocked.get(runtime)?.()
  const summary = await runtime.attachSession(o.session ?? SESSION, { optIn: o.optIn ?? true, online: true })
  runtime.setSessionReady(true)
  return summary
}

export async function settle(runtime: OfflineRuntimeHandle) {
  for (let i = 0; i < 5; i += 1) {
    await runtime.settle()
    await new Promise(r => setTimeout(r, 0))
  }
}

export function asJson(v: unknown): Json {
  return v as Json
}

let channelSeq = 0
/** A BroadcastChannel private to one test, so parallel test files never hear each other. */
export function privateChannel(): (new (name: string) => BroadcastChannel) & { channelName: string } {
  const name = `hid-offline-test-${(channelSeq += 1)}-${Math.random()}`
  return class extends BroadcastChannel {
    static channelName = name
    constructor() { super(name) }
  }
}

/** Poll until `check` holds (or fail after `ms`). */
export async function until(check: () => Promise<boolean> | boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Timed out waiting for a condition')
    await new Promise(r => setTimeout(r, 5))
  }
}
