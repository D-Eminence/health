import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient, PlainError } from '@hid/http'
import { isContactEmail } from './contact-email'
import { getEnvironment } from './env'

/** The hid-system organization application products. */
export const APPLICATION_PRODUCTS = [
  { code: 'ehr', label: 'Health ID EHR' },
  { code: 'migrate', label: 'Health ID Migrate' },
  { code: 'laboratory', label: 'Health ID Laboratory' },
  { code: 'pharmacy', label: 'Health ID Pharmacy' },
] as const

export type ApplicationProductCode = (typeof APPLICATION_PRODUCTS)[number]['code']

export const PROVIDER_SETUP_CTA = 'Setup Your Facility'

export function isApplicationProduct(value: string): value is ApplicationProductCode {
  return APPLICATION_PRODUCTS.some(product => product.code === value)
}

export function providerApplicationHref(product?: ApplicationProductCode): string {
  return product ? `/provider/apply?product=${product}` : '/provider/apply'
}

export function normalizeCacRegistrationNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

const CAC_PATTERN = /^(RC|BN|IT)[0-9]{4,20}$/

function publicClient() {
  return createRegisteredBrowserClient(createApiClient({
    baseUrl: getEnvironment().apiBaseUrl,
    clientId: 'public-web',
    sessionMode: 'cookie',
  }), 'public-web')
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
  if (!CAC_PATTERN.test(cacRegistrationNumber)) throw new PlainError('Enter a valid CAC registration number.')
  if (!isContactEmail(administratorEmail)) {
    throw new PlainError('Enter the administrator email used on the application.')
  }
  if (!input.turnstileToken) throw new PlainError('Complete the security check.')
  return publicClient().request({
    method: 'POST', path: `${COMPLETION_PATH}/start`, auth: 'none',
    body: { productCode: input.productCode, cacRegistrationNumber, administratorEmail,
      turnstileAction: 'organization-completion', turnstileToken: input.turnstileToken },
  })
}

export async function verifyOrganizationCompletion(challengeId: string, code: string): Promise<void> {
  if (!/^[0-9]{6}$/.test(code)) throw new PlainError('Enter the six-digit email code.')
  const response = await publicClient().request<{ verified: true }>({
    method: 'POST', path: `${COMPLETION_PATH}/verify`, auth: 'none', body: { challengeId, code },
  })
  if (response?.verified !== true) throw new PlainError('We couldn’t check the email code. Please try again.')
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
  if (profile.status !== 'pending_verification') throw new PlainError('This organization profile is already waiting for review.')
  const body: OrganizationProfilePatch = {}
  for (const name of PROFILE_FIELDS) {
    const value = entries[name]?.trim()
    if (!value) continue
    if (profile.fields[name].source === 'qoreid') throw new PlainError('This detail came from the official company record and can’t be changed here.')
    body[name] = value
  }
  if (Object.keys(body).length === 0) throw new PlainError('Enter at least one missing organization detail.')
  const invalid = Object.values(validateOrganizationProfileEntries(body))[0]
  if (invalid) throw new PlainError(invalid)
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
