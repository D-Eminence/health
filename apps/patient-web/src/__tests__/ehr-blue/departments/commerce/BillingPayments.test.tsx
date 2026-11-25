import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Payments } from '../../../../ehr-blue/departments/commerce/Payments'
import { TakePayment } from '../../../../ehr-blue/departments/commerce/TakePayment'
import { Receipt } from '../../../../ehr-blue/departments/commerce/Receipt'
import { BillBadge } from '../../../../ehr-blue/departments/commerce/BillBadge'
import { naira } from '../../../../ehr-blue/departments/commerce/money'
import type { Bill } from '../../../../ehr-blue/departments/commerce/api'
import { DEMO_HOSPITAL_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { HMO_ID, TILL_ID, billOf, off, ok, refused, settingsOf, unpaidBill } from './billingFixtures'

/**
 * Payments, Take payment and the receipt against hid-system BILL-1's shapes: names with the last four of the Health ID
 * only, HMO cover recorded as owed and never paid, a refund as a cancelled payment with its reason, the version read sent
 * with every change, and each refusal in BILL-1's own words. Every person, bill and code here is fictional.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))
vi.mock('../../../../ehr-blue/departments/commerce/api', async importOriginal => {
  const { commerceMock } = await import('../harness')
  return { ...(await importOriginal<object>()), commerce: commerceMock(commerceApi) }
})
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

const CASHIER = ['billing.catalogue.read', 'billing.bill.read', 'billing.bill.create', 'billing.payment.record', 'billing.shift.own']
const OFFICER = [...CASHIER, 'billing.bill.adjust', 'billing.bill.defer', 'billing.payment.confirm', 'billing.payment.void',
  'billing.payment.waive', 'billing.shift.manage', 'billing.catalogue.manage', 'billing.report.read']
const as = (permissions: string[]) => { session.facility = fakeFacility(permissions, { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: ['cashier'] }) }

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  as(CASHIER)
  commerceApi.paymentSettings = async () => ok(settingsOf())
})

describe('Payments', () => {
  it('lists bills to pay with the name and the last four of the Health ID only, the source and what an HMO is to pay', async () => {
    commerceApi.bills = async () => ok({ items: [billOf()], nextPage: null })
    renderDept(<Payments />)
    const card = (await screen.findByText('Ada Test')).closest('li')!
    expect(within(card).getByText('Health ID ending 7Q2K')).toBeTruthy()
    expect(within(card).getByText('Visit')).toBeTruthy()
    expect(card.textContent).toContain('HMO to pay')
    expect(card.textContent).toContain('₦2,000.00')
    expect(card.textContent).toContain('₦1,500.00')
    expect(document.body.textContent).not.toMatch(/HID-[A-Z0-9]/)
  })

  it('narrows by source on the server, and never sends a Health ID or NIN typed in the search', async () => {
    const calls: unknown[] = []
    commerceApi.bills = async (...args: never[]) => { calls.push(args[1]); return ok({ items: [], nextPage: null }) }
    renderDept(<Payments />)
    await screen.findByText('Nothing to pay right now')
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: 'pharmacy' } })
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ source: 'pharmacy' })))
    fireEvent.change(screen.getByRole('searchbox', { name: /Search by bill number/ }), { target: { value: 'HID-ZDEMAAA2' } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Search by bill number, receipt number or name. Do not type a Health ID or NIN here.')
    fireEvent.change(screen.getByRole('searchbox', { name: /Search by bill number/ }), { target: { value: '12345678901' } })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(JSON.stringify(calls)).not.toMatch(/HID-|12345678901/)
  })

  it('says billing is not switched on when its bills answer 404', async () => {
    commerceApi.bills = async () => off()
    renderDept(<Payments />)
    expect(await screen.findByText('Billing is not switched on at this facility yet.')).toBeTruthy()
  })

  it('shows Outstanding balances to a billing officer: patients who owe and HMOs that owe', async () => {
    as(OFFICER)
    commerceApi.bills = async () => ok({ items: [], nextPage: null })
    commerceApi.outstanding = async () => ok({ items: [{ patient: { patientId: 'p-1', displayName: 'Ada Test', healthIdLast4: '7Q2K' },
      bills: [{ billId: 'b-1', number: 'B-000412', createdAt: '2026-11-14T08:00:00Z', dueKobo: 150000, deferred: false }], dueKobo: 150000, oldestDays: 12 }],
    totalDueKobo: 150000, nextPage: null })
    commerceApi.hmoReceivables = async () => ok({ items: [{ hmoId: HMO_ID, hmoName: 'Demo HMO', count: 2, amountKobo: 400000, oldestDays: 3 }] })
    renderDept(<Payments />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Outstanding balances' }))
    const row = (await screen.findByText('Health ID ending 7Q2K')).closest('tr')!
    expect(row.textContent).toContain('Ada Test')
    expect(within(row).getByText('12 days')).toBeTruthy()
    expect(within(row).getByText('₦1,500.00')).toBeTruthy()
    expect(screen.getByText('Demo HMO')).toBeTruthy()
    expect(screen.getByText('HMO cover waiting for a claim. Not money received.')).toBeTruthy()
  })

  it('offers no Outstanding balances to a cashier', async () => {
    commerceApi.bills = async () => ok({ items: [], nextPage: null })
    renderDept(<Payments />)
    await screen.findByText('Nothing to pay right now')
    expect(screen.queryByRole('radio', { name: 'Outstanding balances' })).toBeNull()
  })
})

describe('a bill’s actions', () => {
  const malaria = { id: 'line-3', catalogueItemId: 'c5555555-5555-4555-8555-555555555555', name: 'Malaria test', kind: 'lab_test' as const,
    quantity: 1, unitKobo: 200000, totalKobo: 200000, workItemId: 'work-2', origin: 'lab' as const, cancelled: false }
  async function openBill(bill = billOf(), tab?: string) {
    commerceApi.bills = async () => ok({ items: [bill], nextPage: null })
    renderDept(<Payments />)
    if (tab) fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${tab}`) }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open bill' }))
    return screen.findByRole('dialog')
  }

  it('records a refund as a cancelled payment with "Refund:" and the version read', async () => {
    as(OFFICER)
    const voidPayment = vi.fn(async (..._args: unknown[]) => ok(billOf({ payments: [{ ...billOf().payments[0]!, voided: true }], paidKobo: 0, dueKobo: 450000, version: 6 })))
    commerceApi.voidPayment = voidPayment
    const drawer = await openBill()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel or refund' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this payment?' })
    fireEvent.change(within(sheet).getByLabelText('Why is it refunded?'), { target: { value: 'Patient returned the items' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    await waitFor(() => expect(voidPayment).toHaveBeenCalled())
    expect(voidPayment.mock.calls[0]).toEqual(expect.arrayContaining(['pay-1', 'Refund: Patient returned the items', 5]))
  })

  it('refunds at a till with a day per till: the till is asked for, and sent', async () => {
    as(OFFICER)
    const OTHER_TILL = 'b3333333-3333-4333-8333-333333333333'
    commerceApi.paymentSettings = async () => ok(settingsOf({ dayCloseBy: 'till', tills: [{ id: TILL_ID, name: 'Front till', active: true },
      { id: OTHER_TILL, name: 'Back till', active: true }, { id: 'b4444444-4444-4444-8444-444444444444', name: 'Old till', active: false }] }))
    const voidPayment = vi.fn(async (..._args: unknown[]) => ok(billOf({ version: 6 })))
    commerceApi.voidPayment = voidPayment
    const drawer = await openBill()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel or refund' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this payment?' })
    const till = within(sheet).getByLabelText('Till')
    expect(within(till).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose the till', 'Front till', 'Back till'])
    fireEvent.change(within(sheet).getByLabelText('Why is it refunded?'), { target: { value: 'Patient returned the items' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    expect(await within(sheet).findByText('Choose the till the money is given back from.')).toBeTruthy()
    expect(voidPayment).not.toHaveBeenCalled()
    fireEvent.change(till, { target: { value: OTHER_TILL } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    await waitFor(() => expect(voidPayment).toHaveBeenCalled())
    expect(voidPayment.mock.calls[0]![3]).toBe('Refund: Patient returned the items')
    expect(voidPayment.mock.calls[0]![6]).toBe(OTHER_TILL)
  })

  it('asks for no till without a day per till, nor to cancel a waiver', async () => {
    as(OFFICER)
    const voidPayment = vi.fn(async (..._args: unknown[]) => ok(billOf({ version: 6 })))
    commerceApi.voidPayment = voidPayment
    let drawer = await openBill()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel or refund' }))
    let sheet = await screen.findByRole('dialog', { name: 'Cancel this payment?' })
    expect(within(sheet).queryByLabelText('Till')).toBeNull()
    fireEvent.change(within(sheet).getByLabelText('Why is it refunded?'), { target: { value: 'Patient returned the items' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    await waitFor(() => expect(voidPayment).toHaveBeenCalled())
    expect(voidPayment.mock.calls[0]![6]).toBeUndefined()
    cleanup()
    commerceApi.paymentSettings = async () => ok(settingsOf({ dayCloseBy: 'till', tills: [{ id: TILL_ID, name: 'Front till', active: true }] }))
    drawer = await openBill(billOf({ payments: [{ ...billOf().payments[0]!, method: 'waiver', reason: 'Staff family' }] }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel or refund' }))
    sheet = await screen.findByRole('dialog', { name: 'Cancel this payment?' })
    expect(within(sheet).queryByLabelText('Till')).toBeNull()
  })

  it('keeps a refund’s reason within what the server takes once "Refund: " is put before it', async () => {
    as(OFFICER)
    const voidPayment = vi.fn(async (..._args: unknown[]) => ok(billOf({ version: 6 })))
    commerceApi.voidPayment = voidPayment
    const drawer = await openBill()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel or refund' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this payment?' })
    const reason = within(sheet).getByLabelText('Why is it refunded?')
    expect(reason.getAttribute('maxLength')).toBe('492')
    fireEvent.change(reason, { target: { value: 'x'.repeat(495) } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    expect(await within(sheet).findByText('Say why, in 8 to 492 characters.')).toBeTruthy()
    expect(voidPayment).not.toHaveBeenCalled()
    // Recorded by mistake: sent as typed, so up to 500.
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Recorded by mistake' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    await waitFor(() => expect(voidPayment).toHaveBeenCalled())
    expect(voidPayment.mock.calls[0]![3]).toBe('x'.repeat(495))
  })

  it('moves focus to the reason when it is missing, so the refusal is heard', async () => {
    as(OFFICER)
    const drawer = await openBill()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel or refund' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this payment?' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    const reason = within(sheet).getByLabelText('Why is it refunded?')
    await waitFor(() => expect(document.activeElement).toBe(reason))
    expect(reason.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(reason.getAttribute('aria-describedby')!)?.textContent).toBe('Say why, in 8 to 492 characters.')
  })

  it('names Cancel line by its visible words first', async () => {
    as(OFFICER)
    const drawer = await openBill()
    expect(within(drawer).getByRole('button', { name: 'Cancel line: Consultation' })).toBeTruthy()
  })

  it('reads the bill again as it opens: the list’s copy may be older', async () => {
    as(OFFICER)
    const transfer = { id: 'pay-2', method: 'transfer' as const, amountKobo: 100000, reference: 'TRF-0091', receivedBy: 'Bola Cashier',
      receivedAt: '2026-11-26T09:00:00Z', voided: false, status: 'pending_check' as const, receiptNumber: 'R-2026-000124' }
    const listed = billOf({ payments: [...billOf().payments, transfer], pendingCheckKobo: 100000, dueKobo: 50000 })
    // The lab added a test since the list was read: the bill is now at version 7.
    commerceApi.bill = async () => ok({ ...listed, version: 7, lines: [...listed.lines, malaria] })
    const confirmPayment = vi.fn(async (..._args: unknown[]) => ok({ ...listed, version: 8 }))
    commerceApi.confirmPayment = confirmPayment
    const drawer = await openBill(listed)
    expect(await within(drawer).findByRole('button', { name: 'Cancel line: Malaria test' })).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Confirm transfer' }))
    const sheet = await screen.findByRole('dialog', { name: 'Confirm this transfer?' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Money arrived' }))
    await waitFor(() => expect(confirmPayment).toHaveBeenCalled())
    expect(confirmPayment.mock.calls[0]![3]).toBe(7)
  })

  it('reads the bill again when someone else changed it, and sends the next press anew with the version read', async () => {
    as(OFFICER)
    const transfer = { id: 'pay-2', method: 'transfer' as const, amountKobo: 100000, reference: 'TRF-0091', receivedBy: 'Bola Cashier',
      receivedAt: '2026-11-26T09:00:00Z', voided: false, status: 'pending_check' as const, receiptNumber: 'R-2026-000124' }
    const listed = billOf({ payments: [...billOf().payments, transfer], pendingCheckKobo: 100000, dueKobo: 50000 })
    let reads = 0
    commerceApi.bill = async () => { reads += 1; return ok(reads === 1 ? listed : { ...listed, version: 9, lines: [...listed.lines, malaria] }) }
    const confirmPayment = vi.fn()
      .mockResolvedValueOnce(refused('VERSION_CONFLICT', 'Someone else changed this. Reload it and try again.', 412))
      .mockResolvedValueOnce(ok({ ...listed, version: 10 }))
    commerceApi.confirmPayment = confirmPayment
    const drawer = await openBill(listed)
    await waitFor(() => expect(reads).toBe(1))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Confirm transfer' }))
    const sheet = await screen.findByRole('dialog', { name: 'Confirm this transfer?' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Money arrived' }))
    expect(await within(sheet).findByText('Someone else changed this bill meanwhile. It has been read again: check it, then try again.')).toBeTruthy()
    expect(await within(drawer).findByRole('button', { name: 'Cancel line: Malaria test' })).toBeTruthy()
    expect(reads).toBe(2)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Money arrived' }))
    await waitFor(() => expect(confirmPayment).toHaveBeenCalledTimes(2))
    expect(confirmPayment.mock.calls[0]![3]).toBe(5)
    expect(confirmPayment.mock.calls[1]![3]).toBe(9)
    expect(confirmPayment.mock.calls[1]![4]).not.toBe(confirmPayment.mock.calls[0]![4])
  })

  it('says another member of staff must cancel a payment the person took', async () => {
    as(OFFICER)
    commerceApi.voidPayment = async () => refused('SECOND_PERSON_REQUIRED', 'Another member of staff must do this, not the person who recorded the payment.', 403)
    const drawer = await openBill()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel or refund' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this payment?' })
    fireEvent.change(within(sheet).getByLabelText('Why is it refunded?'), { target: { value: 'Paid twice by mistake' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    expect(await within(sheet).findByText('Another member of staff must do this, not the person who recorded the payment.')).toBeTruthy()
  })

  it('asks for a reason of 8 characters or more before cancelling', async () => {
    as(OFFICER)
    const voidPayment = vi.fn()
    commerceApi.voidPayment = voidPayment
    const drawer = await openBill()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel or refund' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this payment?' })
    fireEvent.change(within(sheet).getByLabelText('Why is it refunded?'), { target: { value: 'short' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel payment' }))
    expect(await within(sheet).findByText('Say why, in 8 to 492 characters.')).toBeTruthy()
    expect(voidPayment).not.toHaveBeenCalled()
  })

  it('cancels HMO cover with its reason, and confirms a transfer someone else recorded', async () => {
    as(OFFICER)
    const transfer = { id: 'pay-2', method: 'transfer' as const, amountKobo: 100000, reference: 'TRF-0091', receivedBy: 'Bola Cashier',
      receivedAt: '2026-11-26T09:00:00Z', voided: false, status: 'pending_check' as const, receiptNumber: 'R-2026-000124' }
    const cancelHmoCover = vi.fn(async (..._args: unknown[]) => ok(billOf({ payments: [...billOf().payments, transfer], hmoCovers: [], hmoCoveredKobo: 0, pendingCheckKobo: 100000, dueKobo: 250000, version: 6 })))
    commerceApi.cancelHmoCover = cancelHmoCover
    const confirmPayment = vi.fn(async (..._args: unknown[]) => ok(billOf({ version: 7 })))
    commerceApi.confirmPayment = confirmPayment
    const drawer = await openBill(billOf({ payments: [...billOf().payments, transfer], pendingCheckKobo: 100000, dueKobo: 50000 }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel HMO cover' }))
    let sheet = await screen.findByRole('dialog', { name: 'Cancel this HMO cover?' })
    fireEvent.change(within(sheet).getByLabelText('Why?'), { target: { value: 'The HMO refused the visit' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel HMO cover' }))
    await waitFor(() => expect(cancelHmoCover).toHaveBeenCalled())
    expect(cancelHmoCover.mock.calls[0]).toEqual(expect.arrayContaining(['cover-1', 'The HMO refused the visit', 5]))
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Bill B-000412/ })).getByRole('button', { name: 'Confirm transfer' }))
    sheet = await screen.findByRole('dialog', { name: 'Confirm this transfer?' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Money arrived' }))
    await waitFor(() => expect(confirmPayment).toHaveBeenCalled())
    expect(confirmPayment.mock.calls[0]).toEqual(expect.arrayContaining(['pay-2']))
  })

  it('offers Cancel bill only when nothing is paid or covered, and Emergency: bill follows while something is due', async () => {
    as(OFFICER)
    const voidBill = vi.fn(async (..._args: unknown[]) => ok(unpaidBill({ status: 'void', version: 6 })))
    commerceApi.voidBill = voidBill
    const drawer = await openBill(unpaidBill())
    expect(within(drawer).getByRole('button', { name: 'Emergency: bill follows' })).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel bill' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this bill?' })
    fireEvent.change(within(sheet).getByLabelText('Why?'), { target: { value: 'Made for the wrong visit' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel bill' }))
    await waitFor(() => expect(voidBill).toHaveBeenCalled())
  })

  it('says why a bill follows for an unknown patient', async () => {
    as(OFFICER)
    const drawer = await openBill(billOf({ status: 'deferred', deferred: { reason: 'unknown_patient', by: 'system', at: '2026-11-26T08:10:00Z' } }), 'Bill follows')
    expect(within(drawer).getByText('An unknown patient: served first, billed when they are identified.')).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'Emergency: bill follows' })).toBeNull()
  })

  /** The server's answer after a part-paid medicine's dispensing was reversed: its line is off the bill, nothing is due,
   * and only the money paid beyond the bill's new total is to give back. */
  const reversedBill = (patch: Partial<Bill> = {}) => {
    const paid = billOf()
    return billOf({ status: 'paid', totalKobo: 500000, paidKobo: 400000, hmoCoveredKobo: 200000, dueKobo: 0,
      refundDueKobo: 100000, coverOverKobo: 0,
      lines: [paid.lines[0]!, { ...paid.lines[1]!, cancelled: true, dispensingReversed: true }],
      payments: [{ ...paid.payments[0]!, amountKobo: 400000 }], ...patch })
  }

  it('says how much refund is due when a part-paid medicine\'s dispensing was reversed, with the line off the bill', async () => {
    as(OFFICER)
    const drawer = await openBill(reversedBill(), 'Paid')
    expect(within(drawer).getAllByText((_, element) => element?.textContent === `Refund due ${naira(100000)}`).length).toBeGreaterThan(0)
    expect(within(drawer).getByText(/The dispensing of Paracetamol 500 mg tablet was reversed, so it is off the bill/)).toBeTruthy()
    expect(within(within(drawer).getByRole('list', { name: 'Lines' })).queryByText(/Paracetamol/)).toBeNull()
    expect(within(drawer).queryByText('HMO cover or waiver is more than the bill')).toBeNull()
  })

  it('says when an HMO cover or waiver is more than the bill after a reversal', async () => {
    as(OFFICER)
    const drawer = await openBill(reversedBill({ paidKobo: 0, payments: [], refundDueKobo: 0, hmoCoveredKobo: 650000, coverOverKobo: 150000 }), 'Paid')
    expect(within(drawer).getByText('HMO cover or waiver is more than the bill')).toBeTruthy()
    expect(within(drawer).queryByText(/^Refund due/)).toBeNull()
  })

  it('says nothing of a refund when a reversed medicine was never paid for, or none was reversed', async () => {
    as(OFFICER)
    const drawer = await openBill(reversedBill({ status: 'part_paid', paidKobo: 300000, hmoCoveredKobo: 0, dueKobo: 200000,
      refundDueKobo: 0, payments: [billOf().payments[0]!] }))
    expect(within(drawer).queryByText(/^Refund due/)).toBeNull()
    expect(within(drawer).queryByText(/dispensing reversed/)).toBeNull()
  })

  it('shows a cashier no cancel, refund or confirm', async () => {
    const drawer = await openBill()
    for (const name of ['Cancel or refund', 'Cancel HMO cover', 'Cancel bill', 'Confirm transfer']) expect(within(drawer).queryByRole('button', { name })).toBeNull()
    expect(within(drawer).getByRole('button', { name: 'Add an item' })).toBeTruthy()
  })
})

