import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { valueAt } from './cssRules'

/**
 * The screens of facility-assisted registration (hid-system #85) at a phone's
 * width. A fieldset's default minimum width is its content's (min-content), so a
 * group of long statements or radio labels would widen the page at 320px instead
 * of wrapping; jsdom lays nothing out, so the rules that prevent it are guarded here.
 */
const here = dirname(fileURLToPath(import.meta.url))
const staffCss = readFileSync(resolve(here, '../staff/style.css'), 'utf8')
const adminCss = readFileSync(resolve(here, '../admin/style.css'), 'utf8')
const PHONE = 320

describe('facility-assisted registration at 320px', () => {
  it('lets the in-person check’s groups shrink to the screen and its statements wrap', () => {
    expect(valueAt(staffCss, '.staff-in-person fieldset', 'min-width', PHONE)).toBe('0')
    expect(valueAt(staffCss, ['.staff-choice', '.staff-in-person .staff-choice'], 'overflow-wrap', PHONE)).toBe('anywhere')
    // A wrapped statement keeps space above and below it, inside its 44px target.
    expect(valueAt(staffCss, '.staff-in-person .staff-choice', 'padding', PHONE)).toBe('10px 12px')
  })

  it('lets the designation’s status group shrink to the screen, with its radios at their own size', () => {
    expect(valueAt(adminCss, '.admin-designation-status', 'min-width', PHONE)).toBe('0')
    expect(valueAt(adminCss, ".admin-designation-form input[type='radio']", 'width', PHONE)).toBe('auto')
  })
})
