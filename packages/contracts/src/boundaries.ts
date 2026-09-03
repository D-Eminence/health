/**
 * Application boundaries, expressed as code rather than as a convention.
 *
 * Health ID is several applications, not one application with many tabs. Each
 * one is granted the backend services its workflows actually need, and calling
 * outside that grant fails loudly at development time.
 *
 * This is an architecture guard, not a security control. The backend authorises
 * every request regardless of which application sent it; what this prevents is
 * the slow drift where one frontend accumulates unrelated functionality until
 * the boundaries exist only in a diagram.
 */

import { findEndpoint, hasContracts, type HidService } from './registry'

export type HidApp =
  | 'public-web'
  | 'patient-web'
  | 'staff-web'
  | 'ehr-web'
  | 'lab-web'
  | 'pharmacy-web'
  | 'ocr-web'
  | 'outreach-web'
  | 'admin-web'

export interface AppBoundary {
  readonly app: HidApp
  /** One line on what this application is for. Anything outside it belongs elsewhere. */
  readonly purpose: string
  /** Backend services this application may call. */
  readonly services: readonly HidService[]
  /** Whether this application handles patient-identifying or clinical data. */
  readonly handlesPhi: boolean
}

/**
 * Declared with `as const satisfies` so the granted service list of each
 * application survives as a literal type. That is what lets `@hid/api` hand an
 * application only the services it owns, making a boundary violation a
 * compile error rather than something discovered at runtime.
 */
export const APP_BOUNDARIES = {
  'public-web': {
    app: 'public-web',
    purpose: 'Public information and the entry point into patient or provider sign-up.',
    // Anonymous, cacheable, and deliberately unable to reach anything clinical.
    services: ['platform'],
    handlesPhi: false,
  },
  'patient-web': {
    app: 'patient-web',
    purpose: 'A patient viewing and managing their own health information and consent.',
    services: ['identity', 'ehr', 'access', 'files', 'notifications'],
    handlesPhi: true,
  },
  'staff-web': {
    app: 'staff-web',
    purpose: 'Clinician and facility workflows: patient lookup, access requests, encounters.',
    services: ['identity', 'ehr', 'access', 'files', 'notifications'],
    handlesPhi: true,
  },
  'ehr-web': {
    app: 'ehr-web',
    purpose: 'Electronic health record authoring and review.',
    services: ['identity', 'ehr', 'access', 'files'],
    handlesPhi: true,
  },
  'lab-web': {
    app: 'lab-web',
    purpose: 'Laboratory workflows: orders, specimens, results.',
    services: ['identity', 'lab'],
    handlesPhi: true,
  },
  'pharmacy-web': {
    app: 'pharmacy-web',
    purpose: 'Pharmacy workflows: prescriptions, dispensing, stock.',
    services: ['identity', 'pharmacy'],
    handlesPhi: true,
  },
  'ocr-web': {
    app: 'ocr-web',
    purpose: 'Document capture, OCR review and migration of existing records.',
    services: ['identity', 'ocr'],
    handlesPhi: true,
  },
  'outreach-web': {
    app: 'outreach-web',
    purpose: 'Field registration campaigns run by outreach workers.',
    services: ['identity', 'outreach'],
    handlesPhi: true,
  },
  'admin-web': {
    app: 'admin-web',
    purpose: 'Platform administration: users, roles, billing, platform controls.',
    services: ['identity', 'admin', 'platform'],
    handlesPhi: true,
  },
} as const satisfies Record<HidApp, AppBoundary>

/** The services a given application is granted, as a union of literal types. */
export type ServicesOf<A extends HidApp> = (typeof APP_BOUNDARIES)[A]['services'][number]

export class BoundaryViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BoundaryViolationError'
  }
}

export function servicesFor(app: HidApp): readonly HidService[] {
  return APP_BOUNDARIES[app].services
}

export function canUseService(app: HidApp, service: HidService): boolean {
  // `services` is a literal tuple per application, so it is widened here to
  // compare against an arbitrary service.
  return servicesFor(app).includes(service)
}

/**
 * Throws unless `app` is allowed to call `endpointName`.
 *
 * Service modules call this once when they are constructed, so a boundary
 * mistake surfaces the first time an application boots rather than the first
 * time a user reaches an unusual screen.
 */
export function assertEndpointAllowed(app: HidApp, endpointName: string): void {
  const descriptor = findEndpoint(endpointName)

  if (!descriptor) {
    throw new BoundaryViolationError(
      `"${endpointName}" is not a known Health ID endpoint. ` +
        'Add it to the contract registry only after the backend contract is confirmed; ' +
        'if it does not exist, record it in docs/OPEN-QUESTIONS.md instead of calling it.',
    )
  }

  if (!hasContracts(descriptor.service)) {
    throw new BoundaryViolationError(
      `The "${descriptor.service}" service has no confirmed backend contracts at the frozen release, ` +
        `so "${endpointName}" cannot be called yet.`,
    )
  }

  if (!canUseService(app, descriptor.service)) {
    throw new BoundaryViolationError(
      `"${app}" may not call the "${descriptor.service}" service (endpoint "${endpointName}"). ` +
        `It is granted: ${servicesFor(app).join(', ')}. ` +
        'Either the workflow belongs in a different application, or the boundary needs to change deliberately.',
    )
  }
}
