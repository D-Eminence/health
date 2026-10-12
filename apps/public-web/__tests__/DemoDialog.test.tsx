import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { submitDemoRequest } from '@/lib/commercial-api'

vi.mock('@/lib/env', () => ({
  getEnvironment: () => ({ name: 'local', appOrigin: 'http://localhost:3100',
    apiBaseUrl: 'http://localhost:3100', turnstileSiteKey: null }),
}))
vi.mock('@/lib/commercial-api', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  submitDemoRequest: vi.fn(),
}))

const submit = vi.mocked(submitDemoRequest)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

beforeAll(() => {
  // jsdom has no modal dialog; opening one only needs to mark it open.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})
beforeEach(() => submit.mockReset())

function openDialog() {
  render(<><a href="#demo">Book a demo</a><DemoDialog /></>)
  fireEvent.click(screen.getByRole('link', { name: 'Book a demo' }))
}

const field = (name: string) => document.querySelector<HTMLInputElement>(`dialog [name="${name}"]`)!

function fillValidRequest() {
  fireEvent.change(field('service'), { target: { value: 'ehr' } })
  fireEvent.change(field('facility'), { target: { value: 'Prime Hospital' } })
  fireEvent.change(field('contactName'), { target: { value: 'Amaka Eze' } })
  fireEvent.change(field('role'), { target: { value: 'Medical director' } })
  fireEvent.change(field('email'), { target: { value: 'Amaka@Example.com' } })
}

describe('DemoDialog', () => {
  it('sends the request to the commercial API with the book-demo check and one idempotency key', async () => {
    submit.mockResolvedValueOnce(undefined)
    openDialog()
    fillValidRequest()
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))

    expect(await screen.findByText('Demo request received')).toBeDefined()
    expect(submit).toHaveBeenCalledTimes(1)
    const [body, key] = submit.mock.calls[0]!
    expect(body).toMatchObject({
      productCode: 'ehr', organizationName: 'Prime Hospital', contactName: 'Amaka Eze',
      contactRole: 'Medical director', contactEmail: 'amaka@example.com',
      turnstileAction: 'book-demo', turnstileToken: 'local-turnstile-disabled',
      sourceSection: 'demo-dialog', ctaLabel: 'Book a demo',
    })
    expect(key).toMatch(UUID)
  })

  it('retries a refused request as the same submission, with the same key', async () => {
    submit.mockRejectedValueOnce(new HidApiError(503, 'The service is temporarily unavailable. Please try again shortly.'))
      .mockResolvedValueOnce(undefined)
    openDialog()
    fillValidRequest()
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))

    expect((await screen.findByRole('alert')).textContent).toBe('The service is temporarily unavailable. Please try again shortly.')
    expect(screen.queryByText('Demo request received')).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send request' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))

    expect(await screen.findByText('Demo request received')).toBeDefined()
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[1]![1]).toBe(submit.mock.calls[0]![1])
    expect(submit.mock.calls[0]![1]).toMatch(UUID)
  })

  it('asks for a role the backend accepts before sending anything', async () => {
    openDialog()
    fillValidRequest()
    expect(field('role').maxLength).toBe(120)
    fireEvent.change(field('role'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))

    expect(await screen.findByText(/Enter your role/)).toBeDefined()
    expect(field('role').getAttribute('aria-invalid')).toBe('true')
    expect(submit).not.toHaveBeenCalled()
  })

  it('holds a role given under Other to the same limit', () => {
    openDialog()
    fireEvent.change(field('role'), { target: { value: 'Other' } })
    expect(field('otherRole').maxLength).toBe(120)
  })
})
