import { findEndpoint, isBlankHealthIdInput, isCompleteHealthId, type EndpointMethod } from '@hid/contracts'
import { isHidApiError, PlainError, plainErrorText } from '@hid/http'
import { useCallback } from 'react'
import { usesNovuBackend } from '../../../backendContract'
import { isAllowedPatientLookup, staffApi, type Facility } from '../../../staff/api'
import type { ActivePatient } from '../../../staff/App'
import { staffSessionGeneration, staffSessionSignal } from '../../../staff/session'
import { selfServiceReview } from '../../../staff/staffAccess'
import { opensInProduct, productOf } from '../../frame/product'
import { segmentOf } from '../parts/segments'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'

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
/** AccessRequests.tsx:100 and Patients.tsx:243, once a grant is closed. */
export const ACCESS_CLOSED = 'Access was closed.'
/** Patients.tsx:246, a close of the open record's grant that failed, whatever the reason (classic maps no code here). */
export const CLOSE_FAILED = 'Grant could not be closed.'
/**
 * An access step (a request, a PIN) that failed for a reason the page has no words of its own for. Not classic's
 * Patients.tsx:226 sentence: the coordinator's 2 Nov review reverted that wording (db9967ae, reverting d8379e1d) as
 * showing internal names on facility screens, and parity row 17g records this as the coordinator's choice. With it,
 * rows 9c and 22a count as done for their fallback.
 */
export const COMMAND_FAILED = 'Something went wrong. Please try again.'

export type AccessMethod = 'request' | 'pin' | 'emergency'

interface MethodRoute { readonly route: string; readonly method: EndpointMethod; readonly purpose?: string }
export interface Action { readonly routes: readonly MethodRoute[]; readonly action: string }

/**
 * Each backend route a method calls, whose every listed permission the role must hold (today's METHOD_ROUTES,
 * Patients.tsx:37-44), with today's action words for the request and the PIN. Emergency access keeps the plain words
 * the coordinator chose on 2 Nov.
 */
export const METHOD_ROUTES: Readonly<Record<AccessMethod, Action>> = {
  request: { routes: [{ route: 'access.staffRequests', method: 'POST' }], action: 'send access requests' },
  pin: { routes: [{ route: 'access.verifyPin', method: 'POST' },
    { route: 'identity.patientLookup', method: 'POST', purpose: 'to open the record' }], action: 'verify a patient’s PIN' },
  emergency: { routes: [{ route: 'access.breakGlass', method: 'POST' },
    { route: 'identity.patientLookup', method: 'POST', purpose: 'to open the record' },
    { route: 'ehr.emergencyRecords', method: 'GET', purpose: 'to read the emergency summary' }], action: 'open emergency access' },
}
/** Patients.tsx:53, closing the grant that opened the record. */
export const CLOSE_GRANT: Action = { routes: [{ route: 'access.closeOwnGrant', method: 'POST' }], action: 'close this grant' }
export const OPEN_SHARED: Action = { routes: [{ route: 'identity.patientLookup', method: 'POST' }], action: 'open a patient’s record' }

export type Administrator = 'pending' | 'reviewed' | null

export function whoToAsk(administrator: Administrator): string {
  if (administrator === 'pending') return 'You are this facility’s administrator. Health ID support gives your own role '
    + 'clinical access when it checks your facility: add your licence on the Staff page.'
  if (administrator === 'reviewed') return 'You are this facility’s administrator. Health ID support gives your own role '
    + 'clinical access; ask them, or invite a colleague who holds this role.'
  return 'Ask your facility administrator.'
}

