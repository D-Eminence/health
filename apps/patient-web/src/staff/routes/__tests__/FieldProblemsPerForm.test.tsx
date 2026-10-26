import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Outreach } from '../Operations'
import { Registration } from '../Registration'

/**
 * PEHR-04 on pages with several forms. Outreach's forms, and Registration's
 * NIN, case, review and enrollment forms, each shared one set of field
 * problems: submitting one form cleared what another form's field had been
 * refused for, though that value was still there and still refused. Each form
 * now keeps its own.
 */
const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCases: vi.fn(), outreachCampaignMembers: vi.fn(), createOutreachCase: vi.fn(), linkExistingOutreachCase: vi.fn(),
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

// Outreach offers no campaign create, status or member form (OUTREACH-01: Identity does not
// authorize outreach.campaign.write, so each would always be refused; Outreach.test.tsx pins
// that none is offered). The forms it keeps side by side are the new case form and each
// pending case's link form, and each keeps its own refusals.
describe('outreach', () => {
  const LINK_REFUSED = 'Enter a canonical patient ID and a reason of at least 8 characters.'
  const pending = (id: string, fullName: string) => ({ id, status: 'identity_resolution_pending', fullName, rowVersion: 1,
    createdAt: '2026-10-01T08:00:00.000Z' })

  /** Opens the link form of the case named `fullName`, submits it empty, and returns its refused patient ID field. */
  async function refuseLink(fullName: string) {
    const card = (await screen.findByText(fullName)).closest<HTMLElement>('.staff-list-item')!
    fireEvent.click(within(card).getByText('Link verified existing patient'))
    const patient = within(card).getByLabelText(/^Canonical patient ID/)
    fireEvent.submit(patient.closest('form')!)
    await waitFor(() => expectRefused(patient, LINK_REFUSED))
    return patient
  }

  it('a case refused at its own field leaves a link refusal at the canonical patient ID', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1', 'Amina Example')])
    render(<Outreach />)
    const patient = await refuseLink('Amina Example')
    const caseName = screen.getByLabelText(/^Full name/)
    fireEvent.submit(caseName.closest('form')!)
    await waitFor(() => expectRefused(caseName, "Enter the registrant's full name."))
    expectRefused(patient, LINK_REFUSED)
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })

  it('a case created leaves a link refusal at the canonical patient ID', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1', 'Amina Example')])
    api.createOutreachCase.mockResolvedValue({ id: 'case-2' })
    render(<Outreach />)
    const patient = await refuseLink('Amina Example')
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Bola Example' } })
    fireEvent.change(screen.getByLabelText(/^Age \(years\)/), { target: { value: '34' } })
    fireEvent.submit(screen.getByLabelText(/^Full name/).closest('form')!)
    await waitFor(() => expect(document.getElementById('outreach-status')?.textContent).toBe('Registration case created for identity resolution.'))
    expectRefused(patient, LINK_REFUSED)
  })

  it('one case’s link refusal stays at its field when another case’s link form is submitted', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1', 'Amina Example'), pending('case-2', 'Bola Example')])
    render(<Outreach />)
    const first = await refuseLink('Amina Example')
    const second = await refuseLink('Bola Example')
    expect(second).not.toBe(first)
    expectRefused(first, LINK_REFUSED)
    expect(api.linkExistingOutreachCase).not.toHaveBeenCalled()
  })

  // Refused from Enter in the refused field, focus cannot move to say why: it is an alert there, and focus stays.
  it('a link refusal, refused from within the refused field, is an alert there', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1', 'Amina Example')])
    render(<Outreach />)
    const card = (await screen.findByText('Amina Example')).closest<HTMLElement>('.staff-list-item')!
    fireEvent.click(within(card).getByText('Link verified existing patient'))
    const patient = within(card).getByLabelText(/^Canonical patient ID/)
    patient.focus()
    fireEvent.submit(patient.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe(LINK_REFUSED)
    expect(document.activeElement).toBe(patient)
    expect(api.linkExistingOutreachCase).not.toHaveBeenCalled()
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
    // A slow CI runner can take longer than waitFor's one second to show the refusal (main run 38983273017 failed here once).
    await waitFor(() => expectRefused(reason, 'Enter a review reason between 8 and 500 characters.'), { timeout: 5000 })

    fireEvent.change(caseId, { target: { value: second } })
    fireEvent.submit(caseId.closest('form')!)
    await screen.findByRole('heading', { name: `Case ${second}` }, { timeout: 5000 })
    const next = screen.getByLabelText(/^Approval reason/)
    expect(next.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById('registration-approve-reason-error')).toBeNull()
  })

  // A case's review and enrollment forms start afresh when another case is shown. That reset used to run as an effect
  // after the render that showed the case, so a refusal made before the effect ran was then cleared by it: on a slow CI
  // runner the test above lost its refusal that way (the wait cannot help, the refusal is gone). This submits the review
  // form in the same task as that render, before its effects run, and the refusal must stay.
  it('a refusal made as soon as a case’s review form appears is kept', async () => {
    const caseId = 'c0000000-0000-4000-8000-000000000003'
    api.registrationCase.mockResolvedValueOnce({ caseId, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 })
    render(<Registration />)
    const caseField = await screen.findByRole('textbox', { name: 'Registration case ID' })
    const submitted = new Promise<HTMLElement>(resolve => {
      const observer = new MutationObserver(() => {
        const reason = document.getElementById('registration-approve-reason')
        if (!reason) return
        observer.disconnect()
        fireEvent.submit(reason.closest('form')!)
        resolve(reason)
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
    fireEvent.change(caseField, { target: { value: caseId } })
    fireEvent.submit(caseField.closest('form')!)
    const reason = await submitted
    await waitFor(() => expectRefused(reason, 'Enter a review reason between 8 and 500 characters.'))
  })
})
