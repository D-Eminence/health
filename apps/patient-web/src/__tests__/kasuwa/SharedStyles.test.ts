import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appliesAt, parse } from '../cssRules'
import { buttonClass } from '../../kasuwa/ui'

/**
 * jsdom lays nothing out, so these guard the shared rules measured in Chromium (docs/LOG.md, 2026-11-03): the six code
 * boxes are drawn wherever they appear and shrink to a 320px screen, a text button and a disclosure are at least 24px
 * tall, and the bottom menu on phones never covers the control that has focus.
 */
const here = dirname(fileURLToPath(import.meta.url))
const portalCss = readFileSync(resolve(here, '../../index.css'), 'utf8')
const authCss = readFileSync(resolve(here, '../../authLayout.css'), 'utf8')

/** The value that wins at `width` for `selector`, reading a rule's `:not(…)` filters as part of what it matches. */
function declared(css: string, selector: string, property: string, width: number): string | undefined {
  const bare = (text: string) => text.replace(/:not\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  return parse(css)
    .filter(rule => rule.selectors.some(candidate => bare(candidate) === selector) && appliesAt(rule.context, width))
    .flatMap(rule => [...rule.body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'g'))].map(match => match[1]!.trim()))
    .at(-1)
}

describe('the six code boxes', () => {
  it.each([320, 360, 1366])('let their row shrink to the screen at %ipx, so the card is never pushed wider', width => {
    // The field is a grid: an auto track took the row's full width (6 × 52px + gaps = 352px) and widened the card.
    expect(declared(portalCss, '.patient-code-field', 'grid-template-columns', width)).toBe('minmax(0, 1fr)')
    expect(declared(portalCss, '.patient-code-boxes', 'min-width', width)).toBe('0')
    expect(declared(portalCss, '.patient-code-boxes', 'width', width)).toBe('100%')
  })

  it('draws each box in the portal (profile, emergency contacts), not only inside a sign-in form', () => {
    expect(declared(portalCss, '.patient-code-boxes input', 'border', 320)).toBe('1px solid var(--color-line-control)')
    expect(declared(portalCss, '.patient-code-boxes input', 'background', 320)).toBe('var(--color-surface)')
    expect(declared(portalCss, '.patient-code-boxes input:focus', 'border-color', 320)).toBe('var(--color-brand)')
    expect(declared(portalCss, ".patient-code-boxes input[aria-invalid='true']", 'border-color', 320)).toBe('var(--color-danger)')
  })

  it('draws each box on the sign-up, password reset and NIN code steps, whatever their form is called', () => {
    // Those forms have no .patient-form class: the boxes' only edge was scoped to it, so they showed as blank space.
    expect(declared(authCss, '.auth-panel .patient-code-boxes input', 'max-width', 320)).toBe('56px')
    expect(declared(authCss, '.auth-skin .auth-panel .patient-code-boxes input', 'box-shadow', 320)).toBe('inset 0 0 0 1px var(--color-line-strong)')
    expect(declared(authCss, '.auth-skin .auth-panel .patient-code-boxes input', 'background', 320)).toBe('var(--color-hero)')
    expect(declared(authCss, '.auth-skin .auth-panel .patient-code-boxes input:focus', 'box-shadow', 320)).toContain('#175cd3')
    expect(declared(authCss, ".auth-skin .auth-panel .patient-code-boxes input[aria-invalid='true']", 'box-shadow', 320)).toContain('var(--color-danger)')
  })
})

describe('a whole-page state\'s action (the session check\'s Try again, Reload after an error)', () => {
  it.each([320, 1366])('is a full-size button, 44px tall, at %ipx', width => {
    // The redesign's buttons are 40px; the one way on from a state screen is thumb-sized, as the shell's buttons are.
    expect(declared(portalCss, '.patient-state-actions .patient-primary-button', 'min-height', width)).toBe('44px')
    expect(declared(portalCss, '.patient-state-actions .patient-secondary-button', 'min-height', width)).toBe('44px')
  })
})

describe('small controls', () => {
  it('makes a text button (the link look) at least 24px tall, as "Send a new code" and "Use a different NIN"', () => {
    expect(buttonClass({ variant: 'link' }).split(' ')).toContain('min-h-6')
  })

  it.each([320, 1366])('makes every disclosure toggle at least 24px tall at %ipx', width => {
    // "Which records can I ask about?" was 19px, "Previous versions" 22px.
    expect(declared(portalCss, 'summary', 'min-height', width)).toBe('24px')
  })
})
