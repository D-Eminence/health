import { useCallback, useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { staffApi, type OutreachCase, type OutreachCaseInput } from '../../../staff/api'
import { outreachProblemText } from '../../../outreachProblems'

/*
 * The offline queue for registrations at an outreach group (plan PR-5, the field critique): a registration that could
 * not be sent (no network, a timeout, or Health ID briefly unavailable) is kept on this device, with its command, and
 * sent again when the network comes back, or when the person asks. It survives a reload. Outreach is idempotent on the
 * command's localCommandId (also its Idempotency-Key), so sending the same entry twice makes one registration.
 *
 * Kept in IndexedDB, keyed by localCommandId, and only for the account and facility that saved it: another person signed
 * in on the same browser sees none of it, and nothing waits longer than 14 days. A browser without IndexedDB (or one that
 * refuses it) keeps the queue in memory for this page only, and says so. Nothing goes in localStorage, cookies or the
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

/** The queue in IndexedDB, or null where the browser has none or refuses to open it. */
export async function indexedDbQueueStore(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<OutreachQueueStore | null> {
  if (!factory) return null
  let database: IDBDatabase
  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open(DATABASE, 1)
      opening.onupgradeneeded = () => {
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

/**
 * Whether a failure means the registration never reached Health ID, or Health ID could not take it just now, so it
 * waits in the queue: no network, a timeout, too many requests, or a server fault. Anything else is Health ID's answer.
 */
export function waitsForNetwork(error: unknown): boolean {
  if (!isHidApiError(error)) return error instanceof TypeError
  if (error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT' || error.status === 0) return error.code !== 'REQUEST_CANCELLED'
  return error.status === 408 || error.status === 429 || error.status >= 500
}

const REFUSED_FALLBACK = 'Health ID did not accept this registration. Check the details, then register the person again.'

/**
 * The queue for one account at one facility: what waits, sending it again, and adding to it. `onSynced` hears each
 * registration Health ID took from the queue, with its answer.
 */
export function useOutreachQueue(accountId: string | undefined, facilityId: string, onSynced: (created: OutreachCase) => void) {
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
    const expired = all.filter(entry => !(Date.now() - Date.parse(entry.savedAt) < QUEUE_MAX_AGE_MS))
    await Promise.all(expired.map(entry => store.remove(entry.localCommandId).catch(() => undefined)))
    setEntries(all.filter(entry => mine(entry) && !expired.includes(entry)).sort((a, b) => a.savedAt.localeCompare(b.savedAt)))
  }, [mine])

  const sync = useCallback(async () => {
    if (busy.current || !accountId) return
    busy.current = true
    setSyncing(true)
    try {
      const store = await outreachQueueStore()
      const waiting = (await store.list().catch(() => [] as PendingRegistration[])).filter(entry => mine(entry) && entry.state === 'waiting')
      for (const entry of waiting) {
        try {
          const created = await staffApi.createOutreachCase(entry.facilityId, entry.input,
            { localCommandId: entry.localCommandId, temporaryPatientId: entry.temporaryPatientId })
          await store.remove(entry.localCommandId)
          synced.current(created)
        } catch (caught) {
          // Still offline: stop, and try the rest when the network is back.
          if (waitsForNetwork(caught)) break
          await store.put({ ...entry, state: 'refused', refusal: outreachProblemText(caught, REFUSED_FALLBACK) })
        }
      }
    } finally {
      busy.current = false
      setSyncing(false)
      await reload()
    }
  }, [accountId, mine, reload])

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
    void reload().then(() => { if (typeof navigator === 'undefined' || navigator.onLine !== false) void sync() })
    const online = () => { void sync() }
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [accountId, reload, sync])

  return { entries, durable, syncing, sync, add, discard }
}
