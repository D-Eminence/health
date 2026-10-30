import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { pharmacyPage } from '../../../../ehr-blue/departments/pharmacy/page'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_HOSPITAL_ID, DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, actionsCard, ALL, AMOXICILLIN, contextLine, CREATE, deferred, dispensed, expectNoFullPatientIds, IBUPROFEN, METFORMIN,
  otherFacilityItem, READ, reversed, row, SALBUTAMOL, savedRecord,
} from './fixtures'

/**
 * The blue Pharmacy page's list and record views: who may open it, the list's loading, empty, refused and cut-short
 * states, its search, pages and quick view, opening a record and going back, and the working facility. Dispensing and
 * work from other facilities have their own files.
 */
const session = vi.hoisted(() => ({ ready: true, facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), decline: vi.fn(), get: vi.fn(), reportWrongPatient: vi.fn(),
  cannotComplete: vi.fn(), findCorrectable: vi.fn(), correctWrongPatient: vi.fn() }))
/** Any staffApi member the page reaches for besides the four it may use. */
const strays = vi.hoisted(() => new Set<string>())

vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => session.ready ? staffContext(session.facility) : { state: { status: 'loading' }, lock: null } }
})
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, { get(target, key) {
    if (typeof key === 'string' && !(key in target)) strays.add(key)
    return target[key as keyof typeof target]
  } }),
  orderRoutesApi: routes,
}))

function working(permissions: string[], overrides: Partial<FakeFacility> = {}) {
  session.facility = fakeFacility(permissions, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'], ...overrides })
}

beforeEach(() => {
  vi.resetAllMocks()
  strays.clear()
  session.ready = true
  working([READ])
  api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed, reversed] })
})
afterEach(() => {
  expect([...strays]).toEqual([])
  // Nothing about the work reaches the address or the browser's storage.
  expect(window.location.hash).toBe('')
  expect(window.localStorage.length).toBe(0)
  expect(window.sessionStorage.length).toBe(0)
})

async function renderList() {
  renderDept(<Pharmacy />)
  await screen.findByRole('button', { name: AMOXICILLIN })
}

describe('the page entry', () => {
  it('is listed live under Diagnostics for members who read pharmacy work', () => {
    expect(pharmacyPage).toMatchObject({ path: 'pharmacy', group: 'Diagnostics', label: 'Pharmacy', permission: READ, status: 'live' })
  })
})

