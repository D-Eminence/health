import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor, AuditEvent } from '../api'
import { AuditPage } from '../Audit'
import { FacilityDetailPage } from '../Facilities'
import { ACTION_GROUPS } from '../auditWords'
import { AUDIT_ACTION_LABELS } from '../../audit/actionLabels'
import { StepUpProvider } from '../StepUp'

/**
 * The support console's Audit page and a facility's audit excerpts say each event in plain English: who did what, when,
 * and Allowed, Refused or Failed. No action code, route, HTTP method, ID or request reference is ever on screen, in the
 * rows, the filters or the details; the filters still send the codes and IDs to the backend.
 */
const mocks = vi.hoisted(() => ({ audit: vi.fn(), facility: vi.fn(), assistedRegistration: vi.fn() }))
vi.mock('../api', () => ({ adminApi: mocks, PAGE_SIZE: 25, newIdempotencyKey: () => 'key-1' }))

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const CODE_ON_SCREEN = /[A-Z]{2,}_[A-Z_]+|\/v1\/|\b(GET|POST|PUT|PATCH|DELETE)\b|[0-9a-f]{8}-[0-9a-f]{4}/

let sequence = 100
function event(action: string, more: Partial<AuditEvent> = {}): AuditEvent {
  sequence -= 1
  return { sequenceId: String(sequence), eventId: `7d1e2f3a-0b4c-4d5e-8f6a-${String(sequence).padStart(12, '0')}`,
    occurredAt: '2026-10-08T12:00:00.000Z', correlationId: `c3a1b2d4-5e6f-4a7b-8c9d-${String(sequence).padStart(12, '0')}`,
    actorType: 'staff', actorSubject: 'staff:5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e', facilityId: FACILITY_ID, action,
    outcome: 'success', resourceType: null, resourceId: null, purposeOfUse: null, reason: null, sourceSystem: 'ehr-api', ...more }
}

