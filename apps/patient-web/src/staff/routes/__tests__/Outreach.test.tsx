import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Outreach } from '../Operations'
import { SAID_NETWORK } from '../../../__tests__/said'

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCases: vi.fn(), outreachCampaignMembers: vi.fn(), createOutreachCase: vi.fn(),
  linkExistingOutreachCase: vi.fn(),
}))
// Every staff API member the page reaches for that this test does not provide, such as a campaign write.
const unprovided = vi.hoisted(() => new Set<string>())
const permissions = vi.hoisted(() => ({ value: [] as string[] }))

vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { id: 'staff-1', facility: {
    id: 'facility-1', membershipId: 'member-1', permissions: permissions.value,
  } } } }, lock: null }),
}))
vi.mock('../../api', () => ({
  staffApi: new Proxy(api, {
    get(target, property) {
      if (typeof property === 'string' && !(property in target)) unprovided.add(property)
      return Reflect.get(target, property)
    },
  }),
}))

const ALL = ['outreach.campaign.read', 'outreach.campaign.write', 'outreach.registration.read', 'outreach.registration.write']
const campaign = (id: string, name: string, status: string) =>
  ({ id, name, status, services: ['registration'], startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 })

const pendingCase = { id: 'case-1', status: 'identity_resolution_pending', fullName: 'Amaka Obi', ageYears: 34, sex: 'female',
  temporaryPatientId: 'tmp_c0000000-0000-4000-8000-000000000001', createdAt: '2026-10-12T09:00:00.000Z', rowVersion: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  unprovided.clear()
  permissions.value = ALL
  api.outreachCampaigns.mockResolvedValue([campaign('campaign-1', 'Ikeja screening week', 'active'), campaign('campaign-2', 'Epe follow-up', 'planned')])
  api.outreachCases.mockResolvedValue([])
  api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) =>
    [{ id: `${campaignId}-membership`, campaignId, membershipId: 'member-1', role: 'health_worker', createdAt: '2026-01-01T00:00:00.000Z' }])
})

/**
 * GAP-L93, OUTREACH-01 and "Reference workflows - Outreach campaign writes".
 * Identity does not authorize outreach.campaign.write until campaign governance
 * is decided (hid-system authorize-outreach.dto.ts, ADR-045), so creating a
 * campaign, changing its status and adding a member always answer
 * 400 VALIDATION_FAILED, though six roles hold the permission. The page offers
 * none of them; campaigns and their members can still be read. The redesign removed the notice that said so (no
 * disclaimers): the page offers nothing it cannot do, and says nothing about it.
 */
describe('Outreach campaigns, read only', () => {
  it('offers no campaign create, status or member control, even with outreach.campaign.write, and adds no disclaimer', async () => {
    render(<Outreach />)
    expect(await screen.findByText('Ikeja screening week')).toBeTruthy()
    await screen.findByText('Epe follow-up')
    expect(screen.getByRole('heading', { name: 'Campaigns' })).toBeTruthy()
    expect(screen.queryByText(/Campaign management is not yet available/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'New campaign' })).toBeNull()
    for (const name of [/create campaign/i, /activate campaign/i, /close campaign/i, /add member/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByText('Add campaign member')).toBeNull()
    expect(screen.queryByLabelText(/^Activation reason/)).toBeNull()
    expect(screen.queryByLabelText(/^Closure reason/)).toBeNull()
    expect(screen.queryByLabelText(/^Facility membership ID/)).toBeNull()
    // Members are still read, and nothing else is reached for.
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledWith('facility-1', 'campaign-2'))
    expect([...unprovided]).toEqual([])
  })

  it('does not say the page manages campaigns', async () => {
    render(<Outreach />)
    await screen.findByText('Ikeja screening week')
    expect(document.body.textContent).not.toMatch(/Manage facility campaigns/)
  })
})

/**
 * NEW-PEHR-REQUIRED-MISMATCH and OCR-A11Y-06 (Outreach): a field marked
 * required with an asterisk must be required to assistive technology too.
 */
