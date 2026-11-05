import { createApiClient, HidApiError, type RequestSpec } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { staffApi, type OutreachCampaignMember, type OutreachCase } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import {
  assertStaffSessionFacility, endsStaffSession, noteStaffSessionRefusal, refusedAsPatient, reportStaffSessionEnded,
  reportStaffSessionRead, staffSessionActor, staffSessionGeneration, staffSessionSignal, untilStaffSessionReady,
} from '../../../staff/session'

/*
 * Outreach follow-up visits, member names and linking by Health ID (hid-system 0115, behind OUTREACH_VISITS_ENABLED):
 * the case's visits, recording one, and the Health ID preview before a link. The page uses these only once a case answer
 * has said the backend serves them (outreachVisitsServed.ts); before that it sends exactly today's requests.
 *
 * Its own client, registered as the provider portal ('staff-web') as staff/api.ts is, so the contract registry and the
 * app boundary guard every request. The same headers as today's Outreach requests (the working facility, direct care);
 * the client adds the CSRF token; each write carries the Idempotency-Key its caller keeps. Each request keeps the provider
 * portal's session safeguards (staff/api.ts): it waits for the session it was made in, is stopped when its facility is no
 * longer the session's, restores the session once on a 401 only while that session is still in use, and reports a
 * refusal that ends the session so the session-ended screen shows.
 */

/** What a case answer from 0115 adds. A backend before it sends none of these keys. */
export interface OutreachCaseServed extends OutreachCase {
  createdBy?: { name: string } | null
  campaignName?: string | null
  nextFollowUpOn?: string | null
  visitCount?: number
}

/** What a campaign member answer from 0115 adds: the staff member's name, or null when it can't be given. */
export interface OutreachCampaignMemberServed extends OutreachCampaignMember {
  displayName?: string | null
}

export type OutreachVisitKind = 'visit' | 'referral' | 'follow_up'
export const OUTREACH_VISIT_KINDS: readonly OutreachVisitKind[] = ['visit', 'referral', 'follow_up']

/** One visit, referral or follow-up recorded on a case. Dates are calendar days (YYYY-MM-DD). */
export interface OutreachVisit {
  id: string
  registrationCaseId: string
  kind: OutreachVisitKind | string
  occurredOn: string
  followUpOn: string | null
  referredTo: string | null
  notes: string | null
  recordedByMembershipId?: string
  createdAt?: string
}

export interface OutreachVisitInput {
  kind: OutreachVisitKind
  occurredOn: string
  followUpOn: string | null
  referredTo: string | null
  notes: string | null
}

/** The person a Health ID names, as much as is needed to check it is them: never their record's ID or full Health ID. */
export interface OutreachLinkPreview {
  patient: { fullName: string; dateOfBirth: string | null; healthIdLast4: string }
  canLink: boolean
}

/** Made on first use, so importing this module reads no configuration. */
let registered: ReturnType<typeof createRegisteredBrowserClient> | null = null
function client(): ReturnType<typeof createRegisteredBrowserClient> {
  registered ??= createRegisteredBrowserClient(createApiClient({
    baseUrl: getEnvironment().apiBaseUrl,
    clientId: 'staff-web',
    sessionMode: 'cookie',
    refreshSession: async () => {
      const sentIn = staffSessionGeneration()
      const actor = staffSessionActor()
      const restored = await staffApi.refresh()
      // A refresh that answers for another account has not restored this one: nothing is repeated as that account.
      if (actor !== null && restored?.actor?.id !== actor) {
        throw new HidApiError(401, 'Your session has ended. Please sign in again.', { code: 'AUTHENTICATION_REQUIRED', retryable: false })
      }
      reportStaffSessionRead(restored, sentIn)
    },
  }), 'staff-web')
  return registered
}

async function send<T>(spec: Omit<RequestSpec, 'signal' | 'beforeAttempt'>, facilityId: string, idempotencyKey?: string): Promise<T> {
  const sentIn = staffSessionGeneration()
  const headers: Record<string, string> = {
    'X-Facility-ID': facilityId, 'X-Purpose-Of-Use': 'direct-care',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  }
  try {
    return await client().request<T>({
      ...spec,
      headers,
      signal: staffSessionSignal(),
      // Every attempt, a repeat after a refresh included, waits for its session and names a facility still the session's.
      beforeAttempt: async () => { await untilStaffSessionReady(sentIn); assertStaffSessionFacility(headers) },
      // A request whose session has since ended, or sent while no one is signed in, is never restored and repeated.
      refreshOnUnauthorized: () => staffSessionGeneration() === sentIn && staffSessionActor() !== null,
      ...(spec.method === 'GET' ? { dedupe: false } : {}),
    })
  } catch (error) {
    noteStaffSessionRefusal(error, sentIn)
    if (endsStaffSession(error) || refusedAsPatient(error)) reportStaffSessionEnded(sentIn)
    throw error
  }
}

const casePath = (caseId: string) => `/api/v1/outreach/registration-cases/${encodeURIComponent(caseId)}`

export const outreachVisitsApi = {
  /** The case's visits, newest first, at most 100. */
  listCaseVisits: (facilityId: string, caseId: string) =>
    send<{ items: OutreachVisit[] }>({ method: 'GET', path: `${casePath(caseId)}/visits` }, facilityId).then(answer => answer?.items ?? []),
  /** Records a visit. The caller keeps one key per visit, and sends it again only with the same visit. */
  createCaseVisit: (facilityId: string, caseId: string, input: OutreachVisitInput, idempotencyKey: string) =>
    send<{ visit: OutreachVisit }>({ method: 'POST', path: `${casePath(caseId)}/visits`, body: input }, facilityId, idempotencyKey)
      .then(answer => answer.visit),
  /** Who the Health ID names, and whether a link would be allowed. The Health ID goes in the body, never the address. */
  previewLink: (facilityId: string, caseId: string, healthId: string) =>
    send<OutreachLinkPreview>({ method: 'POST', path: `${casePath(caseId)}/link-preview`, body: { healthId } }, facilityId),
  /**
   * Links the case to the person the Health ID names; Outreach looks it up again, trusting nothing from the preview. The
   * caller keeps one key per link and sends it again only with the same link, so a repeat after a lost answer is
   * answered as the link already made.
   */
  linkByHealthId: (facilityId: string, registrationCase: OutreachCase, healthId: string, reason: string, idempotencyKey: string) =>
    send<OutreachCaseServed>({ method: 'POST', path: `${casePath(registrationCase.id)}/link-existing`,
      body: { healthId, expectedVersion: registrationCase.rowVersion, reason } }, facilityId, idempotencyKey),
}
