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
    [WHITE, 'brand', 5.0],
    [WHITE, 'brand-dark', 6.2],
    ['ink', 'surface', 17.35],
    ['text', 'surface', 8.28],
    ['muted', 'surface', 5.44],
    ['muted', 'surface-tint', 5.06],
    ['muted', 'surface-sunk', 4.84],
    ['muted', 'tint', 4.89],
    ['brand-dark', 'tint', 5.57],
    ['positive', 'surface', 4.92],
    ['critical', 'surface', 6.54],
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
    expect([token('success-600'), token('success-50')]).toEqual(['#146d3e', '#edf8f1'])
    expect([token('warning-600'), token('warning-50')]).toEqual(['#855b00', '#fff8e9'])
    expect([token('danger-text'), token('danger-50')]).toEqual(['#a9322d', '#fdf0ef'])
    expect([token('warning-banner-text'), token('warning-banner-surface')]).toEqual(['#94600c', '#fff7e6'])
    expect([token('tab-current-text'), token('tab-current-surface')]).toEqual(['#005dbd', '#e7f1ff'])
    expect(token('nav-group-text')).toBe('#63758b')
  })
})

describe('The design\'s exact values below WCAG contrast (owner decision)', () => {
  // The owner chose the design's own control border and sidebar group heading over the accessible substitutes of
  // PR #37. These record how far each falls short, so a change to either is a decision, not an accident.
  it.each<[string, number]>([
    ['surface', 1.7],
    ['surface-tint', 1.58],
    ['surface-sunk', 1.51],
    ['tint', 1.53],
  ])('the control border #c6c6cc is below 3:1 on %s', (surface, expected) => {
    expect(token('control-border')).toBe('#c6c6cc')
    const ratio = contrast(token('control-border'), token(surface))
    expect(ratio).toBeLessThan(NON_TEXT)
    expect(ratio).toBeCloseTo(expected, 1)
  })

  it('the sidebar group heading #63758b is below 4.5:1 on surface-tint', () => {
    expect(token('nav-group-text')).toBe('#63758b')
    const ratio = contrast(token('nav-group-text'), token('surface-tint'))
    expect(ratio).toBeLessThan(TEXT)
    expect(ratio).toBeCloseTo(4.39, 1)
  })

  it('draws the focus ring at 3:1 or more on white', () => {
    expect(contrast(token('focus-ring-color'), WHITE)).toBeGreaterThanOrEqual(NON_TEXT)
  })
})

describe('Colour as ehr.css applies it', () => {
  const styleRules = ehrRules.filter(rule => !rule.selectors[0]!.startsWith('@'))
  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

  it('never sets faint or caution as a text colour (an icon may be faint)', () => {
    const forbidden = new Set([token('faint'), token('caution')])
    const offenders = styleRules.flatMap(rule => declarations(rule.body, 'color')
      .filter(value => forbidden.has(resolveVars(value)))
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
