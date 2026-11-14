import { offlineShellHere } from '../../../productHostname'
import type { OutreachCampaign } from '../../../staff/api'

/*
 * Outreach with no signal (owner, 13 November 2026): opening Outreach with no connection, the session can't be read,
 * so on Health ID Outreach's own site only the last confirmed session's few facts needed to show Outreach are kept here:
 * who the volunteer is (account id and display name), their outreach group (id and name), whether Outreach takes the
 * health check fields, and the campaigns they may register people into, with their dates. Never a token, a cookie, a
 * permission, an email address or anything about a person registered.
 *
 * Kept in localStorage only, one copy for every tab (a reload, and a phone that closed the tab), for 24 hours from the
 * last time the session was confirmed (touchOutreachSnapshot); deleted on a deliberate sign-out, when Health ID answers
 * that the session ended, when another account signs in on this browser, and when the confirmed session no longer
 * includes the outreach group (staff/App.tsx). An older copy in sessionStorage is deleted when seen. The only module allowed browser storage for it (eslint.config.js, docs/ARCHITECTURE.md).
 *
 * It opens only "No signal" mode (OfflineOutreach.tsx): new registrations kept on this device, and the ones waiting.
 * They go to Health ID only once the session is read again for this same account (offlineQueue.ts).
 */

export interface OfflineCampaign {
  readonly id: string
  readonly name: string
  readonly startsAt: string
  readonly endsAt: string | null
}

export interface OutreachSnapshot {
  readonly version: 1
  /** When the session was last confirmed with these facts (ms since the epoch). */
  readonly savedAt: number
  readonly actorId: string
  readonly displayName: string
  readonly facilityId: string
  readonly facilityName: string
  /** Whether Outreach took the area field and the longer notes (OutreachNew's healthChecksServed). */
  readonly healthChecksServed: boolean
  /** The running or coming registration campaigns the volunteer is a member of. */
  readonly campaigns: readonly OfflineCampaign[]
  /**
   * Set when this volunteer's campaigns could not all be read (a campaign's members read got no answer, or failed) and no
   * earlier copy had them: an empty list then means "not known", never "in no campaign", and "No signal" mode says so.
   */
  readonly campaignsUnread?: true
  /**
   * Never stored: campaigns at the group whose members read has not answered yet. The campaigns kept before under these
   * ids stay (saveOutreachSnapshot), beside the ones this read did confirm.
   */
  readonly pendingCampaignIds?: readonly string[]
}

export const OUTREACH_SNAPSHOT_KEY = 'hid-outreach-offline-start'
/** How long the facts open "No signal" mode after the session was last confirmed. */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000

const LIMIT = 200
const text = (value: unknown, max = LIMIT): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

// One copy, in localStorage, so a sign-out or a session end in any tab removes it for every tab.
function stores(): Storage[] {
  try { const store = window.localStorage; return store ? [store] : [] } catch { return [] }
}

// Copies an earlier build kept per tab: deleted, never read.
function dropTabCopy(): void {
  try { window.sessionStorage?.removeItem(OUTREACH_SNAPSHOT_KEY) } catch { /* refused: nothing kept there */ }
}

function parse(raw: string | null, now: number): OutreachSnapshot | null {
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (typeof value !== 'object' || value === null) return null
  const s = value as Record<string, unknown>
  if (s.version !== 1 || typeof s.savedAt !== 'number' || !Number.isFinite(s.savedAt)) return null
  if (!(now - s.savedAt < SNAPSHOT_MAX_AGE_MS) || s.savedAt > now + 60_000) return null
  if (!text(s.actorId) || !text(s.facilityId) || !text(s.facilityName) || typeof s.displayName !== 'string' || s.displayName.length > LIMIT) return null
  if (typeof s.healthChecksServed !== 'boolean' || !Array.isArray(s.campaigns) || s.campaigns.length > 50) return null
  const campaigns: OfflineCampaign[] = []
  for (const item of s.campaigns as unknown[]) {
    const c = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    if (!text(c.id) || !text(c.name) || !text(c.startsAt, 40) || !(c.endsAt === null || text(c.endsAt, 40))) return null
    campaigns.push({ id: c.id, name: c.name, startsAt: c.startsAt, endsAt: c.endsAt })
  }
  return { version: 1, savedAt: s.savedAt, actorId: s.actorId, displayName: s.displayName, facilityId: s.facilityId,
    facilityName: s.facilityName, healthChecksServed: s.healthChecksServed, campaigns, ...(s.campaignsUnread === true ? { campaignsUnread: true } : {}) }
}

