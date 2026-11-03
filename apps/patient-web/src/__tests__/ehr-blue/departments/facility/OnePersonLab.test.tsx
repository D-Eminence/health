import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { FacilityProfile } from '../../../../ehr-blue/departments/facility/FacilityProfile'
import { DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * One-person lab on the Facility profile (owner decision 33.3, hid-system 0111): the facility administrator reads the
 * switch and turns it on or off with a typed reason of 10 to 500 characters, confirmed. Offered only to holders of
 * organization.manage, and only where Identity answers the read: a 404 (an image before 0111) shows nothing.
 */
const session = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility as FakeFacility | undefined) }
})
const api = vi.hoisted(() => ({ facilitySettings: vi.fn(), setOnePersonLab: vi.fn() }))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const EXPLAINED = 'When it’s on, the scientist who entered a result can check it themselves, with a reason. Every self-check is recorded.'
const ADMIN = ['organization.manage', 'workforce.manage', 'audit.read']
const off = { onePersonLab: { enabled: false, changedAt: null, changedByName: null, reason: null } }
const on = { onePersonLab: { enabled: true, changedAt: '2026-11-03T10:00:00.000Z', changedByName: 'Ada Admin', reason: 'Only one scientist works here' } }
const problem = (status: number, code: string) => new HidApiError(status, 'Service words that are never shown', { code })

const section = () => screen.getByRole('heading', { level: 2, name: 'One-person lab' }).closest('section') as HTMLElement

async function opened() {
  renderDept(<FacilityProfile />)
  await screen.findByRole('heading', { level: 2, name: 'One-person lab' })
  return section()
}

