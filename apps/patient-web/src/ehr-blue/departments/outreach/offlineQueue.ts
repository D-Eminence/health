import { useCallback, useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { staffApi, type OutreachCase, type OutreachCaseInput } from '../../../staff/api'
import { outreachProblemText } from '../../../outreachProblems'
import { sendStationCommand, type StationCommand, type StationCommandAnswer } from './campaignApi'
import type { StationKind } from './campaignTypes'

/*
 * The offline queue for registrations at an outreach group (plan PR-5, the field critique): a registration that could
 * not be sent (no network, a timeout, or Health ID briefly unavailable) is kept on this device, with its command, and
 * sent again when the network comes back, or when the person asks. It survives a reload. Outreach is idempotent on the
 * command's localCommandId (also its Idempotency-Key), so sending the same entry twice makes one registration.
 *
 * Outreach campaigns (owner decisions of 13 November 2026) queue each station's writes the same way: vital signs, test
 * results, answers, the outcome, the referral and the follow-up (and their updates), each its own command with its own
 * localCommandId, so each station saves on its own. A write for a person registered while offline names the queued
 * registration it belongs to (dependsOn) instead of a case: it waits until that registration is sent, and is then given
 * the case Outreach made (the temporary reference is swapped for the real case id, in the queue, before the registration
 * leaves it). Sending order: registrations first, oldest first; then writes, oldest first, each once its case is known.
 *
 * Kept in IndexedDB, keyed by localCommandId, and only for the account and facility that saved it: another person signed
 * in on the same browser sees none of it. Nothing waits longer than 14 days: the staff app sweeps expired entries when it
 * starts and on every session change, whatever page is open (purgeExpiredOutreachQueue), and signing out deletes the
 * account's own entries (removeOutreachQueueEntriesFor). A session that ends without a sign-out keeps them, so the person
 * can sign in again and send them, until the 14 days are up. A browser without IndexedDB (or one that refuses it) keeps
 * the queue in memory for this page only, and says so. Nothing goes in localStorage, cookies or the address. IndexedDB is
 * allowed in this one module only (eslint.config.js, docs/ARCHITECTURE.md).
 *
 * The same database keeps a small "day settings" memory per account, facility and campaign: the site, the station and
 * the kit lots in use, so a volunteer doesn't pick them again for every person. It holds nothing about any person, and
 * goes with the queue: 14 days after it was last saved, and at sign-out.
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

/** A station's write waiting on this device (Outreach campaigns). */
export interface PendingStationWrite {
  /** The command's id, also its Idempotency-Key: the queue's key. */
  readonly localCommandId: string
  readonly accountId: string
  readonly facilityId: string
  readonly campaignId: string | null
  /** The case it is for; null while the registration it depends on still waits in the queue. */
  readonly caseId: string | null
  /** The localCommandId of the queued registration it belongs to, while that registration has not been sent. */
  readonly dependsOn: string | null
  readonly command: StationCommand
  readonly savedAt: string
  readonly state: 'waiting' | 'refused'
  readonly refusal?: string
}

/** What a station remembers for the day (per account, facility and campaign): never anything about a person. */
export interface DaySettings {
  /** daySettingsKey(accountId, facilityId, campaignId). */
  readonly key: string
  readonly accountId: string
  readonly facilityId: string
  readonly campaignId: string
  readonly siteId: string | null
  readonly station: StationKind | null
  /** The kit lot in use for each test (testId → lot). */
  readonly kitLots: Readonly<Record<string, string>>
  readonly savedAt: string
}

export type DaySettingsChange = Partial<Pick<DaySettings, 'siteId' | 'station' | 'kitLots'>>

/** Where the queue is kept. */
export interface OutreachQueueStore {
  /** Whether entries outlive a reload (IndexedDB), or only this page (memory). */
  readonly durable: boolean
  list(): Promise<PendingRegistration[]>
  put(entry: PendingRegistration): Promise<void>
  remove(localCommandId: string): Promise<void>
  listWrites(): Promise<PendingStationWrite[]>
  putWrite(entry: PendingStationWrite): Promise<void>
  removeWrite(localCommandId: string): Promise<void>
  listDaySettings(): Promise<DaySettings[]>
  putDaySettings(settings: DaySettings): Promise<void>
  removeDaySettings(key: string): Promise<void>
}

/** How long a registration may wait on a device before it is deleted unsent (docs/ARCHITECTURE.md). */
export const QUEUE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

const DATABASE = 'hid-outreach-offline'
/** Version 2 adds the station writes and the day settings beside version 1's registrations. */
const DATABASE_VERSION = 2
const STORE = 'pending-registrations'
const WRITES = 'pending-station-writes'
const SETTINGS = 'day-settings'

/** A queue in memory, for a browser without IndexedDB, and for tests. */
export function memoryQueueStore(): OutreachQueueStore {
  const entries = new Map<string, PendingRegistration>()
  const writes = new Map<string, PendingStationWrite>()
  const settings = new Map<string, DaySettings>()
  return {
    durable: false,
    list: async () => [...entries.values()],
    put: async entry => { entries.set(entry.localCommandId, entry) },
    remove: async id => { entries.delete(id) },
    listWrites: async () => [...writes.values()],
    putWrite: async entry => { writes.set(entry.localCommandId, entry) },
    removeWrite: async id => { writes.delete(id) },
    listDaySettings: async () => [...settings.values()],
    putDaySettings: async entry => { settings.set(entry.key, entry) },
    removeDaySettings: async key => { settings.delete(key) },
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
      const opening = factory.open(DATABASE, DATABASE_VERSION)
      opening.onupgradeneeded = event => {
        // Never kept here: a sweep leaves nothing behind (aborting the upgrade fails the open, and nothing is created).
        if (existingOnly && event.oldVersion === 0) { opening.transaction?.abort(); return }
        const names = opening.result.objectStoreNames
        if (!names.contains(STORE)) opening.result.createObjectStore(STORE, { keyPath: 'localCommandId' })
        if (!names.contains(WRITES)) opening.result.createObjectStore(WRITES, { keyPath: 'localCommandId' })
        if (!names.contains(SETTINGS)) opening.result.createObjectStore(SETTINGS, { keyPath: 'key' })
      }
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error ?? new Error('IndexedDB could not be opened'))
      // Another tab still holds version 1 open: this page keeps its queue in memory until that tab is reloaded.
      opening.onblocked = () => reject(new Error('IndexedDB is blocked'))
    })
  } catch {
    return null
  }
  const store = (name: string, mode: IDBTransactionMode) => database.transaction(name, mode).objectStore(name)
  return {
    durable: true,
    list: () => request(() => store(STORE, 'readonly').getAll() as IDBRequest<PendingRegistration[]>),
    put: async entry => { await request(() => store(STORE, 'readwrite').put(entry)) },
    remove: async id => { await request(() => store(STORE, 'readwrite').delete(id)) },
    listWrites: () => request(() => store(WRITES, 'readonly').getAll() as IDBRequest<PendingStationWrite[]>),
    putWrite: async entry => { await request(() => store(WRITES, 'readwrite').put(entry)) },
    removeWrite: async id => { await request(() => store(WRITES, 'readwrite').delete(id)) },
    listDaySettings: () => request(() => store(SETTINGS, 'readonly').getAll() as IDBRequest<DaySettings[]>),
    putDaySettings: async entry => { await request(() => store(SETTINGS, 'readwrite').put(entry)) },
    removeDaySettings: async key => { await request(() => store(SETTINGS, 'readwrite').delete(key)) },
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

/** Removes the entries `pick` chooses from every part of the store; how many. Never throws. */
async function removeWhere(store: OutreachQueueStore, pick: (entry: { accountId: string; savedAt: string }) => boolean): Promise<number> {
  const quietly = <T>(read: Promise<T[]>) => read.catch(() => [] as T[])
  const [registrations, writes, settings] = await Promise.all([quietly(store.list()), quietly(store.listWrites()), quietly(store.listDaySettings())])
  const gone = [
    ...registrations.filter(pick).map(entry => store.remove(entry.localCommandId)),
    ...writes.filter(pick).map(entry => store.removeWrite(entry.localCommandId)),
    ...settings.filter(pick).map(entry => store.removeDaySettings(entry.key)),
  ]
  await Promise.all(gone.map(removal => removal.catch(() => undefined)))
  return gone.length
}

/**
 * Deletes every entry older than 14 days, whoever saved it: registrations, station writes and day settings. The staff
 * app calls it as it starts and on every session change, so the promise holds on a shared device whatever page is
 * opened. Never throws.
 */
export async function purgeExpiredOutreachQueue(now = Date.now()): Promise<number> {
  try {
    const store = await sweepStore()
    if (!store) return 0
    return await removeWhere(store, entry => queueEntryExpired(entry, now))
  } catch {
    return 0
  }
}

/**
 * Deletes every entry the account saved, on any facility (registrations, station writes and day settings): signing out
 * leaves none of its work here. Never throws.
 */
export async function removeOutreachQueueEntriesFor(accountId: string): Promise<number> {
  try {
    const store = await sweepStore()
    if (!store) return 0
    return await removeWhere(store, entry => entry.accountId === accountId)
  } catch {
    return 0
  }
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

const REFUSED_FALLBACK = 'Health ID did not accept this registration. Check the details, then register the person again.'
const WRITE_REFUSED_FALLBACK = 'Health ID did not accept this. Open the person’s visit, check it, then save it again.'
/** A write whose registration was discarded from this device: it has no person to go to. */
export const WRITE_ORPHANED = 'The registration this belongs to was removed from this device, so it can’t be sent. Find the person and record it again.'
/** A write still waiting for its registration to be sent. */
export const WRITE_WAITS_FOR_REGISTRATION = 'Waiting for this person’s registration to be sent first.'

// ------------------------------------------------------------------------------------------------------ syncing --

/** Whose queue: one account at one facility. */
export interface QueueOwner {
  readonly accountId: string
  readonly facilityId: string
}

/** How entries are sent; the hook uses the staff client, tests their own. */
export interface QueueSenders {
  registration(entry: PendingRegistration): Promise<OutreachCase>
  write(entry: PendingStationWrite & { readonly caseId: string }): Promise<StationCommandAnswer>
}

export interface QueueListeners {
  onRegistration?(created: OutreachCase, entry: PendingRegistration): void
  onWrite?(answer: StationCommandAnswer, entry: PendingStationWrite): void
}

/** What a sync did: how many went, how many were refused, and why it stopped early (null when it went through). */
export interface QueueSyncReport {
  readonly sent: number
  readonly refused: number
  readonly stopped: 'network' | 'sign_in' | null
}

const bySaved = <T extends { savedAt: string }>(a: T, b: T) => a.savedAt.localeCompare(b.savedAt)
const mineOf = (owner: QueueOwner) => (entry: { accountId: string; facilityId: string }) =>
  entry.accountId === owner.accountId && entry.facilityId === owner.facilityId

/**
 * Gives the writes that wait for a registration the case Outreach made for it. Done before the registration leaves the
 * queue: if the page closes in between, the registration is sent again (Outreach answers the same case) and nothing is
 * lost.
 */
export async function resolveQueuedWrites(store: OutreachQueueStore, registrationCommandId: string, caseId: string): Promise<number> {
  const waiting = (await store.listWrites()).filter(entry => entry.dependsOn === registrationCommandId)
  for (const entry of waiting) await store.putWrite({ ...entry, caseId, dependsOn: null })
  return waiting.length
}

/**
 * Sends what waits for one account at one facility: registrations first, oldest first, each one's writes given its case
 * as it goes; then the writes whose case is known, oldest first. Stops at the first failure that means no network or
 * signed out (all of it keeps waiting); any other refusal marks that entry refused, with Health ID's answer in words, and
 * goes on. A write whose registration is no longer queued and has no case is marked refused (WRITE_ORPHANED).
 */
export async function syncOutreachQueue(store: OutreachQueueStore, owner: QueueOwner, senders: QueueSenders,
  listeners: QueueListeners = {}): Promise<QueueSyncReport> {
  const mine = mineOf(owner)
  let sent = 0
  let refused = 0
  const stop = (error: unknown): QueueSyncReport['stopped'] =>
    waitsForNetwork(error) ? 'network' : waitsForSignIn(error) ? 'sign_in' : null

  const registrations = (await store.list().catch(() => [] as PendingRegistration[]))
    .filter(entry => mine(entry) && entry.state === 'waiting').sort(bySaved)
  for (const entry of registrations) {
    let created: OutreachCase
    try { created = await senders.registration(entry) }
    catch (caught) {
      const stopped = stop(caught)
      if (stopped) return { sent, refused, stopped }
      await store.put({ ...entry, state: 'refused', refusal: outreachProblemText(caught, REFUSED_FALLBACK) })
      refused += 1
      continue
    }
    await resolveQueuedWrites(store, entry.localCommandId, created.id)
    await store.remove(entry.localCommandId)
    sent += 1
    listeners.onRegistration?.(created, entry)
  }

  const queuedRegistrations = new Set((await store.list().catch(() => [] as PendingRegistration[])).map(entry => entry.localCommandId))
  const writes = (await store.listWrites().catch(() => [] as PendingStationWrite[]))
    .filter(entry => mine(entry) && entry.state === 'waiting').sort(bySaved)
  for (const entry of writes) {
    if (entry.caseId === null) {
      if (entry.dependsOn !== null && queuedRegistrations.has(entry.dependsOn)) continue
      await store.putWrite({ ...entry, state: 'refused', refusal: WRITE_ORPHANED })
      refused += 1
      continue
    }
    let answer: StationCommandAnswer
    try { answer = await senders.write({ ...entry, caseId: entry.caseId }) }
    catch (caught) {
      const stopped = stop(caught)
      if (stopped) return { sent, refused, stopped }
      await store.putWrite({ ...entry, state: 'refused', refusal: outreachProblemText(caught, WRITE_REFUSED_FALLBACK) })
      refused += 1
      continue
    }
    await store.removeWrite(entry.localCommandId)
    sent += 1
    listeners.onWrite?.(answer, entry)
  }
  return { sent, refused, stopped: null }
}

/** Where a station write is going: a case Outreach has, or a registration still waiting in this queue. */
export type StationWriteTarget = { readonly caseId: string } | { readonly registrationCommandId: string }

/** Puts a station write in the queue; its localCommandId (made here when not given) is answered. */
export async function queueStationWrite(store: OutreachQueueStore, owner: QueueOwner, campaignId: string | null,
  target: StationWriteTarget, command: StationCommand, localCommandId: string = crypto.randomUUID(), now = new Date()): Promise<string> {
  const caseId = 'caseId' in target ? target.caseId : null
  const dependsOn = 'registrationCommandId' in target ? target.registrationCommandId : null
  await store.putWrite({ localCommandId, accountId: owner.accountId, facilityId: owner.facilityId, campaignId, caseId, dependsOn,
    command, savedAt: now.toISOString(), state: 'waiting' })
  return localCommandId
}

/** Removes a queued registration and every write that waits for it (they have no one to go to without it). */
export async function discardQueuedRegistration(store: OutreachQueueStore, localCommandId: string): Promise<void> {
  const dependents = (await store.listWrites().catch(() => [] as PendingStationWrite[])).filter(entry => entry.dependsOn === localCommandId)
  await Promise.all(dependents.map(entry => store.removeWrite(entry.localCommandId)))
  await store.remove(localCommandId)
}

// -------------------------------------------------------------------------------------------------- day settings --

export function daySettingsKey(accountId: string, facilityId: string, campaignId: string): string {
  return JSON.stringify([accountId, facilityId, campaignId])
}

/** The day settings of an account at a facility for a campaign, or null (none saved, or older than 14 days). */
export async function readDaySettings(store: OutreachQueueStore, owner: QueueOwner, campaignId: string, now = Date.now()): Promise<DaySettings | null> {
  const key = daySettingsKey(owner.accountId, owner.facilityId, campaignId)
  const found = (await store.listDaySettings().catch(() => [] as DaySettings[])).find(entry => entry.key === key)
  if (!found) return null
  if (queueEntryExpired(found, now)) { await store.removeDaySettings(key).catch(() => undefined); return null }
  return found
}

/** Saves a change to the day settings (kit lots are merged by test), and answers what is now saved. */
export async function saveDaySettings(store: OutreachQueueStore, owner: QueueOwner, campaignId: string, change: DaySettingsChange,
  now = new Date()): Promise<DaySettings> {
  const before = await readDaySettings(store, owner, campaignId, now.getTime())
  const next: DaySettings = {
    key: daySettingsKey(owner.accountId, owner.facilityId, campaignId),
    accountId: owner.accountId, facilityId: owner.facilityId, campaignId,
    siteId: change.siteId !== undefined ? change.siteId : before?.siteId ?? null,
    station: change.station !== undefined ? change.station : before?.station ?? null,
    kitLots: { ...before?.kitLots, ...change.kitLots },
    savedAt: now.toISOString(),
  }
  await store.putDaySettings(next)
  return next
}

/** A station's day settings for one campaign, kept on this device (see the top of this module). */
export function useDaySettings(accountId: string | undefined, facilityId: string, campaignId: string | undefined) {
  const [settings, setSettings] = useState<DaySettings | null>(null)
  useEffect(() => {
    if (!accountId || !campaignId) { setSettings(null); return }
    let live = true
    void outreachQueueStore().then(store => readDaySettings(store, { accountId, facilityId }, campaignId))
      .then(found => { if (live) setSettings(found) }, () => { if (live) setSettings(null) })
    return () => { live = false }
  }, [accountId, facilityId, campaignId])
  const save = useCallback(async (change: DaySettingsChange) => {
    if (!accountId || !campaignId) return null
    const saved = await saveDaySettings(await outreachQueueStore(), { accountId, facilityId }, campaignId, change)
    setSettings(saved)
    return saved
  }, [accountId, facilityId, campaignId])
  const clear = useCallback(async () => {
    if (!accountId || !campaignId) return
    const store = await outreachQueueStore()
    await store.removeDaySettings(daySettingsKey(accountId, facilityId, campaignId))
    setSettings(null)
  }, [accountId, facilityId, campaignId])
  return { settings, save, clear }
}

// ------------------------------------------------------------------------------------------------------- the hook --

/**
 * The queue for one account at one facility: what waits, sending it again, and adding to it. `onSynced` hears each
 * registration Health ID took from the queue, with its answer; `onWriteSynced` each station write.
 */
export function useOutreachQueue(accountId: string | undefined, facilityId: string, onSynced: (created: OutreachCase) => void,
  onWriteSynced?: (answer: StationCommandAnswer, entry: PendingStationWrite) => void) {
  const [entries, setEntries] = useState<PendingRegistration[]>([])
  const [writes, setWrites] = useState<PendingStationWrite[]>([])
  const [durable, setDurable] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const busy = useRef(false)
  const synced = useRef(onSynced)
  synced.current = onSynced
  const writeSynced = useRef(onWriteSynced)
  writeSynced.current = onWriteSynced
  const mine = useCallback((entry: { accountId: string; facilityId: string }) => entry.accountId === accountId && entry.facilityId === facilityId,
    [accountId, facilityId])

  const reload = useCallback(async () => {
    const store = await outreachQueueStore()
    setDurable(store.durable)
    const all = await store.list().catch(() => [] as PendingRegistration[])
    const allWrites = await store.listWrites().catch(() => [] as PendingStationWrite[])
    // Nothing waits longer than 14 days on a device, whoever saved it.
    const expired = all.filter(entry => queueEntryExpired(entry))
    const expiredWrites = allWrites.filter(entry => queueEntryExpired(entry))
    await Promise.all([...expired.map(entry => store.remove(entry.localCommandId).catch(() => undefined)),
      ...expiredWrites.map(entry => store.removeWrite(entry.localCommandId).catch(() => undefined))])
    setEntries(all.filter(entry => mine(entry) && !expired.includes(entry)).sort(bySaved))
    setWrites(allWrites.filter(entry => mine(entry) && !expiredWrites.includes(entry)).sort(bySaved))
  }, [mine])

  const sync = useCallback(async () => {
    if (busy.current || !accountId) return
    busy.current = true
    setSyncing(true)
    try {
      const store = await outreachQueueStore()
      // Still offline, or signed out: it stops, and tries the rest when the network is back or after signing in again.
      await syncOutreachQueue(store, { accountId, facilityId }, {
        registration: entry => staffApi.createOutreachCase(entry.facilityId, entry.input,
          { localCommandId: entry.localCommandId, temporaryPatientId: entry.temporaryPatientId }),
        write: entry => sendStationCommand(entry.facilityId, entry.caseId, entry.command, entry.localCommandId),
      }, {
        onRegistration: created => synced.current(created),
        onWrite: (answer, entry) => writeSynced.current?.(answer, entry),
      })
    } finally {
      busy.current = false
      setSyncing(false)
      await reload()
    }
  }, [accountId, facilityId, reload])

  const add = useCallback(async (entry: Omit<PendingRegistration, 'accountId' | 'facilityId' | 'savedAt' | 'state'>) => {
    if (!accountId) return
    const store = await outreachQueueStore()
    await store.put({ ...entry, accountId, facilityId, savedAt: new Date().toISOString(), state: 'waiting' })
    await reload()
  }, [accountId, facilityId, reload])

  /** Queues a station write for a case, or for a registration still in the queue; answers its localCommandId. */
  const addWrite = useCallback(async (campaignId: string | null, target: StationWriteTarget, command: StationCommand, localCommandId?: string) => {
    if (!accountId) return null
    const id = await queueStationWrite(await outreachQueueStore(), { accountId, facilityId }, campaignId, target, command, localCommandId)
    await reload()
    return id
  }, [accountId, facilityId, reload])

  const discard = useCallback(async (localCommandId: string) => {
    await discardQueuedRegistration(await outreachQueueStore(), localCommandId)
    await reload()
  }, [reload])

  const discardWrite = useCallback(async (localCommandId: string) => {
    const store = await outreachQueueStore()
    await store.removeWrite(localCommandId)
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

  return { entries, writes, durable, syncing, sync, add, addWrite, discard, discardWrite }
}
