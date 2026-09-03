/**
 * Route guards.
 *
 * These decide what to *show*. They do not decide what a person is *allowed to
 * do* — the backend does that, on every request, regardless of what the browser
 * believes. A guard that passes when it should not is a user-experience bug; it
 * is not, on its own, a data breach, and the architecture depends on that
 * remaining true.
 *
 * The practical consequence: never use a guard result to decide whether to omit
 * a server-side check, and never treat a hidden route or a disabled button as
 * protection.
 */

import type { HidAppRole } from '@hid/contracts'
import type { AuthPrincipal, PrincipalKind } from './principal'
import { hasSatisfiedMfa } from './principal'
import type { SessionState } from './session'

export interface AccessRequirement {
  /** Which entrance this route belongs to. A patient route never renders for staff. */
  readonly principalKinds: readonly PrincipalKind[]
  /** Optional narrowing by authorisation role. */
  readonly appRoles?: readonly HidAppRole[]
  /**
   * Whether the route needs a second factor. Mirrors the backend's requirement
   * for privileged roles so the UI can prompt instead of failing a request.
   */
  readonly requireMfa?: boolean
}

export type AccessDecision =
  /** Render the route. */
  | { readonly outcome: 'allow' }
  /** Session state is not known yet. Render a loading state; do not redirect. */
  | { readonly outcome: 'pending' }
  /** Nobody is signed in. Send them to this portal's sign-in screen. */
  | { readonly outcome: 'sign-in-required'; readonly portal: PrincipalKind }
  /** Signed in, but a second factor is needed before this route makes sense. */
  | { readonly outcome: 'mfa-required' }
  /**
   * Signed in as the wrong kind of principal. The route belongs to a different
   * application or entrance; the UI should offer a way across, not an error.
   */
  | { readonly outcome: 'wrong-portal'; readonly actual: PrincipalKind }
  /** Signed in, correct portal, insufficient role. */
  | { readonly outcome: 'not-permitted' }

export function evaluateAccess(
  state: SessionState,
  requirement: AccessRequirement,
): AccessDecision {
  if (state.status === 'unknown') return { outcome: 'pending' }

  if (state.status === 'anonymous' || state.principal === null) {
    // Send them to the entrance the route belongs to, not to a generic login.
    const portal = requirement.principalKinds[0] ?? 'patient'
    return { outcome: 'sign-in-required', portal }
  }

  const principal: AuthPrincipal = state.principal

  if (!requirement.principalKinds.includes(principal.kind)) {
    return { outcome: 'wrong-portal', actual: principal.kind }
  }

  if (requirement.appRoles && !requirement.appRoles.includes(principal.appRole)) {
    return { outcome: 'not-permitted' }
  }

  if (requirement.requireMfa === true && !hasSatisfiedMfa(principal)) {
    return { outcome: 'mfa-required' }
  }

  return { outcome: 'allow' }
}

/** Convenience for rendering: true only for an outright allow. */
export function isAllowed(decision: AccessDecision): boolean {
  return decision.outcome === 'allow'
}

/** Requirements for the standard entrances, so applications do not restate them. */
export const PATIENT_ROUTE: AccessRequirement = { principalKinds: ['patient'] }

export const STAFF_ROUTE: AccessRequirement = {
  principalKinds: ['staff'],
  requireMfa: true,
}

export const PLATFORM_ADMIN_ROUTE: AccessRequirement = {
  principalKinds: ['platform'],
  appRoles: ['platform_admin'],
  requireMfa: true,
}