describe('Take payment', () => {
  it('records HMO cover as owed by the HMO, never paid, with no receipt', async () => {
    const bill = unpaidBill()
    commerceApi.bill = async () => ok(bill)
    const recordPayment = vi.fn(async (..._args: unknown[]) => ok(unpaidBill({ hmoCoveredKobo: 650000, dueKobo: 0, status: 'paid', version: 6,
      hmoCovers: [{ id: 'cover-9', hmoId: HMO_ID, hmoName: 'Demo HMO', amountKobo: 650000, approvalCode: 'AX-221', status: 'pending_claim', recordedBy: 'Demo Scientist', recordedAt: '2026-11-26T10:00:00Z' }] })))
    commerceApi.recordPayment = recordPayment
    const receipt = vi.fn()
    commerceApi.receipt = receipt
    commerceApi.catalogueItems = async () => ok({ items: [], nextPage: null })
    renderDept(<TakePayment open bill={bill} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('radio', { name: /HMO/ }))
    expect(screen.getByText('Recorded as owed by the HMO, not paid. The HMO pays it after its claim is accepted.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Approval code'), { target: { value: 'AX-221' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record HMO cover' }))
    await waitFor(() => expect(recordPayment).toHaveBeenCalled())
    expect(recordPayment.mock.calls[0]![2]).toEqual({ method: 'hmo', amountKobo: 650000, reference: 'AX-221', hmoId: HMO_ID, expectedVersion: 5 })
    expect(await screen.findByText('Recorded as owed by the HMO, not paid')).toBeTruthy()
    expect(receipt).not.toHaveBeenCalled()
  })

  it('sends the paper receipt number and the till, and prints that payment’s receipt', async () => {
    commerceApi.paymentSettings = async () => ok(settingsOf({ dayCloseBy: 'till', tills: [{ id: TILL_ID, name: 'Front till', active: true }] }))
    const bill = unpaidBill()
    commerceApi.bill = async () => ok(bill)
    const paid = unpaidBill({ status: 'paid', paidKobo: 650000, dueKobo: 0, version: 6, payments: [{ id: 'pay-new', method: 'cash', amountKobo: 650000,
      receivedBy: 'Demo Scientist', receivedAt: '2026-11-26T10:00:00Z', voided: false, status: 'recorded', receiptNumber: 'R-2026-000200', paperReceiptNumber: '0457' }] })
    const recordPayment = vi.fn(async (..._args: unknown[]) => ok(paid))
    commerceApi.recordPayment = recordPayment
    const receipt = vi.fn(async (..._args: unknown[]) => ok({ receiptNumber: 'R-2026-000200', facility: { name: 'Demo Hospital' }, bill: paid, issuedAt: '2026-11-26T10:00:00Z',
      issuedBy: 'Demo Scientist', paperReceiptNumber: '0457' }))
    commerceApi.receipt = receipt
    renderDept(<TakePayment open bill={bill} onClose={() => undefined} />)
    fireEvent.change(await screen.findByLabelText(/Paper receipt number/), { target: { value: '0457' } })
    fireEvent.click(screen.getByRole('button', { name: /Take payment/ }))
    await waitFor(() => expect(recordPayment).toHaveBeenCalled())
    expect(recordPayment.mock.calls[0]![2]).toEqual({ method: 'cash', amountKobo: 650000, tillId: TILL_ID, paperReceiptNumber: '0457', expectedVersion: 5 })
    await waitFor(() => expect(receipt).toHaveBeenCalled())
    expect(receipt.mock.calls[0]).toEqual(expect.arrayContaining(['pay-new']))
    expect(await screen.findByText('Paper receipt 0457')).toBeTruthy()
  })

  it('never asks for a medicine whose dispensing was reversed: its line is off the bill', async () => {
    const paid = billOf()
    const bill = unpaidBill({ totalKobo: 500000, dueKobo: 500000, lines: [paid.lines[0]!, { ...paid.lines[1]!, cancelled: true, dispensingReversed: true }] })
    commerceApi.bill = async () => ok(bill)
    commerceApi.catalogueItems = async () => ok({ items: [], nextPage: null })
    renderDept(<TakePayment open bill={bill} onClose={() => undefined} />)
    expect(await screen.findByText('Consultation')).toBeTruthy()
    expect(screen.queryByText(/Paracetamol/)).toBeNull()
  })

  it('says to open the day first, with the way to End of day', async () => {
    commerceApi.bill = async () => ok(unpaidBill())
    commerceApi.recordPayment = async () => refused('TILL_DAY_NOT_OPEN', 'Open your day first.')
    renderDept(<TakePayment open bill={unpaidBill()} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: /Take payment/ }))
    const alert = await screen.findByText('Open your day first.')
    expect(within(alert.closest('[role]')!.parentElement!).getByRole('link', { name: 'End of day' })).toBeTruthy()
  })

  it('refuses more than is due before sending, and says so when the server does', async () => {
    commerceApi.bill = async () => ok(unpaidBill({ dueKobo: 100000 }))
    const recordPayment = vi.fn(async (..._args: unknown[]) => refused('OVERPAYMENT', 'That is more than is due. Enter the amount due or less.'))
    commerceApi.recordPayment = recordPayment
    renderDept(<TakePayment open bill={unpaidBill({ dueKobo: 100000 })} onClose={() => undefined} />)
    fireEvent.change(await screen.findByLabelText('Amount to pay'), { target: { value: '5000' } })
    expect(await screen.findByText('That is more than the ₦1,000.00 due.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Amount to pay'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Take payment/ }))
    expect(await screen.findByText('That is more than is due. Enter the amount due or less.')).toBeTruthy()
  })

  it('takes a POS reference of 6 to 20 letters and digits only, and offers no waiver without billing.payment.waive', async () => {
    commerceApi.bill = async () => ok(unpaidBill())
    const recordPayment = vi.fn()
    commerceApi.recordPayment = recordPayment
    renderDept(<TakePayment open bill={unpaidBill()} onClose={() => undefined} />)
    expect(screen.queryByRole('radio', { name: /Waiver/ })).toBeNull()
    fireEvent.click(await screen.findByRole('radio', { name: /POS/ }))
    fireEvent.change(screen.getByLabelText(/Reference on the POS slip/), { target: { value: '12-34' } })
    fireEvent.click(screen.getByRole('button', { name: /Take payment/ }))
    expect(await screen.findByText(/6 to 20 letters and digits/)).toBeTruthy()
    expect(recordPayment).not.toHaveBeenCalled()
  })

  it('never offers paying online, which is built but switched off', async () => {
    commerceApi.paymentSettings = async () => ok(settingsOf({ methods: ['cash', 'online' as never] }))
    commerceApi.bill = async () => ok(unpaidBill())
    renderDept(<TakePayment open bill={unpaidBill()} onClose={() => undefined} />)
    expect(await screen.findByRole('radio', { name: /Cash/ })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Online/ })).toBeNull()
  })

  it('says billing is not set up when the bill answers 404, and saves nothing', async () => {
    commerceApi.bill = async () => off()
    commerceApi.paymentSettings = async () => off()
    renderDept(<TakePayment open bill={{ billId: 'b-1', status: 'unpaid', dueKobo: 100 }} onClose={() => undefined} />)
    expect(await screen.findByText('This isn’t set up for your facility. Contact support.')).toBeTruthy()
  })
})