describe('who may open Pharmacy', () => {
  function expectRefused() {
    expect(screen.getByRole('heading', { level: 1, name: 'Pharmacy' })).toBeTruthy()
    expect(screen.getByText('Permission denied. This facility membership cannot open Pharmacy: it needs pharmacy work-item read permission.')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh list' })).toBeNull()
    expect(api.pharmacyWorkItems).not.toHaveBeenCalled()
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(routes.incoming).not.toHaveBeenCalled()
  }

  it('refuses a membership without pharmacy work-item read permission, and reads nothing', () => {
    working([CREATE, 'pharmacy.dispensing.read', 'pharmacy.dispensing.reverse'])
    renderDept(<Pharmacy />)
    expectRefused()
  })

  it.each([
    ['the staff session is not ready', () => { session.ready = false }],
    ['no facility is active', () => { session.facility = undefined }],
  ])('refuses when %s', (_case, arrange) => {
    working(ALL)
    arrange()
    renderDept(<Pharmacy />)
    expectRefused()
  })
})

describe('the list', () => {
  it('has one heading, the design’s search card and its columns', async () => {
    await renderList()
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Pharmacy'])
    expect(screen.getByRole('searchbox', { name: 'Search Pharmacy' }).getAttribute('placeholder')).toBe('Search saved records…')
    const table = screen.getByRole('table', { name: 'Prescriptions' })
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Record', 'Patient / context', 'Status', 'Accepted', 'Actions'])
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expect(api.pharmacyWorkItems).toHaveBeenCalledWith(DEMO_PHARMACY_ID)
  })

  it('shows each prescription with its short reference, masked patient, dose, frequency and lowercase status', async () => {
    await renderList()
    const first = row(AMOXICILLIN)
    expect(within(first).getByText('a1b2c3d4')).toBeTruthy()
    expect(within(first).getByText('Patient ••••6f8a10')).toBeTruthy()
    expect(within(first).getByText('1 capsule · Three times daily')).toBeTruthy()
    expect(within(first).getByText('accepted')).toBeTruthy()
    expect(within(first).getByText(new Date(accepted.acceptedAt).toLocaleString())).toBeTruthy()
    expect(within(row(METFORMIN)).getByText('dispensed')).toBeTruthy()
    expect(within(row(METFORMIN)).getByText('Patient ••••a9b3c4')).toBeTruthy()
    const third = row(SALBUTAMOL)
    expect(within(third).getByText('reversed')).toBeTruthy()
    expect(within(third).getByText('Dose not recorded · Frequency not recorded')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/From |Synced/)
    expectNoFullPatientIds()
  })

  it('offers each row a Quick view and an Open, both real buttons named by the record they act on', async () => {
    await renderList()
    const first = row(AMOXICILLIN)
    const quick = within(first).getByRole('button', { name: 'Quick view' })
    const open = within(first).getByRole('button', { name: 'Open' })
    for (const control of [quick, open, within(first).getByRole('button', { name: AMOXICILLIN })]) {
      expect(control.tagName).toBe('BUTTON')
      expect(control.getAttribute('tabindex')).toBeNull()
    }
    expect(document.getElementById(quick.getAttribute('aria-describedby') ?? '')?.textContent).toBe(AMOXICILLIN)
    expect(document.getElementById(open.getAttribute('aria-describedby') ?? '')?.textContent).toBe(AMOXICILLIN)
  })

  it('shows a loading state while the list is read, with Refresh list busy but focusable', async () => {
    const load = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockReturnValueOnce(load.promise)
    renderDept(<Pharmacy />)
    expect(screen.getByRole('status').textContent).toBe('Loading prescriptions')
    const refresh = screen.getByRole('button', { name: 'Refresh list' })
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    expect(refresh.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('No matching records')).toBeNull()
    // A second press while it reads does nothing.
    fireEvent.click(refresh)
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    await act(async () => { load.resolve({ items: [accepted] }) })
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByText('Loading prescriptions')).toBeNull()
    expect(refresh.getAttribute('aria-disabled')).toBeNull()
  })

  it('says when there are no prescriptions, and finds new ones on Refresh list', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [accepted] })
    renderDept(<Pharmacy />)
    expect(await screen.findByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Prescriptions appear here once they are accepted.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(DEMO_PHARMACY_ID)
  })

  it('says a refused read in an error box, without any patient data, and recovers on Refresh list', async () => {
    api.pharmacyWorkItems.mockRejectedValueOnce(new HidApiError(403, 'You do not have permission to do that.', { code: 'PERMISSION_DENIED' }))
      .mockResolvedValueOnce({ items: [accepted] })
    renderDept(<Pharmacy />)
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have permission to do that.')
    expect(screen.queryByText('No matching records')).toBeNull()
    expect(document.body.textContent).not.toContain('Patient ••••')
    expectNoFullPatientIds()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['a rejection with no message', { status: 0 }, 'Prescriptions could not be loaded. Please retry.'],
    ['Pharmacy switched off on this deployment', new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }),
      'This workspace is not in service on this Health ID deployment: its work cannot be loaded or changed here, and refreshing will not help.'],
    ['a fault between Health ID services', new HidApiError(503, 'Upstream', { code: 'PHARMACY_SERVICE_AUTH_UNAVAILABLE' }),
      'A connection between Health ID services failed; retry in about 15 seconds.'],
  ])('says %s plainly', async (_case, refusal, text) => {
    api.pharmacyWorkItems.mockRejectedValueOnce(refusal)
    renderDept(<Pharmacy />)
    expect((await screen.findByRole('alert')).textContent).toBe(text)
  })

  it('keeps the list on screen while it is read again, and when that read fails', async () => {
    const reload = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(reload.promise)
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    expect(screen.getByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByText('Loading prescriptions')).toBeNull()
    await act(async () => { reload.reject(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'PHARMACY_SERVICE_UNAVAILABLE' })) })
    expect((await screen.findByRole('alert')).textContent).toBe('Pharmacy work is temporarily unavailable.')
    expect(screen.getByRole('button', { name: AMOXICILLIN })).toBeTruthy()
  })
})

