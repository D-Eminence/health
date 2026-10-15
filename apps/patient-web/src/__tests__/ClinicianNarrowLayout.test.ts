import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { valueAt } from './cssRules'

/**
 * jsdom lays nothing out, so these guard the rules that keep the clinician
 * sign-up and status pages inside a 320px phone: six step names, a facility
 * or licence without spaces, the facts beside their names, and the withdraw
 * dialog.
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../staff/clinician/clinician.css'), 'utf8')
const PHONE = 320
const DESKTOP = 1280

describe('clinician pages on a phone', () => {
  it('wraps the six step names onto more rows rather than squeezing them', () => {
    expect(valueAt(css, '.clinician-steps', 'flex-wrap', PHONE)).toBe('wrap')
    expect(valueAt(css, '.clinician-steps li', 'min-width', PHONE)).toBe('0')
  })

  it.each(['.clinician-card', '.clinician-application', '.clinician-facts dd'])('lets long words wrap anywhere in %s', selector => {
    expect(valueAt(css, selector, 'overflow-wrap', PHONE)).toBe('anywhere')
  })

  it('puts each fact under its name on a phone, beside it on a desktop', () => {
    expect(valueAt(css, '.clinician-facts', 'grid-template-columns', PHONE)).toBe('minmax(0, 1fr)')
    expect(valueAt(css, '.clinician-facts', 'grid-template-columns', DESKTOP)).toBe('max-content minmax(0, 1fr)')
  })

  it('keeps radios and checkboxes their own size inside a full-width form', () => {
    expect(valueAt(css, '.patient-form .clinician-choice input', 'width', PHONE)).toBe('18px')
    expect(valueAt(css, '.patient-form .clinician-choice input', 'min-height', PHONE)).toBe('0')
  })

  it('keeps the withdraw dialog within the screen', () => {
    expect(valueAt(css, '.clinician-dialog', 'width', PHONE)).toBe('min(100%, 26rem)')
    expect(valueAt(css, '.clinician-dialog-backdrop', 'padding', PHONE)).toBe('16px')
  })
})
