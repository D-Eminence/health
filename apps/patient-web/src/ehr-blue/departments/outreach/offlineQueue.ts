import { useCallback, useEffect, useRef, useState } from 'react'
import { isHidApiError, isStoppedRequest } from '@hid/http'
import { staffApi, type OutreachCase, type OutreachCaseInput } from '../../../staff/api'
import { outreachProblemText } from '../../../outreachProblems'

/*
 * The offline queue for registrations at an outreach group (plan PR-5, the field critique): a registration that could
 * not be sent (no network, a timeout, or Health ID briefly unavailable) is kept on this device, with its command, and
 * sent again when the network comes back, or when the person asks. It survives a reload. Outreach is idempotent on the
 * command's localCommandId (also its Idempotency-Key), so sending the same entry twice makes one registration.
 *
 * What waits is sent again, oldest first: when the page opens, when the browser says it is back online, when the page is
 * shown again, after a registration Health ID took, and every 30 seconds while anything waits (a phone on weak signal
 * rarely says it went offline). No connection, a timeout, a send stopped as the session ended, or a sign-in needed stops
 * the round; Health ID unavailable for one registration (a server fault, too many requests) moves on to the next.
 *
 * Kept in IndexedDB, keyed by localCommandId, and only for the account and facility that saved it: another person signed
 * in on the same browser sees none of it. Nothing waits longer than 14 days: the staff app sweeps expired entries when it
 * starts and on every session change, whatever page is open (purgeExpiredOutreachQueue), and signing out deletes the
 * account's own entries (removeOutreachQueueEntriesFor). A session that ends without a sign-out keeps them, so the person
 * can sign in again and send them, until the 14 days are up. A browser without IndexedDB (or one that refuses it) keeps
 * the queue in memory for this page only, and says so. Nothing goes in localStorage, cookies or the
 * address. IndexedDB is allowed in this one module only (eslint.config.js, docs/ARCHITECTURE.md).
 */

export interface PendingRegistration {
  /** The command's id, also its Idempotency-Key: the queue's key. */
  readonly localCommandId: string
  readonly temporaryPatientId: string
  readonly accountId: string
  readonly facilityId: string
  readonly input: OutreachCaseInput
  readonly savedAt: string
  /** 'waiting' to be sent; 'refused' when Health ID answered no, with what it said, for the person to correct or discard. */
  readonly state: 'waiting' | 'refused'
  readonly refusal?: string
}

/** Where the queue is kept. */
export interface OutreachQueueStore {
  /** Whether entries outlive a reload (IndexedDB), or only this page (memory). */
  readonly durable: boolean
  list(): Promise<PendingRegistration[]>
  put(entry: PendingRegistration): Promise<void>
  remove(localCommandId: string): Promise<void>
}

/** How long a registration may wait on a device before it is deleted unsent (docs/ARCHITECTURE.md). */
export const QUEUE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** How often what waits is sent again while the page is open and shown. */
export const QUEUE_RETRY_MS = 30_000

const DATABASE = 'hid-outreach-offline'
const STORE = 'pending-registrations'

/** A queue in memory, for a browser without IndexedDB, and for tests. */
export function memoryQueueStore(): OutreachQueueStore {
  const entries = new Map<string, PendingRegistration>()
  return {
    durable: false,
    list: async () => [...entries.values()],
    put: async entry => { entries.set(entry.localCommandId, entry) },
    remove: async id => { entries.delete(id) },
  }
}

function request<T>(open: () => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const pending = open()
    pending.onsuccess = () => resolve(pending.result)
    pending.onerror = () => reject(pending.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * The queue in IndexedDB, or null where the browser has none or refuses to open it. With `existingOnly`, null too where
 * this browser has never kept a queue: opening it then creates nothing (the sweep outside an outreach group).
 */
export async function indexedDbQueueStore(factory: IDBFactory | undefined = globalThis.indexedDB,
  { existingOnly = false }: { existingOnly?: boolean } = {}): Promise<OutreachQueueStore | null> {
  if (!factory) return null
  let database: IDBDatabase
  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open(DATABASE, 1)
      opening.onupgradeneeded = event => {
        // Never kept here: a sweep leaves nothing behind (aborting the upgrade fails the open, and nothing is created).
        if (existingOnly && event.oldVersion === 0) { opening.transaction?.abort(); return }
        if (!opening.result.objectStoreNames.contains(STORE)) opening.result.createObjectStore(STORE, { keyPath: 'localCommandId' })
      }
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error ?? new Error('IndexedDB could not be opened'))
      opening.onblocked = () => reject(new Error('IndexedDB is blocked'))
    })
  } catch {
    return null
  }
  const store = (mode: IDBTransactionMode) => database.transaction(STORE, mode).objectStore(STORE)
  return {
    durable: true,
    list: () => request(() => store('readonly').getAll() as IDBRequest<PendingRegistration[]>),
    put: async entry => { await request(() => store('readwrite').put(entry)) },
    remove: async id => { await request(() => store('readwrite').delete(id)) },
  }
}

