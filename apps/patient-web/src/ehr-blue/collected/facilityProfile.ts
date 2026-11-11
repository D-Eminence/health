import type { AdministratorRole, CareLevel, DepartmentCode, FacilityProfileValues, Ownership } from '../../staff/api'
import { EMAIL_REFUSED, emailAcceptable, isStateCode, PHONE_REFUSED, phoneE164, REQUIRED, stateName, textProblem } from './places'

export type { AdministratorRole, CareLevel, DepartmentCode, FacilityProfileValues, Ownership }

/** The choices' codes as Identity takes them, with their words. */
export const OWNERSHIP: ReadonlyArray<readonly [Ownership, string]> = [
  ['public', 'Public'], ['private', 'Private'], ['faith_based', 'Faith-based'], ['ngo', 'NGO'],
]
export const CARE_LEVELS: ReadonlyArray<readonly [CareLevel, string]> = [
  ['primary', 'Primary'], ['secondary', 'Secondary'], ['tertiary', 'Tertiary'],
]
/** The design's departments, in its order (src/model.ts:349-365), as Identity's codes (contract §6). */
export const DEPARTMENTS: ReadonlyArray<readonly [DepartmentCode, string]> = [
  ['general_outpatient', 'General Outpatient'], ['emergency', 'Emergency'], ['inpatient', 'Inpatient'],
  ['laboratory', 'Laboratory'], ['pharmacy', 'Pharmacy'], ['maternity', 'Maternity'], ['pediatrics', 'Pediatrics'],
  ['radiology', 'Radiology'], ['dental', 'Dental'], ['physiotherapy', 'Physiotherapy'], ['dialysis', 'Dialysis'],
  ['oncology', 'Oncology'], ['cardiology', 'Cardiology'], ['icu', 'ICU'], ['theatre', 'Theatre'],
]
/** The sign-up's "Role at the facility" (administratorRole). */
export const ADMINISTRATOR_ROLES: ReadonlyArray<readonly [AdministratorRole, string]> = [
  ['owner', 'Owner'], ['medical_director', 'Medical Director'], ['administrator', 'Administrator'],
  ['other_authorised_representative', 'Other authorised representative'],
]

/** A yes or no question as a form holds it: not answered yet, yes or no. */
export type YesNo = '' | 'yes' | 'no'

/** The form's values as typed: text everywhere, so nothing is guessed before it is checked. */
export interface FacilityProfileForm {
  tradingName: string
  ownership: Ownership | ''
  careLevel: CareLevel | ''
  addressLine: string
  city: string
  stateCode: string
  lga: string
  gpsLatitude: string
  gpsLongitude: string
  phone: string
  email: string
  bedCount: string
  operatingHours: string
  emergency24h: YesNo
  departments: readonly DepartmentCode[]
  servicesOffered: string
  smohLicenceNumber: string
  hasRegistryId: YesNo
  registryId: string
  hasNhiaAccreditation: YesNo
  nhiaAccreditationNumber: string
  medicalDirectorName: string
  medicalDirectorMdcn: string
  expectedStaff: string
  migratingRecords: YesNo
  needsInteroperability: YesNo
}
export type ProfileField = keyof FacilityProfileForm

export function emptyProfileForm(): FacilityProfileForm {
  return {
    tradingName: '', ownership: '', careLevel: '', addressLine: '', city: '', stateCode: '', lga: '', gpsLatitude: '',
    gpsLongitude: '', phone: '', email: '', bedCount: '', operatingHours: '', emergency24h: '', departments: [],
    servicesOffered: '', smohLicenceNumber: '', hasRegistryId: '', registryId: '', hasNhiaAccreditation: '',
    nhiaAccreditationNumber: '', medicalDirectorName: '', medicalDirectorMdcn: '', expectedStaff: '', migratingRecords: '',
    needsInteroperability: '',
  }
}

/** The sign-up's "Facility details" step (2 of 5), in the order shown. */
export const FACILITY_DETAILS_FIELDS: readonly ProfileField[] = ['tradingName', 'ownership', 'careLevel', 'addressLine', 'city',
  'stateCode', 'lga', 'gpsLatitude', 'gpsLongitude', 'phone', 'email', 'bedCount', 'operatingHours', 'emergency24h',
  'departments', 'servicesOffered']
