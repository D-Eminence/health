import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { pharmacyPage } from '../../../../ehr-blue/departments/pharmacy/page'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_HOSPITAL_ID, DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, actionsCard, ALL, AMOXICILLIN, connectedCard, contextLine, CREATE, deferred, dispensed, expectNoFullPatientIds, IBUPROFEN,
  METFORMIN, nowDispensed, otherFacilityItem, READ, reversed, row, SALBUTAMOL, samePatient, savedRecord, shownParts, versions,
  versionsCard,
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
    // The list card is the first thing under the heading, and the heading has no Refresh list beside it (design).
    expect(shownParts()[0]).toBe(screen.getByRole('searchbox', { name: 'Search Pharmacy' }).closest('section'))
    expect(screen.queryByRole('button', { name: /^Refresh/ })).toBeNull()
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

  it('shows a loading state while the list is read, with nothing to press meanwhile', async () => {
    const load = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockReturnValueOnce(load.promise)
    renderDept(<Pharmacy />)
    expect(screen.getByRole('status').textContent).toBe('Loading prescriptions')
    expect(screen.getByRole('status').closest('section')).toBe(screen.getByRole('searchbox', { name: 'Search Pharmacy' }).closest('section'))
    expect(screen.queryByRole('button', { name: /^Refresh/ })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('No matching records')).toBeNull()
    await act(async () => { load.resolve({ items: [accepted] }) })
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByText('Loading prescriptions')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Refresh/ })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('says when there are no prescriptions, and finds new ones on the empty list’s Refresh', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [accepted] })
    renderDept(<Pharmacy />)
    expect(await screen.findByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Prescriptions appear here once they are accepted.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh list' })).toBeNull()
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh.closest('section')).toBe(screen.getByRole('searchbox', { name: 'Search Pharmacy' }).closest('section'))
    refresh.focus()
    fireEvent.click(refresh)
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(DEMO_PHARMACY_ID)
    // Its button went with the empty list: focus goes to the heading, not the page.
    await waitFor(() => expect(document.activeElement?.id).toBe('pharmacy-heading'))
  })

  it('keeps Refresh on the empty list where it is when the list is still empty', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [] })
    renderDept(<Pharmacy />)
    const refresh = await screen.findByRole('button', { name: 'Refresh' })
    refresh.focus()
    fireEvent.click(refresh)
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Refresh' })))
  })

  it('says a refused read in an error box, without any patient data, and recovers on Refresh list under it', async () => {
    api.pharmacyWorkItems.mockRejectedValueOnce(new HidApiError(403, 'You do not have permission to do that.', { code: 'PERMISSION_DENIED' }))
      .mockResolvedValueOnce({ items: [accepted] })
    renderDept(<Pharmacy />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('You do not have permission to do that.')
    expect(screen.queryByText('No matching records')).toBeNull()
    expect(document.body.textContent).not.toContain('Patient ••••')
    expectNoFullPatientIds()
    // Today's way to retry stays, under the refusal: the design has no Refresh list beside the heading.
    const refresh = screen.getByRole('button', { name: 'Refresh list' })
    expect(alert.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(refresh.closest('.hid-ehr-page-heading, header')).toBeNull()
    refresh.focus()
    fireEvent.click(refresh)
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh list' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe('pharmacy-heading'))
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a rejection with no message', { status: 0 }, 'Prescriptions could not be loaded. Please retry.', true],
    ['Pharmacy switched off on this deployment', new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }),
      'This workspace is not in service on this Health ID deployment: its work cannot be loaded or changed here, and refreshing will not help.', false],
    ['a fault between Health ID services', new HidApiError(503, 'Upstream', { code: 'PHARMACY_SERVICE_AUTH_UNAVAILABLE' }),
      'A connection between Health ID services failed; retry in about 15 seconds.', true],
  ])('says %s plainly', async (_case, refusal, text, retry) => {
    api.pharmacyWorkItems.mockRejectedValueOnce(refusal)
    renderDept(<Pharmacy />)
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    // Refresh list under the refusal, except where its words say refreshing will not help (as on Laboratory).
    expect(screen.queryByRole('button', { name: 'Refresh list' }) !== null).toBe(retry)
  })

  it('takes the empty list’s Refresh away while it reads, so a second press reads nothing more', async () => {
    const reload = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [] }).mockReturnValueOnce(reload.promise)
    renderDept(<Pharmacy />)
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    expect(screen.getByRole('status').textContent).toBe('Loading prescriptions')
    expect(screen.queryByRole('button', { name: /^Refresh/ })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    await act(async () => { reload.resolve({ items: [accepted] }) })
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
  })

  it('takes Refresh list away while it reads after a refusal, so a second press reads nothing more', async () => {
    const reload = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockRejectedValueOnce(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'PHARMACY_SERVICE_UNAVAILABLE' }))
      .mockReturnValueOnce(reload.promise)
    renderDept(<Pharmacy />)
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh list' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Refresh/ })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    await act(async () => { reload.resolve({ items: [accepted] }) })
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
  })

  it('keeps the list on screen while it is read again, and when that read fails', async () => {
    working([READ, CREATE])
    const reload = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted, dispensed] })
      .mockRejectedValueOnce(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'PHARMACY_SERVICE_UNAVAILABLE' }))
      .mockReturnValueOnce(reload.promise)
    api.dispense.mockResolvedValueOnce({ id: 'dispensing-9' })
    await renderList()
    // A dispensing reads the list again; that read fails, and the list read before stays.
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Dispense quantity' }))
    const form = screen.getByRole('form', { name: 'Dispense quantity' })
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Units to dispense' }), { target: { value: '21' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Full course dispensed at counter' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Dispense quantity' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Pharmacy work is temporarily unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    expect(screen.getByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByText('Loading prescriptions')).toBeNull()
    await act(async () => { reload.reject(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'PHARMACY_SERVICE_UNAVAILABLE' })) })
    expect((await screen.findByRole('alert')).textContent).toBe('Pharmacy work is temporarily unavailable.')
    expect(screen.getByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.getByRole('button', { name: METFORMIN })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(3)
  })
})

