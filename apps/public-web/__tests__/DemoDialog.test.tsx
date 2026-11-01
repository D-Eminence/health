import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { submitDemoRequest } from '@/lib/commercial-api'
import { focusWhenShown } from './focusWhenShown'

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

    // The form's own plain words, never the server's.
    expect((await screen.findByRole('alert')).textContent).toBe('Health ID isn’t available right now. Please try again in a few minutes.')
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

  // Nothing announces the errors as they appear: the first field to correct, in
  // form order, takes focus, and its error is read with it.
  it('moves focus to the first field to correct', async () => {
    openDialog()
    fillValidRequest()
    fireEvent.change(field('role'), { target: { value: 'X' } })
    fireEvent.change(field('email'), { target: { value: 'not-an-email' } })
    const send = screen.getByRole('button', { name: 'Send request' })
    send.focus()
    fireEvent.click(send)

    await waitFor(() => expect(document.activeElement).toBe(field('role')))
    expect(field('role').getAttribute('aria-describedby')).toBe('role-error')
    expect(submit).not.toHaveBeenCalled()
  })

  it('moves focus to the service, with its error, when none is chosen', async () => {
    openDialog()
    const send = screen.getByRole('button', { name: 'Send request' })
    send.focus()
    fireEvent.click(send)

    await waitFor(() => expect(document.activeElement).toBe(field('service')))
    expect(field('service').getAttribute('aria-describedby')).toBe('service-error')
    expect(document.getElementById('service-error')?.textContent).toBe('Choose a service.')
  })

  // The field takes focus in the commit that marks it. From an animation frame,
  // a check made as soon as the error was shown found focus still on Send.
  it('has focus on the first field to correct as soon as it is marked', async () => {
    openDialog()
    const send = screen.getByRole('button', { name: 'Send request' })
    send.focus()
    const shown = focusWhenShown('dialog [name="service"][aria-invalid="true"]')
    fireEvent.click(send)
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  // The link that opened the dialog has focus back once it closes, not a frame
  // later. (This file's close() fires the close event at once.)
  it('has focus on the link that opened it as soon as the dialog closes', async () => {
    render(<><a href="#demo">Book a demo</a><DemoDialog /></>)
    const link = screen.getByRole('link', { name: 'Book a demo' })
    link.focus()
    fireEvent.click(link)
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    const shown = focusWhenShown(() => document.querySelector('dialog:not([open])'))
    fireEvent.click(close)
    expect((await shown).focused).toBe(link)
  })

  it('holds a role given under Other to the same limit', () => {
    openDialog()
    fireEvent.change(field('role'), { target: { value: 'Other' } })
    expect(field('otherRole').maxLength).toBe(120)
  })
})
