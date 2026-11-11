import type { ResolveNinInput } from '../../staff/api'
import { isStateCode, PHONE_REFUSED, phoneE164, REQUIRED, textProblem } from './places'

/**
 * The patient's contact as a registration desk takes it, and the Health ID they say they already have (hid-system
 * 0114, collect-fields-contract.md §3), sent with the NIN check (`nin/resolve`) by every screen that makes one: the
 * blue Registration page, the classic one, and a pharmacy's or laboratory's new Health ID. All required (owner: "all
 * fields required"). The facility keeps them as unverified: they are never used for sign-in or recovery, and Identity
 * never returns them. Allergies are left to clinical records and "provisional local identity" is off, so neither is
 * asked here.
 */
export interface DeskForm {
  phone: string
  addressLine: string
  city: string
  stateCode: string
  lga: string
  hasExistingHealthId: '' | 'yes' | 'no'
  existingHealthId: string
}
export type DeskField = keyof DeskForm

/** The form's control names, which FormData reads (deskFormFrom). */
export const DESK_FIELDS: readonly DeskField[] = ['phone', 'addressLine', 'city', 'stateCode', 'lga', 'hasExistingHealthId',
  'existingHealthId']

export const DESK_LABELS: Readonly<Record<DeskField, string>> = {
  phone: 'Phone',
  addressLine: 'Address',
  city: 'City or town',
  stateCode: 'State',
  lga: 'Local government area',
  hasExistingHealthId: 'Does the patient already have a Health ID?',
  existingHealthId: 'Existing Health ID',
}

export const DESK_HINTS: Partial<Record<DeskField, string>> = {
  phone: 'Kept by this facility to reach the patient. It is not used to sign in.',
  addressLine: 'Kept by this facility. It is not checked.',
  existingHealthId: 'Starts with HID-, for example HID-ABC234. Health IDs never use 0, 1, I or O.',
}

export function emptyDeskForm(): DeskForm {
  return { phone: '', addressLine: '', city: '', stateCode: '', lga: '', hasExistingHealthId: '', existingHealthId: '' }
}

const HID = /^HID-[A-HJ-NP-Z2-9]{6,32}$/

/** A Health ID as Identity checks it: trimmed and in capitals. */
export function normalizeHealthId(value: string): string {
  return value.trim().toUpperCase()
}

export function deskFieldShown(field: DeskField, form: DeskForm): boolean {
  return field !== 'existingHealthId' || form.hasExistingHealthId === 'yes'
}

export function deskFieldProblem(field: DeskField, form: DeskForm): string | null {
  switch (field) {
    case 'phone':
      if (!form.phone.trim()) return REQUIRED
      return phoneE164(form.phone) ? null : PHONE_REFUSED
    case 'addressLine': return textProblem(form.addressLine, 5, 300)
    case 'city': return textProblem(form.city, 2, 100)
    case 'stateCode': return isStateCode(form.stateCode) ? null : 'Choose the state.'
    case 'lga': return textProblem(form.lga, 2, 100)
    case 'hasExistingHealthId': return form.hasExistingHealthId ? null : 'Choose yes or no.'
    case 'existingHealthId':
      if (form.hasExistingHealthId !== 'yes') return null
      if (!form.existingHealthId.trim()) return REQUIRED
      return HID.test(normalizeHealthId(form.existingHealthId)) ? null
        : 'Enter the Health ID as written: HID-, then 6 to 32 letters and digits.'
  }
}

/** Each field's problem, in the form's order. */
export function deskProblems(form: DeskForm): Array<readonly [DeskField, string]> {
  const found: Array<readonly [DeskField, string]> = []
  for (const field of DESK_FIELDS) {
    const problem = deskFieldProblem(field, form)
    if (problem) found.push([field, problem])
  }
  return found
}

type DeskValues = Pick<ResolveNinInput, 'phone' | 'addressLine' | 'city' | 'stateCode' | 'lga' | 'hasExistingHealthId'
  | 'existingHealthId'>

/** The fields as the NIN check sends them. Only call once deskProblems finds nothing. */
export function deskValues(form: DeskForm): DeskValues {
  const has = form.hasExistingHealthId === 'yes'
  return {
    phone: phoneE164(form.phone) ?? form.phone.trim(),
    addressLine: form.addressLine.trim(),
    city: form.city.trim(),
    stateCode: form.stateCode,
    lga: form.lga.trim(),
    hasExistingHealthId: has,
    existingHealthId: has ? normalizeHealthId(form.existingHealthId) : null,
  }
}

/** The fields from a form's controls, by their names (DESK_FIELDS). */
export function deskFormFrom(data: FormData): DeskForm {
  const text = (name: DeskField) => String(data.get(name) ?? '')
  const has = text('hasExistingHealthId')
  return {
    phone: text('phone'), addressLine: text('addressLine'), city: text('city'), stateCode: text('stateCode'),
    lga: text('lga'), hasExistingHealthId: has === 'yes' || has === 'no' ? has : '', existingHealthId: text('existingHealthId'),
  }
}
