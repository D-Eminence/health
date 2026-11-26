import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PriceList } from '../../../../ehr-blue/departments/commerce/PriceList'
import { PaymentSetup } from '../../../../ehr-blue/departments/commerce/PaymentSetup'
import { EndOfDay } from '../../../../ehr-blue/departments/commerce/EndOfDay'
import { HomeBillingTodayCard } from '../../../../ehr-blue/home/adminCards'
import type { CatalogueItem, Shift } from '../../../../ehr-blue/departments/commerce/api'
import { DEMO_HOSPITAL_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { HMO_ID, ITEM_ID, TILL_ID, off, ok, refused, settingsOf } from './billingFixtures'

/**
 * The price list (the one item master, BILL-7, with Services as the Service catalogue), Payment setup (pay before
 * switched off until the clinical lead signs it, emergencies always served first, HMOs and tills never deleted), End of
 * day (waivers and HMO cover apart from cash, a note when the count differs) and Home's live billing card, against
 * hid-system BILL-1's shapes. Every name, price and code here is fictional.
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

const ADMIN = ['billing.settings.manage', 'billing.catalogue.read', 'billing.catalogue.manage', 'billing.bill.read', 'billing.shift.own', 'billing.shift.manage']
const as = (permissions: string[]) => { session.facility = fakeFacility(permissions, { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: ['org_admin'] }) }

const consultation: CatalogueItem = { id: ITEM_ID, kind: 'other', name: 'Consultation', prescriptionOnly: false, prices: { cashKobo: 500000, hmo: [] },
  active: true, version: 2, nationalCodeSystem: null, nationalCode: null, orderable: false, stockKept: false }
const amoxicillin: CatalogueItem = { id: 'item-amox', kind: 'drug', name: 'Amoxicillin', strength: '500 mg', form: 'capsule', packSize: '21 capsules',
  prescriptionOnly: true, nationalCodeSystem: 'HID-MED', nationalCode: 'MED-00042', prices: { cashKobo: 150000, hmo: [{ hmoId: HMO_ID, amountKobo: 120000 }] },
  stockKept: true, active: true, version: 4 }

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  as(ADMIN)
  commerceApi.paymentSettings = async () => ok(settingsOf())
})

describe('the price list', () => {
  it('names services "Service", shows the national code, and opens on Services from ?kind=other', async () => {
    const calls: unknown[] = []
    commerceApi.catalogueItems = async (...args: never[]) => { calls.push(args[1]); return ok({ items: [consultation, amoxicillin], nextPage: null }) }
    renderDept(<PriceList />, { route: '/provider/price-list?kind=other' })
    expect(await screen.findByText('Consultation')).toBeTruthy()
    expect(calls[0]).toEqual(expect.objectContaining({ kind: 'other' }))
    // The kind on the card and on the drawn tile: "Service", never "other".
    expect(screen.getAllByText('Service').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/\bother\b/)
    expect(screen.getByText(/HID-MED MED-00042/)).toBeTruthy()
    expect(screen.getByText('Stock counted')).toBeTruthy()
  })

  it('adds a service without a strength, pack size, picture or "active", and refuses a duplicate name in BILL-1’s words', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [], nextPage: null })
    const create = vi.fn(async (..._args: unknown[]) => refused('CATALOGUE_ITEM_EXISTS', 'An active item already has this name.'))
    commerceApi.createCatalogueItem = create
    renderDept(<PriceList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const drawer = await screen.findByRole('dialog', { name: 'Add item' })
    fireEvent.click(within(drawer).getByRole('radio', { name: 'Service' }))
    expect(within(drawer).queryByLabelText(/Pack size/)).toBeNull()
    expect(within(drawer).queryByText(/Add a picture/)).toBeNull()
    fireEvent.change(within(drawer).getByLabelText('Name'), { target: { value: 'Registration' } })
    fireEvent.change(within(drawer).getByLabelText('Cash price'), { target: { value: '2,000' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    const body = create.mock.calls[0]![1] as Record<string, unknown>
    expect(body).toEqual({ kind: 'other', name: 'Registration', strength: null, form: null, packSize: null, prescriptionOnly: false,
      nationalCodeSystem: null, nationalCode: null, prices: { cashKobo: 200000, hmo: [] } })
    expect(await within(drawer).findByText('An active item already has this name.')).toBeTruthy()
  })

  it('sends only the fields that changed, with the version read', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [amoxicillin], nextPage: null })
    const update = vi.fn(async (..._args: unknown[]) => ok({ ...amoxicillin, prices: { ...amoxicillin.prices, cashKobo: 175000 }, version: 5 }))
    commerceApi.updateCatalogueItem = update
    renderDept(<PriceList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Amoxicillin' }))
    const drawer = await screen.findByRole('dialog', { name: 'Edit Amoxicillin' })
    fireEvent.change(within(drawer).getByLabelText('Cash price'), { target: { value: '1750' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0]![2]).toEqual({ expectedVersion: 4, prices: { cashKobo: 175000, hmo: [{ hmoId: HMO_ID, amountKobo: 120000 }] } })
  })

  it('checks a national medicine code’s shape before sending it', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [], nextPage: null })
    const create = vi.fn()
    commerceApi.createCatalogueItem = create
    renderDept(<PriceList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const drawer = await screen.findByRole('dialog', { name: 'Add item' })
    fireEvent.change(within(drawer).getByLabelText('Name'), { target: { value: 'Paracetamol' } })
    fireEvent.change(within(drawer).getByLabelText('Cash price'), { target: { value: '200' } })
    fireEvent.change(within(drawer).getByRole('combobox', { name: 'National list' }), { target: { value: 'HID-MED' } })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Code' }), { target: { value: '113' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }))
    expect(await within(drawer).findByText('Type the code like MED-00042.')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('lists what is not on the price list, and prices one with its code filled in', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [], nextPage: null })
    commerceApi.unpricedCodes = async () => ok({ items: [{ codeSystem: 'HID-MED', code: 'MED-00113', display: 'Paracetamol 500 mg tablet', count: 14 }] })
    renderDept(<PriceList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show' }))
    expect(await screen.findByText('HID-MED MED-00113 · 14 times')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a price' }))
    const drawer = await screen.findByRole('dialog', { name: 'Add item' })
    expect((within(drawer).getByLabelText('Name') as HTMLInputElement).value).toBe('Paracetamol 500 mg tablet')
    expect((within(drawer).getByRole('textbox', { name: 'Code' }) as HTMLInputElement).value).toBe('MED-00113')
  })

  it('prices one of this facility’s own items (HID-FACILITY) as the kind chosen, by its id in lower case', async () => {
    const facilityItem = '3F2A9C1E-5B7D-4E8F-9A0B-1C2D3E4F5A6B'
    commerceApi.catalogueItems = async () => ok({ items: [], nextPage: null })
    commerceApi.unpricedCodes = async () => ok({ items: [{ codeSystem: 'HID-FACILITY', code: facilityItem.toLowerCase(), display: 'Malaria rapid test (own)', count: 3 }] })
    const create = vi.fn()
      .mockResolvedValueOnce(refused('NATIONAL_CODE_NOT_FOUND', 'This code is not on the national list.'))
      .mockResolvedValueOnce(ok({ id: 'item-mrdt', kind: 'lab_test', name: 'Malaria rapid test (own)', prescriptionOnly: false, nationalCodeSystem: 'HID-FACILITY',
        nationalCode: facilityItem.toLowerCase(), prices: { cashKobo: 150000, hmo: [] }, active: true, version: 1 }))
    commerceApi.createCatalogueItem = create
    renderDept(<PriceList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show' }))
    // A facility item may be a medicine or a test: listed, in words rather than by its id.
    expect(await screen.findByText('This facility’s item · 3 times')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a price' }))
    const drawer = await screen.findByRole('dialog', { name: 'Add item' })
    expect((within(drawer).getByRole('combobox', { name: 'National list' }) as HTMLSelectElement).value).toBe('HID-FACILITY')
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Code' }), { target: { value: facilityItem } })
    fireEvent.change(within(drawer).getByLabelText('Cash price'), { target: { value: '1,500' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toMatchObject({ kind: 'drug', nationalCodeSystem: 'HID-FACILITY', nationalCode: facilityItem.toLowerCase() })
    // Refused as a drug: the words say to check the kind, never "the national list".
    expect(await within(drawer).findByText('This is not one of this facility’s medicines in use. Check whether it is a drug or a lab test.')).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('radio', { name: 'Lab test' }))
    expect((within(drawer).getByRole('combobox', { name: 'National list' }) as HTMLSelectElement).value).toBe('HID-FACILITY')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add item' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1]![1]).toMatchObject({ kind: 'lab_test', nationalCodeSystem: 'HID-FACILITY', nationalCode: facilityItem.toLowerCase() })
  })

  it('checks a facility item’s id before sending it, and keeps an item’s facility code when only its price changes', async () => {
    const linked: CatalogueItem = { id: 'item-own', kind: 'drug', name: 'House cough syrup', prescriptionOnly: false, nationalCodeSystem: 'HID-FACILITY',
      nationalCode: '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b', prices: { cashKobo: 80000, hmo: [] }, active: true, version: 3 }
    commerceApi.catalogueItems = async () => ok({ items: [linked], nextPage: null })
    const update = vi.fn(async (..._args: unknown[]) => ok({ ...linked, prices: { cashKobo: 90000, hmo: [] }, version: 4 }))
    commerceApi.updateCatalogueItem = update
    renderDept(<PriceList />)
    expect(await screen.findByText(/House cough syrup/)).toBeTruthy()
    expect(screen.getByText(/This facility’s item/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/3f2a9c1e/)
    fireEvent.click(screen.getByRole('button', { name: 'Edit House cough syrup' }))
    const drawer = await screen.findByRole('dialog', { name: 'Edit House cough syrup' })
    const code = within(drawer).getByRole('textbox', { name: 'Code' })
    fireEvent.change(code, { target: { value: 'MED-00042' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }))
    expect(await within(drawer).findByText('Type the item’s id as the facility’s list gives it (36 characters).')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
    fireEvent.change(code, { target: { value: '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b' } })
    fireEvent.change(within(drawer).getByLabelText('Cash price'), { target: { value: '900' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0]![2]).toEqual({ expectedVersion: 3, prices: { cashKobo: 90000, hmo: [] } })
  })

  it('refuses a Health ID typed without its "HID-" in the search, in the price list’s own words, and sends nothing', async () => {
    const calls: unknown[] = []
    commerceApi.catalogueItems = async (...args: never[]) => { calls.push(args[1]); return ok({ items: [consultation], nextPage: null }) }
    renderDept(<PriceList />)
    await screen.findByText('Consultation')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the price list' }), { target: { value: 'ZDEM2A' } })
    expect((await screen.findByRole('alert')).textContent).toBe('Search by the item’s name. Do not type a Health ID or NIN here.')
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(JSON.stringify(calls)).not.toMatch(/ZDEM2A/i)
  })

  it('offers no unpriced list or Add item to someone who only reads prices, and says when billing is off', async () => {
    as(['billing.catalogue.read', 'billing.bill.read'])
    commerceApi.catalogueItems = async () => off()
    renderDept(<PriceList />)
    expect(await screen.findByText('Billing is not switched on at this facility yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull()
    expect(screen.queryByText('Not on the price list')).toBeNull()
  })
})

describe('Payment setup', () => {
  it('shows pay before switched off until it is available, and emergencies always on', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [consultation], nextPage: null })
    renderDept(<PaymentSetup />)
    const pharmacy = await screen.findByRole('switch', { name: /Pharmacy dispenses only when paid/ })
    expect(pharmacy).toHaveProperty('disabled', true)
    expect(screen.getAllByText('Not switched on yet.').length).toBeGreaterThan(0)
    const emergencies = screen.getByRole('switch', { name: /Emergencies/ })
    expect(emergencies.getAttribute('aria-checked')).toBe('true')
    expect(emergencies).toHaveProperty('disabled', true)
  })

  it('saves the whole setup with the version read: a new HMO without an id, one taken off as not active, and the check-in charge', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [consultation], nextPage: null })
    const save = vi.fn(async (..._args: unknown[]) => ok(settingsOf({ version: 4 })))
    commerceApi.savePaymentSettings = save
    renderDept(<PaymentSetup />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop accepting Demo HMO' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'HMO name' }), { target: { value: 'Fictional Care HMO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add HMO' }))
    fireEvent.change(await screen.findByLabelText(/^Service/), { target: { value: ITEM_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Save setup' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const body = save.mock.calls[0]![1] as Record<string, unknown>
    expect(body.expectedVersion).toBe(3)
    expect(body.hmos).toEqual([{ id: HMO_ID, name: 'Demo HMO', active: false }, { name: 'Fictional Care HMO', active: true }])
    expect(body.payBefore).toEqual({ pharmacy: false, lab: false })
    expect(body.allowDeferredFor).toEqual(['emergency'])
    expect(body.checkInChargeItemId).toBe(ITEM_ID)
  })

  it('says a stale setup was changed by someone else', async () => {
    commerceApi.catalogueItems = async () => ok({ items: [], nextPage: null })
    commerceApi.savePaymentSettings = async () => refused('VERSION_CONFLICT', 'Someone else changed this. Reload it and try again.', 412)
    renderDept(<PaymentSetup />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save setup' }))
    expect(await screen.findByText('Someone else changed this. Reload it and try again.')).toBeTruthy()
  })

  it('says billing is not switched on when the setup answers 404', async () => {
    commerceApi.paymentSettings = async () => off()
    renderDept(<PaymentSetup />)
    expect(await screen.findByText('Billing is not switched on at this facility yet.')).toBeTruthy()
  })
})

const openDay: Shift = {
  id: 'day-1', scope: 'facility', openedBy: 'Bola Cashier', openedAt: '2026-11-26T07:00:00Z', openingCashKobo: 1000000,
  totals: [{ method: 'cash', count: 3, amountKobo: 450000 }, { method: 'pos', count: 1, amountKobo: 150000 }],
  waivers: { count: 1, amountKobo: 50000 }, hmoCovered: { count: 2, amountKobo: 400000 },
  expectedCashKobo: 1450000, unpaidBills: { count: 4, amountKobo: 900000 }, deferredBills: { count: 1, amountKobo: 300000 }, version: 2,
}

describe('End of day', () => {
  it('shows waivers and HMO cover apart from the cash, and needs a note when the count differs', async () => {
    commerceApi.currentShift = async () => ok(openDay)
    const close = vi.fn(async (..._args: unknown[]) => ok({ ...openDay, closedAt: '2026-11-26T18:00:00Z', countedCashKobo: 1400000, differenceKobo: -50000 }))
    commerceApi.closeShift = close
    renderDept(<EndOfDay />)
    expect(await screen.findByText('Not money taken, so not in the cash')).toBeTruthy()
    expect(screen.getByText('Waived')).toBeTruthy()
    expect(screen.getByText('HMO to pay')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cash counted'), { target: { value: '14000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close day' }))
    expect(await screen.findByText('Say why the cash is over or short.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'Change given twice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close day' }))
    const sheet = await screen.findByRole('dialog', { name: 'Close the day?' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close day' }))
    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(close.mock.calls[0]).toEqual(expect.arrayContaining(['day-1', 1400000, 'Change given twice', 2]))
  })

  it('says a day is already open, in BILL-1’s words', async () => {
    commerceApi.currentShift = async () => ok(null)
    commerceApi.openShift = async () => refused('SHIFT_ALREADY_OPEN', 'A day is already open here.')
    renderDept(<EndOfDay />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open day' }))
    expect(await screen.findByText('A day is already open here.')).toBeTruthy()
  })

  it('says billing is not switched on when the day answers 404', async () => {
    commerceApi.currentShift = async () => off()
    renderDept(<EndOfDay />)
    expect(await screen.findByText('Billing is not switched on at this facility yet.')).toBeTruthy()
  })

  it('refuses more than ₦1,000,000.00 of cash, to open or to close a day, before sending it', async () => {
    commerceApi.currentShift = async () => ok(null)
    const openShift = vi.fn()
    commerceApi.openShift = openShift
    const { unmount } = renderDept(<EndOfDay />)
    fireEvent.change(await screen.findByLabelText('Cash in the drawer now'), { target: { value: '1,250,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open day' }))
    expect(await screen.findByText('Type an amount up to ₦1,000,000.00.')).toBeTruthy()
    expect(openShift).not.toHaveBeenCalled()
    unmount()
    commerceApi.currentShift = async () => ok(openDay)
    const closeShift = vi.fn()
    commerceApi.closeShift = closeShift
    renderDept(<EndOfDay />)
    fireEvent.change(await screen.findByLabelText('Cash counted'), { target: { value: '1250000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close day' }))
    expect(await screen.findByText('Type an amount up to ₦1,000,000.00.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Close the day?' })).toBeNull()
    expect(closeShift).not.toHaveBeenCalled()
  })

  const TILLS = { dayCloseBy: 'till' as const, tills: [{ id: TILL_ID, name: 'Front till', active: true }, { id: 'b3333333-3333-4333-8333-333333333333', name: 'Back till', active: true }] }
  const CASHIER = ['billing.catalogue.read', 'billing.bill.read', 'billing.bill.create', 'billing.payment.record', 'billing.shift.own']

  it('with a day per till, never asks a cashier’s session for every open day (billing.shift.manage), and opens the till picked', async () => {
    as(CASHIER)
    commerceApi.paymentSettings = async () => ok(settingsOf(TILLS))
    const shifts = vi.fn(async () => refused('BILLING_NOT_ALLOWED', 'Your role here does not include this. Ask a billing officer or administrator.', 403))
    commerceApi.shifts = shifts
    const current = vi.fn(async (..._args: unknown[]) => ok(null))
    commerceApi.currentShift = current
    renderDept(<EndOfDay />)
    fireEvent.click(await screen.findByRole('radio', { name: /Back till/ }))
    expect(await screen.findByRole('button', { name: 'Open Back till' })).toBeTruthy()
    expect(current.mock.calls[0]![1]).toEqual({ tillId: 'b3333333-3333-4333-8333-333333333333' })
    expect(shifts).not.toHaveBeenCalled()
    expect(screen.queryByText('Checking…')).toBeNull()
    expect(screen.queryByText(/Couldn’t check which tills are open/)).toBeNull()
    expect(screen.queryByText(/Your role here does not include this/)).toBeNull()
  })

  it('with a day per till, shows those who manage the days which tills are open', async () => {
    commerceApi.paymentSettings = async () => ok(settingsOf(TILLS))
    const shifts = vi.fn(async (..._args: unknown[]) => ok({ items: [{ ...openDay, scope: 'till', tillId: TILL_ID, tillName: 'Front till' }], nextPage: null }))
    commerceApi.shifts = shifts
    renderDept(<EndOfDay />)
    const front = await screen.findByRole('radio', { name: /Front till/ })
    await waitFor(() => expect(within(front).getByText('Open')).toBeTruthy())
    expect(within(screen.getByRole('radio', { name: /Back till/ })).getByText('Closed')).toBeTruthy()
    expect(shifts.mock.calls[0]![1]).toEqual({ status: 'open' })
  })

  it('opens to an administrator who sees every day but has none of their own: the overview only', async () => {
    as(['billing.settings.manage', 'billing.catalogue.read', 'billing.bill.read', 'billing.shift.manage', 'billing.report.read'])
    const current = vi.fn(async () => ok(null))
    commerceApi.currentShift = current
    const shifts = vi.fn(async (..._args: unknown[]) => ok({ items: [openDay], nextPage: null }))
    commerceApi.shifts = shifts
    renderDept(<EndOfDay />)
    expect(await screen.findByText('Opened by Bola Cashier')).toBeTruthy()
    expect(shifts.mock.calls[0]![1]).toEqual(expect.objectContaining({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }))
    expect(current).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Open day' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close day' })).toBeNull()
  })

  it('shows such an administrator every till’s state without a till to open', async () => {
    as(['billing.settings.manage', 'billing.bill.read', 'billing.shift.manage'])
    commerceApi.paymentSettings = async () => ok(settingsOf(TILLS))
    const current = vi.fn(async () => ok(null))
    commerceApi.currentShift = current
    commerceApi.shifts = async () => ok({ items: [{ ...openDay, scope: 'till', tillId: TILL_ID, tillName: 'Front till' }], nextPage: null })
    renderDept(<EndOfDay />)
    const front = (await screen.findByText('Front till')).closest('li')!
    await waitFor(() => expect(within(front).getByText('Open')).toBeTruthy())
    expect(screen.queryByRole('radio')).toBeNull()
    expect(current).not.toHaveBeenCalled()
  })
})

describe('Home’s billing card', () => {
  it('reads today’s numbers, with HMO cover as owed and not collected', async () => {
    commerceApi.billSummary = async () => ok({ date: '2026-11-26', billedKobo: 650000, collectedKobo: 300000, waivedKobo: 0, hmoCoveredKobo: 200000,
      outstandingKobo: 150000, billCount: 3 })
    renderDept(<HomeBillingTodayCard facilityId={DEMO_HOSPITAL_ID} />)
    expect(await screen.findByText('Today · 3 bills')).toBeTruthy()
    expect(screen.getByText('Recorded today, owed by HMOs, not collected')).toBeTruthy()
    expect(screen.getByText('₦3,000.00')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open payments' }).getAttribute('href')).toBe('/provider/payments')
  })

  it('shows nothing where billing is not switched on', async () => {
    commerceApi.billSummary = async () => off()
    const { container } = renderDept(<HomeBillingTodayCard facilityId={DEMO_HOSPITAL_ID} />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
