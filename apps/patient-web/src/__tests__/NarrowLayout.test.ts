import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { valueAt } from './cssRules'

/**
 * jsdom lays nothing out, so these guard the stylesheet rules that keep the
 * launch screens inside a phone's width and keyboard focus clear of the sticky
 * headers. They were measured in headless Chromium at 320 to 1280px; docs/LOG.md
 * records the measurements. Each check reads the value that wins at a width: the
 * last declaration, in source order, among the rules that apply there.
 */

// A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
const here = dirname(fileURLToPath(import.meta.url))
const portalCss = readFileSync(resolve(here, '../index.css'), 'utf8')
const staffCss = readFileSync(resolve(here, '../staff/style.css'), 'utf8')
const tokensCss = readFileSync(resolve(here, '../../../../packages/ui/src/tokens.css'), 'utf8')
const PHONE = 320
const DESKTOP = 1280

describe('narrow screens', () => {
  it.each([PHONE, 768, DESKTOP])('lets long record values in the patient list wrap at %ipx', width => {
    // A document file name or facility name without spaces is common (hid-system allows 255 characters).
    expect(valueAt(portalCss, '.patient-list li > div:first-child :is(strong, span, p)', 'overflow-wrap', width)).toBe('anywhere')
  })

  it('lets a list item\'s trailing note wrap anywhere on a phone, where the item is one column', () => {
    expect(valueAt(portalCss, '.patient-list li > p', 'overflow-wrap', PHONE)).toBe('anywhere')
  })

  it.each([768, DESKTOP])('wraps a trailing note only between words at %ipx, beside the title column', width => {
    // Wrapping anywhere there split one-word notes ("Uncontrolle" / "d") once a long title shared the row.
    expect(valueAt(portalCss, '.patient-list li > p', 'overflow-wrap', width)).toBe('break-word')
  })

  it('lets a long contact in an enrollment hint wrap', () => {
    // The code step repeats the email or phone as typed; a long address widened the page at 320 and 360px.
    expect(valueAt(portalCss, '.patient-field-hint', 'overflow-wrap', PHONE)).toBe('anywhere')
  })

  it('lets the text of an enrollment route option wrap on a phone', () => {
    // The routes to prove a NIN are full sentences beside their actions; a facility name or address may be long.
    expect(valueAt(portalCss, '.patient-enroll-option :is(p, li)', 'overflow-wrap', PHONE)).toBe('anywhere')
  })

  it('lets long document names in the provider lists wrap', () => {
    expect(valueAt(staffCss, '.staff-list-item strong', 'overflow-wrap', PHONE)).toBe('anywhere')
  })

  it.each([PHONE, 390, 900])('keeps the provider workspace column within the screen at %ipx', width => {
    // A plain 1fr track grows to the navigation strip's width (614px measured at 320px).
    expect(valueAt(staffCss, '.staff-layout', 'grid-template-columns', width)).toBe('minmax(0, 1fr)')
  })

  it.each(['.staff-two-col', '.staff-form-row'])('keeps %s within the screen on a phone', selector => {
    expect(valueAt(staffCss, selector, 'grid-template-columns', PHONE)).toBe('minmax(0, 1fr)')
  })
})

describe('reading order', () => {
  // A denial or revocation reason's rule comes after its field in the page, and
  // before Confirm and Cancel; it is shown in that order too, at every width.
  it.each([PHONE, 768, DESKTOP])('shows a reason\'s rule where it is read, between the field and the buttons, at %ipx', width => {
    expect(valueAt(portalCss, '.patient-deny-form .patient-field-hint', 'order', width) ?? '0').toBe('0')
    expect(valueAt(portalCss, '.patient-deny-form button', 'order', width) ?? '0').toBe('0')
  })
})

describe('keyboard focus under the sticky headers', () => {
  it('scrolls a focused control clear of the tallest sticky header', () => {
    const padding = Number.parseFloat(valueAt(portalCss, 'html', 'scroll-padding-top', PHONE) ?? '0')
    // Patient header: 66px plus its 1px border. Provider top bar: 62px, border included. Admin mobile header: 56px.
    const patientHeader = Number.parseFloat(valueAt(portalCss, '.patient-app-header-inner', 'min-height', PHONE)!) + 1
    const staffTopbar = Number.parseFloat(valueAt(staffCss, '.staff-topbar', 'height', PHONE)!)
    expect(padding).toBeGreaterThan(Math.max(patientHeader, staffTopbar, 56))
    expect(valueAt(portalCss, 'html', 'scroll-padding-top', DESKTOP)).toBe(valueAt(portalCss, 'html', 'scroll-padding-top', PHONE))
  })
})

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
      .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('the facility question', () => {
  it.each([PHONE, DESKTOP])('fills the workspace at %ipx, with no sidebar track beside it', width => {
    // While the facility is chosen the sidebar is gone and the question is the layout's only child; on the
    // sidebar's grid it fell into the sidebar-width first track.
    expect(valueAt(staffCss, ['.staff-layout', '.staff-layout-single'], 'grid-template-columns', width)).toBe('minmax(0, 1fr)')
  })
})

describe('the facility question while its choice is saved', () => {
  // Its options are disabled meanwhile (the fieldset). Each shows it, as a disabled field of @hid/ui does
  // (not-allowed, tinted, muted), not only its small radio, and its name stays readable in either theme.
  const disabledOption = '.staff-facility-choice fieldset:disabled .staff-choice'

  it('shows each option as unavailable, and still readable', () => {
    expect(valueAt(staffCss, disabledOption, 'cursor', DESKTOP)).toBe('not-allowed')
    expect(valueAt(staffCss, disabledOption, 'color', DESKTOP)).toBe('var(--color-muted)')
    expect(valueAt(staffCss, disabledOption, 'background', DESKTOP)).toBe('var(--color-surface-tint)')
    for (const theme of ['@theme', "[data-theme='dark']"]) {
      const text = valueAt(tokensCss, theme, '--color-muted', DESKTOP)!
      const fill = valueAt(tokensCss, theme, '--color-surface-tint', DESKTOP)!
      expect(contrast(text, fill), theme).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the guard itself', () => {
  it('reads the value that wins, so a later rule that undoes a fix is caught', () => {
    const undone = `${staffCss}\n@media (max-width: 900px) { .staff-layout { grid-template-columns: 1fr; } }`
    expect(valueAt(undone, '.staff-layout', 'grid-template-columns', PHONE)).toBe('1fr')
    expect(valueAt(undone, '.staff-layout', 'grid-template-columns', 901)).not.toBe('1fr')
  })
})