/** Why the role cannot take `action`, or null when it holds every permission its routes require. (in plain words: never a permission's name). */
export function actionUnavailable({ routes, action }: Action, permissions: readonly string[], administrator: Administrator = null): string | null {
  const needs = routes.map(item => ({ ...item, required: findEndpoint(item.route)?.permissions?.[item.method] ?? [] }))
  if (needs.some(item => item.required.length === 0)) return `You can’t ${action} here.`
  // The permissions themselves are never named: the role is told, in plain words, what it can't do and whom to ask.
  return needs.every(item => item.required.every(permission => permissions.includes(permission))) ? null
    : `Your role at this facility can’t ${action}. ${whoToAsk(administrator)}`
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

/**
 * Whether a lookup's 403 means Health ID holds no grant for this member to read the patient: Identity refuses it with
 * ACCESS_DENIED (identity.service lookupPatient's ForbiddenException, coded by its problem filter); PATIENT_ACCESS_DENIED
 * is the same refusal by name. A missing permission (PERMISSION_DENIED), a membership not active here or a failed
 * security check is not about this patient, and keeps today's "ask your facility administrator".
 */
export function isNoGrant(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 403 && (caught.code === 'ACCESS_DENIED' || caught.code === 'PATIENT_ACCESS_DENIED')
}

/**
 * Said to a laboratory scientist or pharmacist whose lookup answered 404: Identity shows such a role a patient's record
 * only once the patient has given them access, so "not found" would mislead; the Health ID may also be wrong.
 */
export const NOT_OPEN_TO_ROLE = 'This patient’s record isn’t open to your role here. Check the Health ID, then ask the patient for access.'

/** The facility roles (Identity's role codes) that work only in the laboratory or the pharmacy. */
const DEPARTMENT_ROLES: ReadonlySet<string> = new Set(['lab', 'pharmacist'])

/**
 * What a refused lookup says: NOT_GRANTED (classic's sentence, which the refused-lookup panel shows word for word, parity
 * 13a) when Health ID holds no grant; NOT_OPEN_TO_ROLE for a lab or pharmacy role's 404; otherwise today's words, so "ask
 * your facility administrator" is said only for a refusal that is about the role, not the patient.
 */
export function lookupRefusal(caught: unknown, roles: readonly string[]): string {
  if ((caught instanceof Error && caught.message === NOT_GRANTED) || isNoGrant(caught)) return NOT_GRANTED
  if (isHidApiError(caught) && caught.status === 404 && roles.length > 0 && roles.every(role => DEPARTMENT_ROLES.has(role))) return NOT_OPEN_TO_ROLE
  return plainErrorText(caught, 'Patient access could not be verified.', { audience: 'facility' })
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
  return useCallback(async (hid: string, purpose: 'direct-care' | 'emergency' = 'direct-care', basis?: 'own-facility') => {
    if (!facility) throw new PlainError('Select an active facility first.')
    const lookup = await staffApi.lookupPatient(facility.id, hid, purpose)
    if (!isAllowedPatientLookup(lookup)) {
      setActivePatient(null)
      throw new PlainError(NOT_GRANTED)
    }
    return setActivePatient(basis ? { hid, lookup, purpose, basis } : { hid, lookup, purpose })
  }, [facility, setActivePatient])
}

/**
 * Where an opened patient lands. Direct care (Find, PIN success, a shared record's Open) lands on the patient's page for
 * every role, never straight on the chart: owner decision Q139 B (23 Nov 2026), "Find lands on the patient page with the
 * chart summary". That page shows the chart summary (EHR-C4) and keeps Start consultation and Open chart one click away.
 * This differs from today's openPatient, which sends an allowed lookup to /provider/clinical (Patients.tsx:149); parity
 * rows 9d, 13c and 13d follow the decision. The open record's card on Find a patient is not among them: it keeps
 * today's link to the chart (parity 3.3-1). Emergency access opens the read-only emergency summary where this site
 * opens Emergency, and the patient's page anywhere else.
 */
export function useOpenedPatientHref() {
  const { permissions, can } = useClinical()
  const href = useWorkspaceHref()
  return useCallback((purpose: ActivePatient['purpose']) => {
    if (purpose === 'emergency') {
      const product = productOf(window.location.hostname, permissions)
      return opensInProduct(product, segmentOf('emergency')) && can('identity.break-glass.write') ? href.to('emergency', 'summary') : href.to('patients', 'open')
    }
    return href.to('patients', 'open')
  }, [can, href, permissions])
}

/**
 * "Open as this facility’s patient" (hid-system 0131, ID-4): what it says, and its refusals in plain words. Doctors,
 * nurses and clinicians open a patient registered at this facility, or seen here with their consent in the last 24
 * months, for 24 hours without a PIN; the patient sees each opening in their access history.
 */
export const OWN_FACILITY_TITLE = 'Open as this facility’s patient'
export const OWN_FACILITY_HINT = 'If they registered here, or were seen here with their consent in the last 24 months. Opens for 24 hours.'
export const OWN_FACILITY_REFUSED = 'This patient can’t be opened as this facility’s patient. Use their Access PIN or ask the patient.'
export const OWN_FACILITY_ROLE = 'Your role at this facility can’t open patients this way. Use their Access PIN or ask the patient.'
/**
 * identity-api answers 404 PATIENT_NOT_FOUND here for no ACTIVE patient with the Health ID that this facility's seal
 * allows (0131 open_own_facility_patient: an inactive or merged patient, or a sealed demo or QA one), and the lookup just
 * before it found the patient: it never means the Health ID is unknown, so it offers no registration.
 */
export const OWN_FACILITY_NOT_FOUND = 'This patient can’t be opened here. Check the Health ID with the patient.'

/** The permission POST identity/own-facility-access needs, from the contracts registry; doctors, nurses and clinicians hold it. */
export function opensOwnFacility(permissions: readonly string[]): boolean {
  return roleMay('identity.ownFacilityAccess', 'POST', permissions)
}

/** What a refused "Open as this facility’s patient" says, or null for a failure that is not a refusal. */
export function ownFacilityRefusal(caught: unknown): string | null {
  if (!isHidApiError(caught) || caught.status !== 403) return null
  return caught.code === 'OWN_FACILITY_ACCESS_REFUSED' ? OWN_FACILITY_REFUSED : OWN_FACILITY_ROLE
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
