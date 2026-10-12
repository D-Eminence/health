import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Outreach } from '../Operations'
import { Registration } from '../Registration'

/**
 * PEHR-04 on pages with several forms. Outreach's campaign and case forms, and
 * Registration's NIN, case, review and enrollment forms, each shared one set of
 * field problems: submitting one form cleared what another form's field had
 * been refused for, though that value was still there and still refused. Each
 * form now keeps its own.
 */
const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCases: vi.fn(), outreachCampaignMembers: vi.fn(), createOutreachCampaign: vi.fn(), createOutreachCase: vi.fn(),
  registrationCapabilities: vi.fn(), registrationCase: vi.fn(), resolveNin: vi.fn(),
}))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: {
    id: 'facility-1', membershipId: 'member-1',
    permissions: ['outreach.campaign.read', 'outreach.campaign.write', 'outreach.registration.read', 'outreach.registration.write',
      'identity.registration.write', 'identity.registration.approve'],
  } } } }, lock: null }),
}))
vi.mock('../../api', () => ({ staffApi: api }))

/** The text of every element that describes `element`. */
const described = (element: Element) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()

/** `control` is marked invalid and described by `message`. */
function expectRefused(control: HTMLElement, message: string) {
  expect(control.getAttribute('aria-invalid')).toBe('true')
  expect(described(control)).toBe(message)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.outreachCampaigns.mockResolvedValue([])
  api.outreachCases.mockResolvedValue([])
  api.registrationCapabilities.mockResolvedValue({ nin: { enabled: true, state: 'test-only' }, newPatientRegistrationRequiresNin: true })
})

describe('outreach', () => {
  const NAME_REFUSED = 'Enter a campaign name and choose at least one service.'

  async function refuseCampaignName() {
    render(<Outreach />)
    const name = await screen.findByLabelText(/^Campaign name/)
    fireEvent.submit(name.closest('form')!)
    await waitFor(() => expectRefused(name, NAME_REFUSED))
    return name
  }

  it('a case refused at its own field leaves the campaign’s refusal at the campaign name', async () => {
    const name = await refuseCampaignName()
    const caseName = screen.getByLabelText(/^Full name/)
    fireEvent.submit(caseName.closest('form')!)
    await waitFor(() => expectRefused(caseName, 'Enter a name and a valid age.'))
    expectRefused(name, NAME_REFUSED)
  })

  it('a case created leaves the campaign’s refusal at the campaign name', async () => {
    const name = await refuseCampaignName()
    api.createOutreachCase.mockResolvedValue({ id: 'case-1' })
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Amina Example' } })
    fireEvent.change(screen.getByLabelText(/^Age \(years\)/), { target: { value: '34' } })
    fireEvent.submit(screen.getByLabelText(/^Full name/).closest('form')!)
    await waitFor(() => expect(document.getElementById('outreach-status')?.textContent).toBe('Registration case created for identity resolution.'))
    expectRefused(name, NAME_REFUSED)
  })

  // The services rule is described at their fieldset, which a screen reader does not
  // read again when focus moves within it: refused from Enter in a later service, it
  // is an alert there, and focus stays.
  it('the services rule, refused from within the services, is an alert there', async () => {
    render(<Outreach />)
    const name = await screen.findByLabelText(/^Campaign name/)
    fireEvent.change(name, { target: { value: 'Measles week' } })
    const later = document.getElementById('outreach-service-vaccination')!
    expect(later.closest('fieldset')?.querySelector('input')).not.toBe(later)
    later.focus()
    fireEvent.submit(name.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe(NAME_REFUSED)
    expect(document.activeElement).toBe(later)
    expect(api.createOutreachCampaign).not.toHaveBeenCalled()
  })
})

describe('registration', () => {
  it('a case ID refused at its field leaves the NIN form’s refusal at the NIN', async () => {
    render(<Registration />)
    const nin = await screen.findByLabelText(/^National Identity Number/)
    fireEvent.change(nin, { target: { value: '123' } })
    fireEvent.submit(nin.closest('form')!)
    await waitFor(() => expectRefused(nin, 'Enter the 11 digit NIN.'))

    const caseId = screen.getByRole('textbox', { name: 'Registration case ID' })
    fireEvent.change(caseId, { target: { value: 'not-a-case' } })
    fireEvent.submit(caseId.closest('form')!)
    await waitFor(() => expectRefused(caseId, 'Enter a valid registration case ID.'))
    expectRefused(nin, 'Enter the 11 digit NIN.')
    expect(api.registrationCase).not.toHaveBeenCalled()
  })

  it('a refusal in one case’s review form does not follow to the next case loaded', async () => {
    const first = 'c0000000-0000-4000-8000-000000000001'
    const second = 'c0000000-0000-4000-8000-000000000002'
    const pending = (caseId: string) => ({ caseId, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 })
    api.registrationCase.mockResolvedValueOnce(pending(first)).mockResolvedValueOnce(pending(second))
    render(<Registration />)
    const caseId = await screen.findByRole('textbox', { name: 'Registration case ID' })
    fireEvent.change(caseId, { target: { value: first } })
    fireEvent.submit(caseId.closest('form')!)
    const reason = await screen.findByLabelText(/^Approval reason/)
    fireEvent.submit(reason.closest('form')!)
    await waitFor(() => expectRefused(reason, 'Enter a review reason between 8 and 500 characters.'))

    fireEvent.change(caseId, { target: { value: second } })
    fireEvent.submit(caseId.closest('form')!)
    await screen.findByRole('heading', { name: `Case ${second}` })
    const next = screen.getByLabelText(/^Approval reason/)
    expect(next.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById('registration-approve-reason-error')).toBeNull()
  })
})
