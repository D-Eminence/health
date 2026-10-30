import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The kit's configuration, read from the environment only, and only when a card or the cards gate asks for it: the
 * test list and the localhost selftest run with no HID_* variable set.
 *
 * Logins are wrapped in Secret, which prints as "[secret]" wherever it is turned into text (a template string, JSON,
 * a Node inspect). Only setSecret (devices.ts) and the end-of-run secret scan (report.ts) ever read the value.
 *
 * Only these names are read. Never use a VITE_HID_* or NEXT_PUBLIC_HID_* name: build tools inline those into public
 * bundles.
 */

export const REQUIRED_VARIABLES = [
  'HID_DEMO_STAFF_EMAIL',
  'HID_DEMO_STAFF_PASSWORD',
  'HID_DEMO_PATIENT1_EMAIL',
  'HID_DEMO_PATIENT1_PASSWORD',
  'HID_DEMO_PATIENT2_EMAIL',
  'HID_DEMO_PATIENT2_PASSWORD',
  'HID_E2E_RUN_ID',
] as const

export const OPTIONAL_VARIABLES = ['HID_E2E_RELEASE_CARD', 'HID_E2E_T7_MODE', 'HID_E2E_OFFLINE_MODE'] as const

/** The values no file, step title or report may ever contain. The staff email is the demo login's, in the guard. */
export const SECRET_VARIABLES = [
  'HID_DEMO_STAFF_PASSWORD',
  'HID_DEMO_PATIENT1_EMAIL',
  'HID_DEMO_PATIENT1_PASSWORD',
  'HID_DEMO_PATIENT2_EMAIL',
  'HID_DEMO_PATIENT2_PASSWORD',
] as const

/**
 * The selftest's throwaway password. The config makes a new random one per invocation (never in source, so a code
 * frame in a failure report cannot contain it); it is not a login anywhere.
 */
export const SELFTEST_SECRET_VARIABLE = 'E2E_SELFTEST_FAKE_SECRET'

type Variable = typeof REQUIRED_VARIABLES[number] | typeof OPTIONAL_VARIABLES[number]
type Env = Readonly<Record<string, string | undefined>>

const INSPECT = Symbol.for('nodejs.util.inspect.custom')

