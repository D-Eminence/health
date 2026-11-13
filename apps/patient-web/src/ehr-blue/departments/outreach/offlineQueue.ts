import { useCallback, useEffect, useRef, useState } from 'react'
import { isHidApiError, isStoppedRequest } from '@hid/http'
import { staffApi, type OutreachCase, type OutreachCaseInput } from '../../../staff/api'
import { outreachProblemText } from '../../../outreachProblems'
import { claimStorageLock } from './tabMemory'

/*
 * The offline queue for registrations at an outreach group (plan PR-5, the field critique): every new registration is
 * kept on this device, with its command, before it is first sent (OutreachNew.tsx), and goes as soon as Health ID takes
 * it; one that could not be sent (no network, a timeout, or Health ID briefly unavailable) stays, and is sent again when
 * the network comes back, or when the person asks. It survives a reload, even one made while it was being sent. Outreach is idempotent on the
 * command's localCommandId (also its Idempotency-Key), so sending the same entry twice makes one registration.
 *
 * What waits is sent again, oldest first: when the page opens, when the browser says it is back online, when the page is
 * shown again, after a registration Health ID took, and every 30 seconds while anything waits (a phone on weak signal
 * rarely says it went offline). No connection, a timeout, a send stopped as the session ended, or a sign-in needed stops
 * the round. A registration Health ID can't take just now (a server fault) waits and the next is tried, and it is tried
 * after the others next time, so it never holds them up; too many requests, or Health ID unavailable twice in a row,
 * stops the round, so a struggling Health ID is not sent every registration on the device every 30 seconds.
 *
 * Kept in IndexedDB, keyed by localCommandId, and only for the account and facility that saved it: another person signed
 * in on the same browser sees none of it. Nothing waits longer than 14 days: the staff app sweeps expired entries when it
 * starts and on every session change, whatever page is open (purgeExpiredOutreachQueue), and signing out deletes the
 * account's own entries (removeOutreachQueueEntriesFor), after asking first while any wait: "Send now" sends them
 * (sendWaitingOutreachEntriesFor). A session that ends without a sign-out keeps them, so the person
 * can sign in again and send them, until the 14 days are up. A browser without IndexedDB (or one that refuses it) keeps
 * the queue in memory for this page only, and says so. Nothing about a person goes in localStorage, cookies or the
 * address: localStorage holds at most a short send lock with a random command id (claimSend), where the browser has
 * no Web Locks. IndexedDB is allowed in this one module only (eslint.config.js, docs/ARCHITECTURE.md).
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
  return removeEntriesFor(accountId, () => true)
}

/**
 * Deletes the entries Health ID refused that the account saved, on any facility, and nothing still waiting to be sent:
 * for signing out, where a registration that started waiting meanwhile (a save in another tab timing out, say) is kept.
 * Never throws.
 */
export async function removeRefusedOutreachEntriesFor(accountId: string): Promise<number> {
  return removeEntriesFor(accountId, entry => entry.state === 'refused')
}

