import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { getEnvironment } from './env'

/** Existing hid-system organization application products and facility types. */
export const APPLICATION_PRODUCTS = [
  { code: 'ehr', label: 'Health ID EHR' },
  { code: 'migrate', label: 'Health ID Migrate' },
  { code: 'laboratory', label: 'Health ID Laboratory' },
  { code: 'pharmacy', label: 'Health ID Pharmacy' },
] as const

export type ApplicationProductCode = (typeof APPLICATION_PRODUCTS)[number]['code']
export type OrganizationType = 'hospital' | 'clinic' | 'laboratory' | 'pharmacy' | 'other'

export const ORGANIZATION_TYPES: readonly { value: OrganizationType; label: string }[] = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'other', label: 'Other healthcare provider' },
]

export const PRODUCT_OPTIONS: Record<OrganizationType, readonly ApplicationProductCode[]> = {
  hospital: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
  clinic: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
  laboratory: ['laboratory'],
  pharmacy: ['pharmacy'],
  other: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
}

export const PROVIDER_SETUP_CTA = 'Setup Your Facility'

export function isApplicationProduct(value: string): value is ApplicationProductCode {
  return APPLICATION_PRODUCTS.some(product => product.code === value)
}

/** Mirrors the existing /provider/apply?product= selection in hid-system. */
export function initialApplicationSelection(product: string | undefined): {
  organizationType: OrganizationType
  productCode: ApplicationProductCode
} {
  if (product === 'laboratory') return { organizationType: 'laboratory', productCode: 'laboratory' }
  if (product === 'pharmacy') return { organizationType: 'pharmacy', productCode: 'pharmacy' }
  if (product === 'migrate') return { organizationType: 'hospital', productCode: 'migrate' }
  return { organizationType: 'hospital', productCode: 'ehr' }
}

export function providerApplicationHref(product?: ApplicationProductCode): string {
  return product ? `/provider/apply?product=${product}` : '/provider/apply'
}

export interface OrganizationApplicationInput {
  organizationType: OrganizationType
  productCode: ApplicationProductCode
  cacRegistrationNumber: string
  administratorName: string
  administratorEmail: string
}

export interface OrganizationApplicationBody extends OrganizationApplicationInput {
  turnstileAction: 'organization-application'
  turnstileToken: string
}

export function normalizeCacRegistrationNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CAC_PATTERN = /^(RC|BN|IT)[0-9]{4,20}$/

export function organizationApplicationBody(input: OrganizationApplicationInput, turnstileToken: string): OrganizationApplicationBody {
  const administratorName = input.administratorName.trim()
  const administratorEmail = input.administratorEmail.trim().toLowerCase()
  const cacRegistrationNumber = normalizeCacRegistrationNumber(input.cacRegistrationNumber)

  if (!PRODUCT_OPTIONS[input.organizationType]?.includes(input.productCode)) {
    throw new Error('Choose a product for your facility type.')
  }
  if (administratorName.length < 2 || administratorName.length > 200
    || administratorEmail.length > 254 || !EMAIL_PATTERN.test(administratorEmail)) {
    throw new Error('Check the administrator contact details.')
  }
  if (!CAC_PATTERN.test(cacRegistrationNumber)) {
    throw new Error('Enter a CAC registration number with its RC, BN, or IT prefix.')
  }
  if (!turnstileToken) throw new Error('Complete the security verification.')

  return {
    productCode: input.productCode,
    organizationType: input.organizationType,
    cacRegistrationNumber,
    administratorName,
    administratorEmail,
    turnstileAction: 'organization-application',
    turnstileToken,
  }
}

function publicClient() {
  return createRegisteredBrowserClient(createApiClient({
    baseUrl: getEnvironment().apiBaseUrl,
    clientId: 'public-web',
    sessionMode: 'cookie',
  }), 'public-web')
}

export async function submitOrganizationApplication(body: OrganizationApplicationBody): Promise<void> {
  const response = await publicClient().request<{ accepted: true }>({
    method: 'POST', path: '/api/v1/identity/organization-applications', auth: 'none', body,
  })
  if (response?.accepted !== true) throw new Error('The application could not be confirmed. Please try again.')
}

export type OrganizationProfileFieldName =
  'companyName' | 'entityType' | 'registrationDate' | 'address' | 'registryStatus'
