import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusIsLost } from './focus'

/**
 * The provider workspace's check that a step may move focus (useFocusById's
 * ifLost, the OCR steps) judges lost focus as the patient portal and the
 * page-change focus do (focusLost), and also takes focus already on its target
 * as lost, so a step that rebuilt it focuses it again.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { document.body.innerHTML = '' })

function page() {
  document.body.innerHTML = '<button type="button">Save</button><input aria-label="Notes"><h2 id="next" tabindex="-1">Next step</h2>'
  return {
    button: document.querySelector('button')!,
    field: document.querySelector('input')!,
    target: document.getElementById('next')!,
  }
}

describe('focusIsLost', () => {
  it('is true for focus left on a button disabled while its action ran', () => {
    // Chromium moves focus off a control as it is disabled; jsdom, like an engine
    // that keeps it there, leaves the person on a control that does nothing.
    const { button, target } = page()
    button.focus()
    button.disabled = true
    expect(document.activeElement).toBe(button)
    expect(focusIsLost(target)).toBe(true)
  })

  it('is true for focus on the page, or on a control no longer shown', () => {
    const { button, target } = page()
    expect(document.activeElement).toBe(document.body)
    expect(focusIsLost(target)).toBe(true)
    button.focus()
    button.remove()
    expect(focusIsLost(target)).toBe(true)
  })

  it('is true for focus already on the target', () => {
    const { target } = page()
    target.focus()
    expect(focusIsLost(target)).toBe(true)
  })

  it('is false for focus the person put on a working control', () => {
    const { button, field, target } = page()
    field.focus()
    expect(focusIsLost(target)).toBe(false)
    button.focus()
    expect(focusIsLost(target)).toBe(false)
  })
})
