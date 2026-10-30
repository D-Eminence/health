import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

describe('home analytics dashboard', () => {
  it('renders the reference dashboard, switches ranges, and follows the shared theme', () => {
    const html = readFileSync(resolve('settings-dashboard/index.html'), 'utf8')
    const app = readFileSync(resolve('settings-dashboard/app.js'), 'utf8')
    const pages = readFileSync(resolve('settings-dashboard/dashboard-pages.js'), 'utf8')
    const dom = new JSDOM(html, {
      url: 'http://localhost/settings-dashboard/#/dashboard',
      runScripts: 'outside-only',
    })
    const { window } = dom
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false, addEventListener() {} }),
      configurable: true,
    })
    window.productToast = { push: vi.fn(() => 'notice-1'), update: vi.fn() }
    window.setTimeout = callback => { callback(); return 1 }

    window.eval(`${app}\n${pages}`)

    expect(window.document.title).toBe('Home · Waya')
    expect(window.document.querySelector('#page-title')?.textContent).toBe('Home')
    expect(window.document.querySelectorAll('.home-metric')).toHaveLength(4)
    expect(window.document.querySelectorAll('.home-panel')).toHaveLength(4)
    expect(window.document.querySelectorAll('.home-chart-line')).toHaveLength(3)
    expect(window.document.querySelector('.home-metric > strong')?.textContent).toBe('824.6K')

    window.document.querySelector('[data-page-action="toggle-home-range"]')?.click()
    expect(window.document.querySelector('.home-range-menu')).not.toBeNull()
    window.document.querySelector('[data-page-action="select-home-range"][data-range="30"]')?.click()
    expect(window.document.querySelector('.home-metric > strong')?.textContent).toBe('3.42M')
    expect(window.document.querySelector('.home-date-button')?.textContent).toContain('Last 30 days')

    window.document.querySelector('[data-action="toggle-theme"]')?.click()
    expect(window.document.documentElement.dataset.theme).toBe('dark')
    expect(window.document.querySelector('.home-dashboard')).not.toBeNull()

    dom.window.close()
  })
})