/** The sign-up's "Regulatory identity" step (3 of 5), beside the CAC number. */
export const REGULATORY_FIELDS: readonly ProfileField[] = ['smohLicenceNumber', 'hasRegistryId', 'registryId',
  'hasNhiaAccreditation', 'nhiaAccreditationNumber', 'medicalDirectorName', 'medicalDirectorMdcn']
/** The sign-up's "Platform setup" step (4 of 5), beside the product. */
export const PLATFORM_FIELDS: readonly ProfileField[] = ['expectedStaff', 'migratingRecords', 'needsInteroperability']
/** Every field, in the order Facility setup shows them. */
export const ALL_PROFILE_FIELDS: readonly ProfileField[] = [...FACILITY_DETAILS_FIELDS, ...REGULATORY_FIELDS, ...PLATFORM_FIELDS]

export const PROFILE_LABELS: Readonly<Record<ProfileField, string>> = {
  tradingName: 'Facility name (the name people use)',
  ownership: 'Ownership',
  careLevel: 'Level of care',
  addressLine: 'Address',
  city: 'City or town',
  stateCode: 'State',
  lga: 'Local government area',
  gpsLatitude: 'GPS latitude',
  gpsLongitude: 'GPS longitude',
  phone: 'Facility phone',
  email: 'Facility email',
  bedCount: 'Bed count',
  operatingHours: 'Operating hours',
  emergency24h: '24-hour emergency',
  departments: 'Departments',
  servicesOffered: 'Services offered',
  smohLicenceNumber: 'State Ministry of Health licence number',
  hasRegistryId: 'Does the facility have a national facility registry ID?',
  registryId: 'National facility registry ID',
  hasNhiaAccreditation: 'Is the facility accredited by the NHIA?',
  nhiaAccreditationNumber: 'NHIA accreditation number',
  medicalDirectorName: 'Medical Director’s full name',
  medicalDirectorMdcn: 'Medical Director’s MDCN number',
  expectedStaff: 'Expected number of staff',
  migratingRecords: 'Will you bring records from an older system?',
  needsInteroperability: 'Do you need to exchange records with other systems?',
}

/** A hint under a field, where its rule is not plain from its label. */
export const PROFILE_HINTS: Partial<Record<ProfileField, string>> = {
  tradingName: 'Your registered name comes from your CAC record. Enter the name patients know you by, even if it is the same.',
  addressLine: 'Where the facility is. Health ID’s public directory keeps showing your CAC address.',
  lga: 'Type it as it is written, for example Ikeja.',
  gpsLatitude: 'Between 4 and 14, for example 6.524379.',
  gpsLongitude: 'Between 2.5 and 15, for example 3.379206.',
  phone: 'For example 0803 123 4567 or +234 803 123 4567.',
  operatingHours: 'For example Mon-Sun 24 hours.',
  departments: 'Choose every department you run. This does not create them in Health ID.',
  medicalDirectorMdcn: 'For example MDCN/12345.',
}

const MDCN = /^[A-Z0-9][A-Z0-9/. -]{1,98}[A-Z0-9]$/

/** The MDCN number as Identity checks it: capitals, with runs of spaces made one. */
export function normalizeMdcn(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ')
}

function decimal(value: string, min: number, max: number): number | null {
  const text = value.trim()
  if (!/^-?\d+(\.\d{1,6})?$/.test(text)) return null
  const number = Number(text)
  return number >= min && number <= max ? number : null
}

function whole(value: string, min: number, max: number): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const number = Number(text)
  return number >= min && number <= max ? number : null
}

