/**
 * The Health ID API entry point for an application.
 *
 * An application constructs this once, at startup, and passes it down. It gets
 * exactly the services its boundary grants: `api.admin` does not exist on the
 * patient application, and reaching for it is a compile error rather than
 * something discovered when a request comes back 403 in production.
 *
 * Two layers hold the boundary:
 *   - the type of this function, derived from `APP_BOUNDARIES`
 *   - `assertEndpointAllowed` inside every service call, for dynamic callers
 *     and for code that has cast its way past the types
 */

import type { ApiClient } from '@hid/http'
import { APP_BOUNDARIES, type HidApp, type ServicesOf } from '@hid/contracts'
import {
  createAccessService,
  createAdminService,
  createAuthService,
  createCommercialService,
  createEhrService,
  createEnrollmentService,
  createFilesService,
  createIdentityService,
  createLabService,
  createNotificationsService,
  createOcrService,
  createOutreachService,
  createPharmacyService,
  createPlatformService,
} from './services'
import type { ServiceContext } from './service'

/**
 * Service factories, keyed by the service they implement.
 *
 * Every factory checks both the route registry and application boundary.
 */
const SERVICE_FACTORIES = {
  auth: createAuthService,
  enrollment: createEnrollmentService,
  identity: createIdentityService,
  ehr: createEhrService,
  access: createAccessService,
  files: createFilesService,
  notifications: createNotificationsService,
  outreach: createOutreachService,
  ocr: createOcrService,
  lab: createLabService,
  pharmacy: createPharmacyService,
  admin: createAdminService,
  commercial: createCommercialService,
  platform: createPlatformService,
} as const

type ServiceFactories = typeof SERVICE_FACTORIES

/** Services an application is granted that are actually implementable today. */
type AvailableServices<A extends HidApp> = Extract<ServicesOf<A>, keyof ServiceFactories>

export type HidApiFor<A extends HidApp> = {
  readonly app: A
} & {
  readonly [S in AvailableServices<A>]: ReturnType<ServiceFactories[S]>
}

export interface HidApiOptions<A extends HidApp> {
  readonly app: A
  readonly client: ApiClient
}

export function createHidApi<A extends HidApp>({ app, client }: HidApiOptions<A>): HidApiFor<A> {
  const context: ServiceContext = { app, client }
  const granted = APP_BOUNDARIES[app].services as readonly (keyof ServiceFactories)[]

  const services: Record<string, unknown> = { app }
  for (const service of granted) {
    const factory = SERVICE_FACTORIES[service]
    if (factory) services[service] = factory(context)
  }

  return services as HidApiFor<A>
}

export { createServiceBinding } from './service'
export { createRegisteredBrowserClient } from './browser-client'
export type { CallOptions, ServiceContext } from './service'
export {
  createAccessService,
  createAdminService,
  createAuthService,
  createCommercialService,
  createEhrService,
  createEnrollmentService,
  createFilesService,
  createIdentityService,
  createLabService,
  createNotificationsService,
  createOcrService,
  createOutreachService,
  createPharmacyService,
  createPlatformService,
} from './services'
