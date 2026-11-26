import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { batchExpired, daysLeft, expiryOf, StockPage } from '../../../../ehr-blue/departments/pharmacy/Stock'
import { Sell } from '../../../../ehr-blue/departments/pharmacy/Sell'
import { PaperPrescription } from '../../../../ehr-blue/departments/pharmacy/PaperPrescription'
import { ReceiveStock } from '../../../../ehr-blue/departments/pharmacy/ReceiveStock'
import { Sales } from '../../../../ehr-blue/departments/pharmacy/Sales'
import { outsideOrder, EMPTY_OUTSIDE } from '../../../../ehr-blue/departments/pharmacy/walkIn'
import type { Bill, CatalogueItem, PaymentSettings, StockLine } from '../../../../ehr-blue/departments/commerce/api'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { billOf } from '../commerce/billingFixtures'

/**
 * The pharmacy's point-of-care stock and counter sales against hid-system BILL-1 (0166): stock settings per item, the
 * expired count apart (never given out), a counter sale without a photo of the prescription (refused until the upload
 * ships), queuing a paper prescription switched off with BILL-1's words, receiving only into counted stock, and each page
 * saying when billing is not switched on. Every drug, batch and person here is fictional.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined, rest: '' }))
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
vi.mock('../../../../ehr-blue/frame/pageContext', () => ({ useBluePage: () => ({ rest: session.rest }) }))

const PHARMACIST = ['billing.catalogue.read', 'billing.bill.read', 'billing.bill.create', 'billing.payment.record', 'billing.shift.own',
  'pharmacy.stock.read', 'pharmacy.stock.manage', 'pharmacy.walk-in.create', 'pharmacy.dispensing.create', 'pharmacy.work-item.read']
const ok = <T,>(data: T) => ({ ok: true as const, data })

const AMOXICILLIN: StockLine = {
  catalogueItemId: 'cat-amox', name: 'Amoxicillin', strength: '500 mg', form: 'capsule', imageUrl: null, onHand: 180, expiredOnHand: 30,
  unit: 'capsule', reorderLevel: 50, version: 2, batches: [
    { batchId: 'batch-old', batchNumber: 'AMX-1001', expiresOn: '2026-01-01', quantity: 30, expired: true },
    { batchId: 'batch-new', batchNumber: 'AMX-2291', expiresOn: '2027-06-01', quantity: 180, expired: false },
  ],
}
const PARACETAMOL: CatalogueItem = { id: 'cat-para', kind: 'drug', name: 'Paracetamol', strength: '500 mg', form: 'tablet', prescriptionOnly: false,
  prices: { cashKobo: 20000, hmo: [] }, stockKept: false, active: true, version: 1 }
const CIPRO: CatalogueItem = { id: 'cat-cipro', kind: 'drug', name: 'Ciprofloxacin', strength: '500 mg', form: 'tablet', prescriptionOnly: true,
  prices: { cashKobo: 90000, hmo: [] }, stockKept: true, active: true, version: 1 }

/** A counter sale of one Paracetamol at version 1, as made (nothing paid yet). */
const madeSale = (patch: Partial<Bill> = {}) => billOf({ id: 'sale-1', number: 'B-000600', source: 'pharmacy', status: 'unpaid', counter: true,
  patient: null, visit: null, lines: [{ id: 'line-para', catalogueItemId: 'cat-para', name: 'Paracetamol 500 mg', kind: 'drug', quantity: 1,
    unitKobo: 20000, totalKobo: 20000, workItemId: null, origin: 'counter', cancelled: false }],
  totalKobo: 20000, paidKobo: 0, hmoCoveredKobo: 0, dueKobo: 20000, payments: [], hmoCovers: [], receiptNumber: null, version: 1, ...patch })
const paidSale = (version: number) => madeSale({ status: 'paid', paidKobo: 20000, dueKobo: 0, receiptNumber: 'R-2026-000601', version,
  payments: [{ id: 'pay-c', method: 'cash', amountKobo: 20000, receivedBy: 'Bola Cashier', receivedAt: '2026-11-26T09:05:00Z', voided: false,
    status: 'recorded', receiptNumber: 'R-2026-000601' }] })
