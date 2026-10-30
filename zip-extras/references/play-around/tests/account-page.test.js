import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

function mountAccountPage() {
  const html = readFileSync(resolve('settings-dashboard/index.html'), 'utf8')
  const app = readFileSync(resolve('settings-dashboard/app.js'), 'utf8')
  const sidebar = readFileSync(resolve('settings-dashboard/sidebar-system.js'), 'utf8')
  const pages = readFileSync(resolve('settings-dashboard/dashboard-pages.js'), 'utf8')
  const dom = new JSDOM(html, {
    url: 'http://localhost/settings-dashboard/#/account',
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

describe('account page', () => {
  it('renders the balance, transfer details and transaction table columns', () => {
    const dom = mountAccountPage()
    const { document } = dom.window

    expect(document.title).toBe('Account · Waya')
    expect(document.querySelector('#page-title')?.textContent).toBe('Account')
    expect(document.body.classList.contains('is-audit-route')).toBe(false)
    expect(document.querySelector('[data-sidebar-route="/account"]')).not.toBeNull()

    expect(document.querySelector('.account-balance-label')?.textContent).toBe('Balance')
    expect(document.querySelector('.account-balance-amount')?.textContent).toBe('$1,000,000.45')
    expect(document.querySelector('.account-refresh')?.getAttribute('aria-label')).toBe('Refresh balance')

    const headers = [...document.querySelectorAll('.data-table--account thead th')]
      .map(header => header.textContent.trim())
      .filter(Boolean)
    expect(headers).toEqual(['Direction', 'From / To', 'Status', 'Date', 'Amount'])

    const firstRow = [...document.querySelectorAll('.data-table--account tbody tr:first-child td')]
      .map(cell => cell.textContent.trim())
    expect(firstRow).toEqual(['', 'Funding', 'First Bank of Nigeria', 'Pending', '09-29-2026 10:15pm', '$6,789,012.00'])

    expect(document.querySelectorAll('.data-table--account tbody tr')).toHaveLength(20)
    expect(document.querySelector('.pagination-count')?.textContent).toBe('1 / 4')

    // Rows scroll inside their own box, like the transactions table, so the
    // pagination stays pinned instead of being pushed below the fold.
    const scrollBox = document.querySelector('#account-data .account-table-scroll')
    expect(scrollBox?.classList.contains('data-table-scroll')).toBe(true)
    expect(scrollBox?.querySelector('.data-table--account')).not.toBeNull()
    expect(scrollBox?.querySelector('.table-pagination')).toBeNull()
    expect(document.querySelector('#account-data > .table-pagination')).not.toBeNull()
    expect(document.querySelector('[data-page-action="account-page-size"]')?.value).toBe('20')

    const details = [...document.querySelectorAll('.account-detail')].map(row => [
      row.querySelector('dt')?.textContent,
      row.querySelector('dd')?.textContent,
    ])
    expect(details).toEqual([
      ['Account number', '0123456789'],
      ['Account holder', 'Money Making Business'],
      ['Bank name', 'Community Federal Savings Bank (CFSB)'],
      ['Account type', 'Checking'],
      ['US Bank address', '1323 Columbus Avenue San Francisco, CA 94133 United States'],
    ])
    expect(document.querySelector('.account-details')?.getAttribute('aria-labelledby')).toBe('account-details-title')
    expect(document.querySelector('#account-details-title')?.textContent).toBe('Account details')
    expect(document.querySelector('.account-copy')?.getAttribute('aria-label')).toBe('Copy account number')
    expect(document.querySelector('.account-copy-all')).not.toBeNull()

    dom.window.close()
  })

  it('filters, searches, selects and paginates without leaving the route', () => {
    const dom = mountAccountPage()
    const { document } = dom.window
    const rowCount = () => document.querySelectorAll('.data-table--account tbody tr').length

    document.querySelector('[data-page-action="toggle-account-filter"]').click()
    expect(document.querySelector('.table-filter-panel')).not.toBeNull()
    document.querySelector('[data-page-action="account-filter"][data-group="direction"][data-value="withdrawal"]').click()
    document.querySelector('[data-page-action="close-account-filter"]').click()

    const directions = new Set([...document.querySelectorAll('.data-table--account tbody td.col-direction')].map(cell => cell.textContent.trim()))
    expect([...directions]).toEqual(['Withdrawal'])

    document.querySelector('[data-page-action="toggle-account-filter"]').click()
    document.querySelector('[data-page-action="reset-account-filter"]').click()
    document.querySelector('[data-page-action="close-account-filter"]').click()
    expect(rowCount()).toBe(20)

    const search = document.querySelector('[data-account-query]')
    search.value = 'Wema'
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(rowCount()).toBe(1)

    search.value = 'no-such-bank'
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(document.querySelector('.data-state h2')?.textContent).toBe('No transactions found')

    // The empty state's own recovery action clears the query and the filters.
    document.querySelector('.data-state [data-page-action="reset-account-filter"]').click()
    expect(document.querySelector('[data-account-query]').value).toBe('')
    expect(rowCount()).toBe(20)

    document.querySelector('[data-page-action="select-visible-account-transactions"]').click()
    expect(document.querySelector('.bulk-action-bar')?.getAttribute('aria-label')).toBe('20 selected transactions')
    document.querySelector('[data-page-action="clear-account-selection"]').click()
    expect(document.querySelector('.bulk-action-bar')).toBeNull()

    document.querySelector('[data-page-action="account-page"][data-page="last"]').click()
    expect(document.querySelector('.pagination-count')?.textContent).toBe('4 / 4')
    expect(rowCount()).toBe(8)

    const pageSize = document.querySelector('[data-page-action="account-page-size"]')
    pageSize.value = '10'
    pageSize.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    expect(document.querySelector('.pagination-count')?.textContent).toBe('1 / 7')
    expect(rowCount()).toBe(10)

    expect(document.title).toBe('Account · Waya')
    dom.window.close()
  })

  it('shows the service banner and links it to the account route', () => {
    const dom = mountAccountPage()
    const banner = dom.window.document.querySelector('.system-banner')

    expect(banner?.getAttribute('aria-label')).toBe('Service status')
    expect(banner?.querySelector('p')?.textContent).toBe('We are experiencing a temporary outage with our banking partner. All transactions will be processed as soon as the system is restored.')
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe('#/account')
    expect(banner?.querySelector('.svg-icon path')?.getAttribute('d')).toBeTruthy()

    dom.window.close()
  })
})
