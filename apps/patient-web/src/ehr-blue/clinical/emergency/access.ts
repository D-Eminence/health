import { findEndpoint, isBlankHealthIdInput, isCompleteHealthId, type EndpointMethod } from '@hid/contracts'
import { isHidApiError } from '@hid/http'

/*
 * Today's emergency access rules and wording (staff/routes/Patients.tsx), word for word. Patients.tsx keeps them
 * module-local, so they are restated here until it exports them; the permissions still come from the contracts
 * registry (findEndpoint), as there.
 */

/** Patients.tsx:17, the Health ID field's hint. */
export const HID_FORMAT = 'Starts with HID-, then 6 to 32 letters and digits. Health IDs never use 0, 1, I or O.'

/** Patients.tsx:81-86: why a normalized Health ID cannot be sent, or null. */
export function healthIdProblem(normalized: string): string | null {
  if (isBlankHealthIdInput(normalized)) return 'Enter the patient’s Health ID.'
  return isCompleteHealthId(normalized) ? null
    : 'Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.'
}

/** Patients.tsx:169, the emergency reason refused before sending. */
export const REASON_TOO_SHORT = 'Say why in at least 8 characters.'
export const REASON_MIN = 8
/** Patients.tsx:243, the reason the server accepts at most (textarea maxLength 500). */
export const REASON_MAX = 500

/** Patients.tsx:243, the emergency notice, before and after the Novu sentence (Patients.tsx:46). */
export const NOTICE_WHEN = 'Only when the patient can’t consent and care can’t wait'
export const NOTICE_BEFORE = 'Emergency access lets you see the emergency summary without the patient’s approval. It ends by itself and every view is reviewed.'
export const EMERGENCY_CONTACTS_TOLD = 'The patient’s chosen emergency contacts are told your name, this facility and the time. They never see your reason or any medical details.'
export const NOTICE_AFTER = 'You see this facility’s finished visits, signed notes, diagnoses, prescriptions, lab requests and documents. You can’t change anything.'

export function emergencyNotice(novu: boolean): string {
  return novu ? `${NOTICE_BEFORE} ${EMERGENCY_CONTACTS_TOLD} ${NOTICE_AFTER}` : `${NOTICE_BEFORE} ${NOTICE_AFTER}`
}

/** Patients.tsx:142, a lookup answered with anything but an allowed patient. */
export const NOT_GRANTED = 'You don’t have access to this patient yet. Ask the patient, use their Access PIN, or use emergency access if it’s justified.'
export const COMMAND_FAILED = 'Something went wrong. Please try again.'
export const CLOSE_REASON = 'Clinician closed completed patient access'
export const ACCESS_CLOSED = 'Your access has ended.'
export const CLOSE_FAILED = 'Couldn’t end your access. Please try again.'
/** A close refused because the access had already ended (409 CONSENT_COMMAND_CONFLICT, 404 CONSENT_RESOURCE_NOT_FOUND). */
export const CLOSE_REFUSALS: Readonly<Record<string, string>> = {
  CONSENT_COMMAND_CONFLICT: 'This access had already ended.',
  CONSENT_RESOURCE_NOT_FOUND: 'This access had already ended.',
}

/**
 * The break-glass duration today's client sends (staff/api.ts breakGlass: durationMinutes 30). The design's
 * acknowledgement names the expiry, so it names this one.
 */
export const EMERGENCY_MINUTES = 30

/** Patients.tsx:184-204: today's words for the break-glass refusals it knows; null for any other (shown as sent). */
export function breakGlassRefusal(caught: unknown, facilityName: string): string | null {
  if (!isHidApiError(caught)) return null
  if (caught.status === 423 && caught.code === 'BREAK_GLASS_DISABLED') {
    return 'Emergency access is switched off right now, so the record was not opened. Ask Health ID support.'
  }
  if (caught.status === 429 && caught.code === 'EMERGENCY_PROBATION_LIMITED') {
    return `${facilityName} is new to Health ID: emergency access is limited to 5 times a day in its first `
      + '30 days. Contact Health ID support to lift the limit.'
  }
  if (caught.status === 400 && caught.code === 'INVALID_CONSENT_COMMAND') {
    return 'Emergency access isn’t set up for your facility, so the record was not opened. Contact support.'
  }
  return null
}

interface MethodRoute { readonly route: string; readonly method: EndpointMethod; readonly purpose?: string }
export interface AccessAction { readonly routes: readonly MethodRoute[]; readonly action: string }

/** Patients.tsx:36-38: the grant, the lookup that opens the record and the summary that record is. */
export const EMERGENCY_ACCESS: AccessAction = {
  routes: [{ route: 'access.breakGlass', method: 'POST' },
    { route: 'identity.patientLookup', method: 'POST', purpose: 'to open the record' },
    { route: 'ehr.emergencyRecords', method: 'GET', purpose: 'to read the emergency summary' }],
  action: 'activate emergency access',
}

/** Patients.tsx:48. */
export const CLOSE_GRANT: AccessAction = { routes: [{ route: 'access.closeOwnGrant', method: 'POST' }], action: 'end your access' }

export type Administrator = 'pending' | 'reviewed' | null

/** Patients.tsx:56-62. */
export function whoToAsk(administrator: Administrator): string {
  if (administrator === 'pending') return 'You are this facility’s administrator. Health ID support gives your own role '
    + 'clinical access when it checks your facility: add your licence on the Staff page.'
  if (administrator === 'reviewed') return 'You are this facility’s administrator. Health ID support gives your own role '
    + 'clinical access; ask them, or invite a colleague who holds this role.'
  return 'Ask your organization administrator.'
}

/** Patients.tsx:65-78: why the role cannot take `action`, or null when it holds every permission its routes need. (in plain words: never a permission's name). */
export function actionUnavailable({ routes, action }: AccessAction, permissions: readonly string[], administrator: Administrator = null): string | null {
  const needs = routes.map(item => ({ ...item, required: findEndpoint(item.route)?.permissions?.[item.method] ?? [] }))
  if (needs.some(item => item.required.length === 0)) return `You can’t ${action} here.`
  // Never the permission's own name (owner's rule, 1 Nov 2026): the role can't, and who to ask.
  const lacking = needs.some(item => item.required.some(permission => !permissions.includes(permission)))
  return lacking ? `Your role here can’t ${action}. ${whoToAsk(administrator)}` : null
}

/**
 * The design asked for an emergency reason and a clinical justification; the break-glass request carries one reason
 * (Identity keeps it with the access and its audit), so the form asks once. breakGlassReason stays for a caller with both.
 */
export const JUSTIFICATION_LABEL = 'Clinical justification: '
export const REASON_FIELD_MAX = 160
export const JUSTIFICATION_MAX = REASON_MAX - REASON_FIELD_MAX - JUSTIFICATION_LABEL.length - 1

export function breakGlassReason(reason: string, justification: string): string {
  return `${reason.trim()}\n${JUSTIFICATION_LABEL}${justification.trim()}`
}
