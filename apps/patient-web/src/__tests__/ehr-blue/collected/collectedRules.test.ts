import { describe, expect, it } from 'vitest'
import { emailAcceptable, NIGERIA_STATES, phoneE164 } from '../../../ehr-blue/collected/places'
import {
  emptyProfileForm, normalizeMdcn, profileFieldProblem, profileProblems, profileValues, type FacilityProfileForm,
} from '../../../ehr-blue/collected/facilityProfile'
import { deskProblems, deskValues, emptyDeskForm } from '../../../ehr-blue/collected/deskFields'

/* The rules of the collected sign-up fields (hid-system 0114, collect-fields-contract.md §1, §3, §5). Fictional values. */

const FILLED: FacilityProfileForm = {
  ...emptyProfileForm(), tradingName: ' Demo Clinic ', ownership: 'public', careLevel: 'primary', addressLine: '1 Example Road',
  city: 'Ikeja', stateCode: 'FC', lga: 'Abaji', gpsLatitude: '9.0', gpsLongitude: '7.4', phone: '(0803) 123-4567',
  email: ' Desk@Example.TEST ', bedCount: '0', operatingHours: 'Mon-Fri 8-5', emergency24h: 'no',
  departments: ['laboratory', 'general_outpatient'], servicesOffered: 'Clinic', smohLicenceNumber: 'FC/1', hasRegistryId: 'no',
  registryId: 'ignored when no', hasNhiaAccreditation: 'no', nhiaAccreditationNumber: '', medicalDirectorName: 'Dr Demo',
  medicalDirectorMdcn: ' mdcn  12345 ', expectedStaff: '1', migratingRecords: 'no', needsInteroperability: 'no',
}

describe('the phone rule', () => {
  it('takes + and 8 to 15 digits, ignoring spaces, dots, dashes and brackets, and reads a Nigerian local number as +234', () => {
    expect(phoneE164('0803 123 4567')).toBe('+2348031234567')
    expect(phoneE164('+44 (20) 7946.0000')).toBe('+442079460000')
    expect(phoneE164('8031234567')).toBeNull()
    expect(phoneE164('+1234567')).toBeNull()
    expect(phoneE164('+1234567890123456')).toBeNull()
  })

  it('refuses a number whose first digit after + is 0, as Identity does', () => {
    expect(phoneE164('+0803 123 4567')).toBeNull()
    expect(phoneE164('+08031234567')).toBeNull()
    expect(phoneE164('+2348031234567')).toBe('+2348031234567')
  })
})

describe('the email rule', () => {
  it('takes an address with a top-level domain, as Identity does', () => {
    expect(emailAcceptable(' desk@example.test ')).toBe(true)
    expect(emailAcceptable('first.last+desk@mail.example.ng')).toBe(true)
  })

  it('refuses a domain with no dot, a numeric or one-letter top level, and an empty word before the @', () => {
    expect(emailAcceptable('info@stmarys')).toBe(false)
    expect(emailAcceptable('info@example.1')).toBe(false)
    expect(emailAcceptable('info@example.c')).toBe(false)
    expect(emailAcceptable('first..last@example.test')).toBe(false)
    expect(emailAcceptable('.first@example.test')).toBe(false)
    expect(emailAcceptable('first.@example.test')).toBe(false)
    expect(emailAcceptable('info@-example.test')).toBe(false)
    expect(emailAcceptable('@example.test')).toBe(false)
    expect(emailAcceptable(`${'a'.repeat(65)}@example.test`)).toBe(false)
  })
})

describe('the states', () => {
  it('are the 37 codes Identity keeps, the FCT shown by both names and sent as FC', () => {
    expect(NIGERIA_STATES).toHaveLength(37)
    expect(new Set(NIGERIA_STATES.map(([code]) => code)).size).toBe(37)
    expect(NIGERIA_STATES.find(([code]) => code === 'FC')?.[1]).toBe('Federal Capital Territory (FCT)')
  })
})

describe('the facility profile', () => {
  it('needs every field, and finds nothing wrong once all are given', () => {
    expect(profileProblems(emptyProfileForm()).map(([field]) => field)).toEqual(['tradingName', 'ownership', 'careLevel',
      'addressLine', 'city', 'stateCode', 'lga', 'gpsLatitude', 'gpsLongitude', 'phone', 'email', 'bedCount', 'operatingHours',
      'emergency24h', 'departments', 'servicesOffered', 'smohLicenceNumber', 'hasRegistryId', 'hasNhiaAccreditation',
      'medicalDirectorName', 'medicalDirectorMdcn', 'expectedStaff', 'migratingRecords', 'needsInteroperability'])
    expect(profileProblems(FILLED)).toEqual([])
  })

  it('holds the numbers to their ranges and six decimal places', () => {
    expect(profileFieldProblem('gpsLatitude', { ...FILLED, gpsLatitude: '3.9' })).not.toBeNull()
    expect(profileFieldProblem('gpsLatitude', { ...FILLED, gpsLatitude: '6.1234567' })).not.toBeNull()
    expect(profileFieldProblem('gpsLongitude', { ...FILLED, gpsLongitude: '2.5' })).toBeNull()
    expect(profileFieldProblem('bedCount', { ...FILLED, bedCount: '1.5' })).not.toBeNull()
    expect(profileFieldProblem('expectedStaff', { ...FILLED, expectedStaff: '0' })).not.toBeNull()
  })

  it('sends the values as Identity takes them: trimmed, normalised, ordered, and no number for a "no"', () => {
    expect(normalizeMdcn(' mdcn  12345 ')).toBe('MDCN 12345')
    expect(profileValues(FILLED)).toMatchObject({ tradingName: 'Demo Clinic', phone: '+2348031234567', email: 'desk@example.test',
      gpsLatitude: 9, bedCount: 0, emergency24h: false, departments: ['general_outpatient', 'laboratory'], registryId: null,
      nhiaAccreditationNumber: null, medicalDirectorMdcn: 'MDCN 12345', expectedStaff: 1 })
  })
})

describe('the desk fields', () => {
  it('need the contact, and a Health ID in its format exactly when the patient says they have one', () => {
    expect(deskProblems(emptyDeskForm()).map(([field]) => field))
      .toEqual(['phone', 'addressLine', 'city', 'stateCode', 'lga', 'hasExistingHealthId'])
    const given = { phone: '08031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
      hasExistingHealthId: 'yes' as const, existingHealthId: 'hid-io1234' }
    expect(deskProblems(given).map(([field]) => field)).toEqual(['existingHealthId'])
    expect(deskValues({ ...given, existingHealthId: ' hid-abc234 ' }))
      .toEqual({ phone: '+2348031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
        hasExistingHealthId: true, existingHealthId: 'HID-ABC234' })
    expect(deskValues({ ...given, hasExistingHealthId: 'no' }).existingHealthId).toBeNull()
  })
})
