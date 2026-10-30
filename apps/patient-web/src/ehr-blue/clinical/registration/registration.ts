import { findEndpoint, type EndpointMethod } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { useRef } from 'react'
import type { RegistrationCapabilities, RegistrationCase } from '../../../staff/api'

/**
 * Today's Patient registration rules and words (staff/routes/Registration.tsx), for the blue EHR's registration pages.
 * Today's page keeps `UUID`, `completed`, `safeError`, `statusLabel` and `useCommandKey` private, so they are restated
 * here word for word. The permissions come from the contracts registry (`findEndpoint`): each step needs every
 * permission the registry lists for the route it calls (today: identity.registration.write to read and verify,
 * identity.registration.approve to link, approve and enroll).
 */

/** Restated from Registration.tsx: a registration case ID as today's "Load case" accepts it. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Restated from Registration.tsx: the statuses whose verified identity may be enrolled. */
export const completed = new Set<RegistrationCase['status']>(['approved_new_identity', 'linked_existing', 'resolved_existing_identity'])

/** Restated from Registration.tsx: the backend's sanitised message, or the step's own words. */
export function safeError(error: unknown, fallback: string) {
  return isHidApiError(error) ? error.message : fallback
}

/** Restated from Registration.tsx. */
export function statusLabel(status: RegistrationCase['status']) {
  return ({
    pending_new_identity_approval: 'Awaiting new patient approval',
    review_required: 'Possible existing patient review',
    resolved_existing_identity: 'Verified existing patient',
    linked_existing: 'Linked to existing patient',
    approved_new_identity: 'New patient approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  })[status]
}

/** Restated from Registration.tsx: idempotency keys stay in component memory only and are reused for an unchanged retry. */
export function useCommandKey() {
  const previous = useRef<{ signature: string; key: string } | null>(null)
  return {
    forInput(signature: string) {
      if (previous.current?.signature !== signature) previous.current = { signature, key: crypto.randomUUID() }
      return previous.current.key
    },
    clear() { previous.current = null },
  }
}

type Route = readonly [name: string, method: EndpointMethod]

/** Whether the role holds every permission the registry lists for each route; a route listing none is not open. */
function roleMay(routes: readonly Route[], permissions: readonly string[]): boolean {
  return routes.every(([name, method]) => {
    const required = findEndpoint(name)?.permissions?.[method] ?? []
    return required.length > 0 && required.every(permission => permissions.includes(permission))
  })
}

/** Today's `canWrite`: the capability read, NIN verification and the case read. */
export const mayWrite = (permissions: readonly string[]) => roleMay([
  ['identity.registrationCapabilities', 'GET'], ['identity.resolveNin', 'POST'], ['identity.registrationCase', 'GET'],
], permissions)
/** Today's `canApprove`, for each command it guards. */
export const mayLink = (permissions: readonly string[]) => roleMay([['identity.registrationLink', 'POST']], permissions)
export const mayApprove = (permissions: readonly string[]) => roleMay([['identity.registrationApprove', 'POST']], permissions)
export const mayEnroll = (permissions: readonly string[]) => roleMay([['identity.registrationEnroll', 'POST']], permissions)
/** The Patients list's Health ID lookup (the frame opens Patients with the same permission). */
export const mayOpenPatients = (permissions: readonly string[]) => roleMay([['identity.patientLookup', 'POST']], permissions)

/**
 * A case NIN verification has just created, as the router state of the move to its page: only the facility that
 * created it (never the NIN, a name or a patient), so its page says so, and a first read that fails says
 * "Case created. Reload its details before reviewing it." as today's page does.
 */
export function createdState(facilityId: string) {
  return { created: facilityId }
}

export function createdAt(state: unknown): string {
  return state && typeof state === 'object' && 'created' in state && typeof state.created === 'string' ? state.created : ''
}

// Today's words, verbatim.
export const TITLE = 'Patient registration'
export const UNAVAILABLE_TITLE = 'Registration unavailable'
export const UNAVAILABLE = 'This facility membership needs identity registration write permission.'
export const INTRO = 'Verify a NIN, review possible matches, and link the verified identity to a governed Health ID. Every step is tied to your active facility and recorded by the backend.'
export const AVAILABILITY = 'Verification availability'
export const CHECKING = 'Checking the backend’s registration capability…'
export const CAPABILITIES_FAILED = 'Registration capabilities could not be loaded.'
export const NIN_TITLE = 'Start with verified identity'
export const NIN_INTRO = 'Enter the NIN and matching demographic claims. The NIN is sent directly to the identity service and is cleared from this form after a successful response.'
export const RESUME_TITLE = 'Resume a registration case'
export const RESUME_INTRO = 'Use the case ID supplied when verification completed. The backend does not provide a searchable case list.'
export const NIN_PROBLEM = 'Enter the 11 digit NIN.'
export const NAME_PROBLEM = 'Enter the patient’s name and date of birth.'
export const CASE_ID_PROBLEM = 'Enter a valid registration case ID.'
export const CANDIDATE_PROBLEM = 'Select a candidate returned by this registration case.'
export const REASON_PROBLEM = 'Enter a review reason between 8 and 500 characters.'
export const ENROLL_PROBLEM = 'Enter a valid email and an enrollment reason between 8 and 500 characters.'
export const RESOLVE_FAILED = 'NIN verification could not be completed.'
export const CASE_FAILED = 'The registration case could not be loaded.'
export const REVIEW_FAILED = 'The case review could not be completed. Refresh the case before changing its decision.'
export const ENROLL_FAILED = 'Account enrollment could not be completed. The patient may already have an account.'
export const CREATED = 'NIN verification created a governed registration case. Review its status before continuing.'
export const CREATED_UNREAD = 'Case created. Reload its details before reviewing it.'
export const LINKED = 'The verified identity was linked to the selected patient.'
export const APPROVED = 'A new Health ID was approved.'
export const ENROLLED = 'A pending patient account was created. Contact ownership and password setup still require verification.'
export const REVIEW_NOTICE = 'A possible existing patient was found. Only a listed candidate may be linked. This API does not support overriding the match review to create a new identity.'
export const PENDING_NOTICE = 'Verification found no candidate. An authorized reviewer may approve a new Health ID.'
export const NO_CANDIDATES = 'Candidate details are unavailable. Refresh this case before reviewing it.'
export const ENROLL_TITLE = 'Enroll patient account'
export const ENROLL_INTRO = 'This creates a pending account for a patient who does not already have one. The email must belong to the patient; contact verification and password setup follow separately.'

/** "NIN verification is enabled in test mode." or why new cases cannot start here. */
export function capabilityLine(capabilities: RegistrationCapabilities): string {
  return capabilities.nin.enabled
    ? `NIN verification is enabled in ${capabilities.nin.state} mode.`
    : `NIN verification is ${capabilities.nin.state}. New cases cannot be started here until the backend enables a verification provider.`
}

/** "Version 3. 1 possible existing patient." */
export function versionLine(registrationCase: RegistrationCase): string {
  const count = registrationCase.candidateCount
  return `Version ${registrationCase.version}. ${count > 0 ? `${count} possible existing patient${count === 1 ? '' : 's'}.` : 'No possible existing patients reported.'}`
}

export function candidateDetails(candidate: { patientId: string; dateOfBirth: string | null }): string {
  return `Date of birth: ${candidate.dateOfBirth ?? 'Not provided'} · Patient ID: ${candidate.patientId}`
}

export function candidateOption(candidate: { fullName: string; dateOfBirth: string | null }): string {
  return `${candidate.fullName} · ${candidate.dateOfBirth ?? 'date unknown'}`
}

export function enrolledLine(hid: string): string {
  return `Pending account created for ${hid}. Contact verification is required.`
}