let shared: Promise<OutreachQueueStore> | null = null
/** The page's queue: IndexedDB where the browser has it, else memory. Tests replace it with setOutreachQueueStore. */
export function outreachQueueStore(): Promise<OutreachQueueStore> {
  shared ??= indexedDbQueueStore().then(store => store ?? memoryQueueStore(), () => memoryQueueStore())
  return shared
}
export function setOutreachQueueStore(store: OutreachQueueStore | null) {
  shared = store ? Promise.resolve(store) : null
}

/** The store to sweep: the page's when it has one open, else IndexedDB only where a queue was ever kept on this browser. */
function sweepStore(): Promise<OutreachQueueStore | null> {
  return shared ?? indexedDbQueueStore(globalThis.indexedDB, { existingOnly: true }).catch(() => null)
}

/** Whether an entry has waited its 14 days (or its date can't be read). */
export function queueEntryExpired(entry: Pick<PendingRegistration, 'savedAt'>, now = Date.now()): boolean {
  return !(now - Date.parse(entry.savedAt) < QUEUE_MAX_AGE_MS)
}

/**
 * Deletes every entry older than 14 days, whoever saved it. The staff app calls it as it starts and on every session
 * change, so the promise holds on a shared device whatever page is opened. Never throws.
 */
export async function purgeExpiredOutreachQueue(now = Date.now()): Promise<number> {
  try {
    const store = await sweepStore()
    if (!store) return 0
    const expired = (await store.list()).filter(entry => queueEntryExpired(entry, now))
    await Promise.all(expired.map(entry => store.remove(entry.localCommandId).catch(() => undefined)))
    return expired.length
  } catch {
    return 0
  }
}

/** Deletes every entry the account saved, on any facility: signing out leaves none of its registrations here. Never throws. */
export async function removeOutreachQueueEntriesFor(accountId: string): Promise<number> {
  try {
    const store = await sweepStore()
    if (!store) return 0
    const own = (await store.list()).filter(entry => entry.accountId === accountId)
    await Promise.all(own.map(entry => store.remove(entry.localCommandId).catch(() => undefined)))
    return own.length
  } catch {
    return 0
  }
}

/** How many registrations the account saved that still wait to be sent, on any facility. Never throws: 0 when none can be read. */
export async function waitingOutreachEntriesFor(accountId: string): Promise<number> {
  try {
    const store = await sweepStore()
    if (!store) return 0
    return (await store.list()).filter(entry => entry.accountId === accountId && entry.state === 'waiting').length
  } catch {
    return 0
  }
}

