/* eslint-disable no-restricted-syntax -- The storage report has to read the offline database, Cache Storage and web storage in the page, read-only, to count what a device keeps; nothing here writes to any of them. */
import type { Page } from '@playwright/test'
import { STORAGE } from './selectors'

/**
 * What a device keeps for one origin, read in the page and never written (OFFLINE-CONTRACT §2.4, §2.12):
 * - counts of every store in the 'health-id-offline' database, opened only if indexedDB.databases() lists it
 *   (opening a missing one would create an empty version-1 database and break the app's own upgrade; an
 *   unexpected upgrade is aborted as a second line, so nothing is ever created);
 * - the Cache Storage names, with the shell's ('health-id-shell-<build>') entry counts;
 * - the plaintext scan: every record of every store serialized (byte fields decoded both as UTF-8 and Latin-1)
 *   and searched for each needle, case-insensitively, plus the shell caches' text responses and web storage.
 */

export interface StorageReport {
  origin: string
  database: { exists: boolean; version: number | null; stores: Record<string, number> }
  shellCaches: Record<string, number>
  otherCaches: number
  webStorageKeys: { local: number; session: number }
}

export interface PlaintextScan {
  origin: string
  /** needle index -> where it was found ('outbox', 'cache', 'cache-storage:<name>', 'localStorage', ...). */
  matches: Record<number, string[]>
  recordsScanned: number
  total: number
}

type InPage = { name: string; version: number; stores: readonly string[]; shellPrefix: string }

const SETTINGS: InPage = { name: STORAGE.database, version: STORAGE.version, stores: STORAGE.stores, shellPrefix: STORAGE.shellCachePrefix }

/** Counts for the page's origin. */
export async function storageReport(page: Page): Promise<StorageReport> {
  return await page.evaluate(async (settings: InPage) => {
    const listed = (await indexedDB.databases()).find(item => item.name === settings.name)
    const database: StorageReport['database'] = { exists: listed !== undefined, version: listed?.version ?? null, stores: {} }
    if (listed) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(settings.name)
        // Listed, so this never fires; if it does (deleted meanwhile), abort so nothing is created.
        request.onupgradeneeded = () => request.transaction?.abort()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('open failed'))
        request.onblocked = () => reject(new Error('open blocked'))
      })
      try {
        for (const store of Array.from(db.objectStoreNames)) {
          database.stores[store] = await new Promise<number>((resolve, reject) => {
            const count = db.transaction(store, 'readonly').objectStore(store).count()
            count.onsuccess = () => resolve(count.result)
            count.onerror = () => reject(count.error ?? new Error('count failed'))
          })
        }
      } finally { db.close() }
    }
    const shellCaches: Record<string, number> = {}
    let otherCaches = 0
    for (const name of await caches.keys()) {
      if (!name.startsWith(settings.shellPrefix)) { otherCaches++; continue }
      // Only names caches.keys() returned are opened, so nothing is created.
      shellCaches[name] = (await (await caches.open(name)).keys()).length
    }
    return {
      origin: location.origin, database, shellCaches, otherCaches,
      webStorageKeys: { local: localStorage.length, session: sessionStorage.length },
    }
  }, SETTINGS)
}

/** The plaintext scan for the page's origin. Needles are fictional demo strings and the run's own note text. */
export async function plaintextScan(page: Page, needles: readonly string[]): Promise<PlaintextScan> {
  return await page.evaluate(async ({ settings, needles }: { settings: InPage; needles: readonly string[] }) => {
    const lowered = needles.map(needle => needle.toLowerCase())
    const matches: Record<number, string[]> = {}
    let recordsScanned = 0
    const search = (text: string, where: string) => {
      const haystack = text.toLowerCase()
      lowered.forEach((needle, index) => {
        if (!needle || !haystack.includes(needle)) return
        const places = (matches[index] ??= [])
        if (!places.includes(where)) places.push(where)
      })
    }
    const utf8 = new TextDecoder('utf-8', { fatal: false })
    const latin1 = new TextDecoder('latin1')
    // Every value as text: strings as they are, bytes decoded both ways, everything else walked.
    const serialize = (value: unknown, out: string[], depth = 0): void => {
      if (depth > 12 || value === null || value === undefined) return
      if (typeof value === 'string') { out.push(value); return }
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') { out.push(String(value)); return }
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        out.push(utf8.decode(bytes), latin1.decode(bytes))
        return
      }
      if (value instanceof Blob) { out.push('[blob]'); return }
      if (value instanceof Date) { out.push(value.toISOString()); return }
      if (Array.isArray(value)) { for (const item of value) serialize(item, out, depth + 1); return }
      if (typeof value === 'object') {
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) { out.push(key); serialize(item, out, depth + 1) }
      }
    }

    const listed = (await indexedDB.databases()).some(item => item.name === settings.name)
    if (listed) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(settings.name)
        request.onupgradeneeded = () => request.transaction?.abort()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('open failed'))
        request.onblocked = () => reject(new Error('open blocked'))
      })
      try {
        for (const store of Array.from(db.objectStoreNames)) {
          const records = await new Promise<{ keys: IDBValidKey[]; values: unknown[] }>((resolve, reject) => {
            const transaction = db.transaction(store, 'readonly')
            const keys = transaction.objectStore(store).getAllKeys()
            const values = transaction.objectStore(store).getAll()
            transaction.oncomplete = () => resolve({ keys: keys.result, values: values.result })
            transaction.onerror = () => reject(transaction.error ?? new Error('read failed'))
          })
          records.values.forEach((record, index) => {
            const out: string[] = []
            serialize(records.keys[index], out)
            serialize(record, out)
            search(out.join('\n'), store)
            recordsScanned++
          })
        }
      } finally { db.close() }
    }
    for (const name of await caches.keys()) {
      if (!name.startsWith(settings.shellPrefix)) continue
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        const response = await cache.match(request)
        const type = response?.headers.get('content-type') ?? ''
        if (response && /text|javascript|json|html|css/.test(type)) search(await response.text(), `cache-storage:${name}`)
        search(request.url, `cache-storage:${name}`)
      }
    }
    for (const [label, storage] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const) {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index) ?? ''
        search(`${key}\n${storage.getItem(key) ?? ''}`, label)
      }
    }
    const total = Object.values(matches).reduce((sum, where) => sum + where.length, 0)
    return { origin: location.origin, matches, recordsScanned, total }
  }, { settings: SETTINGS, needles })
}

/** A short line for a card note: "outbox 2, cache 14, audit 3 ...; shell caches 1". */
export function describeReport(report: StorageReport): string {
  const stores = Object.entries(report.database.stores).map(([name, count]) => `${name} ${count}`).join(', ')
  const shells = Object.entries(report.shellCaches).map(([name, count]) => `${name} (${count})`).join(', ')
  return `${report.origin}: database ${report.database.exists ? `v${report.database.version} [${stores}]` : 'absent'}; `
    + `shell caches ${shells || 'none'}; other caches ${report.otherCaches}; web storage keys ${report.webStorageKeys.local}/${report.webStorageKeys.session}`
}