describe('the receipt', () => {
  it('prints the last four of the Health ID, "Cancelled" for a voided payment, the paper number, and HMO cover apart from what was paid', () => {
    const bill = billOf()
    renderDept(<Receipt bill={bill} receipt={{ receiptNumber: 'R-2026-000123', facility: { name: 'Demo Hospital' }, bill, issuedAt: '2026-11-26T08:30:00Z',
      issuedBy: 'Bola Cashier', cancelled: true, paperReceiptNumber: '0457' }} />)
    expect(screen.getByText('ending 7Q2K')).toBeTruthy()
    expect(screen.getByText('Cancelled')).toBeTruthy()
    expect(screen.getByText('Paper receipt 0457')).toBeTruthy()
    expect(screen.getByText('HMO to pay · Demo HMO · code AX-221')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/HID-[A-Z0-9]/)
  })
})

describe('a work item’s bill badge', () => {
  it('says Refund due with the amount while money paid for a reversed medicine is to give back, and Paid otherwise', () => {
    const { unmount } = renderDept(<BillBadge bill={{ billId: 'b-1', status: 'paid', dueKobo: 0, dispensingReversed: true, refundDueKobo: 20000 }} />)
    expect(screen.getAllByText((_, element) => element?.textContent === `Refund due ${naira(20000)}`).length).toBeGreaterThan(0)
    expect(screen.queryByText('Paid')).toBeNull()
    unmount()
    const again = renderDept(<BillBadge bill={{ billId: 'b-1', status: 'paid', dueKobo: 0, dispensingReversed: true, refundDueKobo: 0 }} />)
    expect(screen.queryByText(/Refund due/)).toBeNull()
    expect(screen.getByText('Paid')).toBeTruthy()
    again.unmount()
    renderDept(<BillBadge bill={{ billId: 'b-1', status: 'paid', dueKobo: 0 }} />)
    expect(screen.getByText('Paid')).toBeTruthy()
  })
})
