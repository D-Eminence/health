import { describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import {
  REFUSALS, changeLines, dueDateProblem, monthText, notServed, occurredMoment, occurredProblem, patientFromState, patientLinkLine,
  placeText, recentMonths, refusalWords, toldRequired,
} from '../../../../ehr-blue/departments/quality/qualityRules'
import { qualityResolutionOf } from '../../../../staff/api'
import { LISTS, OWN, REVIEWER } from './qualityFixtures'

/*
 * Quality & Safety's plain words and rules (hid-system QUAL-1): Lagos days and times whatever the device's zone, the
 * form's limits as route 2 checks them, the refusals in the contract's own words (never "permission"), and history that
 * never names a patient. Every id here is fictional.
 */
const lists = LISTS as unknown as Parameters<typeof changeLines>[1]

describe('Lagos days and times', () => {
  it('reads a Lagos day and time typed on the form as the moment it names (UTC+1 all year)', () => {
    expect(occurredMoment('2026-12-03', '09:10')).toBe('2026-12-03T08:10:00.000Z')
    expect(occurredMoment('2026-12-03', '00:30')).toBe('2026-12-02T23:30:00.000Z')
    expect(occurredMoment('2026-02-30', '09:10')).toBeNull()
    expect(occurredMoment('2026-12-03', '25:00')).toBeNull()
    expect(occurredMoment('', '09:10')).toBeNull()
  })

  it('takes a time up to a year ago and up to two minutes ahead, as route 2 does', () => {
    const now = new Date('2026-12-03T10:00:00.000Z')
    expect(occurredProblem('2026-12-03T10:01:59.000Z', now)).toBe('')
    expect(occurredProblem('2026-12-03T10:02:01.000Z', now)).toBe(REFUSALS.QUALITY_TIME_INVALID)
    expect(occurredProblem('2025-12-04T10:00:00.000Z', now)).toBe('')
    expect(occurredProblem('2025-12-03T09:59:00.000Z', now)).toBe(REFUSALS.QUALITY_TIME_INVALID)
    expect(occurredProblem(null, now)).toBe('Enter the day and the time it happened.')
  })

  it('takes a due date from today to a year ahead, in Lagos days', () => {
    // 23:30 UTC on 2 Dec is already 3 Dec in Lagos.
    const now = new Date('2026-12-02T23:30:00.000Z')
    expect(dueDateProblem('2026-12-03', now)).toBe('')
    expect(dueDateProblem('2026-12-02', now)).toBe(REFUSALS.QUALITY_DUE_DATE_INVALID)
    expect(dueDateProblem('2027-12-03', now)).toBe('')
    expect(dueDateProblem('2027-12-04', now)).toBe(REFUSALS.QUALITY_DUE_DATE_INVALID)
  })

  it('names the months of the counts in words, newest first, from the Lagos month', () => {
    expect(monthText('2026-12')).toBe('Dec 2026')
    expect(recentMonths(new Date('2026-12-31T23:30:00.000Z'), 3)).toEqual(['2027-01', '2026-12', '2026-11'])
    expect(recentMonths(new Date('2026-01-15T10:00:00.000Z'), 2)).toEqual(['2026-01', '2025-12'])
  })
})

describe('the form and the card', () => {
  it('asks "patient or family told" for moderate harm, severe harm and death', () => {
    expect(['near_miss', 'no_harm', 'mild', 'moderate', 'severe', 'death'].filter(level => toldRequired(level, lists)))
      .toEqual(['moderate', 'severe', 'death'])
    // Without the list, the DRAFT rule (Q252 A).
    expect(toldRequired('severe')).toBe(true)
    expect(toldRequired('mild')).toBe(false)
  })

  it('says where it happened from the department, the place in words, or both', () => {
    expect(placeText({ departmentCode: 'pharmacy', locationText: 'Counter 2' })).toBe('Pharmacy: Counter 2')
    expect(placeText({ departmentCode: null, locationText: 'Car park' })).toBe('Car park')
    expect(placeText({ departmentCode: 'general_outpatient', locationText: null })).toBe('General Outpatient')
  })

  it('takes the patient only from a page state with a UUID and a name', () => {
    expect(patientFromState({ qualityPatient: { patientId: 'B0000000-0000-4000-8000-0000000000F1', name: ' Tunde Fictional ' } }))
      .toEqual({ patientId: 'b0000000-0000-4000-8000-0000000000f1', name: 'Tunde Fictional' })
    expect(patientFromState({ qualityPatient: { patientId: 'HID-BBBB33', name: 'Tunde Fictional' } })).toBeNull()
    expect(patientFromState(null)).toBeNull()
  })

  it('reads the resolution whether it comes as an object or its text alone', () => {
    expect(qualityResolutionOf({ resolution: null })).toBeNull()
    expect(qualityResolutionOf({ resolution: 'Shelves separated (fictional).' }))
      .toEqual({ text: 'Shelves separated (fictional).', at: null, byMembershipId: null })
    expect(qualityResolutionOf({ resolution: { resolution: 'Done (fictional).', recordedAt: '2026-12-03T10:00:00.000Z', recordedByMembershipId: OWN } }))
      .toEqual({ text: 'Done (fictional).', at: '2026-12-03T10:00:00.000Z', byMembershipId: OWN })
  })
})

describe('history', () => {
  const names = new Map([[REVIEWER, 'Chidi Reviewer']])
  it('says coded changes in words and names staff, never by id', () => {
    expect(changeLines({ kind: 'corrected', at: '2026-12-03T10:00:00.000Z', changes: {
      harmLevel: { from: 'no_harm', to: 'moderate' }, departmentCode: { from: 'pharmacy', to: null },
      patientOrFamilyTold: { from: null, to: 'yes' }, reviewerMembershipId: { from: OWN, to: REVIEWER } } }, lists, OWN, names))
      .toEqual(['Harm: No harm to Moderate harm', 'Department: Pharmacy to none', 'Patient or family told: none to Yes', 'Reviewer: You to Chidi Reviewer'])
  })

  it('says only that a patient link was set, changed or cleared, never who', () => {
    const at = '2026-12-03T10:00:00.000Z'
    expect(changeLines({ kind: 'patient_link_changed', at, changes: { patientId: { from: 'x', to: 'y' } } }, lists, OWN, names)).toEqual([])
    expect(patientLinkLine({ kind: 'patient_linked', at })).toBe('A patient was linked.')
    expect(patientLinkLine({ kind: 'patient_link_changed', at, changes: { patientLinked: { from: true, to: false } } })).toBe('The patient link was cleared.')
    expect(patientLinkLine({ kind: 'patient_link_changed', at, changes: { patientLinked: { from: true, to: true } } })).toBe('The linked patient was changed.')
  })
})

describe('refusals', () => {
  const refusal = (status: number, code: string) => new HidApiError(status, 'Refused', { code, retryable: false })

  it('takes 503 QUALITY_NOT_AVAILABLE and a 404 that is not its own as not switched on yet', () => {
    expect(notServed(refusal(503, 'QUALITY_NOT_AVAILABLE'))).toBe(true)
    expect(notServed(refusal(404, 'NOT_FOUND'))).toBe(true)
    expect(notServed(refusal(404, 'QUALITY_INCIDENT_NOT_FOUND'))).toBe(false)
    expect(notServed(refusal(503, 'SERVICE_UNAVAILABLE'))).toBe(false)
  })

  it('says every refusal in the contract’s words, and a guard’s 403 without the guard’s word', () => {
    expect(refusalWords(refusal(403, 'PERMISSION_DENIED'), 'fallback')).toBe('Only staff of this facility can report incidents.')
    expect(refusalWords(refusal(412, 'QUALITY_VERSION_CONFLICT'), 'fallback')).toBe('Someone else changed this incident. Reload it and try again.')
    expect(refusalWords(refusal(409, 'QUALITY_ACTIONS_OPEN'), 'fallback')).toBe('Mark every corrective action done or cancelled before resolving.')
    expect(refusalWords(refusal(400, 'VALIDATION_FAILED'), 'fallback', 'Check the dates.')).toBe('Check the dates.')
    for (const words of Object.values(REFUSALS)) expect(words).not.toMatch(/permission/i)
  })
})
