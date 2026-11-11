import { createApiClient, isHidApiError } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { getEnvironment } from '../../../staff/env'
import { endsStaffSession, reportStaffSessionEnded, staffSessionGeneration, staffSessionSignal, untilStaffSessionReady } from '../../../staff/session'
import { learnReadingQualityServed } from '../../../readingLearningServed'
import { READING_QUALITY_MANAGER_PERMISSION, READING_QUALITY_PATH, READING_QUALITY_PERMISSIONS } from '../../../readingLearningContract'

/*
 * Migrate learning, phase 1: the staff "Reading quality" read (readingLearningContract.ts READING_QUALITY_PATH), Session
 * B's review-outcome summary for the working facility (hid-system claude/ecstatic-ramanujan-q4i1eo-ocr-review-outcomes,
 * d9c02668: ocr-api quality/quality-summary.controller.ts and .service.ts). GET /api/v1/ocr/quality/summary with
 * X-Facility-ID (row-level security reads that facility only) and X-Purpose-Of-Use: healthcare-operations (the route
 * takes that purpose itself; the header says the same). No from/to: the server's last 28 days, widened to whole weeks.
 *
 * Read by a platform administrator (a staff actor whose platform permissions include platform.admin.access and
 * platform.operations.read) or by the facility's own manager (workforce.manage on the membership at that facility);
 * anyone else 403. The page offers it only to such an actor (readsReadingQuality, which mirrors the server's
 * assertQualityReader). A backend without the route answers 404: not served, and the page stops offering it.
 *
 * Its own client, registered as the provider portal ('staff-web') like paperRecordsApi.ts, so the contract registry and
 * the app boundary guard the request; it waits for the staff session it was made in and ends with it. The read is
 * audited by ocr-api (ocr.quality.summary.read), so nothing here reads it by itself: only opening the view does.
 */

/** The read's answer: the summary, not served here (404), refused for this actor (403), or not read. */
export type ReadingQualityResult =
  | { readonly ok: true; readonly answer: unknown }
  | { readonly ok: false; readonly notServed: true }
  | { readonly ok: false; readonly refused: true }
  | { readonly ok: false; readonly failed: true }

/**
 * Whether the signed-in staff actor may read the reading quality of `facilityId`, the facility the read sends as
 * X-Facility-ID, as Session B's assertQualityReader decides it (hid-system #236, quality-summary.service.ts): a staff
 * actor whose platform permissions include both of READING_QUALITY_PERMISSIONS, or one whose membership at that very
 * facility holds workforce.manage, where that facility is the actor's current one and is not awaiting Health ID
 * support's review (selfService.review 'pending'). workforce.manage at another facility never counts. Copy only: the
 * server decides the read.
 */
export function readsReadingQuality(actor: unknown, facilityId?: string): boolean {
  if (!actor || typeof actor !== 'object') return false
  const { kind, platformPermissions: platform, facilities, facility } = actor as {
    kind?: unknown; platformPermissions?: unknown; facilities?: unknown; facility?: { id?: unknown } | null
  }
  if (kind === 'patient') return false
  if (Array.isArray(platform) && READING_QUALITY_PERMISSIONS.every(permission => platform.includes(permission))) return true
  if (!facilityId || !Array.isArray(facilities) || facility?.id !== facilityId) return false
  const membership = facilities.find((candidate: unknown) => Boolean(candidate) && typeof candidate === 'object'
    && (candidate as { id?: unknown }).id === facilityId) as { permissions?: unknown; selfService?: { review?: unknown } | null } | undefined
  return membership !== undefined && Array.isArray(membership.permissions)
    && membership.permissions.includes(READING_QUALITY_MANAGER_PERMISSION) && membership.selfService?.review !== 'pending'
}

/** Made on first use, so importing this module reads no configuration. */
let registered: ReturnType<typeof createRegisteredBrowserClient> | null = null
function client(): ReturnType<typeof createRegisteredBrowserClient> {
  registered ??= createRegisteredBrowserClient(createApiClient({
    baseUrl: getEnvironment().apiBaseUrl,
    clientId: 'staff-web',
    sessionMode: 'cookie',
  }), 'staff-web')
  return registered
}

function eitherAborted(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (first.aborted || second.aborted) return AbortSignal.abort()
  const both = new AbortController()
  const abort = () => both.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  return both.signal
}

export const readingQualityApi = {
  /** The working facility's reading quality for the last four weeks. */
  async summary(facilityId: string, signal?: AbortSignal): Promise<ReadingQualityResult> {
    const sentIn = staffSessionGeneration()
    try {
      const answer = await client().request<unknown>({
        method: 'GET', path: READING_QUALITY_PATH,
        headers: { 'X-Facility-ID': facilityId, 'X-Purpose-Of-Use': 'healthcare-operations' },
        signal: signal ? eitherAborted(signal, staffSessionSignal()) : staffSessionSignal(),
        beforeAttempt: () => untilStaffSessionReady(sentIn),
        dedupe: false,
      })
      learnReadingQualityServed(true)
      return { ok: true, answer }
    } catch (caught) {
      if (signal?.aborted) throw caught
      if (isHidApiError(caught) && caught.status === 404 && (caught.code === 'NOT_FOUND' || caught.code === 'API_ROUTE_NOT_FOUND')) {
        learnReadingQualityServed(false)
        return { ok: false, notServed: true }
      }
      if (endsStaffSession(caught)) reportStaffSessionEnded(sentIn)
      if (isHidApiError(caught) && caught.status === 403) return { ok: false, refused: true }
      return { ok: false, failed: true }
    }
  },
}
