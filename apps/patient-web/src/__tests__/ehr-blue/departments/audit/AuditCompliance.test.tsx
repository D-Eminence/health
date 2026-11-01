import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { AuditCompliance } from '../../../../ehr-blue/departments/audit/AuditCompliance'
import { DEMO_HOSPITAL_ID, DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { SAID_NETWORK, SAID_TRY_SHORTLY, SAID_UNAVAILABLE } from '../../../said'

/**
 * Audit & Compliance in the blue EHR (target admin/audit.png): today's facility audit read (staff/routes/Audit.tsx)
 * drawn as the target's event list. The API's own mapping keeps only seven fields; the page shows only those, so a
 * patient identifier, a reason or event details that reach it are never shown.
 */
const session = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility as FakeFacility | undefined) }
})

// Every staffApi member the page touches is recorded: only facilityAudit may be.
const api = vi.hoisted(() => {
  const facilityAudit = vi.fn()
  const touched: string[] = []
  const staffApi = new Proxy({ facilityAudit } as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === 'string') touched.push(key)
      return target[key as string]
    },
  })
  return { facilityAudit, touched, staffApi }
})
vi.mock('../../../../staff/api', () => ({ staffApi: api.staffApi }))

const HOSPITAL = fakeFacility(['audit.read'], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: ['org_admin'], membershipId: 'membership-demo-h' })
const LABORATORY = fakeFacility(['audit.read'], { id: DEMO_LABORATORY_ID, name: 'Demo Laboratory' })

const event = (sequenceId: string, overrides: Record<string, unknown> = {}) => ({
  sequenceId, occurredAt: '2026-01-01T12:00:00.000Z', correlationId: `corr-${sequenceId}`, actorType: 'staff',
  action: 'identity.patient.lookup', outcome: 'success', resourceType: 'patient', ...overrides,
})
const pageOf = (items: unknown[], nextBeforeSequenceId: string | null = null) => ({ items, nextBeforeSequenceId })

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const view = () => <MemoryRouter><div className="hid-ehr"><AuditCompliance /></div></MemoryRouter>
const button = (name: string) => screen.getByRole('button', { name })
const events = () => screen.getByRole('region', { name: 'Audit events' })
const onlyAuditRead = () => expect(api.touched.filter(key => key !== 'facilityAudit')).toEqual([])

beforeEach(() => {
  api.facilityAudit.mockReset()
  api.touched.length = 0
  session.facility = HOSPITAL
})

