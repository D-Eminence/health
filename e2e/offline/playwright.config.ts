import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig } from '@playwright/test'
import { KIT_ROOT, readRunClaim, runDir, runIdExplicit, runIdOrLocal, SELFTEST_SECRET_VARIABLE } from './support/env'

/**
 * The Health ID offline cards (opt-in; never part of CI) and their localhost selftest.
 *
 * Reads no login here: logins are read only when a card fixture or the cards gate runs. Every output of one
 * invocation goes under out/runs/<HID_E2E_RUN_ID, or 'local' when unset>/; Playwright empties test-results/ and the
 * HTML reporter replaces html/ at each start, so each invocation of the cards needs a new run id.
 */

const runId = runIdOrLocal()
const RUN_DIR = runDir(runId)

// The runner process (workers set TEST_WORKER_INDEX before loading this file): a run id given explicitly whose folder
// already exists is refused before Playwright clears or rewrites anything in it, unless this invocation claimed it.
if (process.env.TEST_WORKER_INDEX === undefined && !process.argv.includes('--list') && runIdExplicit()
  && existsSync(RUN_DIR) && readRunClaim(runId)?.pid !== process.pid) {
  throw new Error(`${relative(KIT_ROOT, RUN_DIR)}/ already exists: every invocation needs a new HID_E2E_RUN_ID (see README.md).`)
}

// The selftest's throwaway password: random per invocation, never in source; workers inherit it.
process.env[SELFTEST_SECRET_VARIABLE] ??= `fake-${randomBytes(12).toString('hex')}`

export default defineConfig({
  testMatch: '**/*.spec.ts',
  outputDir: join(RUN_DIR, 'test-results'),
  workers: 1,
  fullyParallel: false,
  // A retry would repeat writes on production.
  retries: 0,
  // The cards also pass --max-failures=1: the first failure ends the run.
  maxFailures: 1,
  forbidOnly: true,
  // The default per-test timeout; each card sets its own (test.setTimeout), the sign-in fixtures theirs.
  timeout: 5 * 60_000,
  // Long enough for a release card waiting on the coordinator's release.
  globalTimeout: 10 * 3_600_000,
  globalSetup: './support/global-setup.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: join(RUN_DIR, 'html'), open: 'never' }],
    ['json', { outputFile: join(RUN_DIR, 'results.json') }],
    // Last: it scans the run folder for secrets after the html and json reporters have written theirs.
    ['./support/report.ts', { outputFile: join(RUN_DIR, 'summary.md'), runDir: RUN_DIR }],
  ],
  use: {
    browserName: 'chromium',
    serviceWorkers: 'allow',
    screenshot: 'on',
    trace: 'off',
    video: 'off',
  },
  projects: [
    // 127.0.0.1 only. Headless.
    { name: 'selftest', testDir: 'selftest', testIgnore: '**/leak-fixture.spec.ts', use: { headless: true } },
    // Run by selftest/leak.spec.ts as an invocation of its own, never directly.
    { name: 'selftest-leak', testDir: 'selftest', testMatch: '**/leak-fixture.spec.ts', use: { headless: true } },
    // Production, sealed demo tenant, headed. Order matters: ehr, then migrate, then portal (config order).
    { name: 'ehr-cards', testDir: 'cards', testMatch: /[\\/](T(0[1-9]|1[0-4]|16|17|19|20)-[^\\/]+|R1-R3)\.spec\.ts$/, use: { headless: false } },
    { name: 'migrate-cards', testDir: 'cards', testMatch: /[\\/]T15-[^\\/]+\.spec\.ts$/, use: { headless: false } },
    { name: 'portal-cards', testDir: 'cards', testMatch: /[\\/]T18-[^\\/]+\.spec\.ts$/, use: { headless: false } },
  ],
})
