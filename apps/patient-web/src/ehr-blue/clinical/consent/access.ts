import { findEndpoint, isBlankHealthIdInput, isCompleteHealthId, type EndpointMethod } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { useCallback } from 'react'
import { usesNovuBackend } from '../../../backendContract'
import { isAllowedPatientLookup, staffApi, type Facility } from '../../../staff/api'
import { staffSessionGeneration, staffSessionSignal } from '../../../staff/session'
import { selfServiceReview } from '../../../staff/staffAccess'
import { useClinical } from '../parts/Workspace'

/**
 * Today's governed access rules for the blue EHR (staff/routes/Patients.tsx and AccessRequests.tsx), shared by the
 * Patients and External record access workspaces. Today's page keeps `actionUnavailable`, `whoToAsk`, the method routes
 * and the Health ID checks private, so they are restated here word for word; the permissions still come from the
 * contracts registry (`findEndpoint`), never from a list of our own.
 */

export const HID_FORMAT = 'Starts with HID-, then 6 to 32 letters and digits. Health IDs never use 0, 1, I or O.'
/** Patients.tsx:142, a lookup answered with anything but an allowed patient. */
export const NOT_GRANTED = 'Health ID has not granted access to this patient. Request approval, verify their PIN, or use documented emergency access when justified.'
export const CLOSE_REASON = 'Clinician closed completed patient access'
/** AccessRequests.tsx:96 and Patients.tsx:226, once a grant is closed. */
export const ACCESS_CLOSED = 'Access was closed.'

export type AccessMethod = 'request' | 'pin' | 'emergency'

interface MethodRoute { readonly route: string; readonly method: EndpointMethod; readonly purpose?: string }
export interface Action { readonly routes: readonly MethodRoute[]; readonly action: string }

/** Each backend route a method calls, whose every listed permission the role must hold (today's METHOD_ROUTES). */
export const METHOD_ROUTES: Readonly<Record<AccessMethod, Action>> = {
  request: { routes: [{ route: 'access.staffRequests', method: 'POST' }], action: 'send access requests' },
  pin: { routes: [{ route: 'access.verifyPin', method: 'POST' },
    { route: 'identity.patientLookup', method: 'POST', purpose: 'to open the record' }], action: 'verify a patient’s PIN' },
  emergency: { routes: [{ route: 'access.breakGlass', method: 'POST' },
    { route: 'identity.patientLookup', method: 'POST', purpose: 'to open the record' },
    { route: 'ehr.emergencyRecords', method: 'GET', purpose: 'to read the emergency summary' }], action: 'activate emergency access' },
}
export const CLOSE_GRANT: Action = { routes: [{ route: 'access.closeOwnGrant', method: 'POST' }], action: 'close this grant' }
export const OPEN_SHARED: Action = { routes: [{ route: 'identity.patientLookup', method: 'POST' }], action: 'open a patient’s record' }

export type Administrator = 'pending' | 'reviewed' | null

export function whoToAsk(administrator: Administrator): string {
  if (administrator === 'pending') return 'You are this facility’s administrator. Health ID support gives your own role '
    + 'clinical access when it checks your facility: add your licence on the Staff page.'
  if (administrator === 'reviewed') return 'You are this facility’s administrator. Health ID support gives your own role '
    + 'clinical access; ask them, or invite a colleague who holds this role.'
  return 'Ask your organization administrator.'
}

/** Why the role cannot take `action`, or null when it holds every permission its routes require. */
export function actionUnavailable({ routes, action }: Action, permissions: readonly string[], administrator: Administrator = null): string | null {
  const needs = routes.map(item => ({ ...item, required: findEndpoint(item.route)?.permissions?.[item.method] ?? [] }))
  if (needs.some(item => item.required.length === 0)) return `This portal cannot ${action} here.`
  const required = new Set(needs.flatMap(item => item.required))
  const missing = needs.flatMap(item => {
    const lacking = item.required.filter(permission => !permissions.includes(permission))
    return lacking.length ? [`${lacking.join(' and ')}${item.purpose ? ` ${item.purpose}` : ''}`] : []
  })
  const missingCount = [...required].filter(permission => !permissions.includes(permission)).length
  return missing.length === 0 ? null
    : `Your role at this facility cannot ${action}: it ${missingCount < required.size ? 'also ' : ''}needs ${missing.join(', and ')}. ${whoToAsk(administrator)}`
}

