import { createRegisteredBrowserClient } from '@hid/api'
import { NO_RETRY, createApiClient, type ApiClient, type RequestSpec } from '@hid/http'
import { getEnvironment } from './env'
import { parseCardRecords, parseCardView, type CardRecords, type CardView } from './cardShares'

/**
 * The calls the page a card link opens makes (step 8, hid-system 0118; routes under /api/v1/card-share/). The person
 * who received the link is not signed in to Health ID, and a patient's session in the same browser must never be read,
 * refreshed or ended by this page:
 *
 * - its own client, outside SessionProvider: no refresh, no sign-out on any answer, and the receiver's routes never
 *   answer 401 anyway (a 410 says a view or link ended);
 * - every call `auth: 'none'`, never retried (a code or a code request is never sent twice), and cancellable;
 * - no X-CSRF-Token: the cookie client would otherwise copy a signed-in patient's CSRF cookie onto these calls;
 * - the link's token only in POST bodies, never in a path, query or header;
 * - every read after the code names its view in X-Card-View (the viewId verify answered, not a secret), so the server
 *   can refuse with 409 CARD_SHARE_VIEW_CHANGED when another card was opened in this browser since (critique fix 1).
 */
export interface CardReceiverApi {
  /** 204 while served; a 404 (NOT_FOUND) means switched off or not built. */
  availability(signal?: AbortSignal): Promise<void>
  requestCode(token: string, turnstileToken: string, signal?: AbortSignal): Promise<{ sentTo: string; expiresInSeconds: number; resendAfterSeconds: number }>
  verify(token: string, code: string, signal?: AbortSignal): Promise<CardView>
  view(viewId: string, signal?: AbortSignal): Promise<CardView>
  records(viewId: string, signal?: AbortSignal): Promise<CardRecords>
  endView(viewId: string): Promise<void>
  /**
   * "Stop these emails", from the link in E5 or E6: the separate stop token (never the card's), in the body. 204 for any
   * well-formed token, known or not; a genuine one blocks card emails to that address and ends its live links.
   */
  stop(stopToken: string, signal?: AbortSignal): Promise<void>
}

export function createCardReceiverApi({ baseUrl, fetchImpl }: { baseUrl: string; fetchImpl?: typeof fetch }): CardReceiverApi {
  // `getCsrfToken` answering '' (not null) stops the client reading a signed-in patient's CSRF cookie for these calls.
  const client: ApiClient = createRegisteredBrowserClient(createApiClient({
    baseUrl, clientId: 'patient-web', sessionMode: 'cookie', getCsrfToken: () => '', ...(fetchImpl ? { fetchImpl } : {}),
  }), 'patient-web')
  const call = <T>(method: 'GET' | 'POST', path: string, options: Partial<Pick<RequestSpec, 'body' | 'signal' | 'headers' | 'responseType'>> = {}) =>
    client.request<T>({ method, path: `/api/v1/card-share/${path}`, auth: 'none', retry: NO_RETRY, reportUnauthorized: false,
      refreshOnUnauthorized: () => false, dedupe: false, ...options })
  const viewHeader = (viewId: string) => ({ 'X-Card-View': viewId })
  return {
    availability: async signal => { await call<unknown>('GET', 'availability', { signal }) },
    requestCode: async (token, turnstileToken, signal) => {
      const answer = await call<Record<string, unknown> | null>('POST', 'code', { body: { token, turnstileToken }, signal })
      const sentTo = typeof answer?.sentTo === 'string' && answer.sentTo.length <= 320 ? answer.sentTo : 'the address this link was sent to'
      const number = (value: unknown, otherwise: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : otherwise
      return { sentTo, expiresInSeconds: number(answer?.expiresInSeconds, 600), resendAfterSeconds: number(answer?.resendAfterSeconds, 60) }
    },
    verify: async (token, code, signal) => parseCardView(await call<unknown>('POST', 'verify', { body: { token, code }, signal })),
    view: async (viewId, signal) => parseCardView(await call<unknown>('GET', 'view', { signal, headers: viewHeader(viewId) })),
    records: async (viewId, signal) => parseCardRecords(await call<unknown>('GET', 'records', { signal, headers: viewHeader(viewId) })),
    endView: async viewId => { await call<unknown>('POST', 'end-view', { headers: viewHeader(viewId) }) },
    stop: async (stopToken, signal) => { await call<unknown>('POST', 'stop', { body: { stopToken }, signal }) },
  }
}

/** The browser's own receiver client: the portal's gateway, cookies sent (the code and view cookies), no session logic. */
export function browserCardReceiverApi(): CardReceiverApi {
  return createCardReceiverApi({ baseUrl: getEnvironment().apiBaseUrl })
}
