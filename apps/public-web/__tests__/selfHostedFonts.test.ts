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
 * Forum and Inter are under the SIL Open Font License, which requires its text to travel with the fonts, so each
 * family's licence sits beside its files. app/fonts/README.md says where each file came from.
 */
const site = fileURLToPath(new URL('..', import.meta.url))
const fonts = join(site, 'app', 'fonts')
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** The committed files, as published in the npm packages README.md names (sha256 of the file as published). */
const FONTS: Record<string, { readonly sha256: string; readonly copyright: string }> = {
  'forum/forum-latin-400-normal.woff2': {
    sha256: '21eb0ef1c5f416bd7837e9bcf5c0ba1b026a9d56e5aed213871957ff442cae1d',
    copyright: 'Copyright (c) 2011, Denis Masharov',
  },
  'inter/inter-latin-wght-normal.woff2': {
    sha256: '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62',
    copyright: 'Copyright 2016 The Inter Project Authors',
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
  it('imports nothing from next/font/google, anywhere in the public site', () => {
    const importers = files(site)
      .filter(path => /\.(?:[cm]?[jt]sx?)$/.test(path))
      .filter(path => /['"]@?next\/font\/google['"]/.test(readFileSync(path, 'utf8')))
      .map(path => relative(site, path))
    expect(importers).toEqual([])
  })

  it('loads every face from a committed file through next/font/local', () => {
    const layout = readFileSync(join(site, 'app', 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/from 'next\/font\/local'/)
    const referenced = [...layout.matchAll(/'\.\/fonts\/([^']+)'/g)].map(match => match[1])
    expect([...new Set(referenced)].sort()).toEqual(Object.keys(FONTS).sort())
  })

  it('commits WOFF2 files only, each the file as published, with its family’s licence beside it', () => {
    expect(existsSync(fonts)).toBe(true)
    const committed = files(fonts).map(path => relative(fonts, path).split('\\').join('/'))
    const faces = committed.filter(path => !/(?:^|\/)(?:LICENSE|README\.md)$/.test(path))
    expect(faces.sort()).toEqual(Object.keys(FONTS).sort())

    for (const [file, expected] of Object.entries(FONTS)) {
      const bytes = readFileSync(join(fonts, file))
      expect(bytes.subarray(0, 4).toString('latin1'), file).toBe('wOF2')
      expect(sha256(bytes), file).toBe(expected.sha256)

      const licence = join(fonts, dirname(file), 'LICENSE')
      expect(existsSync(licence), `${file} has no LICENSE beside it`).toBe(true)
      const text = readFileSync(licence, 'utf8')
      expect(text, file).toContain(expected.copyright)
      expect(text, file).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007')
      expect(text, file).toContain('PERMISSION & CONDITIONS')
      expect(text, file).toContain('THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND')
    }
  })

  it('says where each file came from', () => {
    const readme = readFileSync(join(fonts, 'README.md'), 'utf8')
    for (const [file, expected] of Object.entries(FONTS)) {
      expect(readme).toContain(file)
      expect(readme).toContain(expected.sha256)
    }
  })
})
