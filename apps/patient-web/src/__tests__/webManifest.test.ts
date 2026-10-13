// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The portal can be installed as an app: a web app manifest named Health ID,
 * with icons at 192 and 512 pixels (plain and maskable), opened standalone at
 * the host's own start page. It is installability only: Health ID registers no
 * service worker and keeps no page or data for offline use (docs/ARCHITECTURE.md).
 */
const app = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))
const tokens = readFileSync(fileURLToPath(new URL('../../../../packages/ui/src/tokens.css', import.meta.url)), 'utf8')
const page = tokens.match(/--color-page:\s*(#[0-9a-f]{6})/i)?.[1]

interface ManifestIcon { src: string; sizes: string; type: string; purpose: string }
const manifest = JSON.parse(readFileSync(app('public/health-id.webmanifest'), 'utf8')) as Record<string, unknown> & { icons: ManifestIcon[] }

/** A PNG's width, height and whether it has an alpha channel, from its IHDR chunk. */
function png(path: string) {
  const bytes = readFileSync(path)
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  const colourType = bytes[25]
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha: colourType === 4 || colourType === 6 }
}

describe('the portal’s web app manifest', () => {
  it('names Health ID and opens standalone at the host’s own start page', () => {
    expect(manifest).toMatchObject({ id: '/', name: 'Health ID', short_name: 'Health ID', start_url: '/', scope: '/', display: 'standalone' })
    expect(String(manifest.short_name).length).toBeLessThanOrEqual(12)
    // Each product and admin host routes '/' to its own workspace (ProductHostnameGate), so no query is added.
    expect(String(manifest.start_url)).not.toContain('?')
  })

  it('uses the page colour from the design tokens', () => {
    expect(page).toBeTruthy()
    expect(manifest.theme_color).toBe(page)
    expect(manifest.background_color).toBe(page)
  })

  it.each([['any', 192], ['any', 512], ['maskable', 192], ['maskable', 512]] as const)('has a %s icon at %ipx', (purpose, size) => {
    const icon = manifest.icons.find(item => item.purpose === purpose && item.sizes === `${size}x${size}`)
    expect(icon).toBeTruthy()
    expect(icon!.type).toBe('image/png')
    const file = png(app(`public${icon!.src}`))
    expect([file.width, file.height]).toEqual([size, size])
    // A maskable icon fills its canvas; a launcher's mask cuts the edge.
    if (purpose === 'maskable') expect(file.alpha).toBe(false)
  })

  it('declares nothing that could show a person’s data or open other apps', () => {
    for (const key of ['screenshots', 'shortcuts', 'share_target', 'protocol_handlers', 'related_applications', 'file_handlers']) {
      expect(manifest).not.toHaveProperty(key)
    }
  })
})

describe('the portal page head', () => {
  const html = readFileSync(app('index.html'), 'utf8')
  const href = (rel: string) => html.match(new RegExp(`<link rel="${rel}"[^>]*href="([^"]+)"`))?.[1]

  it('links the manifest, its theme colour and the icons, which exist', () => {
    expect(href('manifest')).toBe('/health-id.webmanifest')
    expect(html).toContain(`<meta name="theme-color" content="${String(manifest.theme_color)}" />`)
    const icon = href('icon'); const apple = href('apple-touch-icon')
    expect(icon && existsSync(app(`public${icon}`))).toBe(true)
    expect(apple && existsSync(app(`public${apple}`))).toBe(true)
    const appleIcon = png(app(`public${apple!}`))
    expect([appleIcon.width, appleIcon.height, appleIcon.alpha]).toEqual([180, 180, false])
  })

  it('keeps patient screens out of search engines, and its tab title', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(html).toContain('<title>Health ID: Patient</title>')
  })

  it('registers no service worker', () => {
    expect(html).not.toMatch(/serviceWorker/)
  })
})
