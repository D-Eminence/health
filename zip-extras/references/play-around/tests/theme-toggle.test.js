import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'

describe('settings header theme toggle', () => {
  it('switches directly between light and dark without opening a menu', () => {
    const html = readFileSync(resolve('settings-dashboard/index.html'), 'utf8')
    const app = readFileSync(resolve('settings-dashboard/app.js'), 'utf8')
    const dom = new JSDOM(html, {
      url: 'http://localhost/settings-dashboard/#/settings',
      runScripts: 'outside-only',
    })
    const { window } = dom
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false, addEventListener() {} }),
      configurable: true,
    })

    window.eval(app)
    const button = window.document.querySelector('[data-action="toggle-theme"]')
    expect(button).not.toBeNull()
    expect(window.document.documentElement.dataset.theme).toBe('light')
    expect(button?.getAttribute('aria-label')).toBe('Switch to dark mode')
    const lightPath = button?.querySelector('path')?.getAttribute('d')

    button?.click()
    expect(window.document.documentElement.dataset.theme).toBe('dark')
    expect(button?.getAttribute('aria-label')).toBe('Switch to light mode')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
    expect(button?.querySelector('path')?.getAttribute('d')).not.toBe(lightPath)
    expect(window.document.querySelector('.popover')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem('settings-preview-v3') || '{}').theme).toBe('dark')

    button?.click()
    expect(window.document.documentElement.dataset.theme).toBe('light')
    expect(button?.getAttribute('aria-label')).toBe('Switch to dark mode')
    expect(button?.getAttribute('aria-pressed')).toBe('false')
    expect(button?.querySelector('path')?.getAttribute('d')).toBe(lightPath)
    expect(window.document.querySelector('.popover')).toBeNull()
    dom.window.close()
  })
})
