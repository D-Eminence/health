import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AuditCompliance } from '../../../../ehr-blue/departments/audit/AuditCompliance'
import { dateText } from '../../../../ehr-blue/departments/parts/format'
import { valueAt } from '../../../cssRules'
import { DEMO_HOSPITAL_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * Audit trail's design layout (design audit, #64), kept around today's controls (coordinator review, 2 Nov 2026): under
 * the heading's line, where Refresh stays, and the intro, the page is one list card. The search and the outcome filter
 * sit at its top, then every event of the page loaded (all of them as the page opens, the request log never one), with
 * Newer and Older events under them in the same card. Whether Refresh, the search and the filter go is the owner's
 * design decision; until then they stay, and AuditCompliance.test.tsx (main's, unchanged) covers what they do.
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

const button = (name: string) => screen.getByRole('button', { name })
const events = () => screen.getByRole('region', { name: 'Audit events' })
const onlyAuditRead = () => expect(api.touched.filter(key => key !== 'facilityAudit')).toEqual([])
const shown = (page = 1) => within(screen.getByRole('list', { name: `Audit events, page ${page}` })).getAllByRole('listitem')
  .map(item => item.querySelector('strong')?.textContent)

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../../ehr-blue/departments/departments.css'), 'utf8')

beforeEach(() => {
  api.facilityAudit.mockReset()
  api.touched.length = 0
  session.facility = HOSPITAL
})

describe('Audit trail: the design’s one list card', () => {
  it('draws the search, the outcome filter and the events as the one list card right under the intro, Refresh beside the heading', async () => {
    api.facilityAudit.mockResolvedValueOnce(pageOf([event('51')], '51'))
    renderDept(<AuditCompliance />)
    await screen.findByRole('list', { name: 'Audit events, page 1' })

    const card = events().parentElement as HTMLElement
    expect(card.tagName).toBe('SECTION')
    expect(card.className).toBe('hid-ehr-card hid-ehr-dept-section hid-ehr-dept-list-card')
    const intro = screen.getByText(/^Audit events for Demo Hospital\./)
    expect(intro.nextElementSibling).toBe(card)
    expect(card.nextElementSibling).toBeNull()
    expect(document.querySelectorAll('.hid-ehr-card')).toHaveLength(1)

    // Inside the card: today's search and outcome filter on one row at its top, then the events and their pager.
    expect(card.children).toHaveLength(2)
    const [controls, list] = Array.from(card.children)
    expect(controls!.className).toBe('hid-ehr-dept-search-row')
    expect(within(controls as HTMLElement).getByRole('searchbox', { name: 'Search Audit trail' })).toBeTruthy()
    expect(within(controls as HTMLElement).getByRole('combobox', { name: 'Outcome' })).toBeTruthy()
    expect(list).toBe(events())
    expect(within(card).getByRole('button', { name: 'Older events' })).toBeTruthy()

    // Refresh stays in the heading's line, outside the card.
    const refresh = button('Refresh')
    expect(within(card).queryByRole('button', { name: 'Refresh' })).toBeNull()
    expect(refresh.closest('.hid-ehr-page-heading')).not.toBeNull()
    expect(screen.getAllByRole('button').map(element => element.textContent)).toEqual(['Refresh', 'Older events'])
    onlyAuditRead()
  })

  it('lines the Outcome filter up with the search box, not with its hint', () => {
    expect(valueAt(css, '.hid-ehr .hid-ehr-dept-audit-outcome', 'align-self', 1280)).toBe('start')
  })
})

describe('Audit trail: every event of the page loaded', () => {
  const PAGE = pageOf([
    event('53', { action: 'identity.patient.lookup', outcome: 'success', resourceType: 'patient', actorType: 'staff' }),
    event('52', { action: 'identity.access.denied', outcome: 'denied', resourceType: null, actorType: 'service', correlationId: 'Corr-XYZ' }),
    event('51', { action: 'ehr.encounter.create', outcome: 'failure', resourceType: 'encounter', actorType: 'staff' }),
  ], '51')

  it('lists each event the page holds as it opens, whatever its outcome, newest first, in words', async () => {
    api.facilityAudit.mockResolvedValueOnce(PAGE)
    renderDept(<AuditCompliance />)
    await screen.findByRole('list')

    expect((screen.getByRole('searchbox', { name: 'Search Audit trail' }) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('combobox', { name: 'Outcome' }) as HTMLSelectElement).value).toBe('all')
    expect(shown()).toEqual(['Looked up a patient by Health ID', 'Patient access and registration activity (refused)', 'Tried to start a new visit'])
    const when = dateText('2026-01-01T12:00:00.000Z')
    expect(screen.getByText(`Staff member · ${when} · Allowed`)).toBeTruthy()
    expect(screen.getByText(`Someone · ${when} · Refused`)).toBeTruthy()
    expect(screen.getByText(`Staff member · ${when} · Failed`)).toBeTruthy()
    for (const withheld of ['identity.patient.lookup', 'identity.access.denied', 'ehr.encounter.create', 'Corr-XYZ', 'encounter']) {
      expect(document.body.innerHTML).not.toContain(withheld)
    }
    expect(screen.getByText('Page 1 · 3 events')).toBeTruthy()
    expect(screen.queryByText('No matching events')).toBeNull()
    expect(api.facilityAudit).toHaveBeenCalledTimes(1)
    onlyAuditRead()
  })

  it('lists every event of the next page loaded too', async () => {
    api.facilityAudit.mockResolvedValueOnce(PAGE).mockResolvedValueOnce(pageOf([
      event('50', { action: 'identity.consent.write', outcome: 'denied' }), event('49', { action: 'ehr.note.read', outcome: 'failure' }),
    ]))
    renderDept(<AuditCompliance />)
    await screen.findByRole('list')
    fireEvent.click(button('Older events'))

    await screen.findByRole('list', { name: 'Audit events, page 2' })
    expect(shown(2)).toEqual(['Patient access and registration activity (refused)', 'Tried to open a clinical note'])
    expect(api.facilityAudit).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, '51')
    expect(within(events().parentElement as HTMLElement).getByRole('button', { name: 'Newer events' })).toBeTruthy()
  })

  it('keeps a page already shown while Newer events reads it again, and says so', async () => {
    // Page 1 is shown, an older page is refused, and Newer events reads page 1 again with it still on screen.
    const again = deferred<unknown>()
    api.facilityAudit.mockResolvedValueOnce(PAGE).mockRejectedValueOnce(new Error('Health ID did not answer.'))
      .mockReturnValueOnce(again.promise)
    renderDept(<AuditCompliance />)
    await screen.findByRole('list')
    fireEvent.click(button('Older events'))
    await screen.findByRole('alert')
    fireEvent.click(button('Newer events'))

    await waitFor(() => expect(api.facilityAudit).toHaveBeenCalledTimes(3))
    expect(api.facilityAudit).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, undefined)
    expect(screen.getByRole('list', { name: 'Audit events, page 1' }).getAttribute('aria-busy')).toBe('true')
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Loading audit events')
    expect(status.className).toBe('hid-ehr-sr-only')
    expect(screen.getByText('Tried to start a new visit')).toBeTruthy()
    expect(button('Older events').getAttribute('aria-busy')).toBe('true')

    await act(async () => { again.resolve(pageOf([event('54', { action: 'auth.facility.select' })], '54')) })
    expect(shown()).toEqual(['Switched to this facility'])
    expect(screen.queryByText('Tried to start a new visit')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('list', { name: 'Audit events, page 1' }).hasAttribute('aria-busy')).toBe(false)
    expect(document.activeElement).toBe(button('Older events'))
    onlyAuditRead()
  })
})
