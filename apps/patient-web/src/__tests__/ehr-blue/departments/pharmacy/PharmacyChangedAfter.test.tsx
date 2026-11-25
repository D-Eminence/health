import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PharmacyChangedAfterDispensing, PharmacyWorkItem } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { PharmacyRecord } from '../../../../ehr-blue/departments/pharmacy/PharmacyRecord'
import { changedAfterOf, inTab, lastChangeText, queueOrder, statusOf } from '../../../../ehr-blue/departments/pharmacy/pharmacyText'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, ALL, AMOXICILLIN, dispensed, expectNoFullPatientIds, METFORMIN, PRESCRIPTIONS, recordStatus, reversed, routeCard, routed,
  row, SALBUTAMOL, showTab, Where,
} from './fixtures'

/**
 * Q132 A (hid-system 0148, INTERFACE_CONTRACT "Screen change"): a dispensed item, reversed or not, whose prescription the
 * prescribing team changed afterwards says so in amber on its card and next to the dispensing in its record, in the
 * contract's words, with when (Lagos time) and "Contact the patient.". Its status, tab and place stay as they were; no
 * code, version or id is shown; there is no Dismiss or Seen. With no field, nothing is said. Fictional data only.
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

const CHANGED_AT = '2026-11-20T08:15:00.000Z'
const LAST_CHANGE = 'Last change: 20 Nov 2026, 09:15'
const NEXT = `${LAST_CHANGE}. Contact the patient.`

function change(fields: Partial<PharmacyChangedAfterDispensing> = {}): PharmacyChangedAfterDispensing {
  return { change: 'cancelled', changedAt: CHANGED_AT, changeCount: 1, ...fields }
}

/** The dispensed Metformin with a change after dispensing. */
function changedItem(fields: Partial<PharmacyChangedAfterDispensing> = {}, item: PharmacyWorkItem = dispensed): PharmacyWorkItem {
  return { ...item, changedAfterDispensing: change(fields) }
}

const routedDispensed = (overrides: Partial<PharmacyWorkItem> = {}) =>
  routed({ dispensing: { id: 'dispensing-routed-1', reversed: false }, ...overrides })

const OWN_WORDS: ReadonlyArray<readonly [PharmacyChangedAfterDispensing['change'], string]> = [
  ['on_hold', 'Changed after dispensing: put on hold by the prescribing team'],
  ['cancelled', 'Changed after dispensing: cancelled by the prescribing team'],
  ['entered_in_error', 'Changed after dispensing: entered in error by the prescribing team'],
  ['edited', 'Changed after dispensing: edited by the prescribing team'],
  ['resumed', 'Changed after dispensing: resumed by the prescribing team'],
]

