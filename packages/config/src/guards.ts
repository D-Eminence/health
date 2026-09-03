/**
 * Build-time guard against shipping a secret to the browser.
 *
 * Everything inlined into a frontend bundle is public. This guard is the
 * mechanical check behind that rule: applications run it over their own
 * public environment record and fail the build on a hit, so a mistake in a
 * deployment dashboard surfaces in CI instead of in a bundle.
 *
 * It is a safety net, not the boundary. The boundary is that only variables
 * intended to be public are ever placed under a public prefix.
 */

/** Fragments that mark a value as one that must never leave the server. */
const SECRET_KEY_FRAGMENTS = [
  'SECRET',
  'PRIVATE_KEY',
  'SERVICE_ROLE',
  'SERVICE_KEY',
  'PASSWORD',
  'CREDENTIAL',
  'ACCESS_KEY',
  'SESSION_TOKEN',
  'SIGNING_KEY',
  'WEBHOOK',
  'DATABASE_URL',
  'CONNECTION_STRING',
  'DSN_PRIVATE',
] as const

/**
 * Key fragments naming infrastructure the browser must never address directly.
 * The browser talks to the Health ID Gateway; it does not learn the topology
 * behind it.
 */
const INTERNAL_ENDPOINT_FRAGMENTS = [
  'AWS_',
  'RDS_',
  'ECS_',
  'VPC_',
  'POSTGRES',
  'SUPABASE_URL',
  'SUPABASE_ANON',
  'SUPABASE_SERVICE',
  'CLOUDFLARE_API',
] as const

/** Value shapes that are credentials regardless of what the key is called. */
const SECRET_VALUE_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'an AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'a PEM private key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { label: 'a JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { label: 'a Stripe secret key', pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
]

export interface PublicEnvironmentViolation {
  readonly key: string
  readonly reason: string
}

/**
 * Returns every reason the supplied record is unsafe to inline into a bundle.
 * An empty array means no known violation — not a proof of safety.
 */
export function findPublicEnvironmentViolations(
  raw: Readonly<Record<string, string | undefined>>,
): PublicEnvironmentViolation[] {
  const violations: PublicEnvironmentViolation[] = []

  for (const [key, value] of Object.entries(raw)) {
    const upperKey = key.toUpperCase()
    const flag = (reason: string) => {
      violations.push({ key, reason })
    }

    // One violation per key: the first reason is enough to stop a build, and a
    // single line per key keeps the failure readable.
    const secretFragment = SECRET_KEY_FRAGMENTS.find(fragment => upperKey.includes(fragment))
    if (secretFragment) {
      flag(`key contains "${secretFragment}"; secrets must stay behind the Health ID Gateway`)
      continue
    }

    const internalFragment = INTERNAL_ENDPOINT_FRAGMENTS.find(fragment => upperKey.includes(fragment))
    if (internalFragment) {
      flag(
        `key contains "${internalFragment}"; browsers address the Gateway, never internal infrastructure`,
      )
      continue
    }

    if (typeof value !== 'string' || value === '') continue

    const valuePattern = SECRET_VALUE_PATTERNS.find(({ pattern }) => pattern.test(value))
    if (valuePattern) flag(`value looks like ${valuePattern.label}`)
  }

  return violations
}

/** Throws when the public environment record carries anything that must not ship. */
export function assertPublicEnvironment(raw: Readonly<Record<string, string | undefined>>): void {
  const violations = findPublicEnvironmentViolations(raw)
  if (violations.length === 0) return

  const detail = violations.map(({ key, reason }) => `${key}: ${reason}`).join('\n- ')
  throw new Error(
    `Refusing to build: public environment configuration would expose non-public values.\n- ${detail}`,
  )
}