export type OrganizationProfileField = {
  value: string | null
  source: 'qoreid' | 'user_provided' | null
}
export interface OrganizationCompletionProfile {
  status: 'pending_verification' | 'ready_for_review'
  profileState: 'incomplete' | 'complete'
  version: number
  productCode: ApplicationProductCode
  registrationNumber: string
  fields: Record<OrganizationProfileFieldName, OrganizationProfileField>
}
export type OrganizationProfilePatch = Partial<Record<OrganizationProfileFieldName, string>>
export type OrganizationProfileErrors = Partial<Record<OrganizationProfileFieldName, string>>

const COMPLETION_PATH = '/api/v1/identity/organization-applications/completion'
const PROFILE_FIELDS: readonly OrganizationProfileFieldName[] = [
  'companyName', 'entityType', 'registrationDate', 'address', 'registryStatus',
]

export async function startOrganizationCompletion(input: {
  productCode: ApplicationProductCode
  cacRegistrationNumber: string
  administratorEmail: string
  turnstileToken: string
}): Promise<{ accepted: true; challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }> {
  const cacRegistrationNumber = normalizeCacRegistrationNumber(input.cacRegistrationNumber)
  const administratorEmail = input.administratorEmail.trim().toLowerCase()
  if (!CAC_PATTERN.test(cacRegistrationNumber)) throw new Error('Enter a valid CAC registration number.')
  if (!EMAIL_PATTERN.test(administratorEmail) || administratorEmail.length > 254) {
    throw new Error('Enter the administrator email used on the application.')
  }
  if (!input.turnstileToken) throw new Error('Complete the security verification.')
  return publicClient().request({
    method: 'POST', path: `${COMPLETION_PATH}/start`, auth: 'none',
    body: { productCode: input.productCode, cacRegistrationNumber, administratorEmail,
      turnstileAction: 'organization-completion', turnstileToken: input.turnstileToken },
  })
}

export async function verifyOrganizationCompletion(challengeId: string, code: string): Promise<void> {
  if (!/^[0-9]{6}$/.test(code)) throw new Error('Enter the six-digit email code.')
  const response = await publicClient().request<{ verified: true }>({
    method: 'POST', path: `${COMPLETION_PATH}/verify`, auth: 'none', body: { challengeId, code },
  })
  if (response?.verified !== true) throw new Error('The email code could not be verified.')
}

export function getOrganizationCompletionProfile(): Promise<OrganizationCompletionProfile> {
  return publicClient().request({ method: 'GET', path: `${COMPLETION_PATH}/profile`, auth: 'none' })
}

/** hid-system CompleteOrganizationProfileDto: the lengths each typed field accepts, after trimming. */
const PROFILE_TEXT_BOUNDS: readonly { name: OrganizationProfileFieldName; min: number; max: number; message: string }[] = [
  { name: 'companyName', min: 2, max: 200, message: 'Enter the registered organization name in 2 to 200 characters.' },
  { name: 'entityType', min: 2, max: 120, message: 'Enter the legal entity type in 2 to 120 characters.' },
  { name: 'address', min: 5, max: 1000, message: 'Enter the registered address in 5 to 1,000 characters.' },
]

/** Field errors for the details entered; a field left blank is not sent, so it has none. */
export function validateOrganizationProfileEntries(entries: OrganizationProfilePatch): OrganizationProfileErrors {
  const errors: OrganizationProfileErrors = {}
  for (const { name, min, max, message } of PROFILE_TEXT_BOUNDS) {
    const length = entries[name]?.trim().length ?? 0
    if (length > 0 && (length < min || length > max)) errors[name] = message
  }
  return errors
}

export function missingOrganizationProfileFields(profile: OrganizationCompletionProfile, entries: OrganizationProfilePatch): OrganizationProfilePatch {
  if (profile.status !== 'pending_verification') throw new Error('This organization profile is already awaiting review.')
  const body: OrganizationProfilePatch = {}
  for (const name of PROFILE_FIELDS) {
    const value = entries[name]?.trim()
    if (!value) continue
    if (profile.fields[name].source === 'qoreid') throw new Error('A QoreID-provided profile field cannot be replaced.')
    body[name] = value
  }
  if (Object.keys(body).length === 0) throw new Error('Enter at least one missing organization detail.')
  const invalid = Object.values(validateOrganizationProfileEntries(body))[0]
  if (invalid) throw new Error(invalid)
  return body
}

export function saveOrganizationCompletionProfile(profile: OrganizationCompletionProfile,
  entries: OrganizationProfilePatch): Promise<OrganizationCompletionProfile> {
  return publicClient().request({
    method: 'PATCH', path: `${COMPLETION_PATH}/profile`, auth: 'none',
    headers: { 'If-Match': `"${profile.version}"` },
    body: missingOrganizationProfileFields(profile, entries),
  })
}