const sellSettings = (wherePaid: PaymentSettings['wherePaid']): PaymentSettings => ({ wherePaid, methods: ['cash'], payBefore: { pharmacy: false, lab: false },
  allowDeferredFor: ['emergency'], hmos: [], dayCloseBy: 'facility', tills: [], version: 1 })

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  session.facility = fakeFacility(PHARMACIST, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
  session.rest = ''
})

describe('Stock', () => {
  it('shows the expired count apart, as never given out, and the batch on each movement', async () => {
    commerceApi.stock = async () => ok({ items: [AMOXICILLIN], nextPage: null })
    commerceApi.stockMovements = async () => ok({ items: [{ id: 'mv-1', kind: 'counter_sale', change: -2, batchNumber: 'AMX-2291', at: '2026-11-26T09:00:00Z', by: 'Ade Pharmacist' },
      { id: 'mv-2', kind: 'adjustment', change: 2, batchNumber: 'AMX-2291', at: '2026-11-26T10:00:00Z', by: 'Ade Pharmacist' }], nextPage: null })
    renderDept(<StockPage />)
    expect(await screen.findByText('30 capsule expired, not given out')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Amoxicillin/ }))
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText('Sold at the counter · Batch AMX-2291')).toBeTruthy()
    // A dispensing reversal moves no stock (hid-system 0166): what comes back is counted back as an adjustment.
    expect(within(drawer).getByText('Adjusted · Batch AMX-2291')).toBeTruthy()
    expect(drawer.textContent).toContain('30 capsule in expired batches: never given out.')
  })

  it('counts stock for a drug on the price list: its unit and reorder level', async () => {
    commerceApi.stock = async () => ok({ items: [], nextPage: null })
    commerceApi.catalogueItems = async () => ok({ items: [PARACETAMOL, CIPRO], nextPage: null })
    const settings = vi.fn(async (..._args: unknown[]) => ok({ ...AMOXICILLIN, catalogueItemId: 'cat-para', name: 'Paracetamol', onHand: 0, expiredOnHand: 0, batches: [] }))
    commerceApi.stockSettings = settings
    renderDept(<StockPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Count stock for an item' }))
    const sheet = await screen.findByRole('dialog', { name: 'Count stock for an item' })
    fireEvent.change(within(sheet).getByLabelText(/^Drug/), { target: { value: 'para' } })
    const choose = await within(sheet).findByRole('combobox', { name: 'Choose the drug' })
    await waitFor(() => expect(within(choose).getAllByRole('option').map(option => option.textContent)).toContain('Paracetamol 500 mg'))
    // Ciprofloxacin is counted already: not offered again.
    expect(within(choose).queryByText('Ciprofloxacin 500 mg')).toBeNull()
    fireEvent.change(choose, { target: { value: 'cat-para' } })
    fireEvent.change(within(sheet).getByLabelText(/^Counted in/), { target: { value: 'tablet' } })
    fireEvent.change(within(sheet).getByLabelText(/^Reorder level/), { target: { value: '100' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start counting' }))
    await waitFor(() => expect(settings).toHaveBeenCalled())
    expect(settings.mock.calls[0]).toEqual(expect.arrayContaining(['cat-para', { unit: 'tablet', reorderLevel: 100, expectedVersion: 0 }]))
  })

  it('keeps the unit while there is stock, and says the server’s refusal', async () => {
    commerceApi.stock = async () => ok({ items: [AMOXICILLIN], nextPage: null })
    commerceApi.stockMovements = async () => ok({ items: [], nextPage: null })
    commerceApi.stockSettings = async () => ({ ok: false, error: 'The unit cannot change while there is stock.', code: 'STOCK_UNIT_LOCKED', status: 409 })
    renderDept(<StockPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Amoxicillin/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stock settings' }))
    const sheet = await screen.findByRole('dialog', { name: 'Stock settings' })
    expect(within(sheet).getByLabelText(/^Counted in/)).toHaveProperty('disabled', true)
    fireEvent.change(within(sheet).getByLabelText(/^Reorder level/), { target: { value: '80' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save settings' }))
    expect(await within(sheet).findByText('The unit cannot change while there is stock.')).toBeTruthy()
  })

  it('counts Lagos days to a batch’s expiry: on its expiry day it is still given out, so it is not "Expired"', () => {
    const lagos = (iso: string) => Date.parse(iso)
    // 1 Dec 2026 at 00:30, 10:00 and 23:30 in Lagos (UTC+1), then 00:30 on 2 Dec.
    expect(daysLeft('2026-12-01', lagos('2026-11-30T23:30:00Z'))).toBe(0)
    expect(daysLeft('2026-12-01', lagos('2026-12-01T09:00:00Z'))).toBe(0)
    expect(daysLeft('2026-12-01', lagos('2026-12-01T22:30:00Z'))).toBe(0)
    expect(daysLeft('2026-12-01', lagos('2026-12-01T23:30:00Z'))).toBe(-1)
    expect(daysLeft('2026-12-01', lagos('2026-11-30T22:30:00Z'))).toBe(1)
    // The server's word decides; a copy without it counts Lagos days.
    expect(batchExpired({ expiresOn: '2026-12-01', expired: false }, lagos('2026-12-01T23:30:00Z'))).toBe(false)
    expect(batchExpired({ expiresOn: '2026-12-01' }, lagos('2026-12-01T09:00:00Z'))).toBe(false)
    expect(batchExpired({ expiresOn: '2026-12-01' }, lagos('2026-12-01T23:30:00Z'))).toBe(true)
    expect(expiryOf({ batches: [{ batchId: 'b', batchNumber: 'AMX-3001', expiresOn: '2026-12-01', quantity: 20, expired: false }] },
      lagos('2026-12-01T09:00:00Z'))?.kind).toBe('soon')
  })

  it('shows a batch on its expiry day as expiring, not expired, as the server gives it out first that day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-01T09:00:00Z'))
    try {
      const today: StockLine = { ...AMOXICILLIN, onHand: 20, expiredOnHand: 0,
        batches: [{ batchId: 'batch-today', batchNumber: 'AMX-3001', expiresOn: '2026-12-01', quantity: 20, expired: false }] }
      commerceApi.stock = async () => ok({ items: [today], nextPage: null })
      commerceApi.stockMovements = async () => ok({ items: [], nextPage: null })
      renderDept(<StockPage />)
      const card = await screen.findByRole('button', { name: /Amoxicillin/ })
      expect(within(card).getByText('Expiring soon · 1 Dec 2026')).toBeTruthy()
      expect(card.textContent).not.toMatch(/Expired/)
      fireEvent.click(card)
      const drawer = await screen.findByRole('dialog')
      expect(within(drawer).getByText('Expiring soon: 1 Dec 2026')).toBeTruthy()
      expect(drawer.textContent).not.toMatch(/Expired/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says billing is not switched on when stock answers 404', async () => {
    renderDept(<StockPage />)
    expect(await screen.findByText('Billing is not switched on at this facility yet.')).toBeTruthy()
  })
})

describe('a counter sale', () => {
  it('asks for the prescriber of a prescription-only drug with no photo, and sends no photo at all', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [CIPRO], nextPage: null })
    commerceApi.stock = async () => ok({ items: [], nextPage: null })
    commerceApi.paymentSettings = async () => ok({ wherePaid: 'both', methods: ['cash'], payBefore: { pharmacy: false, lab: false }, allowDeferredFor: ['emergency'],
      hmos: [], dayCloseBy: 'facility', tills: [], version: 1 })
    const walkIn = vi.fn(async (..._args: unknown[]) => ({ ok: false, error: 'This medicine needs a doctor’s prescription.', code: 'PRESCRIPTION_REQUIRED', status: 422 }))
    commerceApi.pharmacyWalkIn = walkIn
    renderDept(<Sell />)
    fireEvent.click(await screen.findByRole('button', { name: /^Add: Ciprofloxacin 500 mg/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Doctor’s prescription' })
    expect(within(sheet).queryByText(/Take or choose a photo/)).toBeNull()
    fireEvent.change(within(sheet).getByLabelText('Prescriber’s name'), { target: { value: 'Dr Test Prescriber' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to basket' }))
    fireEvent.click((await screen.findAllByRole('button', { name: /Take payment/ }))[0]!)
    await waitFor(() => expect(walkIn).toHaveBeenCalled())
    const order = walkIn.mock.calls[0]![1] as { counter: boolean; outside: Record<string, unknown> }
    expect(order.counter).toBe(true)
    expect(order.outside.prescriberName).toBe('Dr Test Prescriber')
    expect(Object.keys(order.outside)).not.toContain('photoFileId')
    expect(await screen.findByText(/This medicine needs a doctor’s prescription\./)).toBeTruthy()
  })

  it('goes straight to the hand-over for a sale of free items only: the server answers it paid as made', async () => {
    const ors: CatalogueItem = { id: 'cat-ors', kind: 'drug', name: 'Oral rehydration salts', strength: null, form: 'other', prescriptionOnly: false,
      prices: { cashKobo: 0, hmo: [] }, stockKept: false, active: true, version: 1 }
    commerceApi.catalogueItems = async () => ok({ items: [ors], nextPage: null })
    commerceApi.stock = async () => ok({ items: [], nextPage: null })
    commerceApi.paymentSettings = async () => ok({ wherePaid: 'both', methods: ['cash'], payBefore: { pharmacy: false, lab: false }, allowDeferredFor: ['emergency'],
      hmos: [], dayCloseBy: 'facility', tills: [], version: 1 })
    commerceApi.pharmacyWalkIn = vi.fn(async () => ok({ bill: billOf({ source: 'pharmacy', status: 'paid', patient: null, visit: null,
      lines: [{ id: 'line-ors', catalogueItemId: 'cat-ors', name: 'Oral rehydration salts', kind: 'drug', quantity: 1, unitKobo: 0, totalKobo: 0,
        workItemId: null, origin: 'counter', cancelled: false }],
      totalKobo: 0, paidKobo: 0, hmoCoveredKobo: 0, dueKobo: 0, payments: [], hmoCovers: [], receiptNumber: null }) }))
    renderDept(<Sell />)
    fireEvent.click(await screen.findByRole('button', { name: /^Add: Oral rehydration salts/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /Take payment/ }))[0]!)
    expect(await screen.findByText('Hand over')).toBeTruthy()
  })

  it('hands over a sale paid at the cashier with the version it has once paid, after Check again', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [PARACETAMOL], nextPage: null })
    commerceApi.stock = async () => ok({ items: [], nextPage: null })
    commerceApi.paymentSettings = async () => ok(sellSettings('cashier'))
    commerceApi.pharmacyWalkIn = async () => ok({ workItemIds: [], bill: madeSale() })
    // The cashier takes the money meanwhile: every payment moves the bill's version on.
    let atCashier = false
    commerceApi.bill = async () => ok(atCashier ? paidSale(2) : madeSale())
    const handOver = vi.fn(async (..._args: unknown[]) => ok({ handedOverAt: '2026-11-26T09:10:00Z', bill: { ...paidSale(3), handedOverAt: '2026-11-26T09:10:00Z' } }))
    commerceApi.handOverSale = handOver
    renderDept(<Sell />)
    fireEvent.click(await screen.findByRole('button', { name: /^Add: Paracetamol 500 mg/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /Send to cashier/ }))[0]!)
    const check = await screen.findByRole('button', { name: 'Check again' })
    atCashier = true
    fireEvent.click(check)
    fireEvent.click(await screen.findByRole('button', { name: 'Handed over' }))
    await waitFor(() => expect(handOver).toHaveBeenCalled())
    expect(handOver.mock.calls[0]![1]).toBe('sale-1')
    expect(handOver.mock.calls[0]![3]).toBe(2)
    expect(await screen.findByText('Sale complete')).toBeTruthy()
    expect(screen.queryByText(/Someone else changed this/)).toBeNull()
  })

  it('hands over a sale paid in the payment step’s own drawer with the version it has once paid', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [PARACETAMOL], nextPage: null })
    commerceApi.stock = async () => ok({ items: [], nextPage: null })
    commerceApi.paymentSettings = async () => ok(sellSettings('both'))
    commerceApi.pharmacyWalkIn = async () => ok({ workItemIds: [], bill: madeSale() })
    commerceApi.bill = async () => ok(madeSale())
    const recordPayment = vi.fn(async (..._args: unknown[]) => ok(paidSale(2)))
    commerceApi.recordPayment = recordPayment
    const handOver = vi.fn(async (..._args: unknown[]) => ok({ handedOverAt: '2026-11-26T09:10:00Z', bill: { ...paidSale(3), handedOverAt: '2026-11-26T09:10:00Z' } }))
    commerceApi.handOverSale = handOver
    renderDept(<Sell />)
    fireEvent.click(await screen.findByRole('button', { name: /^Add: Paracetamol 500 mg/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /Take payment/ }))[0]!)
    // The counter's own drawer opens at once; it is closed, and the payment step's Take payment is used instead.
    const first = await screen.findByRole('dialog', { name: /Take payment/ })
    fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: 'Take payment' }))
    const drawer = await screen.findByRole('dialog', { name: /Take payment/ })
    fireEvent.click(await within(drawer).findByRole('button', { name: /^Take payment ₦200\.00/ }))
    await waitFor(() => expect(recordPayment).toHaveBeenCalled())
    expect(recordPayment.mock.calls[0]![2]).toMatchObject({ method: 'cash', amountKobo: 20000, expectedVersion: 1 })
    fireEvent.click(await within(await screen.findByRole('dialog', { name: /Paid/ })).findByRole('button', { name: 'Done' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Handed over' }))
    await waitFor(() => expect(handOver).toHaveBeenCalled())
    expect(handOver.mock.calls[0]![3]).toBe(2)
    expect(await screen.findByText('Sale complete')).toBeTruthy()
  })

  it('reads a sale again when the hand-over is refused because it changed, and sends the next press anew', async () => {
    const ors: CatalogueItem = { ...PARACETAMOL, id: 'cat-para', prices: { cashKobo: 0, hmo: [] } }
    commerceApi.catalogueItems = async () => ok({ items: [ors], nextPage: null })
    commerceApi.stock = async () => ok({ items: [], nextPage: null })
    commerceApi.paymentSettings = async () => ok(sellSettings('both'))
    commerceApi.pharmacyWalkIn = async () => ok({ workItemIds: [], bill: madeSale({ status: 'paid', totalKobo: 0, dueKobo: 0, version: 1 }) })
    commerceApi.bill = async () => ok(madeSale({ status: 'paid', totalKobo: 0, dueKobo: 0, version: 4 }))
    const handOver = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Someone else changed this. Reload it and try again.', code: 'VERSION_CONFLICT', status: 412 })
      .mockResolvedValueOnce(ok({ handedOverAt: '2026-11-26T09:10:00Z', bill: madeSale({ status: 'paid', totalKobo: 0, dueKobo: 0, version: 5, handedOverAt: '2026-11-26T09:10:00Z' }) }))
    commerceApi.handOverSale = handOver
    renderDept(<Sell />)
    fireEvent.click(await screen.findByRole('button', { name: /^Add: Paracetamol 500 mg/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /Take payment/ }))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Handed over' }))
    expect(await screen.findByText('Someone else changed this sale meanwhile. It has been read again: check it, then press Handed over again.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Handed over' }))
    expect(await screen.findByText('Sale complete')).toBeTruthy()
    expect(handOver.mock.calls.map(call => call[3])).toEqual([1, 4])
    expect(handOver.mock.calls[1]![2]).not.toBe(handOver.mock.calls[0]![2])
  })

  it('leaves photoFileId out of an outside order without a photo', () => {
    expect(outsideOrder({ ...EMPTY_OUTSIDE, prescriberName: 'Dr Test' })).not.toHaveProperty('photoFileId')
  })
})

