import { describe, expect, it } from 'vitest'
import { contrast, declarations, ehrRules, resolveVars, token } from './ehrCss'

/**
 * Colour contrast for the EHR foundation (WCAG 1.4.3 and 1.4.11), computed
 * from the values ehr.css declares rather than from copies of them. EHR text
 * is small, so it needs 4.5:1; a control's boundary and the focus ring need
 * 3:1 against every surface they sit on.
 */

const TEXT = 4.5
const NON_TEXT = 3
const WHITE = '#ffffff'

/** A token name, or a literal hex colour. */
const colour = (name: string) => (name.startsWith('#') ? name : token(name))

describe('EHR text colours', () => {
  it.each<[string, string, number | null]>([
    [WHITE, 'brand', 4.57],
    [WHITE, 'brand-dark', 5.99],
    ['ink', 'surface', 17.75],
    ['text', 'surface', 10.46],
    ['muted', 'surface', 7.69],
    ['muted', 'surface-tint', 7.16],
    ['muted', 'surface-sunk', 6.98],
    ['muted', 'tint', 7.06],
    ['brand-dark', 'tint', 5.5],
    ['positive', 'surface', 5.69],
    ['critical', 'surface', 6.57],
    ['nav-group-text', 'surface', 4.97],
    ['nav-group-text', 'surface-tint', 4.64],
    ['nav-group-text', 'surface-sunk', 4.51],
    ['nav-group-text', 'tint', 4.57],
    ['success-600', 'success-50', null],
    ['warning-600', 'warning-50', null],
    ['danger-text', 'danger-50', null],
    ['warning-banner-text', 'warning-banner-surface', null],
    ['tab-current-text', 'tab-current-surface', null],
  ])('%s on %s reaches 4.5:1', (foreground, background, expected) => {
    const ratio = contrast(colour(foreground), colour(background))
    expect(ratio).toBeGreaterThanOrEqual(TEXT)
    if (expected !== null) expect(ratio).toBeCloseTo(expected, 1)
  })

  it('declares the pairs the spec names', () => {
    expect([token('success-600'), token('success-50')]).toEqual(['#067647', '#ecfdf3'])
    expect([token('warning-600'), token('warning-50')]).toEqual(['#b54708', '#fffaeb'])
    expect([token('danger-text'), token('danger-50')]).toEqual(['#b42318', '#fef3f2'])
    expect([token('warning-banner-text'), token('warning-banner-surface')]).toEqual(['#b54708', '#fffaeb'])
    expect([token('tab-current-text'), token('tab-current-surface')]).toEqual(['#175cd3', '#eff6ff'])
    expect(token('nav-group-text')).toBe('#667085')
  })
})

describe('The control border and sidebar group heading (redesign: accessible values)', () => {
  // The redesign replaced the design's sub-WCAG control border (#c6c6cc) and group heading (#63758b) with #7d8799 and
  // #667085. These hold both at or above WCAG on every surface they sit on, so a change to either is a decision.
  it.each<[string, number]>([
    ['surface', 3.62],
    ['surface-tint', 3.38],
    ['surface-sunk', 3.29],
    ['tint', 3.33],
  ])('the control border #7d8799 reaches 3:1 on %s', (surface, expected) => {
    expect(token('control-border')).toBe('#7d8799')
    const ratio = contrast(token('control-border'), token(surface))
    expect(ratio).toBeGreaterThanOrEqual(NON_TEXT)
    expect(ratio).toBeCloseTo(expected, 1)
  })

  it('the sidebar group heading #667085 reaches 4.5:1 on surface-tint', () => {
    expect(token('nav-group-text')).toBe('#667085')
    const ratio = contrast(token('nav-group-text'), token('surface-tint'))
    expect(ratio).toBeGreaterThanOrEqual(TEXT)
    expect(ratio).toBeCloseTo(4.64, 1)
  })

  it('draws the focus ring at 3:1 or more on white', () => {
    expect(contrast(token('focus-ring-color'), WHITE)).toBeGreaterThanOrEqual(NON_TEXT)
  })
})

describe('Colour as ehr.css applies it', () => {
  const styleRules = ehrRules.filter(rule => !rule.selectors[0]!.startsWith('@'))
  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

  it('never sets faint or caution as a text colour (an icon may be faint)', () => {
    // The group heading token shares faint's value; it is its own token, held to 4.5:1 on every surface above.
    const forbidden = new Set([token('faint'), token('caution')])
    const offenders = styleRules.flatMap(rule => declarations(rule.body, 'color')
      .filter(value => value !== 'var(--ehr-nav-group-text)' && forbidden.has(resolveVars(value)))
      .flatMap(() => rule.selectors.filter(selector => !/-icon$/.test(selector))))
    expect(offenders).toEqual([])
  })

  it('reaches 4.5:1 wherever one rule sets both a text colour and an opaque background', () => {
    let checked = 0
    for (const rule of styleRules) {
      const text = declarations(rule.body, 'color').at(-1)
      const fill = [...declarations(rule.body, 'background'), ...declarations(rule.body, 'background-color')].at(-1)
      if (!text || !fill) continue
      const [foreground, background] = [resolveVars(text), resolveVars(fill)]
      if (!HEX.test(foreground) || !HEX.test(background)) continue
      checked += 1
      expect(contrast(foreground, background), rule.selectors.join(', ')).toBeGreaterThanOrEqual(TEXT)
    }
    expect(checked).toBeGreaterThan(15)
  })
})
