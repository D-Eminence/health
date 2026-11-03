import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StockPage } from '../../../../ehr-blue/departments/pharmacy/Stock'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * Stock at a pharmacy (POINT_OF_CARE_SPEC §5, demo facilities only until Health ID serves it): an item's movements say
 * what happened in words, whatever word the service sends for its kind. Every item and person here is fictional.
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
vi.mock('../../../../ehr-blue/frame/pageContext', () => ({ useBluePage: () => ({ rest: '' }) }))

const AMOXICILLIN = {
  catalogueItemId: 'cat-amox', name: 'Amoxicillin', strength: '500 mg', form: 'capsule', imageUrl: null, onHand: 180, unit: 'capsules',
  reorderLevel: 50, batches: [{ batchId: 'batch-1', batchNumber: 'AMX-2291', expiresOn: '2027-06-01', quantity: 180 }],
}

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  session.facility = fakeFacility(['pharmacy.stock.read'], { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
})

describe('an item’s movements', () => {
  it('names each kind in words, and never shows a kind or reason code it has no word for', async () => {
    commerceApi.stock = async () => ({ ok: true, data: { items: [AMOXICILLIN], nextPage: null } })
    commerceApi.stockMovements = async () => ({ ok: true, data: { items: [
      { id: 'mv-1', kind: 'received', change: 400, at: '2026-11-03T08:00:00Z', by: 'Amaka Eze' },
      { id: 'mv-2', kind: 'dispensed', change: -21, at: '2026-11-03T09:00:00Z', by: 'Amaka Eze' },
      { id: 'mv-3', kind: 'transfer_out', change: -5, at: '2026-11-03T10:00:00Z', by: 'Amaka Eze', reason: 'branch_transfer' },
      { id: 'mv-4', kind: 'adjusted', change: -2, at: '2026-11-03T11:00:00Z', by: 'Amaka Eze', reason: 'damaged' },
    ], nextPage: null } })
    renderDept(<StockPage />, { route: '/provider/pharmacy/stock' })
    fireEvent.click(await screen.findByRole('button', { name: /Amoxicillin/ }))
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText('Received')).toBeTruthy()
    expect(within(drawer).getByText('Dispensed')).toBeTruthy()
    expect(within(drawer).getByText('Stock change')).toBeTruthy()
    // A reason it has a word for is still said.
    expect(within(drawer).getByText('Adjusted · Damaged')).toBeTruthy()
    for (const code of ['received', 'dispensed', 'adjusted', 'damaged', 'transfer_out', 'branch_transfer']) expect(drawer.textContent).not.toContain(code)
  })

  it('has a word for every kind in both spellings, and reads a prototype key as a stock change', async () => {
    const kinds = { receipt: 'Received', received: 'Received', adjustment: 'Adjusted', adjusted: 'Adjusted', dispensing: 'Dispensed',
      dispensed: 'Dispensed', sale: 'Sold', sold: 'Sold', reversal: 'Dispensing reversed', reversed: 'Dispensing reversed',
      constructor: 'Stock change' }
    commerceApi.stock = async () => ({ ok: true, data: { items: [AMOXICILLIN], nextPage: null } })
    commerceApi.stockMovements = async () => ({ ok: true, data: { items: Object.keys(kinds).map((kind, index) =>
      ({ id: `mv-${index}`, kind, change: -1, at: '2026-11-03T08:00:00Z', by: 'Amaka Eze' })), nextPage: null } })
    renderDept(<StockPage />, { route: '/provider/pharmacy/stock' })
    fireEvent.click(await screen.findByRole('button', { name: /Amoxicillin/ }))
    const drawer = await screen.findByRole('dialog')
    await within(drawer).findAllByText('Received')
    const words = within(drawer).getAllByRole('listitem').map(item => item.querySelector('span > span')?.textContent)
      .slice(-Object.keys(kinds).length)
    expect(words).toEqual(Object.values(kinds))
  })
})
