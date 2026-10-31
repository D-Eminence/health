import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { valueAt } from '../../cssRules'

/**
 * The design audit's frame findings (audit/2026-10-30/rahman.md items 15, 18 and 20), as the design's own values
 * (design/ehr-target public/application.css). jsdom computes no style, so these read frame.css.
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../ehr-blue/frame/frame.css'), 'utf8')
const at = (selector: string, property: string, width = 1280) => valueAt(css, selector, property, width)

describe('the frame\'s audit minors', () => {
  it('15. names the facility in the top bar in the design\'s grey', () => {
    expect(at('.hid-ehr .hid-ehr-blue-facility', 'color')).toBe('var(--ehr-text)')
  })

  it('18. leaves the status bar undimmed under a drawer\'s scrim, beside the rail only', () => {
    const selector = '.hid-ehr.hid-ehr-shell:has(.hid-ehr-blue-statusbar) .hid-ehr-scrim.hid-ehr-scrim-drawer'
    expect(at(selector, 'bottom')).toBe(at('.hid-ehr .hid-ehr-blue-statusbar', 'height'))
    expect(at(selector, 'bottom', 390)).toBeUndefined()
  })

  it('20. draws the presence dot at the design\'s 11px, white-ringed, at the avatar\'s corner', () => {
    expect(at('.hid-ehr .hid-ehr-blue-presence', 'width')).toBe('11px')
    expect(at('.hid-ehr .hid-ehr-blue-presence', 'height')).toBe('11px')
    expect(at('.hid-ehr .hid-ehr-blue-presence', 'border')).toBe('2px solid #fff')
    expect(at('.hid-ehr .hid-ehr-blue-presence', 'right')).toBe('0')
    expect(at('.hid-ehr .hid-ehr-blue-presence', 'bottom')).toBe('0')
    expect(at('.hid-ehr .hid-ehr-blue-avatar', 'font-weight')).toBe('600')
  })
})
