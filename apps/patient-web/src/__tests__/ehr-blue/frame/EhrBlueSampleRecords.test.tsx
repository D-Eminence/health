import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where, withFramePages } from './blueHarness'

/** A sample record's page and create form, as the design's screens/workspaces/*-2-new and *-3-detail draw them. */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// These test the frame's own sample workspaces, whichever other folders' pages have joined.
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

async function openDemo(path: string) {
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
  const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([])] })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

const card = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('section')!

describe('a sample record\'s page', () => {
  it('shows the saved record, its actions and its patient as the design does', async () => {
    const sent = await openDemo('/provider/appointments/5a020001')
    const before = sent.length
    expect(screen.getByRole('heading', { level: 1, name: 'Review of results' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeDefined()
    expect(screen.getByText('booked')).toBeDefined()
    expect(screen.getByText('Alex Example · HID-DEMO-001')).toBeDefined()
    const saved = card('Saved record')
    expect(within(saved).getByText('Starts')).toBeDefined()
    expect(within(saved).getByText('Demo Doctor')).toBeDefined()
    expect(within(card('Available actions')).getAllByRole('button').map(button => button.textContent))
      .toEqual(['Reschedule', 'Check in', 'Cancel appointment', 'Mark no-show'])
    expect(within(card('Connected hospital history')).getByText('Only records available to your current permissions are listed.')).toBeDefined()
    // Nothing is preserved until an action changes the record.
    expect(screen.queryByRole('heading', { name: 'Preserved versions & amendments' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Check in' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Check in' })).getByRole('button', { name: 'Check in' }))
    expect(await screen.findByText('checked-in')).toBeDefined()
    expect(within(card('Available actions')).getByText('No further actions for your permission and this record state.')).toBeDefined()
    const versions = card('Preserved versions & amendments')
    expect(within(versions).getByText(/ · booked · Check in$/)).toBeDefined()
    expect(within(versions).getByText('Author: Demo Clinician')).toBeDefined()
    // The action's form is gone, so focus moves to the record's new status.
    expect(document.activeElement).toBe(screen.getByText('checked-in').parentElement)
    expect(sent.length).toBe(before)
  })

  it('asks to confirm an action the design confirms, and to type the word for a refund', async () => {
    await openDemo('/provider/patient-billing/5a110001')
    expect(screen.getByRole('heading', { level: 1, name: 'DEMO-1' })).toBeDefined()
    expect(within(card('Saved record')).getByText('Total').nextElementSibling?.textContent).toBe('1000000')
    fireEvent.click(screen.getByRole('button', { name: 'Issue invoice' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Issue invoice' })).getByRole('button'))
    expect(await screen.findByText('issued')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Record simulated payment' }))
    const payment = screen.getByRole('form', { name: 'Record simulated payment' })
    fireEvent.click(within(payment).getByRole('button', { name: 'Record simulated payment' }))
    expect(within(payment).getAllByText('Complete this field.')).toHaveLength(3)
    fireEvent.change(within(payment).getByRole('spinbutton', { name: 'Amount (currency units)' }), { target: { value: '4000' } })
    fireEvent.change(within(payment).getByRole('combobox', { name: 'Method' }), { target: { value: 'Cash' } })
    fireEvent.change(within(payment).getByRole('textbox', { name: 'Unique transaction reference' }), { target: { value: 'TX-1' } })
    fireEvent.click(within(payment).getByRole('button', { name: 'Record simulated payment' }))
    expect(await screen.findByText('partial')).toBeDefined()
    const due = within(card('Saved record')).getByText('Due').nextElementSibling
    expect(due?.textContent).toBe('600000')

    fireEvent.click(screen.getByRole('button', { name: 'Refund payment' }))
    const refund = screen.getByRole('form', { name: 'Refund payment' })
    fireEvent.change(within(refund).getByRole('spinbutton', { name: 'Refund amount' }), { target: { value: '1000' } })
    fireEvent.change(within(refund).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Fictional overpayment' } })
    fireEvent.click(within(refund).getByRole('button', { name: 'Refund payment' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Refund payment?' })
    expect(within(dialog).getByText('Review the entered details before continuing. This action changes the saved record and is recorded in its history.')).toBeDefined()
    const confirm = within(dialog).getByRole('button', { name: 'Refund payment' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type REFUND to confirm' }), { target: { value: 'REFUND' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(within(card('Saved record')).getByText('Due').nextElementSibling?.textContent).toBe('700000'))
  })

  it('carries the patient and the visit into the next record (Continue care)', async () => {
    await openDemo('/provider/journey/5a030001')
    expect(screen.getByRole('heading', { level: 3, name: 'Continue care' })).toBeDefined()
    // Consultation is live, so a sample visit hands over only to the samples.
    expect(screen.queryByRole('button', { name: 'Create consultation' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create triage & vitals' }))
    await waitFor(() => expect(where()).toBe('/provider/triage/new'))
    expect((screen.getByRole('combobox', { name: 'Patient' }) as HTMLSelectElement).value).toBe('Alex Example')
    expect((screen.getByRole('combobox', { name: 'Visit' }) as HTMLSelectElement).value).toBe('5a030001')
    expect(screen.getByRole('heading', { level: 2, name: 'Patient context' })).toBeDefined()
    expect(screen.getByText('Recorded allergies: Fictional Med A')).toBeDefined()
    expect((screen.getByRole('combobox', { name: 'Priority' }) as HTMLSelectElement).value).toBe('Routine')
  })

  it('keeps a stock item\'s batches, with the tabs above the heading', async () => {
    await openDemo('/provider/supply/5a130001')
    const tabs = screen.getByRole('navigation', { name: 'Supply' })
    const heading = screen.getByRole('heading', { level: 1, name: 'Fictional Med A' })
    expect(tabs.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('DEMO-LOT-1 · 96 units · expires 2030-01-01')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Consume / adjust stock' }))
    const adjust = screen.getByRole('form', { name: 'Consume / adjust stock' })
    fireEvent.change(within(adjust).getByRole('combobox', { name: 'Batch' }), { target: { value: 'DEMO-LOT-1' } })
    fireEvent.change(within(adjust).getByRole('spinbutton', { name: 'Signed unit change' }), { target: { value: '-2' } })
    fireEvent.change(within(adjust).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Wastage (fictional)' } })
    fireEvent.click(within(adjust).getByRole('button', { name: 'Consume / adjust stock' }))
    expect(await screen.findByText('DEMO-LOT-1 · 94 units · expires 2030-01-01')).toBeDefined()
  })

  it('says when a record is not there', async () => {
    await openDemo('/provider/appointments/5a020063')
    expect(screen.getByRole('heading', { level: 1, name: 'Record not found' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    await waitFor(() => expect(where()).toBe('/provider/appointments'))
  })
})