describe('Outreach registration case fields', () => {
  it('every field marked required is a required control', async () => {
    render(<Outreach />)
    const form = (await screen.findByRole('heading', { name: 'New registration case' })).closest('.staff-card') as HTMLElement
    const marked = Array.from(form.querySelectorAll('label')).filter(label => label.querySelector('[aria-hidden="true"]')?.textContent === '*')
    expect(marked.map(label => label.textContent)).toEqual(['Full name*', 'Sex*', 'Age (years)*'])
    for (const label of marked) {
      const control = document.getElementById(label.htmlFor) as HTMLInputElement | HTMLSelectElement
      expect({ field: label.textContent, required: control.required }).toEqual({ field: label.textContent, required: true })
    }
    // Sex always holds a value; Unknown is the default.
    expect((within(form).getByLabelText(/^Sex/) as HTMLSelectElement).value).toBe('unknown')
  })
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/** The new registration case form, filled in as given. */
async function fillCase(values: { fullName?: string; sex?: string; age?: string; phone?: string; notes?: string }) {
  const form = (await screen.findByRole('heading', { name: 'New registration case' })).closest('.staff-card') as HTMLElement
  const set = (label: RegExp, value: string | undefined) => { if (value !== undefined) fireEvent.change(within(form).getByLabelText(label), { target: { value } }) }
  set(/^Full name/, values.fullName); set(/^Sex/, values.sex); set(/^Age/, values.age); set(/^Phone/, values.phone); set(/^Operational notes/, values.notes)
  return within(form).getByRole('button', { name: 'Create case' })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** The command IDs each create request was sent with: its localCommandId (also its Idempotency-Key) and temporary patient ID. */
const commands = () => api.createOutreachCase.mock.calls.map(call => call[2] as { localCommandId: string; temporaryPatientId: string })

/**
 * GAP-L94 and OUTREACH-02. Creating a registration case sends a
 * localCommandId, which is also its Idempotency-Key, and a temporary patient
 * ID; Outreach answers the same request sent again with the case it made
 * (hid-system outreach.service.ts create). A new pair on every press made a
 * retry after a lost answer a second case. The same case keeps its pair until
 * it is created; a different case gets a new one.
 */
describe('creating a registration case', () => {
  it('sends the case with a new command, and says it was created', async () => {
    api.createOutreachCase.mockResolvedValue(pendingCase)
    render(<Outreach />)
    await press(await fillCase({ fullName: '  Amaka Obi ', sex: 'female', age: '34', phone: ' 0803 000 0000 ', notes: '  Met at the market clinic ' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    expect(api.createOutreachCase.mock.calls[0]!.slice(0, 2)).toEqual(['facility-1', { campaignId: undefined, fullName: 'Amaka Obi', sex: 'female',
      ageYears: 34, phone: '0803 000 0000', operationalNotes: 'Met at the market clinic' }])
    expect(commands()[0]!.localCommandId).toMatch(UUID)
    expect(commands()[0]!.temporaryPatientId).toMatch(/^tmp_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await screen.findByText('Registration case created for identity resolution.')).toBeTruthy()
    expect(api.outreachCases).toHaveBeenCalledTimes(2)
  })

  it('sends the same command again when the same case is retried after a lost answer', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(0, 'The network request failed.', { code: 'NETWORK_ERROR' }))
    render(<Outreach />)
    const create = await fillCase({ fullName: 'Amaka Obi', sex: 'female', age: '34' })
    await press(create)
    expect((await screen.findByRole('alert')).textContent).toContain(SAID_NETWORK)
    expect(document.body.textContent).not.toContain('The network request failed.')
    api.createOutreachCase.mockResolvedValueOnce(pendingCase)
    await press(create)
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(2))
    expect(commands()[0]!.localCommandId).toMatch(UUID)
    expect(commands()[1]).toEqual(commands()[0])
  })

  it('sends a new command for a different case, and for the next case once one is created', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(503, 'Outreach is unavailable.', { code: 'SERVICE_UNAVAILABLE' }))
    render(<Outreach />)
    await press(await fillCase({ fullName: 'Amaka Obi', sex: 'female', age: '34' }))
    await screen.findByRole('alert')
    // A different case: the age was mistyped.
    api.createOutreachCase.mockResolvedValueOnce(pendingCase)
    await press(await fillCase({ age: '43' }))
    await screen.findByText('Registration case created for identity resolution.')
    // The next case, though its details match the last.
    api.createOutreachCase.mockResolvedValueOnce(pendingCase)
    await press(await fillCase({ fullName: 'Amaka Obi', sex: 'female', age: '43' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(3))
    const [first, second, third] = commands()
    expect(second!.localCommandId).not.toBe(first!.localCommandId)
    expect(second!.temporaryPatientId).not.toBe(first!.temporaryPatientId)
    expect(third!.localCommandId).not.toBe(second!.localCommandId)
  })

  it.each([
    ['Operational notes', { notes: '  ab ' }, 'outreach-case-notes', 'Enter operational notes of at least 3 characters, or leave them blank.'],
    ['Phone', { phone: ' 12 ' }, 'outreach-case-phone', 'Enter a phone number of at least 3 characters, or leave it blank.'],
    // The form checks its own fields (noValidate), so a browser's bubble does not say the same thing another way.
    ['Full name', { fullName: '   ' }, 'outreach-case-name', 'Enter the registrant\'s full name.'],
    ['an empty age', { age: '' }, 'outreach-case-age', 'Enter an age in whole years, from 0 to 130.'],
    ['an age over 130', { age: '131' }, 'outreach-case-age', 'Enter an age in whole years, from 0 to 130.'],
    ['an age in part years', { age: '4.5' }, 'outreach-case-age', 'Enter an age in whole years, from 0 to 130.'],
  ])('refuses %s as Outreach would, at the field', async (_name, values, id, message) => {
    render(<Outreach />)
    await press(await fillCase({ fullName: 'Amaka Obi', sex: 'female', age: '34', ...values }))
    const field = document.getElementById(id)!
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe(message)
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })
})

describe('what the new registration case form says', () => {
  it('checks its own fields, so the browser does not check them a second way', async () => {
    render(<Outreach />)
    const form = (await fillCase({})).closest('form')!
    expect(form.noValidate).toBe(true)
  })

  it('clears the last answer when a field is refused', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(0, 'The network request failed.', { code: 'NETWORK_ERROR' }))
    render(<Outreach />)
    await press(await fillCase({ fullName: 'Amaka Obi', sex: 'female', age: '34' }))
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_NETWORK)
    expect(document.body.textContent).not.toContain('The network request failed.')
    await press(await fillCase({ phone: ' 12 ' }))
    await waitFor(() => expect(document.getElementById('outreach-case-phone')?.getAttribute('aria-invalid')).toBe('true'))
    expect(screen.queryByText('The network request failed.')).toBeNull()
  })

  // Refused from a press of Create case, focus moves to the field, whose description says why. Refused
  // from Enter in that field, focus cannot move, so the refusal is an alert there, new each time.
  it('says a refusal made from Enter in the refused field itself as an alert', async () => {
    render(<Outreach />)
    await press(await fillCase({ fullName: 'Amaka Obi', sex: 'female', age: '34', phone: ' 12 ' }))
    const phone = document.getElementById('outreach-case-phone')!
    await waitFor(() => expect(document.activeElement).toBe(phone))
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => { fireEvent.submit(phone.closest('form')!) })
    const message = 'Enter a phone number of at least 3 characters, or leave it blank.'
    const first = await screen.findByRole('alert')
    expect(first.textContent).toBe(message)
    expect(document.getElementById(phone.getAttribute('aria-describedby') ?? '')?.textContent).toBe(message)
    await act(async () => { fireEvent.submit(phone.closest('form')!) })
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })

  it('clears a field refused before once another field is refused', async () => {
    render(<Outreach />)
    await press(await fillCase({ fullName: 'Amaka Obi', sex: 'female', age: '34', phone: ' 12 ' }))
    const phone = document.getElementById('outreach-case-phone')!
    await waitFor(() => expect(phone.getAttribute('aria-invalid')).toBe('true'))
    await press(await fillCase({ fullName: '', phone: '0803 000 0000' }))
    await waitFor(() => expect(document.getElementById('outreach-case-name')?.getAttribute('aria-invalid')).toBe('true'))
    expect(phone.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById('outreach-case-phone-error')).toBeNull()
  })
})

