import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter'
import { secretValuesForScan } from './env'

/**
 * summary.md for one invocation, and the end-of-run secret scan.
 *
 * The summary lists each card with its result, its notes (annotations of type 'note'), the kit's own test.step titles
 * (never pw:api steps, whose titles Playwright builds from typed values) and its screenshot paths.
 *
 * Then every file in the run folder is searched for every secret value in the environment (the demo passwords, the
 * patient emails, the selftest's throwaway password), raw and in its JSON-, URL- and HTML-escaped forms. Base64 runs
 * are decoded and searched, and a zip inside one (the HTML report keeps its data as a zip in
 * <template id="playwrightReportBase64">, or <script id=...> in other versions) is unpacked with node:zlib and each
 * entry searched too. A match fails the run and names the files, never the value.
 *
 * Listed after the html and json reporters in playwright.config.ts: Playwright calls onEnd in order, so their files
 * exist when this one scans.
 */

interface Options { outputFile: string; runDir: string }

interface CardEntry { test: TestCase; result: TestResult }

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

export default class SummaryReporter implements Reporter {
  private readonly options: Options
  private config: FullConfig | null = null
  private suite: Suite | null = null
  private readonly entries: CardEntry[] = []
  private readonly startedAt = new Date()

  constructor(options: Partial<Options>) {
    if (!options.outputFile || !options.runDir) throw new Error('The summary reporter needs outputFile and runDir')
    this.options = { outputFile: options.outputFile, runDir: options.runDir }
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config
    this.suite = suite
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.entries.push({ test, result })
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    const { outputFile, runDir } = this.options
    mkdirSync(dirname(outputFile), { recursive: true })
    writeFileSync(outputFile, this.summary(result))
    const secrets = secretValuesForScan()
    if (secrets.length === 0 || !existsSync(runDir)) return
    const scan = scanForSecrets(runDir, secrets)
    const line = scan.hits.length === 0
      ? `Secret scan: ${scan.files} files (${scan.htmlReports} HTML report), ${scan.zipEntries} entries in ${scan.zips} embedded or stored zips, ${scan.decodedBlobs} decoded base64 runs; `
        + `no secret value found (${secrets.length} searched).`
      : `Secret scan FAILED: a secret value was found in ${[...new Set(scan.hits.map(hit => hit.file))].join(', ')}. `
        + 'Delete this run folder and tell the coordinator; do not share any file from it.'
    appendFileSync(outputFile, `\n## Secret scan\n\n${line}\n`)
    process.stdout.write(`\n${line}\n`)
    if (scan.hits.length > 0) return { status: 'failed' }
  }

  printsToStdio(): boolean { return false }

  private summary(result: FullResult): string {
    const { runDir } = this.options
    const lines: string[] = []
    const runId = runDir.split(/[\\/]/).filter(Boolean).pop() ?? ''
    lines.push(`# Health ID offline cards, run ${runId}`, '')
    lines.push(`- Started: ${this.startedAt.toISOString()}`, `- Finished: ${new Date().toISOString()}`, `- Status: ${result.status}`)
    const projects = [...new Set((this.suite?.suites ?? []).map(project => project.title))]
    lines.push(`- Projects: ${projects.join(', ') || 'none'}`, `- Playwright: ${this.config?.version ?? 'unknown'}`, '')
    lines.push('| Card | Project | Result | Duration |', '| --- | --- | --- | --- |')
    for (const { test, result: run } of this.entries) {
      lines.push(`| ${escapeCell(test.title)} | ${escapeCell(projectOf(test))} | ${outcome(test, run)} | ${seconds(run.duration)} |`)
    }
    for (const { test, result: run } of this.entries) {
      lines.push('', `## ${test.title} (${projectOf(test)}): ${outcome(test, run)}`, '')
      // Annotations added while a test runs are reported on both the test and the result: each once.
      const notes = [...new Map([...test.annotations, ...run.annotations].filter(item => item.description)
        .map(item => [`${item.type}|${item.description}`, item])).values()]
      if (notes.length > 0) {
        lines.push('Notes:')
        for (const note of notes) lines.push(`- ${note.type === 'note' ? '' : `${note.type}: `}${oneLine(note.description ?? '')}`)
        lines.push('')
      }
      const steps = kitSteps(run.steps)
      if (steps.length > 0) {
        lines.push('Steps:')
        lines.push(...steps)
        lines.push('')
      }
      const shots = run.attachments.filter(item => item.contentType === 'image/png' && item.path)
      if (shots.length > 0) {
        lines.push('Screenshots:')
        for (const shot of shots) lines.push(`- ${shot.name}: ${relative(runDir, shot.path ?? '')}`)
        lines.push('')
      }
      if (run.errors.length > 0) {
        lines.push('Errors:')
        for (const error of run.errors) lines.push(`- ${oneLine((error.message ?? '').replace(ANSI, '')).slice(0, 600)}`)
        lines.push('')
      }
    }
    return `${lines.join('\n')}\n`
  }
}

function projectOf(test: TestCase): string {
  let suite: Suite | undefined = test.parent
  while (suite && suite.type !== 'project') suite = suite.parent
  return suite?.title ?? ''
}

