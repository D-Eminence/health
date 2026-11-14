'use client'

import { createRegisteredBrowserClient, createSupportService } from '@hid/api'
import { createApiClient } from '@hid/http'
import { SupportChat } from '@hid/ui'
import { PRODUCT_SITE_SUBDOMAINS } from '@/content/site'
import { getEnvironment } from '../lib/env'

/**
 * Where this site's pages open and their edge sends /api/v1 on to the API (infra/cloudflare/src/frontend-worker.mjs):
 * the website, the patient portal's front page for someone not signed in (app., staging.), and each product site's
 * front page (ehr., lab., pharmacy., migrate., outreach.), in production and under `.staging.`.
 */
const KNOWN_HOSTS: ReadonlySet<string> = new Set([
  'healthidentitydirectory.com', 'app.healthidentitydirectory.com',
  'www.staging.healthidentitydirectory.com', 'staging.healthidentitydirectory.com',
  ...Object.values(PRODUCT_SITE_SUBDOMAINS).flatMap(subdomain => [
    `${subdomain}.healthidentitydirectory.com`, `${subdomain}.staging.healthidentitydirectory.com`]),
])

/**
 * The API address the support assistant asks. On a known Health ID host it is the page's own origin: the same page
 * opens on the website, the portal's front page and every product site, and only its own origin answers it without a
 * cross-site request. Anywhere else (local development) it is the configured address.
 */
export function supportApiBaseUrl(location: Pick<Location, 'protocol' | 'hostname' | 'origin'>, configured: string): string {
  return location.protocol === 'https:' && KNOWN_HOSTS.has(location.hostname.toLowerCase()) ? location.origin : configured
}

export function SupportWidget() {
  const env = getEnvironment()
  if (!env.supportChatEnabled || !env.supportContact) return null
  // support-api answers anyone and knows no session, so the request carries none: bearer mode with no token sends
  // no cookie, no CSRF token and no Authorization header. The address is chosen when a message is sent, in the
  // browser; this page is also built ahead of time, where there is no location.
  const send: ReturnType<typeof createSupportService>['chat'] = (text, sessionId, options) => {
    const transport = createApiClient({ baseUrl: supportApiBaseUrl(window.location, env.apiBaseUrl), clientId: 'public-web', sessionMode: 'bearer' })
    return createSupportService({ app: 'public-web', client: createRegisteredBrowserClient(transport, 'public-web') }).chat(text, sessionId, options)
  }
  return <SupportChat contact={env.supportContact} send={send} />
}