describe('the list cut short at 200', () => {
  const many = (count: number) => Array.from({ length: count }, (_, n) => ({ ...accepted, id: `${String(n).padStart(8, '0')}-w` }))

  it('says newer work can’t be reached here, and that work Pharmacy won’t dispense still counts', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(200) })
    renderDept(<Pharmacy />)
    expect(await screen.findByText(/^This list can show only the 200 oldest accepted work items\./)).toBeTruthy()
    expect(screen.getByText(/^Work whose prescription changed after Pharmacy accepted it can’t be/).textContent?.replace(/\s+/g, ' '))
      .toBe('Work whose prescription changed after Pharmacy accepted it can’t be dispensed, but it stays listed and counts toward these 200.')
  })

  it('says nothing of it for a shorter list', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(199) })
    renderDept(<Pharmacy />)
    await screen.findAllByRole('button', { name: AMOXICILLIN })
    expect(screen.queryByText(/oldest accepted work items/)).toBeNull()
    expect(screen.queryByText(/counts toward these 200/)).toBeNull()
  })

  it('shows 50 records a page, as the design does', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(120) })
    renderDept(<Pharmacy />)
    await screen.findAllByRole('button', { name: AMOXICILLIN })
    const pages = screen.getByRole('navigation', { name: 'Record pages' })
    expect(within(pages).getByText('Page 1 of 3')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: AMOXICILLIN })).toHaveLength(50)
    expect(within(pages).getByRole('button', { name: 'Previous page' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    expect(within(pages).getByText('Page 3 of 3')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: AMOXICILLIN })).toHaveLength(20)
    expect(within(pages).getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(within(pages).getByRole('button', { name: 'Previous page' }))
    expect(within(pages).getByText('Page 2 of 3')).toBeTruthy()
  })
})

describe('the search', () => {
  it('filters what is loaded, sends nothing, and says when nothing matches', async () => {
    await renderList()
    const search = screen.getByRole('searchbox', { name: 'Search Pharmacy' })
    fireEvent.change(search, { target: { value: 'metformin twice' } })
    expect(screen.getByRole('button', { name: METFORMIN })).toBeTruthy()
    expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull()
    fireEvent.change(search, { target: { value: 'reversed' } })
    expect(screen.getByRole('button', { name: SALBUTAMOL })).toBeTruthy()
    expect(screen.queryByRole('button', { name: METFORMIN })).toBeNull()
    fireEvent.change(search, { target: { value: 'warfarin' } })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Change your search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })
})

