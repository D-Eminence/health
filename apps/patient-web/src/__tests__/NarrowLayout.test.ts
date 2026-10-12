import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * jsdom lays nothing out, so these guard the stylesheet rules that keep the
 * launch screens inside a phone's width and keep keyboard focus clear of the
 * sticky headers. They were measured in headless Chromium at 320 to 1280 px;
 * docs/LOG.md records the measurements.
 */
interface Rule { selectors: string[]; body: string; context: string[] }

function parse(css: string, context: string[] = []): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  let index = 0
  for (;;) {
    const open = source.indexOf('{', index)
    if (open < 0) break
    const before = source.slice(index, open)
    const prelude = before.slice(before.lastIndexOf(';') + 1).trim()
    let depth = 1
    let end = open + 1
    while (end < source.length && depth > 0) { if (source[end] === '{') depth += 1; else if (source[end] === '}') depth -= 1; end += 1 }
    const body = source.slice(open + 1, end - 1)
    if (/^@(media|layer|supports)\b/.test(prelude)) rules.push(...parse(body, [...context, prelude]))
    else rules.push({ selectors: prelude.split(',').map(selector => selector.trim()), body, context })
    index = end
  }
  return rules
}

function declared(css: string, selector: string, property: string, media?: string): string[] {
  return parse(css)
    .filter(rule => rule.selectors.includes(selector) && (media === undefined ? !rule.context.some(c => c.startsWith('@media')) : rule.context.includes(media)))
    .flatMap(rule => [...rule.body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'g'))].map(match => match[1]!.trim()))
}

// A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
const here = dirname(fileURLToPath(import.meta.url))
const portalCss = readFileSync(resolve(here, '../index.css'), 'utf8')
const staffCss = readFileSync(resolve(here, '../staff/style.css'), 'utf8')

describe('narrow screens', () => {
  it.each(['.patient-list strong', '.patient-list span', '.patient-list p'])(
    'lets long record values in %s wrap instead of widening the page', selector => {
      // A document file name or facility name without spaces is common (hid-system allows 255 characters).
      expect(declared(portalCss, selector, 'overflow-wrap')).toContain('anywhere')
    })

  it('lets long document names in the provider lists wrap', () => {
    expect(declared(staffCss, '.staff-list-item strong', 'overflow-wrap')).toContain('anywhere')
  })

  it('keeps the provider workspace column within the screen below 900px', () => {
    // A plain 1fr track grows to the nav strip's width (614px measured at 320px).
    expect(declared(staffCss, '.staff-layout', 'grid-template-columns', '@media (max-width: 900px)')).toContain('minmax(0, 1fr)')
  })

  it.each(['.staff-two-col', '.staff-form-row'])('keeps %s within the screen below 700px', selector => {
    expect(declared(staffCss, selector, 'grid-template-columns', '@media (max-width: 700px)')).toContain('minmax(0, 1fr)')
  })
})

describe('keyboard focus under the sticky headers', () => {
  it('scrolls a focused control clear of the tallest sticky header', () => {
    const padding = declared(portalCss, 'html', 'scroll-padding-top').map(value => Number.parseFloat(value))
    expect(padding).toHaveLength(1)
    // Patient header: 66px plus its 1px border. Provider top bar: 62px plus 1px. Admin mobile header: 56px.
    const patientHeader = Number.parseFloat(declared(portalCss, '.patient-app-header-inner', 'min-height')[0]!) + 1
    const staffTopbar = Number.parseFloat(declared(staffCss, '.staff-topbar', 'height')[0]!) + 1
    expect(padding[0]).toBeGreaterThan(Math.max(patientHeader, staffTopbar, 56))
  })
})
