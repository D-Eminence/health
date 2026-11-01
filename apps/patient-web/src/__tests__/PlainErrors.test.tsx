import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { HidApiError, PLAIN, PlainError } from '@hid/http'
import { FIELDS_REFUSED, FieldInputError, refusalSentences, refusalText, refusedFields } from '../staff/fieldProblem'
import { errorText, MODULE_NOT_IN_SERVICE } from '../ehr-blue/departments/parts/errors'
import { registrationErrorText } from '../staff/registrationFlow'
import { safeError } from '../ehr-blue/departments/registration/registrationText'
import { billingProblem } from '../staff/billing'
import { failureText, ACCESS_ENDED } from '../ehr-blue/clinical/parts/chart'
import { accessRequestsError } from '../staff/routes/AccessRequests'
import { closeError } from '../ehr-blue/clinical/consent/requests'
import { passwordRefusal } from '../ehr-blue/frame/auth/signInParts'
import { recoveryRefusal } from '../authSteps'
import { sendRefusal, withdrawRefusal, declineRefusal } from '../staff/orderRoutes'
import { labSendRefusal, releasedResultsRefusal, labHandoffOutcome } from '../ehr-blue/clinical/consult/orders/words'
import { releasedResultsRefusal as emergencyResultsRefusal } from '../ehr-blue/clinical/emergency/ReleasedResults'
import { roleInSentence, roleLabel, roleLabels } from '../staff/staffAccess'
import { usePatientResource } from '../routes/usePatientResource'

vi.mock('../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.test', turnstileSiteKey: null }) }))

/**
 * The owner's rule (1 Nov 2026): no internal detail reaches a patient or facility screen, and every error is plain
 * English. Each shared helper is given the worst a failure can carry, and none of it may come out.
 */
const SERVER_DETAIL = 'Cannot GET /api/v1/identity/me/emergency-contacts (identity-api, staff-web, CSRF validation failed)'
const CORRELATION = 'hid_web_3f2a9c1e-77aa-4c55-9d1e-0a1b2c3d4e5f'
const INTERNAL = /Cannot GET|\/api\/v1|identity-api|staff-web|patient-web|CSRF|hid_web_|3f2a9c1e|FORBIDDEN|VALIDATION_FAILED|LAB_[A-Z_]+|ORDER_ROUTE_[A-Z_]+|TypeError|Failed to fetch|Cannot read properties|undefined|expectedRowVersion|row version|must be a UUID|\b[45]\d\d\b|org_admin|lab_manager|identity\.[a-z.-]+\.(read|write)/

function hostile(status: number, code = 'FORBIDDEN'): HidApiError {
  return new HidApiError(status, SERVER_DETAIL, {
    code, detail: SERVER_DETAIL, requestId: CORRELATION,
    details: [{ field: 'expectedRowVersion', messages: ['expectedRowVersion must be a UUID', 'must not be less than 1'] }],
  })
}

const STATUSES = [0, 400, 401, 403, 404, 408, 409, 412, 422, 423, 429, 500, 502, 503, 504]
const JAVASCRIPT: unknown[] = [
  new TypeError('Failed to fetch'),
  new TypeError('Cannot read properties of undefined (reading \'id\')'),
  new SyntaxError('Unexpected token < in JSON at position 0'),
  new Error('"staff-web" may not call the "ocr" service (endpoint "ocr.jobs").'),
  'TypeError: undefined',
  undefined,
]
const EVERY_FAILURE: unknown[] = [
  ...STATUSES.map(status => hostile(status)),
  hostile(400, 'VALIDATION_FAILED'),
  hostile(409, 'LAB_ORDER_PATIENT_MISMATCH'),
  hostile(403, 'LAB_ACCESS_DENIED'),
  ...JAVASCRIPT,
]

function neverInternal(name: string, say: (caught: unknown) => string) {
  for (const caught of EVERY_FAILURE) {
    const text = say(caught)
    expect(text, `${name}: ${String(caught)}`).not.toMatch(INTERNAL)
    expect(text.trim(), `${name}: ${String(caught)}`).not.toBe('')
  }
}

