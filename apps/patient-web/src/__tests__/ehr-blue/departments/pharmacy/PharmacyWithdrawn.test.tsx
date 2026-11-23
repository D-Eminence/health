import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { PharmacyRecord } from '../../../../ehr-blue/departments/pharmacy/PharmacyRecord'
import { inTab, queueOrder, statusOf, withdrawnReasonOf } from '../../../../ehr-blue/departments/pharmacy/pharmacyText'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { accepted, ALL, AMOXICILLIN, dispensed, METFORMIN, PRESCRIPTIONS, recordStatus, row, showTab, Where } from './fixtures'

/**
 * This hospital's own pharmacy item withdrawn by the prescribing team before it was dispensed (hid-system 0133, D8 and
 * D14; pharmacy-api at 06f98040 answers `withdrawn: true` with `withdrawnReason` `changed` or `sent_elsewhere`): the card
 * and the record say who withdrew it and why, and Dispense is never offered. Fictional data only.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), decline: vi.fn(), get: vi.fn(), reportWrongPatient: vi.fn(),
  cannotComplete: vi.fn(), findCorrectable: vi.fn(), correctWrongPatient: vi.fn() }))

vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/api', () => ({ staffApi: api, orderRoutesApi: routes }))

const changed: PharmacyWorkItem = { ...accepted, id: 'a1b2c3d4-withdrawn-1', withdrawn: true, withdrawnReason: 'changed' }
const elsewhere: PharmacyWorkItem = { ...accepted, id: 'a1b2c3d4-withdrawn-2', withdrawn: true, withdrawnReason: 'sent_elsewhere' }

beforeEach(() => {
  vi.resetAllMocks()
  session.facility = fakeFacility(ALL, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
})
afterEach(() => { expect(api.dispense).not.toHaveBeenCalled() })

function renderRecord(item: PharmacyWorkItem) {
  const noop = () => {}
  return renderDept(<PharmacyRecord facilityId={DEMO_PHARMACY_ID} item={item} permissions={ALL} undispensable={false}
    onUndispensable={noop} said={null} holds={false} onChanged={async () => {}} onBusy={noop} onEnded={noop} onNotCompleted={noop}
    onReread={async () => {}} />, { route: `${PRESCRIPTIONS}/${item.id}` })
}

describe('reading withdrawn and withdrawnReason', () => {
  it('reads the two reasons, an unknown reason as withdrawn all the same, and nothing on work not withdrawn or dispensed', () => {
    expect(withdrawnReasonOf(changed)).toBe('changed')
    expect(withdrawnReasonOf(elsewhere)).toBe('sent_elsewhere')
    expect(withdrawnReasonOf({ ...accepted, withdrawn: true })).toBe('other')
    expect(withdrawnReasonOf({ ...accepted, withdrawn: true, withdrawnReason: 'something_new' })).toBe('other')
    expect(withdrawnReasonOf(accepted)).toBeNull()
    expect(withdrawnReasonOf({ ...accepted, withdrawnReason: 'changed' })).toBeNull()
    expect(withdrawnReasonOf({ ...dispensed, withdrawn: true, withdrawnReason: 'changed' })).toBeNull()
    expect(statusOf(changed, false)).toBe('withdrawn')
    expect(statusOf(changed, true)).toBe('withdrawn')
  })

  it('keeps withdrawn work out of To dispense and Waiting for payment, and lists it with the done work', () => {
    expect(inTab('todo', changed)).toBe(false)
    expect(inTab('payment', changed)).toBe(false)
    expect(inTab('dispensed', changed)).toBe(false)
    expect(inTab('all', changed)).toBe(true)
    // Never at the top with the open work: after it, among the done work.
    const order = queueOrder([changed, dispensed, accepted], () => false).map(item => item.id)
    expect(order[0]).toBe(accepted.id)
    expect(order.slice(1).sort()).toEqual([changed.id, dispensed.id].sort())
  })
})

describe('the card', () => {
  it('says “Changed or stopped by the prescribing team” under All, and To dispense does not count it', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [changed, dispensed] })
    renderDept(<><Pharmacy /><Where /></>, { route: PRESCRIPTIONS })
    await screen.findByRole('navigation', { name: 'Show prescriptions' })
    showTab('All')
    const card = (await screen.findByRole('button', { name: AMOXICILLIN })).closest('li') as HTMLElement
    expect(within(card).getByText('Withdrawn')).toBeTruthy()
    expect(within(card).getByText('Changed or stopped by the prescribing team')).toBeTruthy()
    expect(within(card).queryByText(/^Waiting/)).toBeNull()
    expect(within(row(METFORMIN)).queryByText(/prescribing team/)).toBeNull()
    showTab('To dispense')
    expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull()
    const tabs = screen.getByRole('navigation', { name: 'Show prescriptions' })
    expect(within(tabs).getByRole('button', { name: /^To dispense/ }).textContent).not.toMatch(/[1-9]/)
  })
})

describe('the record', () => {
  it('shows a changed item as changed or stopped by the prescribing team, with no Dispense', () => {
    renderRecord(changed)
    expect(recordStatus()).toBe('Withdrawn')
    expect(screen.getByText('Changed or stopped by the prescribing team')).toBeTruthy()
    expect(screen.getByText(/put this prescription on hold, cancelled, corrected, edited or resumed it/)).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Dispense' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dispense' })).toBeNull()
  })

  it('shows an item sent elsewhere as sent to another pharmacy by the prescribing team, with no Dispense', () => {
    renderRecord(elsewhere)
    expect(recordStatus()).toBe('Withdrawn')
    expect(screen.getByText('Sent to another pharmacy by the prescribing team')).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Dispense' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dispense' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/unverified/i)
  })

  it('still offers Dispense on work that is not withdrawn', () => {
    renderRecord(accepted)
    expect(recordStatus()).toBe('To dispense')
    expect(screen.getByRole('form', { name: 'Dispense' })).toBeTruthy()
  })
})
