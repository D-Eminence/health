/*
 * What an outreach page keeps for this browser tab only, so a reload loses nothing a volunteer typed (the owner's "no
 * hassle" rule for the outreach of 14 November 2026). Kept in sessionStorage, which survives a reload of the tab and is
 * cleared when the tab closes; each value is keyed by the account (and the registration it is about), and signing out
 * removes them all (forgetOutreachTab). What is kept here:
 *
 *  - unsaved health checks on one registration (HealthChecks.tsx), until they are saved;
 *  - a Health ID being made with an email code (CreateHealthId.tsx): that a code was sent, when, the email typed and the
 *    Idempotency-Key in use, never the code itself; and a claim code just made, for up to 15 minutes, so the slip can
 *    still print it after an accidental reload;
 *  - the outreach group this tab last chose, so a reload lands back on it (staff/App.tsx);
 *  - this tab's own random id, for the lock below.
 *
 * Nothing about a person ever goes in localStorage: the only localStorage value is the cross-tab send lock
 * (claimStorageLock), which holds a registration's random command id, a random tab id and a time, and is used only where
 * the browser has no Web Locks. Every read and write is wrapped: a browser that refuses storage keeps nothing and loses
 * nothing more than before. Browser storage is allowed in this one module only (eslint.config.js, docs/ARCHITECTURE.md).
 */

import type { Facility, StaffSession } from '../../../staff/api'

const PREFIX = 'hid-outreach:'

function tabStore(): Storage | null {
  try { return globalThis.sessionStorage ?? null } catch { return null }
}

function sharedStore(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

/** Whether this tab can keep anything across a reload (a browser that refuses storage cannot). */
export function tabKeeps(): boolean {
  return tabStore() !== null
}

/** The value kept under `key` in this tab, or null (none, unreadable, or not JSON). */
export function readTab<T>(key: string): T | null {
  try {
    const raw = tabStore()?.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

/** Keeps `value` under `key` in this tab; null removes it. Never throws. */
export function writeTab(key: string, value: unknown): void {
  try {
    const store = tabStore()
    if (!store) return
    if (value === null || value === undefined) store.removeItem(PREFIX + key)
    else store.setItem(PREFIX + key, JSON.stringify(value))
  } catch { /* storage full or refused: nothing is kept */ }
}

/** Removes everything outreach kept in this tab (signing out). Never throws. */
export function forgetOutreachTab(): void {
  try {
    const store = tabStore()
    if (!store) return
    const keys: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch { /* nothing to remove */ }
}

/** This tab's own random id: the same after a reload of the tab, another in another tab. */
export function tabId(): string {
  const kept = readTab<string>('tab')
  if (kept) return kept
  const made = crypto.randomUUID()
  writeTab('tab', made)
  return made
}

/** How long a cross-tab send lock holds when its tab never lets it go (closed while sending). */
export const STORAGE_LOCK_MS = 60_000

/**
 * A lock shared by the tabs of this browser, for a browser without Web Locks: the release, or null while another tab
 * holds it (for at most STORAGE_LOCK_MS). The same tab, reloaded, takes its own lock back at once. Where localStorage
 * can't be used, the lock is granted: Health ID's idempotency still keeps a registration from being made twice.
 */
export function claimStorageLock(name: string, now = Date.now()): (() => void) | null {
  const store = sharedStore()
  const key = `${PREFIX}lock:${name}`
  const me = tabId()
  try {
    if (!store) return () => undefined
    const held = parseLock(store.getItem(key))
    if (held && held.tab !== me && held.until > now) return null
    store.setItem(key, JSON.stringify({ tab: me, until: now + STORAGE_LOCK_MS }))
  } catch {
    return () => undefined
  }
  return () => {
    try { if (parseLock(store.getItem(key))?.tab === me) store.removeItem(key) } catch { /* gone already */ }
  }
}

function parseLock(raw: string | null): { tab: string; until: number } | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as { tab?: unknown; until?: unknown }
    return typeof value.tab === 'string' && typeof value.until === 'number' ? { tab: value.tab, until: value.until } : null
  } catch {
    return null
  }
}

/** The roles that exist only at an outreach group's own facility (as outreachGroup.tsx OUTREACH_GROUP_ROLES). */
const GROUP_ROLES: ReadonlySet<string> = new Set(['outreach_organiser', 'outreach_volunteer'])
const isGroup = (facility: Pick<Facility, 'roles'> | undefined | null) => facility?.roles.some(role => GROUP_ROLES.has(role)) ?? false

/**
 * Remembers, for this tab and account, the facility it now works at when that is an outreach group, so a reload lands
 * back there; any other facility forgets it (a reload then opens where Identity says, as before).
 */
export function rememberTabFacility(session: StaffSession): void {
  const facility = session.actor.facility
  writeTab(`facility:${session.actor.id}`, facility && isGroup(facility) ? facility.id : null)
}

/**
 * The outreach group this tab last chose, when the session read on a reload opened elsewhere and the group is still one
 * of the account's: the facility to choose again. Null otherwise, and never for anyone who never chose one in this tab.
 */
export function tabFacilityToRestore(session: StaffSession): string | null {
  const id = readTab<string>(`facility:${session.actor.id}`)
  if (!id || session.actor.facility?.id === id) return null
  return session.actor.facilities.some(facility => facility.id === id && isGroup(facility)) ? id : null
}