describe('linking a registration case to an existing patient', () => {
  const PATIENT = 'a0000000-0000-4000-8000-000000000001'

  it('sends the patient, the case and its version, and the reason, then reads the cases again', async () => {
    api.outreachCases.mockResolvedValue([pendingCase])
    api.linkExistingOutreachCase.mockResolvedValue({ ...pendingCase, status: 'identity_resolved', rowVersion: 4 })
    render(<Outreach />)
    fireEvent.click(await screen.findByText('Link verified existing patient'))
    fireEvent.change(screen.getByLabelText(/^Canonical patient ID/), { target: { value: ` ${PATIENT} ` } })
    fireEvent.change(screen.getByLabelText(/^Resolution reason/), { target: { value: ' Same name, age and phone as the Health ID record ' } })
    await press(screen.getByRole('button', { name: 'Link existing patient' }))
    await waitFor(() => expect(api.linkExistingOutreachCase).toHaveBeenCalledWith('facility-1', pendingCase, PATIENT,
      'Same name, age and phone as the Health ID record'))
    expect(await screen.findByText('Existing patient linked.')).toBeTruthy()
    expect(api.outreachCases).toHaveBeenCalledTimes(2)
  })

  it('sends nothing without a reason of at least 8 characters', async () => {
    api.outreachCases.mockResolvedValue([pendingCase])
    render(<Outreach />)
    fireEvent.click(await screen.findByText('Link verified existing patient'))
    fireEvent.change(screen.getByLabelText(/^Canonical patient ID/), { target: { value: PATIENT } })
    fireEvent.change(screen.getByLabelText(/^Resolution reason/), { target: { value: ' short  ' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Link existing patient' }).closest('form')!)
    // Refused at the reason field (PEHR-04), which takes focus, so its description says why.
    const reason = screen.getByLabelText(/^Resolution reason/)
    await waitFor(() => expect(document.activeElement).toBe(reason))
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(reason.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a canonical patient ID and a reason of at least 8 characters.')
    expect(api.linkExistingOutreachCase).not.toHaveBeenCalled()
  })

  it('offers no link for a case already resolved', async () => {
    api.outreachCases.mockResolvedValue([{ ...pendingCase, status: 'identity_resolved' }])
    render(<Outreach />)
    await screen.findByText('Amaka Obi')
    expect(screen.queryByText('Link verified existing patient')).toBeNull()
  })
})