describe('the list cut short at 200', () => {
  const many = (count: number) => Array.from({ length: count }, (_, n) => ({ ...accepted, id: `${String(n).padStart(8, '0')}-w` }))

  it('says newer work can’t be reached here, and that work Pharmacy won’t dispense still counts, under the list', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(200) })
    renderDept(<Pharmacy />)
    const cap = await screen.findByText(/^This list can show only the 200 oldest accepted work items\./)
    const list = screen.getByRole('searchbox', { name: 'Search Pharmacy' }).closest('section') as HTMLElement
    expect(shownParts()[0]).toBe(list)
    expect(list.compareDocumentPosition(cap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    // The design's record has Back to list beside its title and no Refresh list anywhere.
    expect(screen.queryByRole('button', { name: /^Refresh/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /list/i }).map(button => button.textContent)).toEqual(['Back to list'])

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

  it('goes back to the list once the record has left it as the list is read again', async () => {
    working([READ, CREATE])
    // A version conflict reads the list again (the design has no Refresh list); the record has left it meanwhile.
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted, dispensed] }).mockResolvedValueOnce({ items: [dispensed] })
    api.dispense.mockRejectedValueOnce(new HidApiError(412, 'Dispensing must bind to the exact accepted work-item version',
      { code: 'PHARMACY_WORK_ITEM_VERSION_CONFLICT' }))
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Dispense quantity' }))
    const form = screen.getByRole('form', { name: 'Dispense quantity' })
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Units to dispense' }), { target: { value: '21' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Full course dispensed at counter' } })
    const submit = within(form).getByRole('button', { name: 'Dispense quantity' })
    submit.focus()
    fireEvent.click(submit)
    await screen.findByRole('heading', { level: 1, name: 'Pharmacy' })
    expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull()
    expect(screen.getByRole('button', { name: METFORMIN })).toBeTruthy()
    // Focus was on the record that went: it goes to the list's heading.
    await waitFor(() => expect(document.activeElement?.id).toBe('pharmacy-heading'))
  })
})