describe('shared error helpers say every failure in plain English', () => {
  it('keeps server text, codes, status numbers, correlation ids and JavaScript messages off every screen', () => {
    neverInternal('refusalText', caught => refusalText(caught, 'We couldn’t save this. Try again.'))
    neverInternal('errorText', caught => errorText(caught, 'Work could not be loaded. Refresh to try again.'))
    neverInternal('registrationErrorText', caught => registrationErrorText(caught, 'We couldn’t check that NIN. Try again.'))
    neverInternal('safeError', caught => safeError(caught, 'We couldn’t open that registration.'))
    neverInternal('billingProblem', caught => { const read = billingProblem(caught, 'Your plan could not be loaded. Try again.'); return read.kind === 'error' ? read.message : 'unavailable' })
    neverInternal('failureText', caught => failureText(caught, 'We couldn’t send the request. Try again.'))
    neverInternal('accessRequestsError', accessRequestsError)
    neverInternal('closeError', closeError)
    neverInternal('passwordRefusal', passwordRefusal)
    neverInternal('recoveryRefusal', caught => recoveryRefusal(caught))
    neverInternal('sendRefusal', caught => sendRefusal(caught, 'lab_request', 'Yaba Diagnostics', 'Ada').text)
    neverInternal('withdrawRefusal', caught => withdrawRefusal(caught).text)
    neverInternal('declineRefusal', caught => declineRefusal(caught).text)
    neverInternal('labSendRefusal', caught => labSendRefusal(caught).text)
    neverInternal('releasedResultsRefusal', releasedResultsRefusal)
    neverInternal('emergency releasedResultsRefusal', emergencyResultsRefusal)
  })

  it('says the shared failures in the shared words, and keeps the page’s own words for the rest', () => {
    expect(refusalText(new TypeError('Failed to fetch'), 'We couldn’t save this.')).toBe(PLAIN.network)
    expect(refusalText(hostile(403), 'We couldn’t save this.')).toBe(PLAIN.noAccessFacility)
    expect(refusalText(hostile(503), 'We couldn’t save this.')).toBe(PLAIN.unavailable)
    expect(refusalText(hostile(422, 'SOMETHING_NEW'), 'We couldn’t save this.')).toBe('We couldn’t save this.')
    expect(refusalText(new TypeError('Cannot read properties of undefined'), 'We couldn’t save this.')).toBe('We couldn’t save this.')
    expect(errorText(hostile(404, 'API_ROUTE_NOT_FOUND'), 'x')).toBe(MODULE_NOT_IN_SERVICE)
    expect(errorText(hostile(503, 'LAB_SERVICE_AUTH_UNAVAILABLE'), 'x')).toBe('We couldn’t finish this just now. Wait a few seconds and try again.')
  })

  it('says a refused field at the field in plain words, never its internal name or the validator’s wording', () => {
    const refused = hostile(400, 'VALIDATION_FAILED')
    expect(refusalText(refused, 'x')).toBe(FIELDS_REFUSED)
    const [field] = refusedFields(refused)
    expect(field?.field).toBe('expectedRowVersion')
    expect(refusalSentences(field!)).toEqual(['Enter 1 or more.'])
    expect(refusalSentences({ field: 'title', messages: ['title must be shorter than or equal to 240 characters'] })).toEqual(['Use 240 characters or fewer.'])
    expect(refusalSentences({ field: 'healthId', messages: ['healthId must match /^HID-[A-Z0-9]{6}$/ regular expression'] })).toEqual(['Check this detail.'])
    expect(refusalSentences({ field: 'content', messages: [] })).toEqual(['Check this detail.'])
  })

  it('shows the words a page wrote for people on purpose, and no other error’s message', () => {
    expect(failureText(new PlainError(ACCESS_ENDED), 'x')).toBe(ACCESS_ENDED)
    expect(refusalText(new FieldInputError('dose', 'Enter the dose as a number.'), 'x')).toBe('Enter the dose as a number.')
    expect(sendRefusal(new PlainError('Reload the list before sending it.'), 'lab_request', 'Yaba', 'Ada').text).toBe('Reload the list before sending it.')
    expect(sendRefusal(new Error('This query parameter is not accepted in an address; send it in a request body.'), 'lab_request', 'Yaba', 'Ada').text)
      .not.toMatch(/query parameter|request body/)
  })

  it('never names a Lab code in a sentence', () => {
    const outcome = labHandoffOutcome({ state: 'failed', status: 409, code: 'LAB_ORDER_PATIENT_MISMATCH' } as never, 'activated', true)
    expect(outcome.text).not.toMatch(/LAB_|\(/)
    expect(outcome.text).toMatch(/didn’t accept it/)
    expect(releasedResultsRefusal(hostile(403, 'LAB_RESULT_FORBIDDEN'))).toBe('You can’t see this test’s results here.')
  })

  it('never shows a role’s internal key', () => {
    expect(roleLabel('lab_manager')).toBe('Staff')
    expect(roleLabels(['doctor', 'records_officer'])).toBe('Doctor, Staff')
    expect(roleInSentence('records_officer')).toBe('a member of staff')
  })
})

describe('usePatientResource', () => {
  it('says a failed page read in plain words, never the server’s', async () => {
    const { result } = renderHook(() => usePatientResource(async () => { throw hostile(404, 'NOT_FOUND') }, 'plain-404'))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toBe(PLAIN.notFound)
    expect(result.current.error).not.toMatch(INTERNAL)
  })

  it('says a JavaScript failure as the page’s own sentence', async () => {
    const { result } = renderHook(() => usePatientResource(async () => { throw new TypeError('Cannot read properties of undefined') }, 'plain-js'))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toBe('We couldn’t load this right now. Check your connection and try again.')
  })
})
