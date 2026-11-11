import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { StartOutreachGroup } from '../../../../ehr-blue/departments/outreach/StartOutreachGroup'

/*
 * "Start an outreach group" (owner decision 5 of 11 November 2026): a hospital worker's login starts its own outreach
 * group, becomes its organiser and keeps its hospital roles, then opens the new group. Fictional data only.
 */
const staff = vi.hoisted(() => ({ selectFacility: vi.fn(), refresh: vi.fn() }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return { useStaff: () => ({ ...staffContext(fakeFacility(['ehr.encounter.read'], { name: 'Demo Hospital', roles: ['doctor'] })),
    selectFacility: staff.selectFacility, refresh: staff.refresh }) }
})
const api = vi.hoisted(() => ({ outreachGroupAvailability: vi.fn(), startOutreachGroup: vi.fn() }))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const NEW_GROUP = '0e7c0000-0000-4000-8000-000000000003'

beforeEach(() => {
  vi.clearAllMocks()
  api.outreachGroupAvailability.mockResolvedValue({ open: true, termsVersion: '2026-11-01' })
  api.startOutreachGroup.mockResolvedValue({ started: true, organizationId: 'org-3', facilityId: NEW_GROUP, membershipId: 'm-3', organiserStatus: 'active',
    label: 'Unverified organiser' })
  staff.refresh.mockResolvedValue(undefined)
  staff.selectFacility.mockResolvedValue(true)
})

function open() {
  return render(<MemoryRouter initialEntries={['/provider/start-outreach-group']}><Routes>
    <Route path="/provider/start-outreach-group" element={<StartOutreachGroup />} />
    <Route path="/provider/outreach" element={<h1>Outreach</h1>} />
  </Routes></MemoryRouter>)
}
async function press(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}

describe('Start an outreach group', () => {
  it('starts the group with the same login, accepting the terms, then opens it', async () => {
    open()
    fireEvent.change(await screen.findByRole('textbox', { name: /Group name/ }), { target: { value: 'Yaba Health Volunteers' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Phone number/ }), { target: { value: '08012345678' } })
    await press('Start my outreach group')
    expect(screen.getByText('Tick the box to accept the organiser terms.')).toBeTruthy()
    expect(api.startOutreachGroup).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: /accept the organiser terms/ }))
    await press('Start my outreach group')
    expect(api.startOutreachGroup).toHaveBeenCalledWith({ groupName: 'Yaba Health Volunteers', kind: 'group', phone: '08012345678',
      termsVersion: '2026-11-01', acceptTerms: true })
    await waitFor(() => expect(staff.selectFacility).toHaveBeenCalledWith(NEW_GROUP))
    expect(await screen.findByRole('heading', { level: 1, name: 'Outreach' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/limit|₦|price/i)
  })

  it('says when the login already runs a group, in plain words', async () => {
    api.startOutreachGroup.mockRejectedValue(new HidApiError(409, 'x', { code: 'OUTREACH_ORGANISER_ALREADY_RUNNING' }))
    open()
    fireEvent.change(await screen.findByRole('textbox', { name: /Group name/ }), { target: { value: 'Yaba Health Volunteers' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Phone number/ }), { target: { value: '08012345678' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /accept the organiser terms/ }))
    await press('Start my outreach group')
    expect(await screen.findByText('Your login already runs an outreach group. Switch to it from Switch facility.')).toBeTruthy()
  })

  it('shows no form and sends nothing when Identity accepts newer terms than this page shows', async () => {
    api.outreachGroupAvailability.mockResolvedValue({ open: true, termsVersion: '2026-12-01' })
    open()
    expect(await screen.findByText('The organiser terms have changed. Reload the page to read the new terms.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start my outreach group' })).toBeNull()
    expect(api.startOutreachGroup).not.toHaveBeenCalled()
  })

  it('offers nothing to send while it is not open', async () => {
    api.outreachGroupAvailability.mockResolvedValue({ open: false })
    open()
    expect(await screen.findByText('Signing up to run outreach isn’t open at the moment. Please try again later.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
