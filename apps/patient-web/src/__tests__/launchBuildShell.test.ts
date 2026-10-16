// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
 */
const repository = fileURLToPath(new URL('../../../..', import.meta.url))
const script = join(repository, 'scripts', 'check-launch-build.mjs')
const sourceShell = readFileSync(join(repository, 'apps', 'patient-web', 'index.html'), 'utf8')

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

/** Runs `npm run audit:launch-build` over a build holding this index.html and two hashed assets. */
function launchBuildCheck(html: string): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'hid-launch-shell-'))
  try {
    const dist = join(root, 'apps', 'patient-web', 'dist')
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), html)
    writeFileSync(join(dist, ENTRY), 'document.title = document.title\n')
    writeFileSync(join(dist, STYLE), 'body{margin:0}\n')
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const built = asBuilt(sourceShell)

describe('the portal shell staging accepts', () => {
  it('has only the meta tags staging accepts: a charset, or a viewport or robots name', () => {
    const metas = sourceShell.match(/<meta\b[^>]*>/gi) ?? []
    expect(metas.length).toBeGreaterThan(0)
    for (const meta of metas) {
      expect(meta).toMatch(/^<meta\s+(?:charset="utf-8"|name="(?:viewport|robots)"\s+content="[^"<>]*")\s*\/?>$/i)
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
    ['a theme-color meta', built.replace('<title>', '<meta name="theme-color" content="#ffffff" />\n    <title>'), /theme-color/],
    ['a linked web app manifest', built.replace('<title>', '<link rel="manifest" href="/health-id.webmanifest">\n    <title>'), /manifest/],
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