/** Whether a failure means the registration never reached Health ID, or its answer never came: no network, or a timeout. */
export function noConnection(error: unknown): boolean {
  if (!isHidApiError(error)) return error instanceof TypeError
  return error.code !== 'REQUEST_CANCELLED' && (error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT' || error.status === 0)
}

/** Whether Health ID answered that it can't take anything just now: a server fault, too many requests, or a 408 from the server. */
export function healthIdUnavailable(error: unknown): boolean {
  if (!isHidApiError(error) || noConnection(error)) return false
  return error.status === 408 || error.status === 429 || error.status >= 500
}

/**
 * Whether a failure means the registration never reached Health ID, or Health ID could not take it just now, so it
 * waits in the queue: no network, a timeout, too many requests, or a server fault. Anything else is Health ID's answer.
 */
export function waitsForNetwork(error: unknown): boolean {
  return noConnection(error) || healthIdUnavailable(error)
}

/** Why a registration still waits: no connection (or one too weak to answer in time), or Health ID unavailable just now. */
export type WaitReason = 'connection' | 'unavailable'

export function waitReason(error: unknown): WaitReason {
  return healthIdUnavailable(error) ? 'unavailable' : 'connection'
}

/** The session answers that say nothing about the registration itself: refused before it was looked at. */
const SESSION_REFUSALS: ReadonlySet<string> = new Set(['CSRF_VALIDATION_FAILED', 'SESSION_CLIENT_MISMATCH', 'STAFF_MFA_REQUIRED'])

/**
 * Whether a failure means the person must sign in again before anything can be sent: the session ended or idled out
 * (401), or the session or its security check was refused (403). The registration keeps waiting: it was never judged.
 */
export function waitsForSignIn(error: unknown): boolean {
  if (!isHidApiError(error)) return false
  return error.status === 401 || error.status === 403 && SESSION_REFUSALS.has(error.code)
}

/** Whether the browser may have a connection: it says so only when it knows it is offline. */
function mayBeOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

const REFUSED_FALLBACK = 'Health ID did not accept this registration. Check the details, then register the person again.'

/** What one round of sending did, for "Send now" to say: how many Health ID took, how many still wait and why, how many it refused. */
export interface QueueSyncResult {
  readonly sent: number
  readonly waiting: number
  readonly refused: number
  /** Why the last registration still waiting was not sent: 'session' when the person must sign in again, or the session ended meanwhile. */
  readonly reason?: WaitReason | 'session'
}

/**
 * The queue for one account at one facility: what waits, sending it again, and adding to it. `onSynced` hears each
 * registration Health ID took from the queue, with its answer. `offline` ("No signal" mode, OfflineOutreach.tsx, where
 * the session could not be read): what waits is listed and added to, and never sent from there.
 */
export function useOutreachQueue(accountId: string | undefined, facilityId: string, onSynced: (created: OutreachCase) => void,
  { offline = false }: { readonly offline?: boolean } = {}) {
  const [entries, setEntries] = useState<PendingRegistration[]>([])
  const [durable, setDurable] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const busy = useRef(false)
  const synced = useRef(onSynced)
  synced.current = onSynced
  const mine = useCallback((entry: PendingRegistration) => entry.accountId === accountId && entry.facilityId === facilityId,
    [accountId, facilityId])

  const reload = useCallback(async () => {
    const store = await outreachQueueStore()
    setDurable(store.durable)
    const all = await store.list().catch(() => [] as PendingRegistration[])
    // Nothing waits longer than 14 days on a device, whoever saved it.
    const expired = all.filter(entry => queueEntryExpired(entry))
    await Promise.all(expired.map(entry => store.remove(entry.localCommandId).catch(() => undefined)))
    setEntries(all.filter(entry => mine(entry) && !expired.includes(entry)).sort((a, b) => a.savedAt.localeCompare(b.savedAt)))
  }, [mine])

  /** Sends what waits, oldest first, one at a time; null when a round is already running in this tab (or nothing is queued here). */
  const sync = useCallback(async (): Promise<QueueSyncResult | null> => {
    if (busy.current || !accountId || offline) return null
    busy.current = true
    setSyncing(true)
    let sent = 0
    let waiting = 0
    let refused = 0
    let reason: QueueSyncResult['reason']
    try {
      const store = await outreachQueueStore()
      const queued = (await store.list().catch(() => [] as PendingRegistration[])).filter(entry => mine(entry) && entry.state === 'waiting')
        .sort((a, b) => a.savedAt.localeCompare(b.savedAt))
      for (const [index, entry] of queued.entries()) {
        try {
          const created = await staffApi.createOutreachCase(entry.facilityId, entry.input,
            { localCommandId: entry.localCommandId, temporaryPatientId: entry.temporaryPatientId })
          await store.remove(entry.localCommandId)
          sent += 1
          synced.current(created)
        } catch (caught) {
          // Still offline, signed out, or stopped as the session ended (never judged by Health ID): stop, and try the
          // rest when the network is back or after signing in again. Each stays waiting.
          if (noConnection(caught) || waitsForSignIn(caught) || isStoppedRequest(caught)) {
            waiting += queued.length - index
            reason = noConnection(caught) ? 'connection' : 'session'
            break
          }
          // Health ID couldn't take this one just now: it waits, and the next is tried.
          if (healthIdUnavailable(caught)) {
            waiting += 1
            reason = 'unavailable'
            continue
          }
          await store.put({ ...entry, state: 'refused', refusal: outreachProblemText(caught, REFUSED_FALLBACK) })
          refused += 1
        }
      }
    } finally {
      busy.current = false
      setSyncing(false)
      await reload()
    }
    return { sent, waiting, refused, reason }
  }, [accountId, mine, reload, offline])

  const add = useCallback(async (entry: Omit<PendingRegistration, 'accountId' | 'facilityId' | 'savedAt' | 'state'>) => {
    if (!accountId) return
    const store = await outreachQueueStore()
    await store.put({ ...entry, accountId, facilityId, savedAt: new Date().toISOString(), state: 'waiting' })
    await reload()
  }, [accountId, facilityId, reload])

  const discard = useCallback(async (localCommandId: string) => {
    const store = await outreachQueueStore()
    await store.remove(localCommandId)
    await reload()
  }, [reload])

  useEffect(() => {
    // Only where the queue is used (an outreach group): elsewhere nothing is opened.
    if (!accountId) return
    void reload().then(() => { if (mayBeOnline()) void sync() })
    const online = () => { void sync() }
    // Back on the page: a phone on weak signal rarely says it went offline, so what waits is tried as the person returns.
    const shown = () => { if (document.visibilityState === 'visible' && mayBeOnline()) void sync() }
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', shown)
    return () => {
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [accountId, reload, sync])

  // While anything waits here, it is tried again every 30 seconds the page is shown, unless the browser knows it is offline.
  const anyWaiting = entries.some(entry => entry.state === 'waiting')
  useEffect(() => {
    if (!accountId || !anyWaiting) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && mayBeOnline()) void sync()
    }, QUEUE_RETRY_MS)
    return () => window.clearInterval(timer)
  }, [accountId, anyWaiting, sync])

  return { entries, durable, syncing, sync, add, discard }
}
