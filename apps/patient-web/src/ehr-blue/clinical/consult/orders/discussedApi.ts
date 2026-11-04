import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient, isHidApiError, type ApiClient, type RequestSpec } from '@hid/http'
import { staffApi } from '../../../../staff/api'
import { getEnvironment } from '../../../../staff/env'
import {
  assertStaffSessionFacility, endsStaffSession, noteStaffSessionRefusal, refusedAsPatient, reportStaffSessionEnded,
  reportStaffSessionRead, staffSessionActor, staffSessionGeneration, staffSessionSignal, untilStaffSessionReady,
} from '../../../../staff/session'
import { readDiscussionList, readDiscussionAnswer, type DiscussionAnswer, type DiscussionList, type WithdrawalReasonCode } from './discussed'

/*
 * The three "Discussed with the patient" routes of lab-api (hid-system #177), on the staff portal's HTTP client: the
 * same registered @hid/http client as staff/api.ts ('staff-web'), so the contract registry and the app boundary guard
 * every request. staff/api.ts keeps its client to itself, so this module makes its own, as the point-of-care screens
 * do (departments/commerce/api.ts), and treats the session as staff/api.ts does: each request waits for the staff
 * session it was made in and ends with it, a 401 restores the session once (staffApi.refresh, shared with every other
 * caller), and a refusal that ends the session is reported.
 */

let registered: ApiClient | null = null
function client(): ApiClient {
  registered ??= createRegisteredBrowserClient(createApiClient({
    baseUrl: getEnvironment().apiBaseUrl,
    clientId: 'staff-web',
    sessionMode: 'cookie',
    refreshSession: async () => {
      const sentIn = staffSessionGeneration()
      const actor = staffSessionActor()
      const restored = await staffApi.refresh()
      // A refresh that answers for another account is no restore: nothing is sent again as that account.
      const id = restored?.actor?.id
      if (actor !== null && (typeof id !== 'string' || id !== actor || restored.actor?.kind === 'patient')) {
        throw new Error('The staff session changed.')
      }
      reportStaffSessionRead(restored, sentIn)
    },
  }), 'staff-web')
  return registered
}

async function send<T>(spec: RequestSpec & { headers: Record<string, string> }): Promise<T> {
  const sentIn = staffSessionGeneration()
  try {
    return await client().request<T>({
      ...spec,
      signal: staffSessionSignal(),
      beforeAttempt: async () => { await untilStaffSessionReady(sentIn); assertStaffSessionFacility(spec.headers) },
    })
  } catch (error) {
    noteStaffSessionRefusal(error, sentIn)
    if (endsStaffSession(error) || refusedAsPatient(error)) reportStaffSessionEnded(sentIn)
    throw error
  }
}

const base = (patientId: string) => `/api/v1/lab/patients/${encodeURIComponent(patientId)}`
const directCare = (facilityId: string) => ({ 'X-Facility-ID': facilityId, 'X-Purpose-Of-Use': 'direct-care' })

/** Whether a refusal says the routes are not served here (yet): a 404 that names no result (the gateway's own), or a 501. */
export function notServed(error: unknown): boolean {
  return isHidApiError(error) && (error.status === 501 || (error.status === 404 && error.code !== 'RESULT_NOT_FOUND'))
}

export const discussedApi = {
  /**
   * The patient's held results, with their marks. Null when the routes are not served, or the member may not read them
   * (403): the button is then never shown. Any other failure is thrown.
   */
  async list(facilityId: string, patientId: string): Promise<DiscussionList | null> {
    try {
      const answer = await send<unknown>({ method: 'GET', path: `${base(patientId)}/result-discussions`,
        headers: directCare(facilityId), dedupe: false })
      return readDiscussionList(answer)
    } catch (error) {
      if (notServed(error) || (isHidApiError(error) && error.status === 403)) return null
      throw error
    }
  },

  /** Marks that released version as discussed with the patient. */
  async mark(facilityId: string, patientId: string, resultId: string, resultVersion: number, idempotencyKey: string): Promise<DiscussionAnswer | null> {
    return readDiscussionAnswer(await send<unknown>({ method: 'POST',
      path: `${base(patientId)}/results/${encodeURIComponent(resultId)}/discussion`, body: { resultVersion },
      headers: { ...directCare(facilityId), 'Idempotency-Key': idempotencyKey } }))
  },

  /** Withdraws the mark on that version, with a reason code and a reason. */
  async withdraw(facilityId: string, patientId: string, resultId: string, resultVersion: number, reasonCode: WithdrawalReasonCode,
    reason: string, idempotencyKey: string): Promise<DiscussionAnswer | null> {
    return readDiscussionAnswer(await send<unknown>({ method: 'POST',
      path: `${base(patientId)}/results/${encodeURIComponent(resultId)}/discussion/withdrawal`, body: { resultVersion, reasonCode, reason },
      headers: { ...directCare(facilityId), 'Idempotency-Key': idempotencyKey } }))
  },
}
