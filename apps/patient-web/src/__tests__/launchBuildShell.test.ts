// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * hid-system's staging step (infra/cloudflare/scripts/health-id-artifact.mjs,
 * `inspectIndexHtml`) allow-lists the portal's index.html: a doctype, html,
 * head, meta charset or a meta named viewport or robots, a title, one module
 * entry script and modulepreload or stylesheet links from the build's own
 * /assets/, comments, and a body with the root div. Anything else refuses the
 * build for every host and environment, so www and admin cannot be staged.
 * Health-id #60 added `<meta name="theme-color">`, which it refuses, and
 * `audit:launch-build` did not check the shell, so it passed.
 *
 * Since the Health ID icon was added (hid-1.0 parity, 2026-10-28) the check is
 * that copy widened by exactly the icon files in apps/patient-web/public, the
 * shell's links to them and a #rrggbb theme-color (check-launch-build.mjs).
 */
const repository = fileURLToPath(new URL('../../../..', import.meta.url))
const script = join(repository, 'scripts', 'check-launch-build.mjs')
const sourceShell = readFileSync(join(repository, 'apps', 'patient-web', 'index.html'), 'utf8')
const publicFiles = join(repository, 'apps', 'patient-web', 'public')

const ENTRY = 'assets/index-AbCdEf12.js'
const STYLE = 'assets/index-GhIjKl34.css'
const SOURCE_ENTRY = '<script type="module" src="/src/main.tsx"></script>'

/** The shell as Vite writes it: the source entry swapped for the hashed bundle, with its stylesheet. */
function asBuilt(html: string): string {
  expect(html).toContain(SOURCE_ENTRY)
  return html.replace(SOURCE_ENTRY, '').replace('</head>',
    `  <script type="module" crossorigin src="/${ENTRY}"></script>\n`
    + `    <link rel="stylesheet" crossorigin href="/${STYLE}">\n  </head>`)
}

/**
 * Runs `npm run audit:launch-build` over a build holding this index.html, two hashed assets and, as Vite copies them,
 * the files in apps/patient-web/public; `files` adds or replaces files in it.
 */
function launchBuildCheck(html: string, files: Record<string, string> = {}): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'hid-launch-shell-'))
  try {
    const dist = join(root, 'apps', 'patient-web', 'dist')
    mkdirSync(join(dist, 'assets'), { recursive: true })
    cpSync(publicFiles, dist, { recursive: true })
    writeFileSync(join(dist, 'index.html'), html)
    writeFileSync(join(dist, ENTRY), 'document.title = document.title\n')
    writeFileSync(join(dist, STYLE), 'body{margin:0}\n')
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dist, path, '..'), { recursive: true })
      writeFileSync(join(dist, path), content)
    }
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const built = asBuilt(sourceShell)

describe('the portal shell staging accepts', () => {
  it('has only the meta tags the check accepts: a charset, a viewport or robots name, or a #rrggbb theme-color', () => {
    const metas = sourceShell.match(/<meta\b[^>]*>/gi) ?? []
    expect(metas.length).toBeGreaterThan(0)
    for (const meta of metas) {
      expect(meta).toMatch(/^<meta\s+(?:charset="utf-8"|name="(?:viewport|robots)"\s+content="[^"<>]*"|name="theme-color"\s+content="#[0-9a-f]{6}")\s*\/?>$/i)
    }
  })

  it('passes the launch build check as Vite builds it', () => {
    const result = launchBuildCheck(built)
    expect(result.output).not.toMatch(/failed/)
    expect(result.status).toBe(0)
  })
})

describe('the launch build check refuses a shell staging refuses', () => {
  it.each([
    ['a theme-color that is not a colour', built.replace('content="#086dd9"', 'content="url(https://evil.example/)"'), /theme-color/],
    ['a web app manifest linked from another file', built.replace('href="/health-id.webmanifest"', 'href="/manifest.json"'), /as manifest/],
    ['an icon from another origin', built.replace('href="/icons/icon-48.png"', 'href="https://cdn.example.test/icon.png"'), /as icon/],
    ['an icon linked as the manifest', built.replace('href="/health-id.webmanifest"', 'href="/icons/icon-48.png"'), /as manifest/],
    ['an inline script', built.replace('<title>', '<script>window.x = 1</script>\n    <title>'), /inline script/],
    ['a script from another origin', built.replace(`src="/${ENTRY}"`, 'src="https://cdn.example.test/app.js"'),
      /outside its own \/assets\//],
    ['an element outside the shell', built.replace('<title>', '<base href="/">\n    <title>'), /<base>/],
    ['no doctype', built.replace('<!doctype html>', ''), /doctype/],
  ])('%s', (_name, html, reason) => {
    const result = launchBuildCheck(html)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(reason)
  })
})

describe('the launch build check refuses a build staging refuses', () => {
  const manifest = readFileSync(join(publicFiles, 'health-id.webmanifest'), 'utf8')
  it.each([
    ['another web app manifest', { 'manifest.json': '{}' }, /manifest\.json is a web app manifest other than health-id\.webmanifest/],
    ['a file outside assets/ that is not an icon file', { 'icons/extra.png': 'png' }, /icons\/extra\.png is outside the expected set/],
    ['a manifest that names a service worker', { 'health-id.webmanifest': JSON.stringify({ ...JSON.parse(manifest), serviceworker: { src: '/sw.js' } }) },
      /names a service worker/],
    ['a manifest icon from outside the build', { 'health-id.webmanifest': JSON.stringify({ ...JSON.parse(manifest), icons: [{ src: 'https://cdn.example.test/i.png' }] }) },
      /names an icon/],
    ['a service worker', { 'service-worker.js': 'self.skipWaiting()' }, /service-worker\.js is a service worker/],
  ])('%s', (_name, files, reason) => {
    const result = launchBuildCheck(built, files)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(reason)
  })
})