function outcome(test: TestCase, run: TestResult): string {
  if (run.status === 'skipped') {
    const reason = [...test.annotations, ...run.annotations].find(item => item.type === 'skip' || item.type === 'fixme')
    return reason?.description ? `skipped (${oneLine(reason.description)})` : 'skipped'
  }
  if (test.expectedStatus === 'failed' && run.status === 'failed') return 'failed as expected'
  return run.status
}

/** The kit's own steps only: test.step titles, which the kit writes and which never carry a typed value. */
function kitSteps(steps: readonly TestStep[], depth = 0): string[] {
  const lines: string[] = []
  for (const step of steps) {
    if (step.category !== 'test.step') continue
    lines.push(`${'  '.repeat(depth)}- ${oneLine(step.title)} (${seconds(step.duration)})${step.error ? ': failed' : ''}`)
    lines.push(...kitSteps(step.steps, depth + 1))
  }
  return lines
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const escapeCell = (text: string) => oneLine(text).replace(/\|/g, '\\|')
const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`

// --- The secret scan ------------------------------------------------------------------------------------------

export interface ScanHit { file: string; where: string }
export interface ScanResult {
  files: number
  /** HTML files that embed Playwright's report data (template or script id="playwrightReportBase64"). */
  htmlReports: number
  zips: number
  zipEntries: number
  decodedBlobs: number
  hits: ScanHit[]
  /** Where each canary (a string expected to be there) was found: proves the decoding reached it. */
  canaries: Record<string, string[]>
}

const BASE64_RUN = /[A-Za-z0-9+/]{64,}={0,2}/g
const REPORT_DATA = /<(template|script)[^>]*id="playwrightReportBase64"[^>]*>data:application\/zip;base64,/

function variants(secret: string): Buffer[] {
  const forms = new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret),
    secret.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')])
  if (secret.includes('@')) { forms.add(secret.toLowerCase()); forms.add(secret.toUpperCase()) }
  const buffers: Buffer[] = []
  for (const form of forms) buffers.push(Buffer.from(form, 'utf8'), Buffer.from(form, 'utf16le'))
  return buffers
}

/** The entries of a zip, from its central directory (stored or deflated; enough for the HTML report's data). */
export function unzip(buffer: Buffer): { name: string; data: Buffer }[] {
  let end = -1
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 65_557); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break }
  }
  if (end < 0) return []
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const entries: { name: string; data: Buffer }[] = []
  for (let entry = 0; entry < count && offset + 46 <= buffer.length; entry++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressed = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const local = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    offset += 46 + nameLength + extraLength + commentLength
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) continue
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const raw = buffer.subarray(start, start + compressed)
    try { entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) }) }
    catch { entries.push({ name: `${name} (could not be inflated)`, data: Buffer.from(raw) }) }
  }
  return entries
}

function walkFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walkFiles(path))
    else if (entry.isFile()) found.push(path)
  }
  return found
}

/**
 * Searches every file under `dir` for each secret (and reports where each canary appears). Base64 runs of 64+
 * characters are decoded and searched, and a decoded or stored zip is unpacked and each entry searched.
 */
export function scanForSecrets(dir: string, secrets: readonly string[], canaries: readonly string[] = []): ScanResult {
  const needles = secrets.filter(secret => secret.length > 0).map(variants)
  const canaryBuffers = canaries.map(canary => Buffer.from(canary, 'utf8'))
  const result: ScanResult = { files: 0, htmlReports: 0, zips: 0, zipEntries: 0, decodedBlobs: 0, hits: [], canaries: Object.fromEntries(canaries.map(canary => [canary, []])) }

  const inspect = (data: Buffer, file: string, where: string, depth: number): void => {
    for (const forms of needles) {
      if (forms.some(form => data.includes(form))) result.hits.push({ file, where })
    }
    canaryBuffers.forEach((canary, index) => { if (data.includes(canary)) result.canaries[canaries[index]!]!.push(`${file}:${where}`) })
    if (depth > 3) return
    if (data.length >= 22 && data.readUInt32LE(0) === 0x04034b50) {
      result.zips++
      for (const entry of unzip(data)) {
        result.zipEntries++
        inspect(entry.data, file, `${where}>${entry.name}`, depth + 1)
      }
      return
    }
    // Text that may carry base64 (the HTML report's data, JSON attachment bodies, data: URLs).
    if (data.length > 64 && looksTextual(data)) {
      const text = data.toString('latin1')
      for (const match of text.matchAll(BASE64_RUN)) {
        const decoded = Buffer.from(match[0], 'base64')
        if (decoded.length === 0) continue
        result.decodedBlobs++
        inspect(decoded, file, `${where}>base64@${match.index ?? 0}`, depth + 1)
      }
    }
  }

  for (const path of walkFiles(dir)) {
    if (statSync(path).size > 200 * 1024 * 1024) { result.hits.push({ file: relative(dir, path), where: 'too large to scan' }); continue }
    result.files++
    const data = readFileSync(path)
    if (path.endsWith('.html') && REPORT_DATA.test(data.toString('latin1'))) result.htmlReports++
    inspect(data, relative(dir, path), 'file', 0)
  }
  return result
}

function looksTextual(data: Buffer): boolean {
  const sample = data.subarray(0, Math.min(data.length, 4096))
  let control = 0
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) control++
  return control / sample.length < 0.02
}