/** Opens the reason form, types `reason` and asks to change it. */
async function ask(card: HTMLElement, turn: 'Turn on' | 'Turn off', reason: string) {
  fireEvent.click(within(card).getByRole('button', { name: turn }))
  const form = within(card).getByRole('form', { name: `${turn} one-person lab` })
  fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: reason } })
  fireEvent.click(within(form).getByRole('button', { name: turn }))
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  session.facility = fakeFacility(ADMIN, { id: DEMO_LABORATORY_ID, name: 'Demo Laboratory', roles: ['org_admin'] })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('One-person lab on the Facility profile', () => {
  it('shows nothing and reads nothing without organization.manage', () => {
    session.facility = fakeFacility(['lab.work-item.read'], { id: DEMO_LABORATORY_ID, name: 'Demo Laboratory' })
    renderDept(<FacilityProfile />)
    expect(screen.queryByRole('heading', { name: 'One-person lab' })).toBeNull()
    expect(api.facilitySettings).not.toHaveBeenCalled()
  })

  it('shows nothing when Identity has no such read (404, an image before 0111)', async () => {
    api.facilitySettings.mockRejectedValue(problem(404, 'API_ROUTE_NOT_FOUND'))
    renderDept(<FacilityProfile />)
    await waitFor(() => expect(api.facilitySettings).toHaveBeenCalledWith(DEMO_LABORATORY_ID))
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'One-person lab' })).toBeNull()
    expect(document.body.textContent).not.toContain('API_ROUTE_NOT_FOUND')
  })

  it('says it is off and has never been changed, with what it does', async () => {
    api.facilitySettings.mockResolvedValue(off)
    const card = await opened()
    expect(within(card).getByText('One-person lab: Off')).toBeTruthy()
    expect(within(card).getByText(EXPLAINED)).toBeTruthy()
    expect(within(card).getByText('Never changed. It is off until the facility administrator turns it on.')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Turn on' })).toBeTruthy()
  })

  it('says it is on, who changed it, when and why', async () => {
    api.facilitySettings.mockResolvedValue(on)
    const card = await opened()
    expect(within(card).getByText('One-person lab: On')).toBeTruthy()
    expect(within(card).getByText(/ by Ada Admin$/)).toBeTruthy()
    expect(within(card).getByText('Only one scientist works here')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Turn off' })).toBeTruthy()
  })

  it('needs a reason of 10 to 500 characters, then a confirm, before it turns it on', async () => {
    api.facilitySettings.mockResolvedValueOnce(off).mockResolvedValue(on)
    api.setOnePersonLab.mockResolvedValue({ enabled: true, changedAt: '2026-11-03T10:00:00.000Z', settingId: 'setting-1' })
    const card = await opened()
    const form = await ask(card, 'Turn on', '  short  ')
    const reason = within(form).getByRole('textbox', { name: 'Reason' })
    await waitFor(() => expect(reason.getAttribute('aria-invalid')).toBe('true'))
    expect(within(form).getByText('Enter a reason of 10 to 500 characters.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.change(reason, { target: { value: ' Only one scientist works here ' } })
    expect(within(form).getByText('29 of 500 characters; at least 10.')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Turn on' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn on one-person lab?' })
    expect(api.setOnePersonLab).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on' })) })
    expect(api.setOnePersonLab).toHaveBeenCalledWith(DEMO_LABORATORY_ID, true, 'Only one scientist works here')
    expect(await within(section()).findByText('One-person lab is now on.')).toBeTruthy()
    expect(await within(section()).findByText('One-person lab: On')).toBeTruthy()
    expect(api.facilitySettings).toHaveBeenCalledTimes(2)
  })

  it('turns it off the same way', async () => {
    api.facilitySettings.mockResolvedValue(on)
    api.setOnePersonLab.mockResolvedValue({ enabled: false, changedAt: '2026-11-03T11:00:00.000Z', settingId: 'setting-2' })
    const card = await opened()
    await ask(card, 'Turn off', 'A second scientist has joined')
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off one-person lab?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Turn off' })) })
    expect(api.setOnePersonLab).toHaveBeenCalledWith(DEMO_LABORATORY_ID, false, 'A second scientist has joined')
    expect(await within(section()).findByText('One-person lab is now off.')).toBeTruthy()
  })

  it.each([
    ['PERMISSION_DENIED', 403, 'Only the facility administrator can change this.'],
    ['FACILITY_SETTING_PERMISSION_DENIED', 403, 'Only the facility administrator can change this.'],
    ['FACILITY_SETTING_UNCHANGED', 409, 'One-person lab is already set that way.'],
    ['FACILITY_SETTINGS_UNAVAILABLE', 503, 'Facility settings are unavailable; try again later.'],
    ['FACILITY_SETTING_INVALID', 400, 'The setting could not be read; try again.'],
    ['SOMETHING_ELSE', 500, 'One-person lab could not be changed. Try again.'],
  ])('says a refused switch (%s) in plain words', async (code, status, said) => {
    api.facilitySettings.mockResolvedValue(off)
    api.setOnePersonLab.mockRejectedValue(problem(status, code))
    const card = await opened()
    await ask(card, 'Turn on', 'Only one scientist works here')
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn on one-person lab?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on' })) })
    expect(await within(section()).findByRole('alert')).toHaveProperty('textContent', said)
    expect(document.body.textContent).not.toContain('Service words that are never shown')
    expect(document.body.textContent).not.toContain(code)
  })

  it.each([
    ['VALIDATION_FAILED', 'Check the reason (10 to 500 characters) and try again.'],
    ['FACILITY_SETTING_REASON_INVALID', 'Enter a reason of 10 to 500 characters.'],
  ])('says a refused reason (%s) at the reason', async (code, said) => {
    api.facilitySettings.mockResolvedValue(off)
    api.setOnePersonLab.mockRejectedValue(problem(400, code))
    const card = await opened()
    const form = await ask(card, 'Turn on', 'Only one scientist works here')
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn on one-person lab?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on' })) })
    const reason = within(form).getByRole('textbox', { name: 'Reason' })
    await waitFor(() => expect(reason.getAttribute('aria-invalid')).toBe('true'))
    expect(within(form).getByText(said)).toBeTruthy()
    expect(document.body.textContent).not.toContain(code)
  })

  it('says a refused read in plain words, and reads again on Try again', async () => {
    api.facilitySettings.mockRejectedValueOnce(problem(503, 'FACILITY_SETTINGS_UNAVAILABLE')).mockResolvedValue(off)
    const card = await opened()
    expect(within(card).getByRole('alert').textContent).toBe('Facility settings are unavailable; try again later.')
    fireEvent.click(within(card).getByRole('button', { name: 'Try again' }))
    // The section is the switch once read; its heading stays where it was.
    expect(await screen.findByText('One-person lab: Off')).toBeTruthy()
    expect(within(section()).queryByRole('alert')).toBeNull()
    expect(api.facilitySettings).toHaveBeenCalledTimes(2)
  })
})
