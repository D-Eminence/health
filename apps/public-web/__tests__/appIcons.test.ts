// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The public site has a browser-tab icon and a home-screen (apple-touch) icon,
 * through Next's app/icon and app/apple-icon file conventions, derived from the
 * supplied mark (components/layout/Logo.tsx). It has no web app manifest: the
 * marketing site is not an app to install; the portal is (apps/patient-web).
 */
const site = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))
function png(path: string) {
  const bytes = readFileSync(path)
  const colourType = bytes[25]
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha: colourType === 4 || colourType === 6 }
}

describe('the public site’s icons', () => {
  it('has a tab icon and an opaque home-screen icon', () => {
    expect(png(site('app/icon.png'))).toMatchObject({ width: 48, height: 48 })
    expect(png(site('app/apple-icon.png'))).toEqual({ width: 180, height: 180, alpha: false })
  })

  it('has no web app manifest', () => {
    expect(readdirSync(site('app')).filter(name => /^manifest\./.test(name))).toEqual([])
    expect(existsSync(site('public')) ? readdirSync(site('public')).filter(name => name.endsWith('.webmanifest')) : []).toEqual([])
  })
})
