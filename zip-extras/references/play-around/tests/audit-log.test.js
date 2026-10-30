import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

function mountAuditLog() {
  const html = readFileSync(resolve('settings-dashboard/index.html'), 'utf8')
  const app = readFileSync(resolve('settings-dashboard/app.js'), 'utf8')
  const sidebar = readFileSync(resolve('settings-dashboard/sidebar-system.js'), 'utf8')
  const pages = readFileSync(resolve('settings-dashboard/dashboard-pages.js'), 'utf8')
  const dom = new JSDOM(html, {
    url: 'http://localhost/settings-dashboard/#/audit-log',
    runScripts: 'outside-only',
  })
  const { window } = dom
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener() {} }),
    configurable: true,
  })
  window.productToast = { push: vi.fn(() => 'notice-1'), update: vi.fn() }
  window.setTimeout = callback => { callback(); return 1 }
  window.requestAnimationFrame = callback => { callback(); return 1 }
  window.eval(`${app}\n${sidebar}\n${pages}`)
  return dom
}

describe('audit log', () => {
  it('renders the retention notice, filter chips and activity table', () => {
    const dom = mountAuditLog()
    const { document } = dom.window

    expect(document.title).toBe('Audit log · Waya')
    expect(document.querySelector('#page-title')?.textContent).toBe('Audit log')
    expect(document.body.classList.contains('is-audit-route')).toBe(true)
    expect(document.querySelector('.system-banner')).not.toBeNull()

    const notice = document.querySelector('#page-notice .page-notice')
    expect(notice?.querySelector('p')?.textContent).toBe('Audit logs are retained for a maximum of 30 days before they are automatically deleted.')
    expect(notice?.querySelector('.page-notice-action')?.textContent).toBe('Download last 30 days')

    // Audit uses the same anchored filter panel as the Account page.
    const filterToggle = document.querySelector('[data-page-action="toggle-audit-filter"]')
    expect(document.querySelector('.audit-filter-panel')).toBeNull()
    expect(filterToggle?.getAttribute('aria-expanded')).toBe('false')
    expect(filterToggle?.getAttribute('aria-controls')).toBe('audit-filter-panel')

    filterToggle.click()
    expect(document.querySelector('[data-page-action="toggle-audit-filter"]')?.getAttribute('aria-expanded')).toBe('true')
    const panel = document.querySelector('.audit-filter-panel')
    expect(panel?.querySelector('h2')?.textContent).toBe('Filter audit log')
    expect([...panel.querySelectorAll('.filter-group > span')].map(label => label.textContent)).toEqual(['Activity', 'Role', 'Date'])
    expect(panel.querySelector('[data-group="member"]')).toBeNull()
    expect(panel.querySelector('[data-page-action="reset-audit-filter"]')).not.toBeNull()
    expect(panel.querySelector('[data-page-action="close-audit-filter"]')).not.toBeNull()

    document.querySelector('[data-page-action="close-audit-filter"]').click()
    expect(document.querySelector('.audit-filter-panel')).toBeNull()

    const headers = [...document.querySelectorAll('.data-table--audit thead th')]
      .map(header => header.textContent.trim())
      .filter(Boolean)
    expect(headers).toEqual(['Date / Time', 'Activity', 'Target', 'Role'])

    const first = document.querySelector('.data-table--audit tbody tr')
    expect(first?.querySelector('.col-datetime')?.textContent).toBe('10-01-2026 03:45pm')
    expect(first?.querySelector('.audit-activity strong')?.textContent).toBe('Oyeleye')
    expect(first?.querySelector('.audit-verb')?.textContent.trim()).toBe('Updated')
    expect(first?.querySelector('.audit-object')?.textContent).toBe('user profile')
    expect(first?.querySelector('.audit-verb')?.getAttribute('data-tone')).toBe('info')
    expect(first?.querySelector('.col-target')?.textContent).toBe('AJohnson123@company.com')
    expect(first?.querySelector('.col-role')?.textContent.trim()).toBe('Admin')

    // Each activity verb carries a tone alongside its label, never colour alone.
    const tones = [...document.querySelectorAll('.data-table--audit tbody .audit-verb')]
      .map(verb => [verb.textContent.trim(), verb.getAttribute('data-tone')])
    expect(tones).toContainEqual(['Created', 'success'])
    expect(tones).toContainEqual(['Deleted', 'danger'])
    expect(tones).toContainEqual(['Suspended', 'warning'])
    expect(tones).toContainEqual(['Invited', 'accent'])

    expect(document.querySelectorAll('.data-table--audit tbody tr')).toHaveLength(20)
    expect(document.querySelector('.pagination-count')?.textContent).toBe('1 / 4')
    expect(document.querySelector('[data-page-action="audit-page-size"]')?.value).toBe('20')

    dom.window.close()
  })

  it('opens the event drawer with overview and changes, and steps between events', () => {
    const dom = mountAuditLog()
    const { document } = dom.window

    const rows = document.querySelectorAll('[data-page-action="open-audit"]')
    rows[7].click()

    const drawer = document.querySelector('.audit-drawer')
    expect(drawer).not.toBeNull()
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(document.body.classList.contains('audit-drawer-open')).toBe(true)
    expect(document.querySelector('.audit-drawer-scrim')).not.toBeNull()
    expect(document.querySelector('#audit-drawer-title')?.textContent).toBe('Updated User Role')
    expect(drawer.querySelector('.audit-drawer-identity h3')?.textContent.replace(/\s+/g, ' ')).toBe('Oyeleye OgunsanyaAdmin')
    expect(drawer.querySelector('.audit-drawer-identity p')?.textContent).toBe('10-02-2026 04:00pm')

    const labels = [...drawer.querySelectorAll('.audit-detail dt')].map(term => term.textContent)
    expect(labels).toEqual(['Target', 'Location', 'Device', 'IP address', 'Event ID', 'Status'])
    expect(drawer.querySelector('.audit-detail-person')?.textContent.trim()).toContain('Chinonso Uche')

    const change = drawer.querySelector('.audit-change')
    expect(change?.querySelector('.audit-change-field')?.textContent).toBe('Role')
    expect(change?.querySelector('.audit-change-before')?.textContent.trim()).toBe('Customer support')
    expect(change?.querySelector('.audit-change-after')?.textContent.trim()).toBe('Operations')

    // Focus lands on the labelled dialog without painting a pointer-triggered
    // focus ring over the close control, and the selected row remains marked.
    expect(document.activeElement.className).toContain('audit-drawer')
    expect(document.querySelectorAll('.data-table--audit tbody tr.is-active')).toHaveLength(1)

    document.querySelector('[data-page-action="step-audit"][data-step="next"]').click()
    expect(document.querySelector('#audit-drawer-title')?.textContent).toBe('Cancelled Order')

    document.querySelector('[data-page-action="close-audit-drawer"]').click()
    expect(document.querySelector('.audit-drawer')).toBeNull()
    expect(document.body.classList.contains('audit-drawer-open')).toBe(false)
    expect(document.querySelectorAll('.data-table--audit tbody tr.is-active')).toHaveLength(0)

    dom.window.close()
  })

  it('filters through the chips and clears them again', () => {
    const dom = mountAuditLog()
    const { document } = dom.window
    const rowCount = () => document.querySelectorAll('.data-table--audit tbody tr').length

    document.querySelector('[data-page-action="toggle-audit-filter"]').click()
    document.querySelector('[data-page-action="audit-filter"][data-group="activity"][data-value="Cancelled"]').click()

    const verbs = new Set([...document.querySelectorAll('.data-table--audit tbody .audit-verb')].map(verb => verb.textContent.trim()))
    expect([...verbs]).toEqual(['Cancelled'])
    expect(document.querySelector('[data-page-action="audit-filter"][data-group="activity"][data-value="Cancelled"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.audit-applied-label')?.textContent).toBe('Activity')
    expect(document.querySelector('.audit-applied-value > span')?.textContent).toBe('Cancelled')
    expect(document.querySelector('.audit-clear-filters')?.textContent).toBe('Clear filter')

    document.querySelector('[data-page-action="audit-filter"][data-group="role"][data-value="Operation"]').click()
    const roles = new Set([...document.querySelectorAll('.data-table--audit tbody .col-role')].map(cell => cell.textContent.trim()))
    expect([...roles]).toEqual(['Operation'])
    expect([...document.querySelectorAll('.audit-applied-label')].map(label => label.textContent)).toEqual(['Activity', 'Role'])

    document.querySelector('[data-page-action="close-audit-filter"]').click()
    expect(document.querySelector('.audit-filter-panel')).toBeNull()
    document.querySelector('[data-page-action="toggle-audit-filter"]').click()
    document.querySelector('[data-page-action="reset-audit-filter"]').click()
    expect(rowCount()).toBe(20)
    expect(document.querySelector('.audit-applied-filters-list')).toBeNull()

    // An active filter stays applied behind a closed panel, and the trigger
    // carries the count so it is never hidden silently.
    const toggle = () => document.querySelector('[data-page-action="toggle-audit-filter"]')
    document.querySelector('[data-page-action="audit-filter"][data-group="activity"][data-value="Deleted"]').click()
    const filtered = rowCount()
    expect(toggle().querySelector('.audit-filter-count')?.textContent).toBe('1')

    document.querySelector('[data-page-action="close-audit-filter"]').click()
    expect(document.querySelector('.audit-filter-panel')).toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(rowCount()).toBe(filtered)
    expect(toggle().querySelector('.audit-filter-count')?.textContent).toBe('1')
    expect(document.querySelector('.audit-applied-value > span')?.textContent).toBe('Deleted')

    // The inline Clear filter action removes every applied value without
    // reopening the selection panel.
    document.querySelector('.audit-clear-filters').click()
    expect(document.querySelector('.audit-filter-panel')).toBeNull()
    expect(document.querySelector('.audit-applied-filters-list')).toBeNull()
    expect(toggle().querySelector('.audit-filter-count')).toBeNull()
    expect(rowCount()).toBe(20)

    dom.window.close()
  })

  it('selects rows and keeps the audit route when paginating', () => {
    const dom = mountAuditLog()
    const { document } = dom.window

    document.querySelector('[data-page-action="select-visible-audit"]').click()
    expect(document.querySelector('.bulk-action-bar')?.getAttribute('aria-label')).toBe('20 selected events')
    document.querySelector('[data-page-action="clear-audit-selection"]').click()
    expect(document.querySelector('.bulk-action-bar')).toBeNull()

    document.querySelector('[data-page-action="audit-page"][data-page="last"]').click()
    expect(document.querySelector('.pagination-count')?.textContent).toBe('4 / 4')
    expect(document.querySelectorAll('.data-table--audit tbody tr')).toHaveLength(12)
    expect(document.title).toBe('Audit log · Waya')

    dom.window.close()
  })
})