/**
 * Whether a campaign is one the facts keep, when the volunteer is a member of it: a running or coming registration
 * campaign (active, taking registrations, and not ended). Outreach.tsx waits for the members of every one of these to be
 * read before it keeps the campaigns, so none of them is left out by a read that has not answered yet.
 */
export function keptCampaign(campaign: OutreachCampaign, now = Date.now()): boolean {
  const ends = typeof campaign.endsAt === 'string' ? Date.parse(campaign.endsAt) : Number.NaN
  return campaign.status === 'active' && campaign.services.includes('registration') && !(ends <= now)
}

/** The facts to keep from a confirmed session at an outreach group: only those listed above. */
export function outreachSnapshotOf({ actorId, displayName, facilityId, facilityName, healthChecksServed, campaigns, pendingCampaignIds, now = Date.now() }: {
  readonly actorId: string
  readonly displayName: string | undefined
  readonly facilityId: string
  readonly facilityName: string
  readonly healthChecksServed: boolean
  /**
   * Campaigns the volunteer is a member of; only running or coming registration campaigns are kept. Null while they
   * can't all be told yet (a campaign's members are still being read, or couldn't be): the facts then say the campaigns
   * are not known, and saveOutreachSnapshot keeps the campaigns an earlier copy had instead.
   */
  readonly campaigns: readonly OutreachCampaign[] | null
  /** Campaigns at the group whose members read has not answered: what was kept before for them stays. */
  readonly pendingCampaignIds?: readonly string[]
  readonly now?: number
}): OutreachSnapshot {
  const facts = {
    version: 1 as const, savedAt: now, actorId, displayName: (displayName ?? '').slice(0, LIMIT), facilityId, facilityName: facilityName.slice(0, LIMIT),
    healthChecksServed,
  }
  if (campaigns === null) return { ...facts, campaigns: [], campaignsUnread: true }
  return {
    ...facts,
    campaigns: campaigns
      .filter(campaign => keptCampaign(campaign, now))
      .slice(0, 50)
      .map(campaign => ({ id: campaign.id, name: campaign.name.slice(0, LIMIT), startsAt: campaign.startsAt,
        endsAt: typeof campaign.endsAt === 'string' ? campaign.endsAt : null })),
    ...(pendingCampaignIds?.length ? { pendingCampaignIds: [...pendingCampaignIds] } : {}),
  }
}

/**
 * Keeps the facts, on Health ID Outreach's own site only. Never throws.
 *
 * Facts whose campaigns are not known (`campaignsUnread`: a members read has not answered, on weak signal say) never
 * replace the campaigns already kept for the same volunteer at the same group: the earlier copy's campaigns stay, and
 * only the rest (and its 24 hours) is brought up to date. Otherwise a members read that timed out would leave "No
 * signal" mode with no campaign, and nobody could be registered until signal came back.
 */
export function saveOutreachSnapshot(snapshot: OutreachSnapshot, hostname = window.location.hostname): void {
  if (!offlineShellHere(hostname)) return
  for (const store of stores()) {
    try {
      const { pendingCampaignIds: pending, ...facts } = snapshot
      let next: OutreachSnapshot = facts
      if (pending?.length) {
        // Some members reads have not answered: the campaigns confirmed now, and for the rest what was kept before.
        const kept = parse(store.getItem(OUTREACH_SNAPSHOT_KEY), snapshot.savedAt)
        const same = kept && kept.actorId === snapshot.actorId && kept.facilityId === snapshot.facilityId ? kept : null
        const known = new Set(facts.campaigns.map(campaign => campaign.id))
        const carried = (same?.campaigns ?? []).filter(campaign => pending.includes(campaign.id) && !known.has(campaign.id))
        const campaigns = [...facts.campaigns, ...carried].slice(0, 50)
        next = { ...facts, campaigns, ...(campaigns.length === 0 ? { campaignsUnread: true as const } : {}) }
      } else if (snapshot.campaignsUnread) {
        const kept = parse(store.getItem(OUTREACH_SNAPSHOT_KEY), snapshot.savedAt)
        if (kept && kept.actorId === snapshot.actorId && kept.facilityId === snapshot.facilityId) {
          const { campaignsUnread: _unknownNow, ...rest } = snapshot
          next = { ...rest, campaigns: kept.campaigns, ...(kept.campaignsUnread ? { campaignsUnread: true } : {}) }
        }
      }
      store.setItem(OUTREACH_SNAPSHOT_KEY, JSON.stringify(next))
    } catch { /* full or refused: the other one may keep it */ }
  }
}

