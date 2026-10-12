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

describe('the guard itself', () => {
  it('reads the value that wins, so a later rule that undoes a fix is caught', () => {
    const undone = `${staffCss}\n@media (max-width: 900px) { .staff-layout { grid-template-columns: 1fr; } }`
    expect(valueAt(undone, '.staff-layout', 'grid-template-columns', PHONE)).toBe('1fr')
    expect(valueAt(undone, '.staff-layout', 'grid-template-columns', 901)).not.toBe('1fr')
  })
})
