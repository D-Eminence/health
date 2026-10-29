import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { test, expect } from '@playwright/test'
import { KIT_ROOT, PROFILES_DIR, runDir, SELFTEST_SECRET_VARIABLE } from '../support/env'
import { scanForSecrets, unzip } from '../support/report'

/**
 * The leak check. Starts selftest/leak-fixture.spec.ts as an invocation of its own (project selftest-leak, a new run
 * id), so its HTML report, results.json, summary.md and failure attachments are all written, then searches every file
 * of that run for the throwaway password: raw, escaped, inside decoded base64, and inside the HTML report's embedded
 * zip, entry by entry (node:zlib; no new dependency). A canary from the fixture's own step title must be found inside
 * the zip, which proves the search reaches the report's data and is not passing on an empty folder.
 */

/** Playwright's own variables from this worker must not leak into the child run (it is a runner, not a worker). */
function childEnv(runId: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(TEST_|PW_)/.test(name) || (/^PLAYWRIGHT_/.test(name) && name !== 'PLAYWRIGHT_BROWSERS_PATH')) continue
    env[name] = value
  }
  return { ...env, HID_E2E_RUN_ID: runId, FORCE_COLOR: '0' }
}

async function run(runId: string): Promise<{ code: number | null; output: string }> {
  const cli = join(KIT_ROOT, 'node_modules', '@playwright', 'test', 'cli.js')
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', '--project=selftest-leak'], { cwd: KIT_ROOT, env: childEnv(runId) })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    child.stderr.on('data', chunk => { output += String(chunk) })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output }))
  })
}

function findFiles(dir: string, name: RegExp): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findFiles(path, name))
    else if (name.test(entry.name)) found.push(path)
  }
  return found
}

/** A one-entry zip (deflated), as the planted positive control. */
function zipOf(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content)
  const nameBytes = Buffer.from(name, 'utf8')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBytes.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt32LE(0, 42)
  const centralAt = local.length + nameBytes.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + nameBytes.length, 12); end.writeUInt32LE(centralAt, 16)
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end])
}

test('the throwaway password appears nowhere in a complete run folder, the HTML report zip and failure attachments included', async () => {
  const testInfo = test.info()
  test.setTimeout(4 * 60_000)
  const secret = process.env[SELFTEST_SECRET_VARIABLE]
  if (!secret) throw new Error('The config sets the selftest password')
  const childId = `selftest-leak-${Date.now()}`
  const folder = runDir(childId)
  const result = await run(childId)
  expect(result.code, `the leak fixture run failed:\n${result.output.split(secret).join('[secret]')}`).toBe(0)
  let clean = false
  try {
    // Everything a run writes is there.
    expect(existsSync(join(folder, 'results.json'))).toBe(true)
    expect(existsSync(join(folder, 'summary.md'))).toBe(true)
    expect(existsSync(join(folder, 'html', 'index.html'))).toBe(true)
    expect(findFiles(join(folder, 'test-results'), /^error-context\.md$/).length, 'the expected failure left an error context').toBeGreaterThan(0)
    expect(findFiles(join(folder, 'test-results'), /\.png$/).length, 'screenshots were taken').toBeGreaterThan(0)

    const canary = `canary-${childId}`
    const scan = scanForSecrets(folder, [secret], [canary])
    testInfo.annotations.push({ type: 'note', description: `Searched ${scan.files} files, ${scan.htmlReports} HTML report, ${scan.zips} zips with ${scan.zipEntries} entries, ${scan.decodedBlobs} decoded base64 runs.` })
    expect(scan.hits, 'the throwaway password was found in the run folder').toEqual([])
    expect(scan.htmlReports).toBe(1)
    expect(scan.zipEntries).toBeGreaterThan(0)
    expect(scan.canaries[canary]?.some(where => where.startsWith('html') && where.includes('base64@') && where.includes('>')),
      `the canary was not found inside the HTML report's zip (found: ${scan.canaries[canary]?.join(', ')})`).toBe(true)
    // The child's own end-of-run scan said the same.
    expect(result.output).toContain('no secret value found')
    clean = true
  } finally {
    // The child run is the selftest's scratch; kept only if something failed, for inspection.
    if (clean) {
      rmSync(folder, { recursive: true, force: true })
      rmSync(join(PROFILES_DIR, childId), { recursive: true, force: true })
    }
  }
})

test('the search finds a planted password inside a zip inside a report template (positive control)', async () => {
  const testInfo = test.info()
  const secret = `planted-${Date.now()}-value`
  const dir = testInfo.outputPath('planted')
  mkdirSync(dir, { recursive: true })
  try {
    const zip = zipOf('report.json', Buffer.from(JSON.stringify({ steps: [{ title: `Fill "${secret}"` }] })))
    expect(unzip(zip).map(entry => entry.data.toString('utf8'))[0]).toContain(secret)
    writeFileSync(join(dir, 'index.html'), `<html><body><template id="playwrightReportBase64">data:application/zip;base64,${zip.toString('base64')}</template></body></html>`)
    const scan = scanForSecrets(dir, [secret])
    expect(scan.htmlReports).toBe(1)
    expect(scan.hits.map(hit => hit.file)).toEqual(['index.html'])
    expect(scan.hits[0]?.where).toContain('report.json')
  } finally {
    // The planted value must not stay in this run's folder (the end-of-run scan searches it too, for the real secret only).
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a run id whose folder already exists is refused before Playwright touches it', async () => {
  const usedId = `selftest-used-${Date.now()}`
  mkdirSync(runDir(usedId), { recursive: true })
  writeFileSync(join(runDir(usedId), 'results.json'), '{"kept":true}\n')
  try {
    const result = await run(usedId)
    expect(result.code).not.toBe(0)
    expect(result.output).toContain('already exists')
    // Nothing was cleared or rewritten.
    expect(readdirSync(runDir(usedId))).toEqual(['results.json'])
  } finally { rmSync(runDir(usedId), { recursive: true, force: true }) }
})