describe('the record’s connected hospital history', () => {
  beforeEach(() => { api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed, reversed, samePatient] }) })

  it('follows the record’s cards, and names the same patient’s other prescriptions with their status', async () => {
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    const card = connectedCard()
    expect(card.querySelector('h2')?.textContent).toBe('Connected hospital history')
    expect(card.querySelector('p')?.textContent).toBe('Only records available to your current permissions are listed.')
    // After "Saved record" and "Available actions", before "Preserved versions & amendments".
    expect(actionsCard().compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(savedRecord().compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.compareDocumentPosition(versionsCard()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Patient A's other prescription only: not this one, not other patients'.
    const rows = within(card).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    const [only] = rows as [HTMLElement]
    const link = within(only).getByRole('button', { name: `Pharmacy · ${IBUPROFEN} · f7a8b9c0` })
    expect(link.tagName).toBe('BUTTON')
    expect(within(only).getByText('dispensed')).toBeTruthy()
    expect(card.textContent).not.toMatch(new RegExp(`${METFORMIN}|${SALBUTAMOL}|${AMOXICILLIN}`))
    expectNoFullPatientIds()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('says the sentence alone when the patient has no other prescription listed', async () => {
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: METFORMIN }))
    const card = connectedCard()
    expect(card.textContent).toBe('Connected hospital historyOnly records available to your current permissions are listed.')
    expect(within(card).queryByRole('list')).toBeNull()
    expect(within(card).queryAllByRole('button')).toEqual([])
  })

  it('never matches work with no patient named to other such work', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ ...accepted, patientId: '' }, { ...samePatient, patientId: '' }] })
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(within(connectedCard()).queryByRole('list')).toBeNull()
    expect(within(connectedCard()).queryAllByRole('button')).toEqual([])
  })

  it('names work the list has not searched for, with the status the list gives it', async () => {
    await renderList()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Pharmacy' }), { target: { value: 'amoxicillin' } })
    expect(screen.queryByRole('button', { name: IBUPROFEN })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(within(connectedCard()).getByRole('button', { name: `Pharmacy · ${IBUPROFEN} · f7a8b9c0` })).toBeTruthy()
  })

  it('opens the named prescription in this page, focus on its title, and Back to list returns to its row', async () => {
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    fireEvent.click(within(connectedCard()).getByRole('button', { name: `Pharmacy · ${IBUPROFEN} · f7a8b9c0` }))
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual([IBUPROFEN])
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${samePatient.id}-title`))
    expect(within(contextLine()).getByText('dispensed')).toBeTruthy()
    // From the other side, the first prescription is named in turn.
    expect(within(connectedCard()).getByRole('button', { name: `Pharmacy · ${AMOXICILLIN} · a1b2c3d4` })).toBeTruthy()
    expect(within(connectedCard()).getByText('accepted')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: IBUPROFEN })))
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('')
  })
})

describe('the record’s preserved versions & amendments', () => {
  it.each([
    ['accepted work: when it was accepted', accepted, AMOXICILLIN, [`${new Date(accepted.acceptedAt).toLocaleString()} · accepted · Accept prescription`]],
    ['a dispensing still in effect: then its dispensing', dispensed, METFORMIN,
      [`${new Date(dispensed.acceptedAt).toLocaleString()} · accepted · Accept prescription`, 'dispensed · Dispense quantity']],
    ['a reversed dispensing: then its reversal', reversed, SALBUTAMOL,
      [`${new Date(reversed.acceptedAt).toLocaleString()} · accepted · Accept prescription`, 'reversed · Reverse dispensing']],
  ])('lists %s', async (_case, item, name, expected) => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [item] })
    renderDept(<Pharmacy />)
    fireEvent.click(await screen.findByRole('button', { name }))
    expect(versions()).toEqual(expected)
    // Each a native disclosure, so Enter and Space open it.
    expect(versionsCard().querySelectorAll('details')).toHaveLength(expected.length)
    expect(versionsCard().querySelector('h2')?.textContent).toBe('Preserved versions & amendments')
  })

  it('adds the dispensing once it is recorded and the list read again', async () => {
    working([READ, CREATE])
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockResolvedValueOnce({ items: [nowDispensed] })
    api.dispense.mockResolvedValueOnce({ id: 'dispensing-9' })
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(versions()).toHaveLength(1)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Dispense quantity' }))
    const form = screen.getByRole('form', { name: 'Dispense quantity' })
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Units to dispense' }), { target: { value: '21' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Full course dispensed at counter' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Dispense quantity' }))
    await waitFor(() => expect(versions()).toEqual([`${new Date(accepted.acceptedAt).toLocaleString()} · accepted · Accept prescription`,
      'dispensed · Dispense quantity']))
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