describe('Audit & Compliance: the event list', () => {
  it('lists the working facility’s events as the target does, and nothing the API withholds', async () => {
    api.facilityAudit.mockResolvedValueOnce(pageOf([
      event('51', { patientId: 'patient-secret', reason: 'sensitive reason', details: { note: 'sensitive payload' },
        actorId: 'actor-secret', membershipId: 'membership-secret' }),
      event('50', { occurredAt: 'not a time', actorType: 'service', action: 'identity.access.denied', outcome: 'denied', resourceType: null }),
    ], '50'))
    renderDept(<AuditCompliance />)

    expect(screen.getByRole('heading', { level: 1, name: 'Audit & Compliance' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText(/^Audit events for Demo Hospital\. Health ID checks your membership and records each review\./)
      .textContent).toContain('Patient identifiers, reasons and event details are not shown here.')
    const list = await screen.findByRole('list', { name: 'Audit events, page 1' })
    expect(api.facilityAudit).toHaveBeenCalledTimes(1)
    expect(api.facilityAudit).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, undefined)

    const [first, second] = within(list).getAllByRole('listitem')
    expect(within(first!).getByText('identity.patient.lookup').tagName).toBe('STRONG')
    expect(within(first!).getByText('2026-01-01T12:00:00.000Z · actor staff · correlation corr-51')).toBeTruthy()
    expect(within(first!).getByText('patient · success')).toBeTruthy()
    expect(within(second!).getByText('identity.access.denied')).toBeTruthy()
    expect(within(second!).getByText('time unavailable · actor service · correlation corr-50')).toBeTruthy()
    expect(within(second!).getByText('resource not recorded · denied')).toBeTruthy()
    for (const withheld of ['patient-secret', 'sensitive reason', 'sensitive payload', 'actor-secret', 'membership-secret']) {
      expect(document.body.textContent).not.toContain(withheld)
    }

    expect(screen.getByText('Page 1 · 2 events')).toBeTruthy()
    expect(button('Older events')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Newer events' })).toBeNull()
    // Today's search and outcome filter, as the target's list search, and Refresh beside the heading.
    const search = screen.getByRole('searchbox', { name: 'Search Audit & Compliance' })
    expect(search.getAttribute('placeholder')).toBe('Search actions, actor types, resources or correlation IDs…')
    expect(document.getElementById(search.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Search and outcome apply to the events loaded on this page. Use Older events to look further back.')
    const outcome = screen.getByRole('combobox', { name: 'Outcome' }) as HTMLSelectElement
    expect(outcome.value).toBe('all')
    expect(within(outcome).getAllByRole('option').map(option => option.textContent)).toEqual(['All outcomes', 'Success', 'Denied', 'Failure'])
    expect(button('Refresh').getAttribute('type')).toBe('button')
    onlyAuditRead()
  })

  it('shows its loading state, then says when the facility has no events yet', async () => {
    const first = deferred<unknown>()
    api.facilityAudit.mockReturnValueOnce(first.promise)
    renderDept(<AuditCompliance />)

    expect(screen.getByRole('status').textContent).toBe('Loading audit events')
    await act(async () => { first.resolve(pageOf([])) })

    expect(screen.getByText('No audit events yet')).toBeTruthy()
    expect(screen.getByText('Events at Demo Hospital appear here once they are recorded.')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getAllByRole('button').map(element => element.textContent)).toEqual(['Refresh'])
    onlyAuditRead()
  })
})

describe('Audit & Compliance: search, outcome and refresh', () => {
  const PAGE = pageOf([
    event('53', { action: 'identity.patient.lookup', outcome: 'success', resourceType: 'patient', actorType: 'staff' }),
    event('52', { action: 'identity.access.denied', outcome: 'denied', resourceType: null, actorType: 'service', correlationId: 'Corr-XYZ' }),
    event('51', { action: 'ehr.encounter.create', outcome: 'failure', resourceType: 'encounter', actorType: 'staff' }),
  ], '51')
  const shown = () => within(screen.getByRole('list', { name: 'Audit events, page 1' })).getAllByRole('listitem')
    .map(item => item.querySelector('strong')?.textContent)

  it('searches the loaded page by action, correlation ID, resource type or actor type, and filters by outcome, sending nothing', async () => {
    api.facilityAudit.mockResolvedValueOnce(PAGE)
    renderDept(<AuditCompliance />)
    await screen.findByRole('list')
    const search = screen.getByRole('searchbox', { name: 'Search Audit & Compliance' })
    const outcome = screen.getByRole('combobox', { name: 'Outcome' })

    fireEvent.change(search, { target: { value: '  ENCOUNTER ' } })
    expect(shown()).toEqual(['ehr.encounter.create'])
    fireEvent.change(search, { target: { value: 'corr-xyz' } })
    expect(shown()).toEqual(['identity.access.denied'])
    fireEvent.change(search, { target: { value: 'service' } })
    expect(shown()).toEqual(['identity.access.denied'])
    fireEvent.change(search, { target: { value: 'patient' } })
    expect(shown()).toEqual(['identity.patient.lookup'])

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.change(outcome, { target: { value: 'denied' } })
    expect(shown()).toEqual(['identity.access.denied'])
    fireEvent.change(outcome, { target: { value: 'failure' } })
    expect(shown()).toEqual(['ehr.encounter.create'])

    fireEvent.change(search, { target: { value: 'lookup' } })
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText('No matching events')).toBeTruthy()
    expect(screen.getByText('Change the search or outcome, or look at another page.')).toBeTruthy()
    // The page's count is the page loaded, not what the search shows.
    expect(screen.getByText('Page 1 · 3 events')).toBeTruthy()

    fireEvent.change(outcome, { target: { value: 'all' } })
    expect(shown()).toEqual(['identity.patient.lookup'])
    expect(api.facilityAudit).toHaveBeenCalledTimes(1)
    onlyAuditRead()
  })

  it('keeps the search and outcome on the next page loaded', async () => {
    api.facilityAudit.mockResolvedValueOnce(PAGE).mockResolvedValueOnce(pageOf([
      event('50', { action: 'identity.consent.write', outcome: 'denied' }), event('49', { action: 'ehr.note.read' }),
    ]))
    renderDept(<AuditCompliance />)
    await screen.findByRole('list')
    fireEvent.change(screen.getByRole('combobox', { name: 'Outcome' }), { target: { value: 'denied' } })
    fireEvent.click(button('Older events'))

    const list = await screen.findByRole('list', { name: 'Audit events, page 2' })
    expect(within(list).getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual(['identity.consent.write'])
    expect(api.facilityAudit).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, '51')
  })

  it('reads the same page again on Refresh, keeping the list and focus while it runs', async () => {
    const again = deferred<unknown>()
    api.facilityAudit.mockResolvedValueOnce(PAGE).mockReturnValueOnce(again.promise)
    renderDept(<AuditCompliance />)
    await screen.findByRole('list')
    const refresh = button('Refresh')
    refresh.focus()
    fireEvent.click(refresh)

    await waitFor(() => expect(api.facilityAudit).toHaveBeenCalledTimes(2))
    expect(api.facilityAudit).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, undefined)
    expect(refresh.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(refresh)
    expect(screen.getByRole('list', { name: 'Audit events, page 1' }).getAttribute('aria-busy')).toBe('true')
    // The list stays on screen, and a visually hidden status says it is being read again.
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Loading audit events')
    expect(status.className).toBe('hid-ehr-sr-only')
    expect(screen.getByText('ehr.encounter.create')).toBeTruthy()
    fireEvent.click(refresh)
    expect(api.facilityAudit).toHaveBeenCalledTimes(2)

    await act(async () => { again.resolve(pageOf([event('54', { action: 'identity.session.start' })])) })
    expect(screen.getByText('identity.session.start')).toBeTruthy()
    expect(screen.queryByText('ehr.encounter.create')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(refresh.hasAttribute('aria-busy')).toBe(false)
    expect(document.activeElement).toBe(refresh)
    onlyAuditRead()
  })
})

describe('Audit & Compliance: older and newer pages', () => {
  it('reads an older page by the last page’s cursor and a newer one back, focus staying on the pager', async () => {
    const older = deferred<unknown>()
    const newer = deferred<unknown>()
    api.facilityAudit
      .mockResolvedValueOnce(pageOf([event('51'), event('50')], '50'))
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    renderDept(<AuditCompliance />)
    await screen.findByText('Page 1 · 2 events')

    const olderButton = button('Older events')
    expect(olderButton.tagName).toBe('BUTTON')
    expect(olderButton.getAttribute('type')).toBe('button')
    olderButton.focus()
    fireEvent.click(olderButton)

    await waitFor(() => expect(api.facilityAudit).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, '50'))
    // While the page is read, the button stays where it was, unavailable, with focus on it.
    expect(button('Older events').getAttribute('aria-busy')).toBe('true')
    expect(button('Older events').getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(button('Older events'))
    expect(screen.getByRole('status').textContent).toBe('Loading audit events')
    fireEvent.click(button('Older events'))
    expect(api.facilityAudit).toHaveBeenCalledTimes(2)

    await act(async () => { older.resolve(pageOf([event('49', { action: 'ehr.encounter.read' })])) })
    expect(screen.getByRole('list', { name: 'Audit events, page 2' })).toBeTruthy()
    expect(screen.getByText('ehr.encounter.read')).toBeTruthy()
    expect(screen.getByText('Page 2 · 1 event')).toBeTruthy()
    // The last page offers no older one: focus moves to Newer events.
    expect(screen.queryByRole('button', { name: 'Older events' })).toBeNull()
    expect(document.activeElement).toBe(button('Newer events'))

    fireEvent.click(button('Newer events'))
    await waitFor(() => expect(api.facilityAudit).toHaveBeenCalledTimes(3))
    expect(api.facilityAudit).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, undefined)
    expect(document.activeElement).toBe(button('Newer events'))
    await act(async () => { newer.resolve(pageOf([event('52', { action: 'identity.consent.write' })], '52')) })

    expect(screen.getByText('identity.consent.write')).toBeTruthy()
    expect(screen.getByText('Page 1 · 1 event')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Newer events' })).toBeNull()
    expect(document.activeElement).toBe(button('Older events'))
    onlyAuditRead()
  })

  it('leaves focus where the user moved it while a page was read', async () => {
    const older = deferred<unknown>()
    api.facilityAudit.mockResolvedValueOnce(pageOf([event('51')], '51')).mockReturnValueOnce(older.promise)
    renderDept(<AuditCompliance />)
    fireEvent.click(await screen.findByRole('button', { name: 'Older events' }))
    events().focus()
    await act(async () => { older.resolve(pageOf([event('40')])) })
    expect(document.activeElement).toBe(events())
  })

  it('says when there are no older events', async () => {
    api.facilityAudit.mockResolvedValueOnce(pageOf([event('51')], '51')).mockResolvedValueOnce(pageOf([]))
    renderDept(<AuditCompliance />)
    fireEvent.click(await screen.findByRole('button', { name: 'Older events' }))

    expect(await screen.findByText('No older events')).toBeTruthy()
    expect(screen.getByText('There are no earlier audit events at Demo Hospital.')).toBeTruthy()
    expect(screen.getByText('Page 2 · 0 events')).toBeTruthy()
    expect(document.activeElement).toBe(button('Newer events'))
  })

  it('says when a page held only request records, which the API call leaves out, and still offers older events', async () => {
    api.facilityAudit.mockResolvedValueOnce(pageOf([], '40'))
    renderDept(<AuditCompliance />)

    expect(await screen.findByText('Nothing to show on this page')).toBeTruthy()
    expect(screen.getByText('This page held only request records, which aren’t shown here. Use Older events to look further back.')).toBeTruthy()
    expect(screen.queryByText('No audit events yet')).toBeNull()
    expect(button('Older events')).toBeTruthy()
  })
})

describe('Audit & Compliance: refusals and failures', () => {
  it('says a 403 refusal plainly, and Try again reads the page again, focus then on the events', async () => {
    api.facilityAudit
      .mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' }))
      .mockResolvedValueOnce(pageOf([event('51')]))
    renderDept(<AuditCompliance />)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Your membership at Demo Hospital can’t review audit events. Ask your facility administrator for audit access.'))
      .toBeTruthy()
    const retry = within(alert).getByRole('button', { name: 'Try again' })
    retry.focus()
    fireEvent.click(retry)

    await screen.findByText('identity.patient.lookup')
    expect(api.facilityAudit).toHaveBeenCalledTimes(2)
    expect(api.facilityAudit).toHaveBeenNthCalledWith(2, DEMO_HOSPITAL_ID, undefined)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(events())
    expect(events().getAttribute('tabindex')).toBe('-1')
    onlyAuditRead()
  })

  it.each([
    ['a refusal with a message', new HidApiError(500, 'The audit service is unavailable.', { code: 'INTERNAL_ERROR' }), SAID_UNAVAILABLE],
    ['a failure between services', new HidApiError(503, 'x', { code: 'EHR_SERVICE_AUTH_UNAVAILABLE' }), SAID_TRY_SHORTLY],
    ['a failure with no message', 'boom', 'Audit events could not be loaded. Try again.'],
  ])('says %s, with Try again', async (_, refusal, words) => {
    api.facilityAudit.mockRejectedValueOnce(refusal)
    renderDept(<AuditCompliance />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(words)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/audit service|INTERNAL_ERROR|SERVICE_AUTH/)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('moves focus to Try again when an older page fails, with Newer events still offered', async () => {
    api.facilityAudit.mockResolvedValueOnce(pageOf([event('51')], '51')).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderDept(<AuditCompliance />)
    const olderButton = await screen.findByRole('button', { name: 'Older events' })
    olderButton.focus()
    fireEvent.click(olderButton)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(SAID_NETWORK)
    expect(alert.textContent).not.toContain('Failed to fetch')
    expect(document.activeElement).toBe(within(alert).getByRole('button', { name: 'Try again' }))
    expect(button('Newer events')).toBeTruthy()
    expect(api.facilityAudit).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, '51')
  })

  it('refuses a membership without audit.read, reading nothing', () => {
    session.facility = fakeFacility(['lab.work-item.read'], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital' })
    renderDept(<AuditCompliance />)

    expect(screen.getByRole('heading', { level: 1, name: 'Audit & Compliance' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Your role at this facility doesn’t include reviewing audit events. Ask your facility administrator.')
    expect(screen.queryByRole('list')).toBeNull()
    expect(api.facilityAudit).not.toHaveBeenCalled()
    expect(api.touched).toEqual([])
  })

  it('asks for a facility when the session has none, reading nothing', () => {
    session.facility = undefined
    renderDept(<AuditCompliance />)
    expect(screen.getByRole('status').textContent).toBe('Choose the facility you are working at to review its audit events.')
    expect(api.touched).toEqual([])
  })
})

describe('Audit & Compliance: switching facility', () => {
  it('reads the new facility’s first page and drops the earlier facility’s late answer', async () => {
    const hospitalOlder = deferred<unknown>()
    api.facilityAudit
      .mockResolvedValueOnce(pageOf([event('51', { action: 'hospital.first' })], '51'))
      .mockReturnValueOnce(hospitalOlder.promise)
      .mockResolvedValueOnce(pageOf([event('9', { action: 'laboratory.first' })]))
    const { rerender } = renderDept(<AuditCompliance />)
    fireEvent.click(await screen.findByRole('button', { name: 'Older events' }))
    await waitFor(() => expect(api.facilityAudit).toHaveBeenCalledTimes(2))

    session.facility = LABORATORY
    rerender(view())
    expect(await screen.findByText('laboratory.first')).toBeTruthy()
    expect(api.facilityAudit).toHaveBeenLastCalledWith(DEMO_LABORATORY_ID, undefined)
    expect(screen.getByText(/^Audit events for Demo Laboratory\./)).toBeTruthy()
    // One page only: no pager, and the hospital's page 2 is not carried over.
    expect(screen.queryByText(/^Page /)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Newer events' })).toBeNull()

    await act(async () => { hospitalOlder.resolve(pageOf([event('40', { action: 'hospital.older' })])) })
    expect(screen.queryByText('hospital.older')).toBeNull()
    expect(screen.queryByText('hospital.first')).toBeNull()
    expect(screen.getByText('laboratory.first')).toBeTruthy()
    onlyAuditRead()
  })
})
