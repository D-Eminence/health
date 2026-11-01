import { useState, type FormEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { ConsentChecks } from '../agreements/ConsentChecks'
import { AgreementSheet } from '../agreements/AgreementSheet'
import { PATIENT_CONSENT_ITEMS, usePatientConsent } from '../agreements/patientConsent'
import { PATIENT_TERMS } from '../agreements/patientTerms'
import { HEALTH_DATA } from '../agreements/healthData'
import { FACILITY_AGREEMENT } from '../agreements/facilityAgreement'
import { PatientAgreementCheck } from '../agreements/PatientAgreementCheck'
import { FacilityAgreementCheck } from '../ehr-blue/frame/FacilityAgreementCheck'
import { ProfileAgreements } from '../routes/ProfileAgreements'

/**
 * The agreements: the boxes (unticked, the button enabled, a missing one said under it with focus there), the full text
 * in a sheet with a printed copy, the screen that asks again after a change (only when the read says so, never on a
 * 404), and the profile's list. The consent routes are proposed: every read may answer 404.
 */
const patientApi = vi.hoisted(() => ({ myConsents: vi.fn(), recordConsents: vi.fn() }))
vi.mock('../session', () => ({ useSession: () => ({ api: patientApi }) }))
const facilityApi = vi.hoisted(() => ({ current: vi.fn(), record: vi.fn() }))
vi.mock('../staff/api', () => ({ facilityAgreementApi: facilityApi }))

const notFound = () => new HidApiError(404, 'Not found', { code: 'NOT_FOUND' })
const TERMS = 'I agree to the Terms of use'
const HEALTH = 'I agree to Health ID keeping my health records and sharing them only as I choose'
const UPDATES = 'Send me occasional updates by email'
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
const describedText = (element: Element) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent).join(' | ')

beforeEach(() => {
  vi.clearAllMocks()
  patientApi.recordConsents.mockResolvedValue({ recorded: true })
  facilityApi.record.mockResolvedValue({ recorded: true })
})
afterEach(() => { vi.unstubAllGlobals() })

/** A form as the sign-up's last step uses the boxes: Send checks them, and goes on only when both required are ticked. */
function ConsentForm({ onSent }: { onSent: () => void }) {
  const consent = usePatientConsent()
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (consent.check(true).length) return
    onSent()
  }
  return <form onSubmit={submit} noValidate>
    <label htmlFor="pw">Password</label><input id="pw" value={password} onChange={event => setPassword(event.target.value)} />
    <ConsentChecks idPrefix="test" summary={PATIENT_TERMS} items={PATIENT_CONSENT_ITEMS} checked={consent.checked}
      onChange={consent.onChange} errors={consent.errors} focusRequest={consent.focusRequest} />
    <button type="submit">Create account</button>
  </form>
}

