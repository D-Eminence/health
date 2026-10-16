/**
 * Environment resolution for every Health ID frontend application.
 *
 * This module is deliberately framework-agnostic: it takes a plain record of
 * already-inlined public variables and validates it. Each application supplies
 * its own source (`import.meta.env` under Vite, `process.env.NEXT_PUBLIC_*`
 * under Next.js) so neither bundler has to parse the other's syntax.
 *
 * Nothing here reaches the network, and nothing here may hold a secret.
 * See `guards.ts` for the rule that enforces the second half of that sentence.
 */

export const HID_ENVIRONMENT_NAMES = ['local', 'staging', 'production'] as const

export type HidEnvironmentName = (typeof HID_ENVIRONMENT_NAMES)[number]

export interface HidEnvironment {
  readonly supportChatEnabled: boolean
  readonly patientChatEnabled: boolean
  readonly supportContact: string | null
  /** Which deployment tier this build is talking to. */
  readonly name: HidEnvironmentName
  /**
   * Absolute origin (plus optional path prefix) of the Health ID Gateway/API.
   * Always supplied per environment; never hard-coded in application code.
   * Stored without a trailing slash so callers can join paths predictably.
   */
  readonly apiBaseUrl: string
  /** Public origin this application is served from. Used for link building. */
  readonly appOrigin: string
  /** Cloudflare Turnstile site key. Public by design; the secret half stays server-side. */
  readonly turnstileSiteKey: string | null
  /** Error-reporting DSN. Public by design. Optional. */
  readonly sentryDsn: string | null
  /** True when this build may talk to real patient data. Drives extra guardrails. */
  readonly handlesRealData: boolean
}

export class EnvironmentConfigError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid Health ID frontend environment configuration:\n- ${issues.join('\n- ')}`)
    this.name = 'EnvironmentConfigError'
    this.issues = issues
  }
}

export type RawEnvironment = Readonly<Record<string, string | undefined>>

function readString(raw: RawEnvironment, key: string): string | null {
  const value = raw[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function isEnvironmentName(value: string): value is HidEnvironmentName {
  return (HID_ENVIRONMENT_NAMES as readonly string[]).includes(value)
}

/**
 * Normalises a base URL: absolute http(s) origin, no trailing slash.
 * Returns null when the value cannot be used as an API base.
 */
export function normalizeBaseUrl(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (parsed.search !== '' || parsed.hash !== '') return null

  const path = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${path}`
}

/**
 * Builds the validated environment for an application.
 *
 * Keys are read with the caller's prefix so the same logic serves
 * `NEXT_PUBLIC_HID_*` and `VITE_HID_*` without duplicating rules.
 */
export function resolveEnvironment(raw: RawEnvironment, prefix: string): HidEnvironment {
  const issues: string[] = []
  const key = (suffix: string) => `${prefix}${suffix}`

  const rawName = readString(raw, key('ENVIRONMENT'))
  let name: HidEnvironmentName = 'local'
  if (rawName === null) {
    issues.push(`${key('ENVIRONMENT')} is required (one of: ${HID_ENVIRONMENT_NAMES.join(', ')})`)
  } else if (!isEnvironmentName(rawName)) {
    issues.push(`${key('ENVIRONMENT')} must be one of: ${HID_ENVIRONMENT_NAMES.join(', ')} (received "${rawName}")`)
  } else {
    name = rawName
  }

  const rawApiBaseUrl = readString(raw, key('API_BASE_URL'))
  let apiBaseUrl = ''
  if (rawApiBaseUrl === null) {
    // Fail closed. A build with no gateway address must not silently fall back
    // to a default host, least of all a production one.
    issues.push(`${key('API_BASE_URL')} is required; there is no default gateway address`)
  } else {
    const normalized = normalizeBaseUrl(rawApiBaseUrl)
    if (normalized === null) {
      issues.push(`${key('API_BASE_URL')} must be an absolute http(s) URL without query or fragment`)
    } else {
      apiBaseUrl = normalized
      if (name !== 'local' && normalized.startsWith('http://')) {
        issues.push(`${key('API_BASE_URL')} must use https outside local development`)
      }
    }
  }

  const rawAppOrigin = readString(raw, key('APP_ORIGIN'))
  let appOrigin = ''
  if (rawAppOrigin === null) {
    issues.push(`${key('APP_ORIGIN')} is required so links and redirects are built from configuration`)
  } else {
    const normalized = normalizeBaseUrl(rawAppOrigin)
    if (normalized === null) {
      issues.push(`${key('APP_ORIGIN')} must be an absolute http(s) URL`)
    } else {
      appOrigin = normalized
    }
  }

  const flag = (suffix: string) => {
    const value = raw[key(suffix)]
    if (value === undefined || value === '') return false
    if (value !== 'true' && value !== 'false') issues.push(`${key(suffix)} must be true or false`)
    return value === 'true'
  }
  const supportChatEnabled = flag('SUPPORT_CHAT_ENABLED')
  const patientChatEnabled = flag('PATIENT_CHAT_ENABLED')
  const supportContact = readString(raw, key('SUPPORT_CONTACT'))
  if (supportChatEnabled && supportContact !== 'mailto:support@healthidentitydirectory.com') {
    issues.push('Support chat requires the approved support contact')
  }
  if (issues.length > 0) throw new EnvironmentConfigError(issues)

  return Object.freeze({
    name,
    apiBaseUrl,
    appOrigin,
    turnstileSiteKey: readString(raw, key('TURNSTILE_SITE_KEY')),
    sentryDsn: readString(raw, key('SENTRY_DSN')),
    handlesRealData: name !== 'local',
    supportChatEnabled, patientChatEnabled, supportContact,
  })
}