describe('the quick view', () => {
  it('shows the record’s facts in the drawer, and opens the full record', async () => {
    await renderList()
    const opener = within(row(AMOXICILLIN)).getByRole('button', { name: 'Quick view' })
    opener.focus()
    fireEvent.click(opener)
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { name: AMOXICILLIN })).toBeTruthy()
    expect(within(drawer).getByText(`Accepted ${new Date(accepted.acceptedAt).toLocaleString()}`)).toBeTruthy()
    const facts = Object.fromEntries([...drawer.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(facts).toMatchObject({ Item: AMOXICILLIN, Patient: 'Patient ••••6f8a10', Dose: '1 capsule', Frequency: 'Three times daily',
      Route: 'oral', Instructions: 'Take with food.\nFinish the course.', Dispensed: 'No', Status: 'accepted' })
    // Focus moves into the drawer, and back to Quick view on Close.
    expect(drawer.contains(document.activeElement)).toBe(true)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Record quick view' })).getByRole('button', { name: 'Open full record' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: AMOXICILLIN })).toBeTruthy()
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`))
  })

  it('closes on Escape', async () => {
    await renderList()
    fireEvent.click(within(row(METFORMIN)).getByRole('button', { name: 'Quick view' }))
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByText('Patient ••••a9b3c4')).toBeTruthy()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the record', () => {
  it('opens from its name with the design’s parts, focus on its title, and goes back to the list on Back to list', async () => {
    await renderList()
    const name = screen.getByRole('button', { name: AMOXICILLIN })
    name.focus()
    fireEvent.click(name)
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual([AMOXICILLIN])
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`))
    // The list is hidden while the record is open: one view at a time.
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect([...contextLine().children].map(part => part.textContent))
      .toEqual(['accepted', 'Patient ••••6f8a10', `Accepted ${new Date(accepted.acceptedAt).toLocaleString()}`])
    const facts = Object.fromEntries([...savedRecord().querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(facts).toEqual({ Item: AMOXICILLIN, Dose: '1 capsule', Frequency: 'Three times daily', Route: 'oral',
      Instructions: 'Take with food.\nFinish the course.', Dispensed: 'No', Accepted: new Date(accepted.acceptedAt).toLocaleString() })
    // This member can't dispense or reverse: nothing is offered.
    expect(within(actionsCard()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(within(actionsCard()).queryAllByRole('button')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Pharmacy' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: AMOXICILLIN })))
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('opens from Open too, and says what is missing on a record with no dose, frequency or route', async () => {
    await renderList()
    fireEvent.click(within(row(SALBUTAMOL)).getByRole('button', { name: 'Open' }))
    const facts = Object.fromEntries([...savedRecord().querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(facts).toMatchObject({ Item: SALBUTAMOL, Dose: 'Not recorded', Frequency: 'Not recorded', Route: 'Not recorded', Dispensed: 'Reversed' })
    expect(facts).not.toHaveProperty('Instructions')
    expect(within(contextLine()).getByText('reversed')).toBeTruthy()
  })

  it('offers Dispense quantity on accepted work and Reverse dispensing on a dispensing still in effect, by permission', async () => {
    working(ALL)
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(within(actionsCard()).getAllByRole('button').map(button => button.textContent)).toEqual(['Dispense quantity'])
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: METFORMIN }))
    expect(within(actionsCard()).getAllByRole('button').map(button => button.textContent)).toEqual(['Reverse dispensing'])
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: SALBUTAMOL }))
    expect(within(actionsCard()).queryAllByRole('button')).toEqual([])
    expectNoFullPatientIds()
  })

  it('goes back to the list once the record has left it', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted, dispensed] }).mockResolvedValueOnce({ items: [dispensed] })
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    const refresh = screen.getByRole('button', { name: 'Refresh list' })
    refresh.focus()
    fireEvent.click(refresh)
    await screen.findByRole('heading', { level: 1, name: 'Pharmacy' })
    expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull()
    expect(screen.getByRole('button', { name: METFORMIN })).toBeTruthy()
    // Refresh list stays where it was, so focus stays on it.
    expect(document.activeElement).toBe(refresh)
  })
})

describe('the working facility', () => {
  it('drops the previous facility’s work, its open record, and reads the new one', async () => {
    const second = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(second.promise)
    const view = renderDept(<Pharmacy />)
    fireEvent.click(await screen.findByRole('button', { name: AMOXICILLIN }))
    working([READ], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', membershipId: 'membership-demo-2' })
    view.rerender(<MemoryRouter><div className="hid-ehr"><Pharmacy /></div></MemoryRouter>)
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Pharmacy' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Loading prescriptions')
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID)
    await act(async () => { second.resolve({ items: [otherFacilityItem] }) })
    expect(await screen.findByRole('button', { name: IBUPROFEN })).toBeTruthy()
    expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull()
  })

  it('ignores a late answer for the previous facility', async () => {
    const first = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ items: [otherFacilityItem] })
    const view = renderDept(<Pharmacy />)
    working([READ], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', membershipId: 'membership-demo-2' })
    view.rerender(<MemoryRouter><div className="hid-ehr"><Pharmacy /></div></MemoryRouter>)
    await screen.findByRole('button', { name: IBUPROFEN })
    await act(async () => { first.resolve({ items: [accepted, dispensed] }) })
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()
    expect(screen.queryByText(METFORMIN)).toBeNull()
    expect(document.body.textContent).not.toContain('••••6f8a10')
  })
})
