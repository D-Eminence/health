import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { OFFLINE_PATHS, type Json } from '../contracts'
import { b64url } from '../crypto'
import { createOfflineRuntime, type OfflineRuntimeHandle, type OfflineRuntimeOptions } from '../runtime'
import { createMemoryLocks } from '../testing'
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
  const audit: { vaultId: string; events: { eventId: string; seq: number; action: string }[] }[] = []
  const state = {
    offline: false,
    escrow: true,
    receiptsDown: false,
    /** Apply the write but lose the answer (network error after commit). */
    loseNextAnswer: false,
    rereadBody: null as unknown,
    auditReject: new Set<string>(),
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
          accepted: b.events.filter(e => !state.auditReject.has(e.eventId)).map(e => e.eventId), duplicate: [],
          rejected: b.events.filter(e => state.auditReject.has(e.eventId)).map(e => ({ eventId: e.eventId, code: 'INVALID_EVENT' })),
        },
      }
    }
    const fault = faults.shift()
    if (fault) throw new TransportError({ ...fault, problem: fault.problem ?? (fault.status !== null && fault.status >= 400) })
    const key = spec.headers?.['Idempotency-Key']
    if (key && keys.has(key)) {
      const prior = keys.get(key)!
      return { status: prior.status, body: prior.body, date: null }
    }
    n += 1
    const body = { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, rowVersion: 1, ...(state.rereadBody && spec.method === 'GET' ? state.rereadBody as object : {}) }
    if (key) keys.set(key, { status: 201, body, operationPath: spec.path })
    if (state.loseNextAnswer) {
      state.loseNextAnswer = false
      throw new TransportError({ status: null, networkError: true })
    }
    return { status: spec.method === 'PATCH' ? 200 : 201, body, date: null }
  }

  return {
    transport, calls, keys, audit, state,
    fail(...f: Fault[]) { faults.push(...f) },
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