beforeEach(() => {
  vi.resetAllMocks()
  session.facility = fakeFacility(ALL, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
})
afterEach(() => {
  expect(api.dispense).not.toHaveBeenCalled()
  expect(api.reverseDispensing).not.toHaveBeenCalled()
})

function renderRecord(item: PharmacyWorkItem) {
  const noop = () => {}
  return renderDept(<PharmacyRecord facilityId={DEMO_PHARMACY_ID} item={item} permissions={ALL} undispensable={false}
    onUndispensable={noop} said={null} holds={false} onChanged={async () => {}} onBusy={noop} onEnded={noop} onNotCompleted={noop}
    onReread={async () => {}} />, { route: `${PRESCRIPTIONS}/${item.id}` })
}

async function renderList(items: PharmacyWorkItem[], tab: 'Dispensed' | 'All' = 'All') {
  api.pharmacyWorkItems.mockResolvedValue({ items })
  renderDept(<><Pharmacy /><Where /></>, { route: PRESCRIPTIONS })
  await screen.findByRole('navigation', { name: 'Show prescriptions' })
  showTab(tab)
}

/** The record's notice, found by its id's ending (never shown). */
function recordNotice(): HTMLElement | null {
  return document.querySelector('[id$="-changed"]')
}

/** No code, raw time, version or id of the change reaches the page, and nothing offers to dismiss it. */
function expectNothingInternal() {
  const text = document.body.textContent ?? ''
  for (const code of ['on_hold', 'entered_in_error', 'changedAfterDispensing', 'changeCount', CHANGED_AT, 'dispensing-2', 'dispensing-3']) {
    expect(text).not.toContain(code)
  }
  expect(text).not.toMatch(/unverified|permission|[–—]/i)
  expect(screen.queryByRole('button', { name: /dismiss|seen/i })).toBeNull()
  expectNoFullPatientIds()
}

describe('the words', () => {
  it('says each change in the contract’s words, with the count only above 1, and never on work not dispensed or withdrawn', () => {
    for (const [code, words] of OWN_WORDS) expect(changedAfterOf(changedItem({ change: code }))?.text).toBe(words)
    expect(changedAfterOf(changedItem({ changeCount: 1 }))?.text).toBe('Changed after dispensing: cancelled by the prescribing team')
    expect(changedAfterOf(changedItem({ changeCount: 3 }))?.text).toBe('Changed after dispensing: cancelled by the prescribing team (changed 3 times)')
    expect(changedAfterOf(changedItem({ change: undefined }))?.text).toBe('Changed after dispensing by the prescribing team')
    expect(changedAfterOf(changedItem({}, reversed))?.text).toBe('Changed after dispensing: cancelled by the prescribing team')
    expect(changedAfterOf(dispensed)).toBeNull()
    expect(changedAfterOf({ ...accepted, changedAfterDispensing: change() })).toBeNull()
    const withdrawn: PharmacyWorkItem = { ...accepted, withdrawn: true, withdrawnReason: 'changed', changedAfterDispensing: change() }
    expect(changedAfterOf(withdrawn)).toBeNull()
  })

  it('names the facility that sent it, or “the ordering facility” with no name', () => {
    expect(changedAfterOf(routedDispensed({ changedAfterDispensing: change({ change: 'on_hold' }) }))?.text)
      .toBe('Changed after dispensing: put on hold by Demo Hospital')
    expect(changedAfterOf(routedDispensed({ changedAfterDispensing: change({ change: undefined, changeCount: 2 }) }))?.text)
      .toBe('Changed after dispensing by Demo Hospital (changed 2 times)')
    expect(changedAfterOf(routedDispensed({ orderRoute: routeCard({ orderingFacilityName: null }), changedAfterDispensing: change() }))?.text)
      .toBe('Changed after dispensing: cancelled by the ordering facility')
  })

  it('says the last change on Lagos time, with its day, whatever the device’s zone', () => {
    expect(lastChangeText(CHANGED_AT)).toBe(LAST_CHANGE)
    expect(lastChangeText('2026-11-20T23:30:00.000Z')).toBe('Last change: 21 Nov 2026, 00:30')
    expect(lastChangeText('not a time')).toBe('')
    expect(changedAfterOf(changedItem())?.when).toBe(LAST_CHANGE)
  })

  it('keeps the status, the tab and the place in the list', () => {
    const item = changedItem({ change: 'entered_in_error', changeCount: 4 })
    expect(statusOf(item, false)).toBe('dispensed')
    expect(statusOf(changedItem({}, reversed), false)).toBe('reversed')
    expect(inTab('dispensed', item)).toBe(true)
    expect(inTab('todo', item)).toBe(false)
    expect(queueOrder([item, accepted], () => false).map(entry => entry.id)).toEqual([accepted.id, item.id])
  })
})

describe('the card', () => {
  it('says each change under the dispensed card, with when and the next step, and nothing under the others', async () => {
    for (const [code, words] of OWN_WORDS) {
      await renderList([accepted, changedItem({ change: code }), reversed], 'Dispensed')
      const card = row(METFORMIN)
      expect(within(card).getByText(words)).toBeTruthy()
      expect(within(card).getByText(NEXT)).toBeTruthy()
      expect(within(card).getByText('Dispensed')).toBeTruthy()
      expectNothingInternal()
      cleanup()
    }
  })

  it('adds the count above 1, uses the general words for a change it does not know, and shows nothing with no field', async () => {
    await renderList([changedItem({ change: undefined, changeCount: 2 }), reversed, accepted])
    expect(within(row(METFORMIN)).getByText('Changed after dispensing by the prescribing team (changed 2 times)')).toBeTruthy()
    expect(within(row(SALBUTAMOL)).queryByText(/Changed after dispensing/)).toBeNull()
    expect(within(row(AMOXICILLIN)).queryByText(/Changed after dispensing/)).toBeNull()
    expect(screen.getAllByText(/Changed after dispensing/)).toHaveLength(1)
    expectNothingInternal()
  })

  it('says it under a reversed card too, and on work another facility sent, by name', async () => {
    await renderList([changedItem({ change: 'edited' }, reversed), routedDispensed({ changedAfterDispensing: change({ change: 'resumed', changeCount: 3 }) })])
    expect(within(row(SALBUTAMOL)).getByText('Changed after dispensing: edited by the prescribing team')).toBeTruthy()
    expect(within(row(SALBUTAMOL)).getByText('Reversed')).toBeTruthy()
    const card = row('Amoxicillin 250 mg capsules')
    expect(within(card).getByText('Changed after dispensing: resumed by Demo Hospital (changed 3 times)')).toBeTruthy()
    expect(within(card).getByText('From Demo Hospital')).toBeTruthy()
    expectNothingInternal()
  })

  it('is found by searching for the change', async () => {
    await renderList([changedItem({ change: 'cancelled' }), { ...reversed }])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Pharmacy' }), { target: { value: 'cancelled' } })
    expect(screen.getByRole('button', { name: METFORMIN })).toBeTruthy()
    expect(screen.queryByRole('button', { name: SALBUTAMOL })).toBeNull()
  })
})

describe('the record', () => {
  it('says each change in amber next to “Already dispensed”, with when and the next step, and keeps the status', () => {
    for (const [code, words] of OWN_WORDS) {
      const { unmount } = renderRecord(changedItem({ change: code }))
      expect(recordStatus()).toBe('Dispensed')
      const notice = recordNotice()
      expect(notice?.className).toContain('hid-ehr-dept-notice-caution')
      expect(notice?.className).not.toContain('critical')
      expect(notice?.querySelector('.hid-ehr-dept-notice-title')?.textContent).toBe(words)
      expect(notice?.querySelector('.hid-ehr-dept-notice-body')?.textContent).toBe(NEXT)
      // Next to the dispensing it changed: in the same card.
      const handedOver = screen.getByText('Already dispensed. Nothing more to do unless it needs reversing.').closest('section, div.flex-col')
      expect(handedOver?.contains(notice)).toBe(true)
      expect(screen.queryByText('Not dispensable')).toBeNull()
      expectNothingInternal()
      unmount()
    }
  })

  it('says it next to the reversal on a reversed item, with the count', () => {
    renderRecord(changedItem({ change: 'on_hold', changeCount: 2 }, reversed))
    expect(recordStatus()).toBe('Reversed')
    const notice = recordNotice()
    expect(notice?.querySelector('.hid-ehr-dept-notice-title')?.textContent).toBe('Changed after dispensing: put on hold by the prescribing team (changed 2 times)')
    const reversal = screen.getByText('This dispensing was reversed. A new prescription is needed to dispense it again.').closest('div.flex-col')
    expect(reversal?.contains(notice)).toBe(true)
    expectNothingInternal()
  })

  it('names the facility that sent it, or the ordering facility, and uses the general words for an unknown change', () => {
    const first = renderRecord(routedDispensed({ changedAfterDispensing: change({ change: 'entered_in_error' }) }))
    expect(recordNotice()?.querySelector('.hid-ehr-dept-notice-title')?.textContent).toBe('Changed after dispensing: entered in error by Demo Hospital')
    first.unmount()
    renderRecord(routedDispensed({ orderRoute: routeCard({ orderingFacilityName: null }), changedAfterDispensing: change({ change: undefined }) }))
    expect(recordNotice()?.querySelector('.hid-ehr-dept-notice-title')?.textContent).toBe('Changed after dispensing by the ordering facility')
    expectNothingInternal()
  })

  it('shows nothing with no field, as before 0148', () => {
    renderRecord(dispensed)
    expect(recordStatus()).toBe('Dispensed')
    expect(recordNotice()).toBeNull()
    expect(document.body.textContent).not.toMatch(/Changed after dispensing|Contact the patient|Last change/)
  })

  it('shows nothing on work not yet dispensed, which still offers Dispense', () => {
    renderRecord({ ...accepted, changedAfterDispensing: change() })
    expect(recordStatus()).toBe('To dispense')
    expect(recordNotice()).toBeNull()
    expect(screen.getByRole('form', { name: 'Dispense' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('Changed after dispensing')
  })
})
