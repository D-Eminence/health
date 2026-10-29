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
  const keys = new Map<string, { status: number; body: unknown; operationPath: string }>()
  const faults: Fault[] = []
  const rules: { when: (spec: SendSpec, bodyText: string) => boolean; faults: Fault[] }[] = []
  const audit: { vaultId: string; events: { eventId: string; seq: number; action: string }[] }[] = []
  const state = {
    offline: false,
    escrow: true,
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

  async function escrowKey(vaultId: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`server-secret|${state.account}|${vaultId}`))
    return b64url(new Uint8Array(digest))
  }

  const transport = async (spec: SendSpec): Promise<SendResult> => {
    const bodyText = spec.body === undefined ? '' : JSON.stringify(spec.body)
    calls.push({ spec, bodyText })
    if (state.offline) throw new TransportError({ status: null, networkError: true })
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
      return { status: 200, date: null, body: { keyVersion: 1, key: await escrowKey((spec.body as { vaultId: string }).vaultId), algorithm: 'HKDF-SHA256' } }
    }
    if (spec.path === OFFLINE_PATHS.audit) {
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
    transport, calls, keys, audit, state,
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
}

export function makeEnv(): Env {
  return { wall: Date.parse('2026-10-29T09:00:00.000Z'), mono: 1_000_000 }
}

export function makeRuntime(o: {
  server: Server; env: Env; idb?: IDBFactory; locks?: ReturnType<typeof createMemoryLocks> | null; mode?: string
  extra?: Partial<OfflineRuntimeOptions>
}): OfflineRuntimeHandle {
  const runtime = createOfflineRuntime({
    appHost: 'ehr',
    env: { mode: o.mode ?? 'pilot', facilities: SESSION.facilityId, hosts: 'ehr,ocr' },
    transport: o.server.transport,
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
  return runtime
}

/** Sign in online with the one-time choice accepted. */
export async function signIn(runtime: OfflineRuntimeHandle, o: { optIn?: boolean; password?: string; session?: typeof SESSION; server?: Server } = {}) {
  if (o.server) o.server.state.account = (o.session ?? SESSION).accountId
  runtime.prepareFromSignIn((o.session ?? SESSION).email, o.password ?? PASSWORD)
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