describe('a paper prescription', () => {
  it('is switched off with BILL-1’s words and a way to sell at the counter instead', async () => {
    const walkIn = vi.fn()
    commerceApi.pharmacyWalkIn = walkIn
    renderDept(<PaperPrescription />)
    expect(await screen.findByText('Sell it at the counter. Queuing outside prescriptions is not available yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sell at the counter' }).getAttribute('href')).toBe('/provider/pharmacy/sell')
    const add = screen.getByRole('button', { name: 'Add and pick' })
    expect(add).toHaveProperty('disabled', true)
    fireEvent.click(add)
    expect(walkIn).not.toHaveBeenCalled()
    expect(screen.queryByText(/Take or choose a photo/)).toBeNull()
  })
})

describe('receiving stock', () => {
  it('receives only into an item whose stock is counted', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [PARACETAMOL], nextPage: null })
    commerceApi.stock = async () => ok({ items: [], nextPage: null })
    const receive = vi.fn()
    commerceApi.receiveStock = receive
    renderDept(<ReceiveStock />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'para' } })
    fireEvent.click(await screen.findByRole('button', { name: /Paracetamol/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save stock received' }))
    expect(await screen.findByText(/Stock is not counted for this item yet/)).toBeTruthy()
    expect(receive).not.toHaveBeenCalled()
  })
})

