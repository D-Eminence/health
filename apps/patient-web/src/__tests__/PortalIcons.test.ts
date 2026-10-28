// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The Health ID mark in the browser tab and on a phone's home screen, as hid-1.0 had (its index.html 11-40): the
 * public site's own icons, copied to apps/patient-web/public, which Vite copies to the build root as they are and the
 * frontend Worker serves from its assets. No service worker comes with it.
 */
const here = dirname(fileURLToPath(import.meta.url))
const portal = resolve(here, '../..')
const shell = readFileSync(resolve(portal, 'index.html'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve(portal, 'public/health-id.webmanifest'), 'utf8')) as Record<string, unknown>
const tokens = readFileSync(resolve(portal, '../../packages/ui/src/tokens.css'), 'utf8')
const brand = /--color-brand:\s*(#[0-9a-f]{6});/i.exec(tokens)?.[1]
const png = (path: string) => readFileSync(resolve(portal, path))
/** A PNG's width and height, from its header. */
const size = (file: Buffer) => `${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`

describe('the portal\'s icon', () => {
  it('is the public site\'s icon, byte for byte', () => {
    expect(png('public/icons/icon-48.png').equals(png('../public-web/app/icon.png'))).toBe(true)
    expect(png('public/icons/apple-touch-icon.png').equals(png('../public-web/app/apple-icon.png'))).toBe(true)
    expect(size(png('public/icons/icon-48.png'))).toBe('48x48')
    expect(size(png('public/icons/apple-touch-icon.png'))).toBe('180x180')
  })

  it('is linked from the shell for the tab, the home screen and installing', () => {
    expect(shell).toContain('<link rel="icon" type="image/png" sizes="48x48" href="/icons/icon-48.png" />')
    expect(shell).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />')
    expect(shell).toContain('<link rel="manifest" href="/health-id.webmanifest" />')
  })

  it('takes its colour from the design tokens\' brand', () => {
    expect(brand).toBe('#086dd9')
    expect(shell).toContain(`<meta name="theme-color" content="${brand}" />`)
    expect(manifest.theme_color).toBe(brand)
  })

  it('installs as Health ID, opening the host\'s own workspace, with no service worker', () => {
    expect(manifest).toMatchObject({ id: '/', name: 'Health ID', short_name: 'Health ID', start_url: '/', scope: '/', display: 'standalone' })
    expect(manifest.icons).toEqual([
      { src: '/icons/icon-48.png', sizes: '48x48', type: 'image/png' },
      { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ])
    expect(manifest).not.toHaveProperty('serviceworker')
  })
})
