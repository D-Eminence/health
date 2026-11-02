// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The public site's typefaces are files in the repo (app/fonts), loaded with next/font/local. next/font/google
 * downloaded them from Google at build time, and that download intermittently came back as something Next could
 * not read ("next/font/google queries have exactly one entry"), failing the public build in CI on several PRs.
 * The committed files are the ones that download fetched, so visitors get the same bytes as before. Forum and Inter
 * are under the SIL Open Font License, which requires its text to travel with the fonts, so each family's OFL.txt
 * sits beside its file. app/fonts/README.md says where each file came from.
 */
const site = fileURLToPath(new URL('..', import.meta.url))
const fonts = join(site, 'app', 'fonts')
const tokens = join(site, '..', '..', 'packages', 'ui', 'src', 'tokens.css')
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

interface Licence {
  readonly sha256: string
  readonly copyright: string
  /** The name the author reserves in the licence's opening lines, if any. */
  readonly reservedName: string | null
}

/**
 * The committed files: the latin WOFF2 Google Fonts served next/font/google for this site, and the OFL.txt that
 * google/fonts publishes for each family (sha256 of each as fetched; README.md names the URL and commit).
 */
const FONTS: Record<string, { readonly sha256: string; readonly licence: Licence }> = {
  'forum/forum-latin-400-normal.woff2': {
    sha256: '678331fb318a613e6f7e4db9e608545b7ab57c192d215882caee23d4d787264d',
    licence: {
      sha256: '1bfe7d2aca99042eabf37079152fef8abdda2c36dad454ae89b858a3cb1078c5',
      copyright: 'Copyright (c) 2011, Denis Masharov',
      reservedName: 'Forum',
    },
  },
  'inter/inter-latin-wght-normal.woff2': {
    sha256: 'c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4',
    licence: {
      sha256: '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57',
      copyright: 'Copyright 2020 The Inter Project Authors',
      reservedName: null,
    },
  },
}

/** Every file under a directory, skipping dependencies and build output. */
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.next', 'out'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path)
    return entry.isFile() ? [path] : []
  })
}

describe('the public site’s fonts', () => {
  it('fetches no font from Google, anywhere in the public site’s code or stylesheets', () => {
    const sources = files(site).filter(path => /\.(?:[cm]?[jt]sx?|css)$/.test(path))
    const importers = sources
      .filter(path => /['"]@?next\/font\/google['"]/.test(readFileSync(path, 'utf8')))
      .map(path => relative(site, path))
    expect(importers).toEqual([])
    // A <link> or CSS @import pointing at Google's font hosts would bring the request back by another road.
    const linkers = sources
      .filter(path => /fonts\.(?:googleapis|gstatic)\.com/.test(readFileSync(path, 'utf8')))
      .map(path => relative(site, path))
    expect(linkers).toEqual([])
  })

  it('loads every face from a committed file through next/font/local', () => {
    const layout = readFileSync(join(site, 'app', 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/from 'next\/font\/local'/)
    const referenced = [...layout.matchAll(/'\.\/fonts\/([^']+)'/g)].map(match => match[1])
    expect([...new Set(referenced)].sort()).toEqual(Object.keys(FONTS).sort())
  })

  it('keeps the CSS variables the stylesheets read', () => {
    const layout = readFileSync(join(site, 'app', 'layout.tsx'), 'utf8')
    const declared = [...layout.matchAll(/variable: '(--font-[\w-]+)'/g)].map(match => match[1] ?? '')
    expect(declared.sort()).toEqual(['--font-forum', '--font-inter'])

    // Every --font-* a stylesheet or component reads is one layout.tsx declares or one a stylesheet defines
    // (@hid/ui's tokens among them), so renaming a variable here cannot quietly drop a face to its fallback.
    const consumers = [...files(join(site, 'app')), ...files(join(site, 'components'))].filter(path =>
      /\.(?:css|tsx?)$/.test(path),
    )
    const text = [...consumers, tokens].map(path => readFileSync(path, 'utf8')).join('\n')
    const defined = new Set([...declared, ...[...text.matchAll(/(--font-[\w-]+)\s*:/g)].map(match => match[1])])
    const read = new Set([...text.matchAll(/\(\s*(--font-[\w-]+)\s*[,)]/g)].map(match => match[1] ?? ''))
    expect(read).toContain('--font-forum')
    expect(read).toContain('--font-inter')
    expect([...read].filter(name => !defined.has(name))).toEqual([])
  })

  it('commits WOFF2 files only, each the file as fetched, with its family’s licence beside it', () => {
    expect(existsSync(fonts)).toBe(true)
    const committed = files(fonts).map(path => relative(fonts, path).split('\\').join('/'))
    const faces = committed.filter(path => !/(?:^|\/)(?:OFL\.txt|README\.md)$/.test(path))
    expect(faces.sort()).toEqual(Object.keys(FONTS).sort())

    for (const [file, expected] of Object.entries(FONTS)) {
      const bytes = readFileSync(join(fonts, file))
      expect(bytes.subarray(0, 4).toString('latin1'), file).toBe('wOF2')
      expect(sha256(bytes), file).toBe(expected.sha256)

      const licence = join(fonts, dirname(file), 'OFL.txt')
      expect(existsSync(licence), `${file} has no OFL.txt beside it`).toBe(true)
      const text = readFileSync(licence, 'utf8')
      expect(sha256(readFileSync(licence)), `${file}: OFL.txt`).toBe(expected.licence.sha256)
      expect(text, file).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007')
      expect(text, file).toContain('PERMISSION & CONDITIONS')
      expect(text, file).toContain('THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND')

      // The copyright lines above the licence are where an author reserves a font name.
      const notice = text.slice(0, text.indexOf('This Font Software is licensed'))
      expect(notice, file).toContain(expected.licence.copyright)
      if (expected.licence.reservedName) {
        expect(notice, file).toContain(`with Reserved Font Name "${expected.licence.reservedName}"`)
      } else {
        expect(notice, file).not.toMatch(/Reserved Font Name/)
      }
    }
  })

  it('says where each file came from, and which names are reserved', () => {
    const readme = readFileSync(join(fonts, 'README.md'), 'utf8')
    for (const [file, expected] of Object.entries(FONTS)) {
      expect(readme).toContain(file)
      expect(readme).toContain(expected.sha256)
      expect(readme).toContain(`${dirname(file)}/OFL.txt`)
      expect(readme).toContain(expected.licence.sha256)
      if (expected.licence.reservedName) {
        expect(readme).toContain(`Reserved Font Name "${expected.licence.reservedName}"`)
      }
    }
  })
})
