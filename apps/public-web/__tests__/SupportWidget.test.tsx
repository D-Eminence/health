// @vitest-environment-options { "url": "https://ehr.healthidentitydirectory.com/" }
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SupportWidget, supportApiBaseUrl } from '@/app/SupportWidget'

// This build's configured address is the website's; the page under test is open on the EHR site's front page.
vi.mock('@/lib/env', () => ({
  getEnvironment: () => ({ name: 'production', appOrigin: 'https://healthidentitydirectory.com',
    apiBaseUrl: 'https://healthidentitydirectory.com', turnstileSiteKey: null,
    supportChatEnabled: true, supportContact: 'mailto:support@healthidentitydirectory.com' }),
}))

const at = (url: string) => { const { protocol, hostname, origin } = new URL(url); return { protocol, hostname, origin } }
const CONFIGURED = 'https://healthidentitydirectory.com'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})
afterEach(() => { document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' })

describe('supportApiBaseUrl', () => {
  it.each([
    'https://healthidentitydirectory.com/', 'https://app.healthidentitydirectory.com/',
    'https://ehr.healthidentitydirectory.com/', 'https://lab.healthidentitydirectory.com/',
    'https://pharmacy.healthidentitydirectory.com/', 'https://migrate.healthidentitydirectory.com/',
    'https://outreach.healthidentitydirectory.com/',
    'https://www.staging.healthidentitydirectory.com/', 'https://staging.healthidentitydirectory.com/',
    'https://ehr.staging.healthidentitydirectory.com/', 'https://lab.staging.healthidentitydirectory.com/',
    'https://pharmacy.staging.healthidentitydirectory.com/', 'https://migrate.staging.healthidentitydirectory.com/',
    'https://outreach.staging.healthidentitydirectory.com/',
  ])('asks the page\'s own origin on %s', url => {
    expect(supportApiBaseUrl(at(url), CONFIGURED)).toBe(new URL(url).origin)
  })
  it.each([
    'http://localhost:3100/', 'https://healthidentitydirectory.com.example/', 'https://ehr.healthidentitydirectory.com.example/',
    'https://evil.example/', 'https://admin.healthidentitydirectory.com/', 'http://ehr.healthidentitydirectory.com/',
  ])('keeps the configured address on %s', url => {
    expect(supportApiBaseUrl(at(url), CONFIGURED)).toBe(CONFIGURED)
  })
})

describe('SupportWidget on a product site\'s front page', () => {
  it('sends to this site\'s own /api/v1/support/chat with no cookie, CSRF token or Authorization header', async () => {
    document.cookie = 'hid_access_csrf=synthetic-csrf-value; path=/'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      sessionId: '11111111-1111-4111-8111-111111111111', messages: ['You can reset your password from the sign-in page.'] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<SupportWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Support chat' }))
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'How do I reset my password?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('You can reset your password from the sign-in page.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0]!
    const request = input instanceof Request ? input : new Request(String(input), init)
    expect(request.url).toBe('https://ehr.healthidentitydirectory.com/api/v1/support/chat')
    expect(init?.credentials ?? request.credentials).toBe('omit')
    const headers = new Headers(init?.headers ?? request.headers)
    expect(headers.has('X-CSRF-Token')).toBe(false)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.has('Cookie')).toBe(false)
    await waitFor(() => expect((screen.getByLabelText('Your question') as HTMLInputElement).disabled).toBe(false))
  })
})
