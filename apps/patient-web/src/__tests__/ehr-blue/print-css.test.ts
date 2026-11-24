import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * No web address on printed paper (owner, 23 Nov 2026). A browser prints the page's address, title and date in its own
 * header and footer, inside the page margin; with every page's margin at 0 there is no room for them, and each paper
 * pads itself instead. jsdom computes no print style, so these read the stylesheets.
 */

// A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, '../..', path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const PAPERS = [
  'ehr-blue/clinical/parts/clinicalPrint.css',
  'ehr-blue/departments/outreach/outreachSlip.css',
  'ehr-blue/departments/laboratory/lab.css',
  'ehr-blue/departments/commerce/commerce.css',
]

describe('print without a web address', () => {
  it('gives every page no margin, for the whole website', () => {
    expect(read('print.css')).toMatch(/@page\s*\{\s*margin:\s*0;?\s*\}/)
    expect(read('main.tsx')).toMatch(/import '\.\/print\.css'/)
  })

  it('keeps a margin on what prints, as padding repeated on every page', () => {
    const css = read('print.css')
    expect(css).toMatch(/@media print\s*\{[\s\S]*body\s*\{[^}]*padding:\s*\d+mm/)
    expect(css).toMatch(/box-decoration-break:\s*clone/)
  })

  it('gives each paper’s named page no margin either, and pads the paper instead', () => {
    for (const path of PAPERS) {
      const css = read(path)
      for (const [, body] of css.matchAll(/@page\s+[\w-]+\s*\{([^}]*)\}/g)) expect(body, path).toMatch(/margin:\s*0;/)
      expect(css, path).not.toMatch(/@page[^{]*\{[^}]*margin:\s*[1-9]/)
      const paddings = [...css.matchAll(/padding:\s*(\d+)mm\s*!important/g)].map(match => Number(match[1]))
      expect(paddings.length, path).toBeGreaterThan(0)
      expect(Math.min(...paddings), path).toBeGreaterThanOrEqual(2)
    }
  })

  it('leaves the app’s own sidebar, top bar and phone tabs off a page printed as it is', () => {
    const shell = read('kasuwa/AppShell.tsx')
    expect(shell).toMatch(/<aside className=\{cx\('[^']*print:hidden!/)
    expect(shell).toMatch(/<header className=\{cx\('[^']*print:hidden/)
    expect(shell).toMatch(/data-hid-bottom-nav className="[^"]*print:hidden/)
  })

  it('prints black ink on white whatever the screen’s theme: the header always, every line in dark theme', () => {
    const css = read('print.css')
    const print = css.slice(css.indexOf('@media print'))
    expect(print).toMatch(/\.hid-ehr\.hid-ehr-print-header,\s*\.hid-ehr\.hid-ehr-print-header \.hid-ehr-print-header-facility\s*\{[^}]*--ehr-ink:\s*#101828;[^}]*color:\s*#000 !important;[^}]*background:\s*transparent !important;/)
    expect(print).toMatch(/:root\[data-theme='dark'\] body \*\s*\{\s*color:\s*#000 !important;\s*background-color:\s*transparent !important;\s*\}/)
    // The dark theme's near-white ink is what it overrides (index.css), on the same .hid-ehr root the header carries.
    expect(read('index.css')).toMatch(/:root\[data-theme='dark'\] \.hid-ehr[^{]*\{[^}]*--ehr-ink:\s*#f5f5f6/)
  })

  it('shows the paper itself, not only hides the rest (a bare [data-…-print] lost to body:has(…) * and printed blank)', () => {
    for (const [path, name] of [['ehr-blue/departments/laboratory/lab.css', 'lab'], ['ehr-blue/departments/commerce/commerce.css', 'receipt']] as const) {
      const css = read(path)
      expect(css, path).toContain(`body:has([data-${name}-print]) * { visibility: hidden !important; }`)
      expect(css, path).toContain(`body:has([data-${name}-print]) [data-${name}-print], body:has([data-${name}-print]) [data-${name}-print] * { visibility: visible !important; }`)
    }
  })

  it('prints only the receipt or Health ID slip whose Print was pressed', () => {
    expect(read('ehr-blue/departments/commerce/commerce.css'))
      .toContain('body:has([data-receipt-print][data-print-chosen]) [data-receipt-print]:not([data-print-chosen]) { display: none !important; }')
  })

  it('shows the print-only header in print alone', () => {
    const ehr = readFileSync(resolve(here, '../../../../../packages/ui/src/ehr/ehr.css'), 'utf8')
    expect(ehr).toMatch(/\.hid-ehr\.hid-ehr-print-only\s*\{\s*display:\s*none;\s*\}/)
    expect(ehr).toMatch(/@media print\s*\{\s*\.hid-ehr\.hid-ehr-print-only\s*\{\s*display:\s*flex;\s*\}\s*\}/)
  })
})
