import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, valueAt } from '../../../cssRules'

/**
 * The blue In-person check's own stylesheet, as today's check is guarded at a phone's width
 * (__tests__/AssistedRegistrationLayout.test.ts): a fieldset's default minimum width is its content's, so a group of
 * long statements would widen the page at 320px instead of wrapping; jsdom lays nothing out, so the rules that prevent
 * it are guarded here. Every rule stays under .hid-ehr with the page's own prefix.
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../../ehr-blue/departments/inperson/inperson.css'), 'utf8')
const PHONE = 320

describe('the in-person check’s stylesheet', () => {
  it('keeps every rule under .hid-ehr with the page’s prefix', () => {
    const selectors = parse(css).flatMap(rule => rule.selectors)
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) expect(selector).toMatch(/^\.hid-ehr \.hid-ehr-dept-inperson-[a-z-]+(\b|$)/)
  })

  it('lets its groups shrink to the screen and its statements wrap at 320px', () => {
    for (const group of ['.hid-ehr .hid-ehr-dept-inperson-group', '.hid-ehr .hid-ehr-dept-inperson-method']) {
      expect(valueAt(css, group, 'min-width', PHONE)).toBe('0')
      expect(valueAt(css, group, 'border', PHONE)).toBe('0')
    }
    expect(valueAt(css, '.hid-ehr .hid-ehr-dept-inperson-choice', 'overflow-wrap', PHONE)).toBe('anywhere')
    // A statement's box keeps its size beside words that wrap.
    expect(valueAt(css, '.hid-ehr .hid-ehr-dept-inperson-choice input', 'flex', PHONE)).toBe('none')
    expect(valueAt(css, '.hid-ehr .hid-ehr-dept-inperson-choice', 'min-height', PHONE)).toBe('40px')
  })

  it('stacks a result’s detail over its words on a phone', () => {
    expect(valueAt(css, '.hid-ehr .hid-ehr-dept-inperson-results > li', 'grid-template-columns', 1440)).toBe('minmax(90px, 1fr) minmax(0, 2fr)')
    expect(valueAt(css, '.hid-ehr .hid-ehr-dept-inperson-results > li', 'grid-template-columns', PHONE)).toBe('minmax(0, 1fr)')
  })
})