/** Whether the role holds every permission the registry lists for the route (today's SharedPatients `roleMay`). */
export function roleMay(route: string, method: EndpointMethod, permissions: readonly string[]): boolean {
  const required = findEndpoint(route)?.permissions?.[method] ?? []
  return required.length > 0 && required.every(permission => permissions.includes(permission))
}

/** The administrator of a self-signed-up facility (Novu), who holds workforce.manage there; null otherwise. */
export function administratorOf(facility: Facility | undefined, permissions: readonly string[]): Administrator {
  return usesNovuBackend() && permissions.includes('workforce.manage') ? selfServiceReview(facility) : null
}

/**
 * Why `normalized` is not a Health ID, or null when it is one (today's healthIdProblem). Every Health ID field starts
 * at HID- (HEALTH_ID_PREFIX) and is normalized as it changes, as today's are: with nothing after the prefix, it is empty.
 */
export function healthIdProblem(normalized: string): string | null {
  if (isBlankHealthIdInput(normalized)) return 'Enter the patient’s Health ID.'
  return isCompleteHealthId(normalized) ? null
    : 'Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.'
}

/** Whether a failed lookup is the patient refusing or being unknown to this facility (403, 404), not an outage. */
export function isRefusedLookup(caught: unknown): boolean {
  return (caught instanceof Error && caught.message === NOT_GRANTED)
    || (isHidApiError(caught) && (caught.status === 403 || caught.status === 404))
}

/**
 * Today's openPatient: the only way a chart opens. A patient lookup for this facility and purpose; a lookup that is
 * not allowed closes any open patient and throws NOT_GRANTED; an allowed one is opened in useStaff() memory only.
 * Answers setActivePatient's boolean: false when the session or facility changed meanwhile (nothing opened).
 */
export function useOpenPatient() {
  const { facility, setActivePatient } = useClinical()
  return useCallback(async (hid: string, purpose: 'direct-care' | 'emergency' = 'direct-care') => {
    if (!facility) throw new Error('Select an active facility first.')
    const lookup = await staffApi.lookupPatient(facility.id, hid, purpose)
    if (!isAllowedPatientLookup(lookup)) {
      setActivePatient(null)
      throw new Error(NOT_GRANTED)
    }
    return setActivePatient({ hid, lookup, purpose })
  }, [facility, setActivePatient])
}

/**
 * The Health ID handed from Patients to a record access form ("Request access", "Verify patient PIN", "Open consent"),
 * so it need not be typed again. It is held in this module's memory only (never in the URL, router state or browser
 * storage), only for the facility, staff session and staff period it was offered in. It is dropped once a form has
 * read it, as its session ends, and when it is read anywhere it does not belong.
 *
 * `period` marks the staff period (staff/App.tsx starts one at each sign-in, sign-out and facility choice): today's
 * `setActivePatient` is made anew for each period, so a Health ID offered before a facility switch is not read after
 * it, even back at the same facility. Pass the one `useClinical()` gives.
 */
let offered: { readonly hid: string; readonly facilityId: string; readonly generation: number; readonly period: unknown } | null = null

export function offerHealthId(hid: string, facilityId: string, period: unknown) {
  const entry = { hid, facilityId, generation: staffSessionGeneration(), period }
  offered = entry
  // Gone as the session ends (sign-out, expiry), whether or not a form read it.
  staffSessionSignal().addEventListener('abort', () => { if (offered === entry) offered = null }, { once: true })
}

/** The Health ID offered for this facility in this session and period, if any. One offered elsewhere is dropped. */
export function offeredHealthId(facilityId: string | undefined, period: unknown): string {
  const current = offered
  if (!current) return ''
  if (!facilityId || current.facilityId !== facilityId || current.generation !== staffSessionGeneration() || current.period !== period) {
    offered = null
    return ''
  }
  return current.hid
}

export function dropOfferedHealthId() {
  offered = null
}
