// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The Health ID mark in the browser tab and on a phone's home screen, as hid-1.0 had (its index.html 11-40): the
 * public site's own icons, copied to apps/patient-web/public, which Vite copies to the build root as they are and the
 * frontend Worker serves from its assets. The installable app (B6, contract b6-contract.md §11.1) adds 192 and 512
 * icons and a maskable 512, made once from the 180 px mark with sharp. The manifest names no service worker: the push
 * worker (public/sw.js) is registered by Settings only, when the patient turns notifications on.
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
/** A PNG's colour type (IHDR byte 25): 2 is RGB, with no alpha. */
const colourType = (file: Buffer) => file.readUInt8(25)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

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
    expect(brand).toBe('#1570ef')
    expect(shell).toContain(`<meta name="theme-color" content="${brand}" />`)
    expect(manifest.theme_color).toBe(brand)
  })

  it('installs as Health ID, opening the host\'s own workspace, with no service worker', () => {
    // Exactly contract §11.1.
    expect(manifest).toEqual({
      id: '/', name: 'Health ID', short_name: 'Health ID', description: 'Your Health ID: your health records, and who can see them.',
      start_url: '/', scope: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#1570ef',
      icons: [
        { src: '/icons/icon-48.png', sizes: '48x48', type: 'image/png' },
        { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    })
    expect(manifest).not.toHaveProperty('serviceworker')
    expect(manifest).not.toHaveProperty('serviceworkers')
  })

  it.each([
    ['public/icons/icon-192.png', '192x192'],
    ['public/icons/icon-512.png', '512x512'],
    ['public/icons/icon-maskable-512.png', '512x512'],
  ])('ships %s as an RGB PNG of %s, as the manifest says', (path, dimensions) => {
    const file = png(path)
    expect(file.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect(file.toString('latin1', 12, 16)).toBe('IHDR')
    expect(size(file)).toBe(dimensions)
    expect(colourType(file)).toBe(2)
    const named = (manifest.icons as Array<{ src: string; sizes: string }>).find(icon => icon.src === `/${path.replace(/^public\//, '')}`)
    expect(named?.sizes).toBe(dimensions)
  })

  it('makes the maskable icon a mark on white inside the safe zone, not the full-bleed 512', () => {
    expect(png('public/icons/icon-maskable-512.png').equals(png('public/icons/icon-512.png'))).toBe(false)
  })
})