/** A login value. Every way of turning it into text gives "[secret]"; reveal() is for setSecret and the scan only. */
export class Secret {
  readonly #value: string
  constructor(value: string) { this.#value = value }
  reveal(): string { return this.#value }
  toString(): string { return '[secret]' }
  toJSON(): string { return '[secret]' }
  [INSPECT](): string { return '[secret]' }
}

/** Names one or more variables that are missing or not usable. It never repeats a value. */
export class VariableError extends Error {
  constructor(readonly names: readonly string[], why: string) {
    super(`${why}: ${names.join(', ')}. Set each with \`read -rs NAME && export NAME\` (see e2e/offline/README.md).`)
    this.name = 'VariableError'
  }
}

export type ReleaseCard = 'T16' | 'T17' | 'T19'
export type T7Mode = 'revoke' | 'wait'
export type OfflineMode = 'setoffline' | 'cdp'

export interface CardEnv {
  staffEmail: Secret
  staffPassword: Secret
  patient1Email: Secret
  patient1Password: Secret
  patient2Email: Secret
  patient2Password: Secret
  runId: string
  releaseCard: ReleaseCard | null
  t7Mode: T7Mode | null
  offlineMode: OfflineMode
}

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function value(env: Env, name: Variable): string | undefined {
  const raw = env[name]
  return raw === undefined || raw.trim() === '' ? undefined : raw
}

/** The required variables that are not set (or are blank). Names only. */
export function missingVariables(env: Env = process.env): string[] {
  return REQUIRED_VARIABLES.filter(name => value(env, name) === undefined)
}

/** The optional variables set to something the kit does not understand. Names only. */
export function invalidOptionalVariables(env: Env = process.env): string[] {
  const invalid: string[] = []
  const release = value(env, 'HID_E2E_RELEASE_CARD')
  if (release !== undefined && !['T16', 'T17', 'T19'].includes(release)) invalid.push('HID_E2E_RELEASE_CARD (T16, T17 or T19)')
  const t7 = value(env, 'HID_E2E_T7_MODE')
  if (t7 !== undefined && !['revoke', 'wait'].includes(t7)) invalid.push('HID_E2E_T7_MODE (revoke or wait)')
  const offline = value(env, 'HID_E2E_OFFLINE_MODE')
  if (offline !== undefined && !['setoffline', 'cdp'].includes(offline)) invalid.push('HID_E2E_OFFLINE_MODE (setoffline or cdp)')
  return invalid
}

/** The run id for output paths: HID_E2E_RUN_ID, or 'local' when it is unset (list and selftest). */
export function runIdOrLocal(env: Env = process.env): string {
  const id = value(env, 'HID_E2E_RUN_ID')
  if (id === undefined) return 'local'
  if (!RUN_ID.test(id) || id.includes('..')) {
    throw new VariableError(['HID_E2E_RUN_ID'], 'Not a usable run id (letters, digits, dot, dash, underscore; at most 64)')
  }
  return id
}

/** Whether HID_E2E_RUN_ID was set at all (an unset id means 'local'). */
export function runIdExplicit(env: Env = process.env): boolean {
  return value(env, 'HID_E2E_RUN_ID') !== undefined
}

let cached: CardEnv | null = null

/**
 * Everything a card needs, read the first time a card asks. Throws a VariableError that names (never shows) whatever
 * is missing or unusable.
 */
export function cardEnv(env: Env = process.env): CardEnv {
  if (env === process.env && cached) return cached
  const missing = missingVariables(env)
  if (missing.length > 0) throw new VariableError(missing, 'Missing environment variables')
  const invalid = invalidOptionalVariables(env)
  if (invalid.length > 0) throw new VariableError(invalid, 'Environment variables with values the kit does not understand')
  const read = (name: Variable) => new Secret(value(env, name) as string)
  const result: CardEnv = {
    staffEmail: read('HID_DEMO_STAFF_EMAIL'),
    staffPassword: read('HID_DEMO_STAFF_PASSWORD'),
    patient1Email: read('HID_DEMO_PATIENT1_EMAIL'),
    patient1Password: read('HID_DEMO_PATIENT1_PASSWORD'),
    patient2Email: read('HID_DEMO_PATIENT2_EMAIL'),
    patient2Password: read('HID_DEMO_PATIENT2_PASSWORD'),
    runId: runIdOrLocal(env),
    releaseCard: (value(env, 'HID_E2E_RELEASE_CARD') ?? null) as ReleaseCard | null,
    t7Mode: (value(env, 'HID_E2E_T7_MODE') ?? null) as T7Mode | null,
    offlineMode: (value(env, 'HID_E2E_OFFLINE_MODE') ?? 'setoffline') as OfflineMode,
  }
  if (env === process.env) cached = result
  return result
}

/** Every secret value currently set, for the end-of-run scan. Values shorter than 6 characters are not searched. */
export function secretValuesForScan(env: Env = process.env): string[] {
  const values = [...SECRET_VARIABLES.map(name => env[name]), env[SELFTEST_SECRET_VARIABLE]]
  return [...new Set(values.filter((item): item is string => typeof item === 'string' && item.length >= 6))]
}

// --- Paths ------------------------------------------------------------------------------------------------------

/** e2e/offline/, wherever the kit is checked out. */
export const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url))
/** Every Playwright output and browser profile lives under here; .gitignore ignores out/. */
export const OUT_DIR = join(KIT_ROOT, 'out')
export const PROFILES_DIR = join(OUT_DIR, 'profiles')

export function runDir(runId: string): string { return join(OUT_DIR, 'runs', runId) }
/** Written by the cards gate: it claims the run id for this invocation. */
export function runClaimFile(runId: string): string { return join(runDir(runId), 'run.json') }
/** Created by the person running a release card, once the coordinator says the release is live. */
export function releaseMarkerFile(runId: string): string { return join(runDir(runId), 'release-live') }
/** Written when the guard stops the run; every later card refuses to start while it exists. */
export function guardStopFile(runId: string): string { return join(runDir(runId), 'guard-stopped.txt') }

export interface RunClaim { runId: string; pid: number; startedAt: string }

/** The claim the gate wrote for this run, or null. */
export function readRunClaim(runId: string): RunClaim | null {
  const file = runClaimFile(runId)
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) as RunClaim } catch { return null }
}
