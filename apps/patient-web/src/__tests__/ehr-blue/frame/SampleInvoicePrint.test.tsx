import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/*
 * A sample invoice's Print (frame/sample/SampleWorkspace.tsx, and the sample Billing page, departments/sample/finance.tsx)
 * prints the page as it is. Safari, and every browser on an iPhone or iPad, prints its own web address round such a page
 * whatever it asks (printEngine.ts), so there no sample Print is offered. All records are fictional.
 */

const opened = vi.hoisted(() => ({ rest: '' }))
vi.mock('../../../staff/App', () => ({ useStaff: () => ({ state: { status: 'signed-out', session: null } }) }))
vi.mock('../../../ehr-blue/frame/pageContext', () => ({
  useBluePage: () => ({ page: { path: '/provider/billing', label: 'Billing' }, rest: opened.rest }),
  useSampleHref: () => () => null,
}))

const { SampleWorkspace } = await import('../../../ehr-blue/frame/sample/SampleWorkspace')
const { sampleRecords } = await import('../../../ehr-blue/frame/sample/store')
const { billingSample } = await import('../../../ehr-blue/departments/sample/finance')

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1'

afterEach(() => { vi.restoreAllMocks() })

function invoice(agent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent)
  opened.rest = sampleRecords('billing')[0]!.id
  return render(<MemoryRouter><SampleWorkspace moduleId="billing" /></MemoryRouter>)
}

describe('a sample invoice’s Print', () => {
  it('is offered in Chrome, Edge and Firefox, which print no web address', () => {
    invoice(CHROME)
    expect(screen.getByText(/All payments are fictional/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
  })

  it.each([['Safari on a Mac', SAFARI], ['an iPhone', IPHONE]])('is not offered in %s', (_where, agent) => {
    invoice(agent)
    expect(screen.getByText(/All payments are fictional/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
  })

  it('on the sample Billing page, is not offered in Safari either', () => {
    const record = { id: 'DEMO-1', status: 'issued', values: { totalCents: '1000' }, state: { paidCents: 0 } }
    const extra = billingSample.savedExtra!
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME)
    const chrome = render(<>{extra(record as never)}</>)
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
    chrome.unmount()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(SAFARI)
    render(<>{extra(record as never)}</>)
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
  })
})