/**
 * The facts kept, when this is Health ID Outreach's own site and they are under 24 hours old; else null (and any
 * expired or unreadable copy is deleted).
 */
export function readOutreachSnapshot(now = Date.now(), hostname = window.location.hostname): OutreachSnapshot | null {
  if (!offlineShellHere(hostname)) return null
  dropTabCopy()
  let found: OutreachSnapshot | null = null
  let stale = false
  for (const store of stores()) {
    let raw: string | null = null
    try { raw = store.getItem(OUTREACH_SNAPSHOT_KEY) } catch { continue }
    if (raw === null) continue
    const parsed = parse(raw, now)
    if (!parsed) stale = true
    else if (!found || parsed.savedAt > found.savedAt) found = parsed
  }
  if (stale && !found) clearOutreachSnapshot(hostname)
  return found
}

/** Deletes the facts: a deliberate sign-out, or Health ID answering that the session ended. Never throws. */
export function clearOutreachSnapshot(hostname = window.location.hostname): void {
  if (!offlineShellHere(hostname)) return
  dropTabCopy()
  for (const store of stores()) {
    try { store.removeItem(OUTREACH_SNAPSHOT_KEY) } catch { /* refused: nothing kept there */ }
  }
}

/**
 * Deletes the facts when they belong to another account than the one whose session was just confirmed, or (with
 * `facilityIds`) when that session no longer includes the outreach group they name. Never throws.
 */
export function clearOutreachSnapshotUnlessFor(actorId: string, facilityIds?: readonly string[], hostname = window.location.hostname): void {
  if (!offlineShellHere(hostname)) return
  dropTabCopy()
  for (const store of stores()) {
    try {
      const raw = store.getItem(OUTREACH_SNAPSHOT_KEY)
      if (raw === null) continue
      let kept: { actorId?: unknown; facilityId?: unknown } | null
      try { kept = JSON.parse(raw) as { actorId?: unknown; facilityId?: unknown } | null } catch { kept = null }
      const gone = facilityIds !== undefined && !facilityIds.includes(String(kept?.facilityId))
      if (kept?.actorId !== actorId || gone) store.removeItem(OUTREACH_SNAPSHOT_KEY)
    } catch { /* refused: nothing kept there */ }
  }
}

/**
 * The session was confirmed again for this account: the facts' 24 hours start again from now, so a tab left open
 * still opens "No signal" mode a day after it was last confirmed. Never throws.
 */
export function touchOutreachSnapshot(actorId: string, now = Date.now(), hostname = window.location.hostname): void {
  if (!offlineShellHere(hostname)) return
  for (const store of stores()) {
    try {
      const kept = parse(store.getItem(OUTREACH_SNAPSHOT_KEY), now)
      if (kept && kept.actorId === actorId) store.setItem(OUTREACH_SNAPSHOT_KEY, JSON.stringify({ ...kept, savedAt: now }))
    } catch { /* full or refused: the facts stay as they were */ }
  }
}

/** The campaigns kept, as the registration form takes them, open now. */
export function offlineCampaigns(snapshot: OutreachSnapshot): OutreachCampaign[] {
  return snapshot.campaigns.map(campaign => ({ id: campaign.id, name: campaign.name, status: 'active', services: ['registration'],
    startsAt: campaign.startsAt, endsAt: campaign.endsAt, rowVersion: 0 }))
}