async function removeEntriesFor(accountId: string, which: (entry: PendingRegistration) => boolean): Promise<number> {
  try {
    const store = await sweepStore()
    if (!store) return 0
    const own = (await store.list()).filter(entry => entry.accountId === accountId && which(entry))
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

/** The registrations being sent from this tab just now, by command id. */
const sendingHere = new Set<string>()

/** A lock held by one tab of this browser at a time, through Web Locks; null where the browser has none. */
function claimWebLock(name: string): Promise<(() => void) | null> | null {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks || typeof locks.request !== 'function') return null
  return new Promise(resolve => {
    let answered = false
    const answer = (release: (() => void) | null) => { if (!answered) { answered = true; resolve(release) } }
    locks.request(name, { ifAvailable: true }, lock => {
      if (!lock) { answer(null); return undefined }
      // Held until released, or until the tab goes (a reload or a closed tab lets it go at once).
      return new Promise<void>(done => answer(done))
    }).catch(() => answer(claimStorageLock(name)))
  })
}

/**
 * Claims a registration for sending: the release, or null when this tab or another tab of this browser is sending it
 * already. So the form, "Send now", the 30-second retry, the online and the page-shown senders never send the same
 * registration twice at once, here or in two tabs (Health ID's idempotency already keeps it from being made twice; this
 * keeps two "Saving" rows from showing). Web Locks where the browser has them, else a short lock in localStorage.
 */
export async function claimSend(localCommandId: string): Promise<(() => void) | null> {
  if (sendingHere.has(localCommandId)) return null
  sendingHere.add(localCommandId)
  const name = `hid-outreach-send:${localCommandId}`
  const release = await (claimWebLock(name) ?? Promise.resolve(claimStorageLock(name)))
  if (!release) { sendingHere.delete(localCommandId); return null }
  let released = false
  return () => {
    if (released) return
    released = true
    sendingHere.delete(localCommandId)
    release()
  }
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
  /**
   * Why those still waiting were not sent: 'session' when the person must sign in again (the session ended meanwhile, say),
   * whatever else happened; otherwise the one reason they share, and none when they differ.
   */
  readonly reason?: WaitReason | 'session'
  /** What the page lists once the round ended (waiting and refused, oldest first): what it said holds while that is unchanged. */
  readonly left: readonly PendingRegistration[]
}

/** Why a round left registrations waiting, as one reason for the person: signing in again comes first. */
function oneReason(reasons: ReadonlySet<WaitReason | 'session'>): QueueSyncResult['reason'] {
  if (reasons.has('session')) return 'session'
  return reasons.size === 1 ? [...reasons][0] : undefined
}

/** What one round of sending did, before the page reads its list again. */
type RoundCounts = Omit<QueueSyncResult, 'left'>

/**
 * Sends what waits in `store` for the entries `mine` picks, oldest first, one at a time; one Health ID couldn't take in
 * an earlier round goes after the others (`tried` holds, by command id, the round it was last tried in, and this is
 * round `round`). No connection, a sign-in needed or a send stopped as the session ended stops the round; Health ID
 * unavailable for one moves on to the next, unless Health ID asked for fewer requests (429) or answered so twice in a
 * row: the rest then wait for the next round. Anything else is Health ID's answer, kept as refused.
 */
async function sendQueued(store: OutreachQueueStore, mine: (entry: PendingRegistration) => boolean,
  onCreated: (created: OutreachCase) => void, tried: Map<string, number> = new Map(), round = 1): Promise<RoundCounts> {
  let sent = 0
  let waiting = 0
  let refused = 0
  let unavailableInARow = 0
  const reasons = new Set<WaitReason | 'session'>()
  const queued = (await store.list().catch(() => [] as PendingRegistration[])).filter(entry => mine(entry) && entry.state === 'waiting')
    .sort((a, b) => (tried.get(a.localCommandId) ?? 0) - (tried.get(b.localCommandId) ?? 0) || a.savedAt.localeCompare(b.savedAt))
  for (const [index, entry] of queued.entries()) {
    // Being sent already, from the form or another tab: left to that send.
    const release = await claimSend(entry.localCommandId)
    if (!release) continue
    try {
      // Sent and taken off this device since the round began (by the form, or another tab): nothing to send.
      const still = await store.list().then(all => all.some(other => other.localCommandId === entry.localCommandId && other.state === 'waiting'),
        () => true)
      if (!still) { tried.delete(entry.localCommandId); continue }
      const created = await staffApi.createOutreachCase(entry.facilityId, entry.input,
        { localCommandId: entry.localCommandId, temporaryPatientId: entry.temporaryPatientId })
      tried.delete(entry.localCommandId)
      unavailableInARow = 0
      await store.remove(entry.localCommandId)
      sent += 1
      onCreated(created)
    } catch (caught) {
      // Still offline, signed out, or stopped as the session ended (never judged by Health ID): stop, and try the
      // rest when the network is back or after signing in again. Each stays waiting.
      if (noConnection(caught) || waitsForSignIn(caught) || isStoppedRequest(caught)) {
        waiting += queued.length - index
        reasons.add(noConnection(caught) ? 'connection' : 'session')
        break
      }
      // Health ID couldn't take this one just now: it waits, tried after the others next time, and the next is tried,
      // unless Health ID asked for fewer requests or answered so twice in a row: the rest then wait for the next round.
      if (healthIdUnavailable(caught)) {
        waiting += 1
        reasons.add('unavailable')
        tried.set(entry.localCommandId, round)
        unavailableInARow += 1
        if ((isHidApiError(caught) && caught.status === 429) || unavailableInARow >= 2) {
          waiting += queued.length - index - 1
          break
        }
        continue
      }
      tried.delete(entry.localCommandId)
      unavailableInARow = 0
      await store.put({ ...entry, state: 'refused', refusal: outreachProblemText(caught, REFUSED_FALLBACK) })
      refused += 1
    } finally {
      release()
    }
  }
  return { sent, waiting, refused, reason: oneReason(reasons) }
}

/** Pages showing the queue, told when something outside them (the sign-out question's "Send now") sent from it. */
const queueListeners = new Set<() => void>()
function queueChanged() { for (const listener of queueListeners) listener() }

/**
 * Sends every registration the account saved that still waits, on any facility: the sign-out question's "Send now"
 * (staff/App.tsx), whatever page is open. Only this account's: another person's on the same phone are never sent.
 * Answers how many still wait afterwards. Never throws: what could not be read still waits.
 */
export async function sendWaitingOutreachEntriesFor(accountId: string): Promise<number> {
  try {
    const store = await sweepStore()
    if (!store) return 0
    await sendQueued(store, entry => entry.accountId === accountId, () => undefined)
  } catch {
    // What was not sent still waits; the count below says so.
  } finally {
    queueChanged()
  }
  return waitingOutreachEntriesFor(accountId)
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
  // One round at a time on this page (a second page of Outreach, opened while a round runs, may run its own: each
  // registration is claimed before it is sent, so the two never send the same one at once).
  const busy = useRef(false)
  // When each registration Health ID couldn't take was last tried on this page, by round: tried after the others next time.
  const triedUnavailable = useRef(new Map<string, number>())
  const round = useRef(0)
  const synced = useRef(onSynced)
  synced.current = onSynced
  const mine = useCallback((entry: PendingRegistration) => entry.accountId === accountId && entry.facilityId === facilityId,
    [accountId, facilityId])

  /** Reads this account's entries here again, oldest first, and answers them. */
  const reload = useCallback(async () => {
    const store = await outreachQueueStore()
    setDurable(store.durable)
    const all = await store.list().catch(() => [] as PendingRegistration[])
    // Nothing waits longer than 14 days on a device, whoever saved it.
    const expired = all.filter(entry => queueEntryExpired(entry))
    await Promise.all(expired.map(entry => store.remove(entry.localCommandId).catch(() => undefined)))
    const listed = all.filter(entry => mine(entry) && !expired.includes(entry)).sort((a, b) => a.savedAt.localeCompare(b.savedAt))
    setEntries(listed)
    return listed
  }, [mine])

  /**
   * Sends what waits, oldest first (one Health ID couldn't take last time after the others), one at a time; null when a
   * round is already running on this page (or nothing is queued here).
   */
  const sync = useCallback(async (): Promise<QueueSyncResult | null> => {
    if (busy.current || !accountId || offline) return null
    busy.current = true
    setSyncing(true)
    const thisRound = ++round.current
    let counts: RoundCounts = { sent: 0, waiting: 0, refused: 0 }
    let left: readonly PendingRegistration[] = []
    try {
      const store = await outreachQueueStore()
      counts = await sendQueued(store, mine, created => synced.current(created), triedUnavailable.current, thisRound)
    } finally {
      busy.current = false
      setSyncing(false)
      left = await reload()
    }
    return { ...counts, left }
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
    // Sent from outside this page (the sign-out question): what is shown is read again.
    const outside = () => { void reload() }
    queueListeners.add(outside)
    return () => {
      queueListeners.delete(outside)
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