describe('Sales & receipts', () => {
  it('says billing is not switched on when its bills answer 404', async () => {
    renderDept(<Sales />)
    expect(await screen.findByText('Billing is not switched on at this facility yet.')).toBeTruthy()
    expect(screen.queryByText('No sales yet today')).toBeNull()
  })

  it('refunds at a till with a day per till: the till is asked for, and sent', async () => {
    session.facility = fakeFacility([...PHARMACIST, 'billing.payment.void'], { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
    session.rest = 'sale-9'
    const sale = billOf({ id: 'sale-9', number: 'B-000501', source: 'pharmacy', status: 'paid', counter: true, patient: null, visit: null,
      lines: [], totalKobo: 20000, paidKobo: 20000, hmoCoveredKobo: 0, dueKobo: 0, hmoCovers: [], handedOverAt: '2026-11-26T09:10:00Z',
      payments: [{ id: 'pay-9', method: 'cash', amountKobo: 20000, receivedBy: 'Bola Cashier', receivedAt: '2026-11-26T09:05:00Z', voided: false,
        status: 'recorded', receiptNumber: 'R-2026-000301' }] })
    commerceApi.bill = async () => ok(sale)
    commerceApi.paymentSettings = async () => ok({ ...sellSettings('both'), dayCloseBy: 'till' as const,
      tills: [{ id: 'till-front', name: 'Front till', active: true }, { id: 'till-back', name: 'Back till', active: true }] })
    const voidPayment = vi.fn(async (..._args: unknown[]) => ok({ ...sale, version: 6 }))
    commerceApi.voidPayment = voidPayment
    renderDept(<Sales />)
    fireEvent.click(await screen.findByRole('button', { name: 'Refund' }))
    const sheet = await screen.findByRole('dialog', { name: 'Refund' })
    fireEvent.change(within(sheet).getByLabelText('Why?'), { target: { value: 'Customer brought the pack back' } })
    fireEvent.click(within(sheet).getByRole('button', { name: /^Refund ₦/ }))
    expect(await within(sheet).findByText('Choose the till the money is given back from.')).toBeTruthy()
    expect(voidPayment).not.toHaveBeenCalled()
    fireEvent.change(within(sheet).getByLabelText('Till'), { target: { value: 'till-back' } })
    fireEvent.click(within(sheet).getByRole('button', { name: /^Refund ₦/ }))
    await waitFor(() => expect(voidPayment).toHaveBeenCalled())
    expect(voidPayment.mock.calls[0]![3]).toBe('Refund: Customer brought the pack back')
    expect(voidPayment.mock.calls[0]![6]).toBe('till-back')
  })

  it('names a counter sale by the name given and the last four of a Health ID only', async () => {
    commerceApi.bills = async () => ok({ items: [{ id: 'bill-9', number: 'B-000500', source: 'pharmacy', status: 'paid', counter: true,
      patient: { patientId: 'p-9', displayName: 'Chidi Test', healthIdLast4: 'K2Q7' }, lines: [], totalKobo: 20000, paidKobo: 20000, dueKobo: 0,
      payments: [], receiptNumber: 'R-2026-000301', createdAt: '2026-11-26T09:00:00Z', version: 2 }], nextPage: null })
    renderDept(<Sales />)
    expect(await screen.findByText('Chidi Test')).toBeTruthy()
    expect(screen.getByText('Health ID ending K2Q7')).toBeTruthy()
  })
})