/** What is wrong with one field, in plain words, or null. */
export function profileFieldProblem(field: ProfileField, form: FacilityProfileForm): string | null {
  switch (field) {
    case 'tradingName': return textProblem(form.tradingName, 2, 200)
    case 'ownership': return form.ownership ? null : 'Choose who owns the facility.'
    case 'careLevel': return form.careLevel ? null : 'Choose the level of care.'
    case 'addressLine': return textProblem(form.addressLine, 5, 300)
    case 'city': return textProblem(form.city, 2, 100)
    case 'stateCode': return isStateCode(form.stateCode) ? null : 'Choose the state.'
    case 'lga': return textProblem(form.lga, 2, 100)
    case 'gpsLatitude':
      if (!form.gpsLatitude.trim()) return REQUIRED
      return decimal(form.gpsLatitude, 4, 14) === null ? 'Enter a latitude between 4 and 14, with up to six decimal places.' : null
    case 'gpsLongitude':
      if (!form.gpsLongitude.trim()) return REQUIRED
      return decimal(form.gpsLongitude, 2.5, 15) === null ? 'Enter a longitude between 2.5 and 15, with up to six decimal places.' : null
    case 'phone':
      if (!form.phone.trim()) return REQUIRED
      return phoneE164(form.phone) ? null : PHONE_REFUSED
    case 'email':
      if (!form.email.trim()) return REQUIRED
      return emailAcceptable(form.email) ? null : EMAIL_REFUSED
    case 'bedCount':
      if (!form.bedCount.trim()) return REQUIRED
      return whole(form.bedCount, 0, 100000) === null ? 'Enter a whole number from 0 to 100000.' : null
    case 'operatingHours': return textProblem(form.operatingHours, 2, 200)
    case 'emergency24h': return form.emergency24h ? null : 'Choose yes or no.'
    case 'departments': return form.departments.length ? null : 'Choose at least one department.'
    case 'servicesOffered': return textProblem(form.servicesOffered, 2, 2000)
    case 'smohLicenceNumber': return textProblem(form.smohLicenceNumber, 2, 100)
    case 'hasRegistryId': return form.hasRegistryId ? null : 'Choose yes or no.'
    case 'registryId': return form.hasRegistryId === 'yes' ? textProblem(form.registryId, 2, 100) : null
    case 'hasNhiaAccreditation': return form.hasNhiaAccreditation ? null : 'Choose yes or no.'
    case 'nhiaAccreditationNumber': return form.hasNhiaAccreditation === 'yes' ? textProblem(form.nhiaAccreditationNumber, 2, 100) : null
    case 'medicalDirectorName': return textProblem(form.medicalDirectorName, 2, 200)
    case 'medicalDirectorMdcn':
      if (!form.medicalDirectorMdcn.trim()) return REQUIRED
      return MDCN.test(normalizeMdcn(form.medicalDirectorMdcn)) ? null
        : 'Enter the MDCN number as it is written, using letters, digits, /, . or -, for example MDCN/12345.'
    case 'expectedStaff':
      if (!form.expectedStaff.trim()) return REQUIRED
      return whole(form.expectedStaff, 1, 100000) === null ? 'Enter a whole number from 1 to 100000.' : null
    case 'migratingRecords': return form.migratingRecords ? null : 'Choose yes or no.'
    case 'needsInteroperability': return form.needsInteroperability ? null : 'Choose yes or no.'
  }
}

/** Whether a field is shown: a registry ID or NHIA number only once the facility says it has one. */
export function profileFieldShown(field: ProfileField, form: FacilityProfileForm): boolean {
  if (field === 'registryId') return form.hasRegistryId === 'yes'
  if (field === 'nhiaAccreditationNumber') return form.hasNhiaAccreditation === 'yes'
  return true
}

/** Each listed field's problem, in the order listed. */
export function profileProblems(form: FacilityProfileForm, fields: readonly ProfileField[] = ALL_PROFILE_FIELDS)
  : Array<readonly [ProfileField, string]> {
  const found: Array<readonly [ProfileField, string]> = []
  for (const field of fields) {
    const problem = profileFieldProblem(field, form)
    if (problem) found.push([field, problem])
  }
  return found
}