describe('ConsentChecks', () => {
  it('lists the short version, then every box unticked, each whole row its label, and the button enabled', () => {
    render(<ConsentForm onSent={vi.fn()} />)
    expect(screen.getByText('Your health records belong to you.')).toBeTruthy()
    for (const line of PATIENT_TERMS.short) expect(screen.getByText(line)).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map(input => input.checked)).toEqual([false, false, false])
    expect(boxes.map(input => input.closest('label')?.textContent)).toEqual([TERMS, HEALTH, UPDATES])
    expect(boxes.every(input => input.closest('label')?.className.includes('min-h-11'))).toBe(true)
    expect(screen.getByRole('group', { name: 'Agreements' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled).toBe(false)
    // The link to the agreement is underlined and stays on the page.
    const read = screen.getByRole('button', { name: 'Read the full agreement' })
    expect(read.className).toContain('underline')
    expect(screen.queryAllByRole('link')).toEqual([])
  })

  it('says a missing required box under it, through aria-describedby, and moves focus to the first one missing', () => {
    const sent = vi.fn()
    render(<ConsentForm onSent={sent} />)
    const create = screen.getByRole('button', { name: 'Create account' })
    create.focus()
    fireEvent.click(create)
    expect(sent).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(box(TERMS))
    expect(describedText(box(TERMS))).toBe('Tick to agree before you continue.')
    expect(describedText(box(HEALTH))).toBe('Tick to agree before you continue.')
    expect(box(TERMS).getAttribute('aria-invalid')).toBe('true')
    // The optional box is never marked.
    expect(box(UPDATES).getAttribute('aria-invalid')).toBeNull()
    expect(box(UPDATES).getAttribute('aria-describedby')).toBeNull()

    fireEvent.click(box(TERMS))
    expect(box(TERMS).getAttribute('aria-describedby')).toBeNull()
    create.focus()
    fireEvent.click(create)
    expect(document.activeElement).toBe(box(HEALTH))
    expect(sent).not.toHaveBeenCalled()
  })

  it('never lets the optional box stop the form', () => {
    const sent = vi.fn()
    render(<ConsentForm onSent={sent} />)
    fireEvent.click(box(TERMS))
    fireEvent.click(box(HEALTH))
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(sent).toHaveBeenCalledTimes(1)
    expect(box(UPDATES).checked).toBe(false)
  })

  it('ticks a box from anywhere on its row', () => {
    render(<ConsentForm onSent={vi.fn()} />)
    fireEvent.click(screen.getByText(HEALTH))
    expect(box(HEALTH).checked).toBe(true)
  })

  it('opens the full agreement in a sheet over the form, which keeps what was typed', () => {
    render(<ConsentForm onSent={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'kept while reading' } })
    const read = screen.getByRole('button', { name: 'Read the full agreement' })
    read.focus()
    fireEvent.click(read)
    const sheet = screen.getByRole('dialog', { name: PATIENT_TERMS.title })
    expect(within(sheet).getByRole('heading', { name: '13. Contact and complaints' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(read)
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('kept while reading')
  })
})

describe('AgreementSheet', () => {
  it('shows the title, version and date, every section, Download copy and Close', () => {
    const close = vi.fn()
    render(<AgreementSheet document={FACILITY_AGREEMENT} open onClose={close} />)
    const sheet = screen.getByRole('dialog', { name: 'Health ID facility agreement' })
    expect(within(sheet).getByText('Version 1.0 · 1 November 2026')).toBeTruthy()
    expect(within(sheet).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(FACILITY_AGREEMENT.sections.map(section => section.heading))
    expect(document.activeElement).toBe(within(sheet).getByRole('heading', { level: 2 }))
    fireEvent.click(within(sheet).getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('prints a copy of the agreement alone, with who agreed and when, and removes it after printing', () => {
    let printed = ''
    const print = vi.fn(() => { printed = document.querySelector('body > .hid-agreement-print')?.textContent ?? '' })
    vi.stubGlobal('print', print)
    render(<AgreementSheet document={HEALTH_DATA} open onClose={vi.fn()} signed={{ by: 'Ada Obi', on: '2026-11-01T09:12:00Z' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download copy' }))
    expect(print).toHaveBeenCalledTimes(1)
    expect(printed).toContain(HEALTH_DATA.title)
    expect(printed).toContain('Version 1.0 · 1 November 2026')
    expect(printed).toContain('Agreed by Ada Obi on 1 November 2026')
    expect(printed).toContain('4. You choose who sees your records')
    window.dispatchEvent(new Event('afterprint'))
    expect(document.querySelector('.hid-agreement-print')).toBeNull()
    // The sheet is still open: printing changes nothing on the page.
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('the agreement-changed screen (patient)', () => {
  it('is shown only when the read says needsAgreement, with at most three lines, and records the two required boxes', async () => {
    patientApi.myConsents.mockResolvedValue({ items: [], needsAgreement: true, changes: ['One.', 'Two.', 'Three.', 'Four.'] })
    render(<MemoryRouter><p>Overview</p><PatientAgreementCheck /></MemoryRouter>)
    const heading = await screen.findByRole('heading', { name: 'We’ve updated our agreement' })
    expect(document.activeElement).toBe(heading)
    const screenBox = screen.getByRole('dialog', { name: 'We’ve updated our agreement' })
    expect(within(screenBox).getAllByRole('listitem').map(item => item.textContent)).toEqual(['One.', 'Two.', 'Three.'])
    expect(within(screenBox).getAllByRole('checkbox').map(input => input.closest('label')?.textContent)).toEqual([TERMS, HEALTH])
    expect(within(screenBox).getAllByRole('button').filter(button => button.textContent === 'Agree')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Agree' }))
    expect(document.activeElement).toBe(box(TERMS))
    expect(describedText(box(TERMS))).toBe('Tick to agree before you continue.')
    expect(patientApi.recordConsents).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Read the full agreement' }))
    expect(screen.getByRole('dialog', { name: PATIENT_TERMS.title })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(box(TERMS)); fireEvent.click(box(HEALTH))
    fireEvent.click(screen.getByRole('button', { name: 'Agree' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(patientApi.recordConsents).toHaveBeenCalledTimes(1))
    expect(patientApi.recordConsents).toHaveBeenCalledWith({ items: [
      { documentId: 'patient-terms', version: '1.0', accepted: true },
      { documentId: 'health-data', version: '1.0', accepted: true },
    ], language: 'en', method: 'self' }, expect.stringMatching(/^[0-9a-f-]{36}$/))
  })

  it.each([
    ['answers 404 (not served yet)', () => patientApi.myConsents.mockRejectedValue(notFound())],
    ['fails', () => patientApi.myConsents.mockRejectedValue(new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }))],
    ['says nothing needs agreeing', () => patientApi.myConsents.mockResolvedValue({ items: [], needsAgreement: false, changes: [] })],
  ])('shows nothing and stops nothing when the read %s', async (_when, answer) => {
    answer()
    render(<MemoryRouter><p>Overview</p><PatientAgreementCheck /></MemoryRouter>)
    await waitFor(() => expect(patientApi.myConsents).toHaveBeenCalledTimes(1))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Overview')).toBeTruthy()
  })

  it('goes when Agree is pressed even if the record is refused', async () => {
    patientApi.myConsents.mockResolvedValue({ items: [], needsAgreement: true, changes: [] })
    patientApi.recordConsents.mockRejectedValue(notFound())
    render(<MemoryRouter><PatientAgreementCheck /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'We’ve updated our agreement' })
    fireEvent.click(box(TERMS)); fireEvent.click(box(HEALTH))
    fireEvent.click(screen.getByRole('button', { name: 'Agree' }))
    await waitFor(() => expect(patientApi.recordConsents).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the agreement-changed screen (facility)', () => {
  const facility = { id: 'f-1', name: 'Demo Hospital', roles: ['org_admin'] }

  it('asks the administrator only, and records the signer and facility with the working facility', async () => {
    facilityApi.current.mockResolvedValue({ needsAgreement: true, changes: ['We explain emergencies in plainer words.'] })
    render(<FacilityAgreementCheck facility={facility} signerName="Dr Amaka Eze" />)
    await screen.findByRole('heading', { name: 'We’ve updated our agreement' })
    expect(facilityApi.current).toHaveBeenCalledWith('f-1')
    fireEvent.click(box('I agree to this for Demo Hospital, and I’m allowed to sign for it'))
    fireEvent.click(screen.getByRole('button', { name: 'Agree' }))
    await waitFor(() => expect(facilityApi.record).toHaveBeenCalledWith({ documentId: 'facility-agreement', version: '1.0',
      signerName: 'Dr Amaka Eze', facilityName: 'Demo Hospital', language: 'en' }, expect.any(String), 'f-1'))
  })

  it('asks nothing of other staff, and nothing on a 404', async () => {
    facilityApi.current.mockRejectedValue(notFound())
    const { unmount } = render(<FacilityAgreementCheck facility={{ ...facility, roles: ['doctor'] }} signerName="Dr B" />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(facilityApi.current).not.toHaveBeenCalled()
    unmount()
    render(<FacilityAgreementCheck facility={facility} signerName="Dr Amaka Eze" />)
    await waitFor(() => expect(facilityApi.current).toHaveBeenCalledTimes(1))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Profile → Agreements', () => {
  it('lists what the patient agreed to, with version and date, Read and Download copy', async () => {
    patientApi.myConsents.mockResolvedValue({ items: [
      { documentId: 'patient-terms', version: '1.0', accepted: true, at: '2026-11-01T09:12:00Z' },
      { documentId: 'health-data', version: '1.0', accepted: true, at: '2026-11-01T09:12:00Z' },
    ], needsAgreement: false, changes: [] })
    render(<MemoryRouter><ProfileAgreements deletionOffered /></MemoryRouter>)
    expect((await screen.findAllByText('Version 1.0 · agreed 1 November 2026'))).toHaveLength(2)
    expect(screen.getByRole('button', { name: `Download copy of ${PATIENT_TERMS.title}` })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Read ${HEALTH_DATA.title}` }))
    expect(screen.getByRole('dialog', { name: HEALTH_DATA.title })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('link', { name: 'Stop sharing' }).getAttribute('href')).toBe('/access')
    expect(screen.getByRole('link', { name: 'close your account' }).getAttribute('href')).toBe('/profile#account-deletion')
  })

  it('lists the current versions with Read only, no dates and nothing said, while the route answers 404', async () => {
    patientApi.myConsents.mockRejectedValue(notFound())
    render(<MemoryRouter><ProfileAgreements deletionOffered={false} /></MemoryRouter>)
    await waitFor(() => expect(patientApi.myConsents).toHaveBeenCalled())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(screen.getAllByText('Version 1.0')).toHaveLength(2)
    expect(screen.queryByText(/agreed/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Download copy/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Read / })).toHaveLength(2)
    expect(screen.queryByRole('link', { name: 'close your account' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
