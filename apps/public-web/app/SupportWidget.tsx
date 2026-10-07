'use client'

import { createRegisteredBrowserClient, createSupportService } from '@hid/api'
import { createApiClient } from '@hid/http'
import { SupportChat } from '@hid/ui'
import { getEnvironment } from '../lib/env'

export function SupportWidget() {
  const env = getEnvironment()
  if (!env.supportChatEnabled || !env.supportContact) return null
  const send = createSupportService({ app: 'public-web', client: createRegisteredBrowserClient(
    createApiClient({ baseUrl: env.apiBaseUrl, clientId: 'public-web', sessionMode: 'cookie' }), 'public-web') }).chat
  return <SupportChat contact={env.supportContact} send={send} />
}