/** Real backend action codes (hid-system services), a request-log row with a route, and a code no one has listed. */
const EVENTS: AuditEvent[] = [
  event('admin.account.disabled', { actorType: 'platform', facilityId: null, resourceType: 'authentication-account',
    resourceId: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d', purposeOfUse: 'healthcare-operations', reason: 'Asked by the account holder' }),
  event('admin.facility.suspended', { actorType: 'platform', facilityId: null, resourceType: 'facility', resourceId: FACILITY_ID }),
  event('ehr.encounter.read', { resourceType: 'encounter', resourceId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', purposeOfUse: 'direct-care' }),
  event('outreach.campaign.created', { purposeOfUse: 'healthcare-operations' }),
  event('identity.patient-access-pin.verify-denied', { outcome: 'denied', actorType: 'patient', actorSubject: 'patient:HID-ZDEMAAA2' }),
  event('security.authorization.denied', { outcome: 'denied', purposeOfUse: 'emergency' }),
  event('ocr.publication.fail', { actorType: 'workload', actorSubject: 'workload:ocr-worker' }),
  event('ehr.allergy.create', { purposeOfUse: 'patient-self' }),
  event('ehr.immunization.create', { purposeOfUse: 'patient-self' }),
  event('api.ehr.note.read.request', { resourceType: 'http-request', purposeOfUse: 'direct-care' }),
  event('api.get./v1/patients/:patientId/encounters', { resourceType: 'http-request', outcome: 'failure' }),
  event('SOMETHING_NEW_HAPPENED', { actorType: 'system', actorSubject: null, purposeOfUse: 'BREAK_GLASS_REVIEW' }),
]

const actor: AdminActor = { accountId: 'admin-1', subject: 'staff:1', displayName: 'Patient One', email: 'one@example.test', platformRoles: [],
  platformPermissions: ['platform.admin.access', 'platform.facility.read', 'platform.audit.read'] }

function openAudit(path = '/admin/audit') {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/audit" element={<AuditPage />} /></Routes></MemoryRouter>)
}

/** Everything a person can read: the text, what is typed or chosen in the filters, and their placeholders. */
function onScreen(): string {
  const fields = Array.from(document.querySelectorAll('input, select, textarea')).map(field => field instanceof HTMLSelectElement
    ? field.selectedOptions[0]?.textContent ?? ''
    : `${(field as HTMLInputElement).value} ${field.getAttribute('placeholder') ?? ''}`)
  return `${document.body.textContent ?? ''} ${fields.join(' ')}`
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.audit.mockResolvedValue({ items: EVENTS, nextBeforeSequenceId: null })
  mocks.facility.mockResolvedValue({ id: FACILITY_ID, organizationId: 'org-1', organizationName: 'Demo Hospital Group', name: 'Demo Hospital',
    code: 'DMH', status: 'verified', statusReason: null, statusChangedAt: null, createdAt: '2026-09-01T09:00:00.000Z',
    membershipCount: 4, version: 3 })
  mocks.assistedRegistration.mockResolvedValue({ facilityId: FACILITY_ID, designated: false, status: null, addressLine: null,
    town: null, lga: null, state: null, hours: null, reason: null, version: 0, updatedAt: null })
})

describe('platform audit rows in plain English', () => {
  it('says who did what and the result, with no code, route, method or ID anywhere on the page', async () => {
    openAudit()
    expect(await screen.findByText('Support disabled an account')).toBeTruthy()
    for (const text of ['Support suspended a facility', 'Opened a patient\'s visit', 'Created an outreach campaign',
      'Their role here does not allow this action', 'Scanned document could not be added', 'A request to Health ID', 'Another action']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText(/Patient PIN not accepted/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Recorded an allergy').some(element => element.tagName !== 'OPTION')).toBe(true)
    // A code with no label yet still reads in words.
    expect(screen.getByText('Patient record: Added immunization')).toBeTruthy()
    for (const who of ['Health ID support', 'Staff member', 'Patient', 'Health ID background service', 'Health ID (automatic)']) {
      expect(screen.getAllByText(who).length).toBeGreaterThan(0)
    }
    for (const result of ['Allowed', 'Refused', 'Failed']) expect(screen.getAllByText(result).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Purpose: caring for a patient').length).toBe(2)
    expect(screen.getByText('Purpose: another purpose')).toBeTruthy()
    expect(screen.getByText('Asked by the account holder')).toBeTruthy()
    expect(onScreen()).not.toMatch(CODE_ON_SCREEN)
    expect(onScreen()).not.toMatch(/staff:|patient:|workload:|HID-ZDEMAAA2|ehr\.|admin\.|http-request|Request code/)
  })

  it('filters by action in words and sends the code', async () => {
    openAudit()
    await screen.findByText('Support disabled an account')
    const what = screen.getByLabelText('What happened') as HTMLSelectElement
    const option = within(what).getByRole('option', { name: 'Support disabled an account' }) as HTMLOptionElement
    fireEvent.change(what, { target: { value: option.value } })
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'denied' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({ action: 'admin.account.disabled', outcome: 'denied' }, undefined, expect.anything()))
    expect(within(screen.getByLabelText('Result')).getByRole('option', { name: 'Refused' })).toBeTruthy()
    expect(onScreen()).not.toMatch(CODE_ON_SCREEN)
    expect(onScreen()).not.toMatch(/admin\.account/)
  })

  it('gives every listed action exactly one option, and no two options read alike', () => {
    const choices = ACTION_GROUPS.flatMap(group => group.choices)
    const codes = choices.map(choice => choice.code)
    expect([...codes].sort()).toEqual(Object.keys(AUDIT_ACTION_LABELS).sort())
    expect(new Set(codes).size).toBe(codes.length)
    const texts = choices.map(choice => choice.text)
    expect(new Set(texts).size).toBe(texts.length)
    for (const text of texts) expect(text).not.toMatch(/[a-z]+\.[a-z]+|[A-Z]{2,}_/)
  })

  it('tells the two role refusals apart in words and filters each by its own code', async () => {
    openAudit()
    await screen.findByText('Support disabled an account')
    const what = screen.getByLabelText('What happened') as HTMLSelectElement
    const refusals = within(what).getAllByRole('option', { name: /^Their role here does not allow this action/ }) as HTMLOptionElement[]
    expect(refusals.map(option => option.textContent)).toEqual([
      'Their role here does not allow this action (accounts, facilities and staff)',
      'Their role here does not allow this action (health records, scanned documents, or not signed in)'])
    fireEvent.change(what, { target: { value: refusals[1]?.value } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({ action: 'security.authorization.denied' }, undefined, expect.anything()))
    expect(what.selectedOptions[0]?.textContent).toBe(refusals[1]?.textContent)
    fireEvent.change(what, { target: { value: refusals[0]?.value } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({ action: 'security.authorization' }, undefined, expect.anything()))
    expect(onScreen()).not.toMatch(/security\./)
  })

  it('never reads Any action while a filter from a link is on', async () => {
    openAudit('/admin/audit?action=security.authorization.denied')
    await screen.findByText('Support disabled an account')
    const what = screen.getByLabelText('What happened') as HTMLSelectElement
    expect(what.selectedOptions[0]?.textContent).toBe('Their role here does not allow this action (health records, scanned documents, or not signed in)')
    expect(within(what).queryByRole('option', { name: 'The action from your link' })).toBeNull()
  })

  it('says a link\'s action with no option of its own as The action from your link', async () => {
    openAudit(`/admin/audit?action=${encodeURIComponent('api.ehr.note.read.request')}`)
    await screen.findByText('Support disabled an account')
    expect(mocks.audit).toHaveBeenCalledWith({ action: 'api.ehr.note.read.request' }, undefined, expect.anything())
    const what = screen.getByLabelText('What happened') as HTMLSelectElement
    expect(what.selectedOptions[0]?.textContent).toBe('The action from your link')
    expect(onScreen()).not.toMatch(/api\.|ehr\./)
  })

  it('finds an error reference without showing one', async () => {
    openAudit()
    await screen.findByText('Support disabled an account')
    expect(screen.getByLabelText('Error reference')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Error reference'), { target: { value: ' ref-503 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({ correlationId: 'ref-503' }, undefined, expect.anything()))
  })

  it('keeps a person or facility filter from a link, says it in words, and clears it', async () => {
    openAudit(`/admin/audit?actor=${encodeURIComponent('staff:5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e')}&facilityId=${FACILITY_ID}&action=admin.unknown.thing`)
    await screen.findByText('Support disabled an account')
    expect(mocks.audit).toHaveBeenCalledWith({ actor: 'staff:5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e', facilityId: FACILITY_ID,
      action: 'admin.unknown.thing' }, undefined, expect.anything())
    expect(screen.getByText('Showing one person\'s activity.')).toBeTruthy()
    expect(screen.getByText('Showing one facility\'s activity.')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'The action from your link' })).toBeTruthy()
    expect(onScreen()).not.toMatch(CODE_ON_SCREEN)
    expect(onScreen()).not.toMatch(/staff:|admin\.unknown/)
    fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({ facilityId: FACILITY_ID, action: 'admin.unknown.thing' }, undefined, expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: 'Show all facilities' }))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({ action: 'admin.unknown.thing' }, undefined, expect.anything()))
  })

  it('says a target filter on the main backend in words', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    openAudit(`/admin/audit?resourceType=facility&resourceId=${FACILITY_ID}`)
    await screen.findByText('Support disabled an account')
    expect(mocks.audit).toHaveBeenCalledWith({ resourceType: 'facility', resourceId: FACILITY_ID }, undefined, expect.anything())
    expect(screen.getByText('Showing changes to one facility.')).toBeTruthy()
    expect(onScreen()).not.toMatch(CODE_ON_SCREEN)
    fireEvent.click(screen.getByRole('button', { name: 'Show every item' }))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({}, undefined, expect.anything()))
  })
})

describe('a facility\'s audit excerpts in plain English', () => {
  it('shows the same words and no codes or IDs', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    render(<MemoryRouter initialEntries={[`/admin/facilities/${FACILITY_ID}`]}><StepUpProvider><Routes>
      <Route path="/admin/facilities/:facilityId" element={<FacilityDetailPage actor={actor} />} />
    </Routes></StepUpProvider></MemoryRouter>)
    const inside = await screen.findByRole('region', { name: 'Activity inside this facility' })
    expect(await within(inside).findByText('Opened a patient\'s visit')).toBeTruthy()
    expect(within(inside).getAllByText('Staff member').length).toBeGreaterThan(0)
    expect(within(inside).getAllByText('Refused').length).toBeGreaterThan(0)
    const changes = screen.getByRole('region', { name: 'Platform changes to this facility' })
    expect(within(changes).getByText('Support suspended a facility')).toBeTruthy()
    for (const region of [inside, changes]) {
      expect(region.textContent).not.toMatch(CODE_ON_SCREEN)
      expect(region.textContent).not.toMatch(/staff:|patient:|ehr\.|admin\./)
    }
  })
})
