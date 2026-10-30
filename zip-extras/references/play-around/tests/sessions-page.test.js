import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

describe('settings sessions page', () => {
  it('renders the reference session table and supports individual and bulk sign-out flows', () => {
    const html = readFileSync(resolve('settings-dashboard/index.html'), 'utf8')
    const app = readFileSync(resolve('settings-dashboard/app.js'), 'utf8')
    const dom = new JSDOM(html, {
      url: 'http://localhost/settings-dashboard/?tab=sessions#/settings',
      runScripts: 'outside-only',
    })
    const { window } = dom
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false, addEventListener() {} }),
      configurable: true,
    })
    window.setTimeout = callback => { callback(); return 1 }
    window.productToast = { push: vi.fn(() => 'notice-1'), update: vi.fn() }

    window.eval(app)

    expect(window.document.querySelector('#sessions-panel h2')?.textContent).toBe('Sessions')
    expect(window.document.querySelectorAll('.session-table-head [role="columnheader"]')).toHaveLength(4)
    expect(window.document.querySelectorAll('.session-row')).toHaveLength(4)
    expect(window.document.querySelector('[data-session-id="current"] .current-session')?.textContent).toBe('Current session')
    expect(window.document.querySelectorAll('.session-signout')).toHaveLength(3)
    expect(window.document.querySelector('.session-signout-all')?.disabled).toBe(false)

    window.document.querySelector('[data-session-id="manchester"] .session-signout')?.click()
    expect(window.document.querySelector('#dialog-title')?.textContent).toBe('Sign out this session?')
    window.document.querySelector('[data-action="confirm-session-signout"]')?.click()
    expect(window.document.querySelector('[data-session-id="manchester"]')).toBeNull()
    expect(window.document.querySelectorAll('.session-row')).toHaveLength(3)

    window.document.querySelector('.session-signout-all')?.click()
    expect(window.document.querySelector('#dialog-title')?.textContent).toBe('Sign out of other sessions?')
    window.document.querySelector('[data-action="confirm-session-signout"]')?.click()
    expect(window.document.querySelectorAll('.session-row')).toHaveLength(1)
    expect(window.document.querySelector('.session-signout-all')?.disabled).toBe(true)
    expect(window.productToast.update).toHaveBeenCalled()
    dom.window.close()
  })
})
