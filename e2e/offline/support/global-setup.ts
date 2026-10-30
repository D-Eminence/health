import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { FullConfig } from '@playwright/test'
import { invalidOptionalVariables, KIT_ROOT, missingVariables, runClaimFile, runDir, runIdOrLocal, VariableError } from './env'

/**
 * The cards gate. Playwright runs it once per invocation, in the runner process, before any browser starts. It does
 * nothing for the localhost selftest; for anything that may run a card it refuses to start unless:
 * - every required variable is set (the refusal names only the missing ones);
 * - the optional ones are values the kit understands, and T7 mode and a release card are not both set;
 * - the card projects run headed, on a machine with a display, and not under CI (CI never points at production);
 * - out/runs/<HID_E2E_RUN_ID>/ does not exist yet: every invocation needs a new run id.
 * It then claims the run id (out/runs/<id>/run.json) so no later invocation can reuse it.
 */

/** Projects that only ever talk to 127.0.0.1. */
export const LOCAL_PROJECTS: ReadonlySet<string> = new Set(['selftest', 'selftest-leak'])
export const CARD_PROJECTS: ReadonlySet<string> = new Set(['ehr-cards', 'migrate-cards', 'portal-cards'])

/**
 * Whether this invocation may run a card. Conservative: true unless at least one --project is given and every value
 * given is a localhost project. (`npm run selftest` passes --project=selftest.)
 */
export function cardsMayRun(argv: readonly string[]): boolean {
  const values: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? ''
    if (token.startsWith('--project=')) values.push(token.slice('--project='.length))
    else if (token === '--project') {
      while (index + 1 < argv.length && !(argv[index + 1] ?? '-').startsWith('-')) values.push(argv[++index] ?? '')
    }
  }
  return values.length === 0 || values.some(value => !LOCAL_PROJECTS.has(value))
}

/** Every reason this invocation may not start the cards. Names only, never values. */
export function gateProblems(config: Pick<FullConfig, 'projects'>, env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = []
  const missing = missingVariables(env)
  if (missing.length > 0) problems.push(`missing environment variables: ${missing.join(', ')}`)
  const invalid = invalidOptionalVariables(env)
  if (invalid.length > 0) problems.push(`environment variables with values the kit does not understand: ${invalid.join(', ')}`)
  if (env.HID_E2E_T7_MODE && env.HID_E2E_RELEASE_CARD) problems.push('HID_E2E_T7_MODE and HID_E2E_RELEASE_CARD are both set; each is its own invocation')
  const cards = config.projects.filter(project => CARD_PROJECTS.has(project.name))
  if (cards.some(project => project.use.headless !== false)) problems.push('a card project is not headed (the cards need a visible window and a person for the human check)')
  if (env.CI) problems.push('CI is set: the cards write to production and never run in CI')
  if (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) problems.push('no display (DISPLAY or WAYLAND_DISPLAY): the cards run in a visible window')
  if (missing.includes('HID_E2E_RUN_ID')) return problems
  let id: string
  try { id = runIdOrLocal(env) } catch (error) {
    problems.push(error instanceof VariableError ? error.message : 'HID_E2E_RUN_ID is not usable')
    return problems
  }
  if (id === 'local') problems.push('HID_E2E_RUN_ID "local" is kept for the selftest; choose a new run id')
  else if (existsSync(runDir(id))) problems.push(`${relative(KIT_ROOT, runDir(id))}/ already exists: every invocation needs a new HID_E2E_RUN_ID`)
  return problems
}

/** Playwright calls it with the config only; the selftest passes argv and env to prove the refusals. */
export default async function globalSetup(config: FullConfig, argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!cardsMayRun(argv)) return
  const problems = gateProblems(config, env)
  if (problems.length > 0) {
    throw new Error(`The offline cards did not start:\n- ${problems.join('\n- ')}\nSee e2e/offline/README.md.`)
  }
  const id = runIdOrLocal(env)
  mkdirSync(runDir(id), { recursive: true })
  writeFileSync(runClaimFile(id), `${JSON.stringify({ runId: id, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' })
}