/** The profile as Identity takes it. Only call once profileProblems finds nothing. */
export function profileValues(form: FacilityProfileForm): FacilityProfileValues {
  const yes = (value: YesNo) => value === 'yes'
  return {
    tradingName: form.tradingName.trim(),
    ownership: form.ownership as Ownership,
    careLevel: form.careLevel as CareLevel,
    addressLine: form.addressLine.trim(),
    city: form.city.trim(),
    stateCode: form.stateCode,
    lga: form.lga.trim(),
    gpsLatitude: Number(form.gpsLatitude.trim()),
    gpsLongitude: Number(form.gpsLongitude.trim()),
    phone: phoneE164(form.phone) ?? form.phone.trim(),
    email: form.email.trim().toLowerCase(),
    bedCount: Number(form.bedCount.trim()),
    operatingHours: form.operatingHours.trim(),
    emergency24h: yes(form.emergency24h),
    departments: DEPARTMENTS.map(([code]) => code).filter(code => form.departments.includes(code)),
    servicesOffered: form.servicesOffered.trim(),
    smohLicenceNumber: form.smohLicenceNumber.trim(),
    hasRegistryId: yes(form.hasRegistryId),
    registryId: yes(form.hasRegistryId) ? form.registryId.trim() : null,
    hasNhiaAccreditation: yes(form.hasNhiaAccreditation),
    nhiaAccreditationNumber: yes(form.hasNhiaAccreditation) ? form.nhiaAccreditationNumber.trim() : null,
    medicalDirectorName: form.medicalDirectorName.trim(),
    medicalDirectorMdcn: normalizeMdcn(form.medicalDirectorMdcn),
    expectedStaff: Number(form.expectedStaff.trim()),
    migratingRecords: yes(form.migratingRecords),
    needsInteroperability: yes(form.needsInteroperability),
  }
}

/** A saved profile back in the form, to change it. */
export function profileForm(values: FacilityProfileValues): FacilityProfileForm {
  const yesNo = (value: boolean): YesNo => (value ? 'yes' : 'no')
  return {
    tradingName: values.tradingName,
    ownership: values.ownership,
    careLevel: values.careLevel,
    addressLine: values.addressLine,
    city: values.city,
    stateCode: values.stateCode,
    lga: values.lga,
    gpsLatitude: String(values.gpsLatitude),
    gpsLongitude: String(values.gpsLongitude),
    phone: values.phone,
    email: values.email,
    bedCount: String(values.bedCount),
    operatingHours: values.operatingHours,
    emergency24h: yesNo(values.emergency24h),
    departments: values.departments,
    servicesOffered: values.servicesOffered,
    smohLicenceNumber: values.smohLicenceNumber,
    hasRegistryId: yesNo(values.hasRegistryId),
    registryId: values.registryId ?? '',
    hasNhiaAccreditation: yesNo(values.hasNhiaAccreditation),
    nhiaAccreditationNumber: values.nhiaAccreditationNumber ?? '',
    medicalDirectorName: values.medicalDirectorName,
    medicalDirectorMdcn: values.medicalDirectorMdcn,
    expectedStaff: String(values.expectedStaff),
    migratingRecords: yesNo(values.migratingRecords),
    needsInteroperability: yesNo(values.needsInteroperability),
  }
}

function label(list: ReadonlyArray<readonly [string, string]>, code: string): string {
  return list.find(([candidate]) => candidate === code)?.[1] ?? code
}

export function departmentNames(codes: readonly string[]): string {
  return DEPARTMENTS.filter(([code]) => codes.includes(code)).map(([, name]) => name).join(', ')
}

export function administratorRoleName(code: string): string {
  return label(ADMINISTRATOR_ROLES, code)
}

/** Each field as a review lists it: its label and its value in words. Fields not shown (a "no" answer's number) are left out. */
export function profileRows(form: FacilityProfileForm, fields: readonly ProfileField[] = ALL_PROFILE_FIELDS)
  : Array<readonly [string, string]> {
  const yesNo = (value: YesNo) => (value === 'yes' ? 'Yes' : value === 'no' ? 'No' : '')
  const words = (field: ProfileField): string => {
    switch (field) {
      case 'ownership': return label(OWNERSHIP, form.ownership)
      case 'careLevel': return label(CARE_LEVELS, form.careLevel)
      case 'stateCode': return form.stateCode ? stateName(form.stateCode) : ''
      case 'phone': return phoneE164(form.phone) ?? form.phone.trim()
      case 'email': return form.email.trim().toLowerCase()
      case 'departments': return departmentNames(form.departments)
      case 'medicalDirectorMdcn': return normalizeMdcn(form.medicalDirectorMdcn)
      case 'emergency24h': case 'hasRegistryId': case 'hasNhiaAccreditation': case 'migratingRecords':
      case 'needsInteroperability': return yesNo(form[field])
      default: return String(form[field]).trim()
    }
  }
  return fields.filter(field => profileFieldShown(field, form)).map(field => [PROFILE_LABELS[field], words(field)] as const)
}
