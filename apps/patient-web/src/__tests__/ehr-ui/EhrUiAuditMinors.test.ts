import { describe, expect, it } from 'vitest'
import { valueAt } from '../cssRules'
import { ehrCss, readEhrFile } from './ehrCss'

/**
 * The design audit's UI-kit findings (audit/2026-10-30/rahman.md items 14-19), as the design's own values
 * (design/ehr-target public/application.css, src/icons.tsx). jsdom computes no style, so these read the source.
 */

const PHONE = 390
const DESKTOP = 1280
const at = (selector: string, property: string, width = DESKTOP) => valueAt(ehrCss, selector, property, width)

describe('14. the phone menu opens below the top bar', () => {
  it('sits under the bar, the sidebar\'s width, over a clear scrim', () => {
    expect(at('.hid-ehr .hid-ehr-phone-menu', 'position', PHONE)).toBe('fixed')
    expect(at('.hid-ehr .hid-ehr-phone-menu', 'top', PHONE)).toBe('var(--ehr-topbar-height-phone)')
    expect(at('.hid-ehr .hid-ehr-phone-menu', 'bottom', PHONE)).toBe('0')
    expect(at('.hid-ehr .hid-ehr-phone-menu', 'width', PHONE)).toBe('var(--ehr-sidebar-width)')
    expect(at('.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-menu', 'background', PHONE)).toBe('transparent')
  })
})

describe('15. titles are the design\'s grey', () => {
  it('draws page and card titles in --ehr-text, not --ehr-ink', () => {
    expect(at('.hid-ehr .hid-ehr-page-title', 'color')).toBe('var(--ehr-text)')
    expect(at('.hid-ehr .hid-ehr-card-title', 'color')).toBe('var(--ehr-text)')
  })
})

describe('16. form controls', () => {
  it('use 13px medium text with a 1.5 line, and the design\'s placeholder grey, with no height forced', () => {
    expect(at('.hid-ehr .hid-ehr-control', 'font-size')).toBe('13px')
    expect(at('.hid-ehr .hid-ehr-control', 'font-weight')).toBe('500')
    expect(at('.hid-ehr .hid-ehr-control', 'line-height')).toBe('1.5')
    expect(at('.hid-ehr .hid-ehr-control::placeholder', 'color')).toBe('#757575')
    expect(at('.hid-ehr .hid-ehr-control', 'height')).toBeUndefined()
  })
})

describe('17. status badges', () => {
  it('are regular weight on a 21px line: 27px tall with their 3px padding, as the design\'s .badge', () => {
    expect(at('.hid-ehr .hid-ehr-badge', 'font-weight')).toBe('400')
    expect(at('.hid-ehr .hid-ehr-badge', 'line-height')).toBe('21px')
    expect(at('.hid-ehr .hid-ehr-badge', 'padding')).toBe('3px 8px')
  })
})

describe('18. the drawer', () => {
  it('titles itself at 20px bold, and its Close is the design\'s text-only secondary button', () => {
    expect(at('.hid-ehr .hid-ehr-drawer .hid-ehr-overlay-title', 'font-size')).toBe('20px')
    expect(at('.hid-ehr .hid-ehr-drawer .hid-ehr-overlay-title', 'font-weight')).toBe('700')
    const drawer = readEhrFile('EhrDrawer.tsx')
    expect(drawer).toMatch(/<EhrButton ref=\{closeRef\} variant="secondary" onClick=\{requestClose\}>Close<\/EhrButton>/)
    expect(drawer).not.toMatch(/Cancel01Icon/)
  })

  it('leaves the sidebar rail undimmed beside it, expanded or collapsed, and covers the whole screen on a phone', () => {
    expect(at('.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-drawer::before', 'left')).toBe('var(--ehr-sidebar-width)')
    expect(at('.hid-ehr.hid-ehr-shell:has(.hid-ehr-sidebar-collapsed) .hid-ehr-scrim.hid-ehr-scrim-drawer::before', 'left'))
      .toBe('var(--ehr-sidebar-collapsed-width)')
    expect(at('.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-drawer::before', 'left', PHONE)).toBeUndefined()
    expect(at('.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-drawer::before', 'background', PHONE)).toBe('var(--ehr-scrim)')
  })

  it('keeps the clear scrim over the rail, so a press there keeps focus in the drawer', () => {
    // Only the dimming moves aside: the scrim itself still covers the whole window, where its press keeps focus.
    expect(at('.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-drawer', 'left')).toBeUndefined()
    expect(at('.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-drawer', 'background')).toBe('transparent')
    expect(at('.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-drawer::before', 'z-index')).toBe('-1')
  })
})

describe('19. the home and bell glyphs are the design\'s', () => {
  it('draws the design\'s paths, stroked as the other icons are', () => {
    const icons = readEhrFile('EhrIcon.tsx')
    expect(icons).toContain("d: 'M3 11 12 3l9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z'")
    expect(icons).toContain("d: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9'")
    expect(icons).toContain("d: 'M13.7 21a2 2 0 0 1-3.4 0'")
    expect(icons).toMatch(/home: DesignHomeIcon/)
    expect(icons).toMatch(/bell: DesignBellIcon/)
  })
})
