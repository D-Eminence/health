/**
 * The public site's API access.
 *
 * `public-web` is granted exactly one service — `platform` — so this file can
 * only ever reach a liveness probe. It cannot request a patient record, and
 * that is not a matter of discipline: `api.ehr` does not exist on this type.
 */

import { createHidApi } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createLogger } from '@hid/observability'
import { getEnvironment } from './env'

export function createPublicApi() {
  const environment = getEnvironment()
  const logger = createLogger({
    minLevel: environment.name === 'local' ? 'debug' : 'warn',
    baseContext: { app: 'public-web', environment: environment.name },
  })

  const client = createApiClient({
    baseUrl: environment.apiBaseUrl,
    clientId: 'public-web',
    logger,
  })

  return createHidApi({ app: 'public-web', client })
}
