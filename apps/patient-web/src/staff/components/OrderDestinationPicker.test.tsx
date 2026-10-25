import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { OrderDestination } from '../api'
import { destinationLine, OrderDestinationPicker } from './OrderDestinationPicker'

/**
 * The directory a clinician picks a laboratory or pharmacy at another facility from (Novu, P4c, SPEC-FINAL §3.4,
 * §13.2): a search only when asked (each counts towards 60 an hour), each result with its CAC registered office, a
 * "New on Health ID" badge for a facility in its first 30 days, and what to do when the facility is not listed.
 */
const api = vi.hoisted(() => ({ destinations: vi.fn() }))
vi.mock('../api', () => ({ orderRoutesApi: api }))
vi.mock('../App', () => ({ useStaff: () => ({ lock: null }) }))

const YABA: OrderDestination = { facilityId: 'f0000000-0000-4000-8000-00000000000a', facilityName: 'Yaba Diagnostics',
  organizationName: 'Yaba Diagnostics Limited', registeredAddress: '12 Herbert Macaulay Way, Yaba, Lagos', newOnHealthId: true }
const IKEJA: OrderDestination = { facilityId: 'f0000000-0000-4000-8000-00000000000b', facilityName: 'Ikeja Lab',
  organizationName: 'Ikeja Lab', registeredAddress: null, newOnHealthId: false }

function Picker({ kind = 'laboratory' as 'laboratory' | 'pharmacy', onChange = vi.fn() }) {
  const [value, setValue] = useState<OrderDestination | null>(null)
  return <OrderDestinationPicker id="pick" facilityId="facility-1" kind={kind} value={value}
    onChange={destination => { setValue(destination); onChange(destination) }} />
}

function search(text: string) {
  fireEvent.change(screen.getByLabelText('Search for the laboratory'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
}

beforeEach(() => { vi.clearAllMocks() })

describe('the order destination picker', () => {
  it('searches the directory only when asked, and lists each facility with its registered office and badge', async () => {
    api.destinations.mockResolvedValue({ items: [YABA, IKEJA] })
    const onChange = vi.fn()
    render(<Picker onChange={onChange} />)
    expect(screen.getByText('Ask the patient which laboratory they will use.')).toBeTruthy()
    expect(api.destinations).not.toHaveBeenCalled()
    search('  yaba   diag ')
    expect(await screen.findByText('2 laboratories found.')).toBeTruthy()
    expect(api.destinations).toHaveBeenCalledWith('facility-1', 'laboratory', 'yaba diag')
    expect(screen.getByRole('radio', { name: /Yaba Diagnostics · Yaba Diagnostics Limited · Registered office: 12 Herbert Macaulay Way, Yaba, Lagos/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Ikeja Lab · Registered office not on record/ })).toBeTruthy()
    expect(screen.getAllByText('New on Health ID')).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: /Yaba Diagnostics/ }))
    expect(onChange).toHaveBeenCalledWith(YABA)
    expect(screen.getByText(/^Chosen:/).textContent).toBe(`Chosen: ${destinationLine(YABA)} (new on Health ID)`)
  })

  it('searches with Enter, without sending a form around it', async () => {
    api.destinations.mockResolvedValue({ items: [] })
    const submitted = vi.fn((event: Event) => event.preventDefault())
    render(<form onSubmit={event => submitted(event.nativeEvent)}><Picker kind="pharmacy" /></form>)
    const box = screen.getByLabelText('Search for the pharmacy')
    fireEvent.change(box, { target: { value: 'Medplus' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('No pharmacy on Health ID matches that name.')).toBeTruthy()
    expect(api.destinations).toHaveBeenCalledWith('facility-1', 'pharmacy', 'Medplus')
    expect(submitted).not.toHaveBeenCalled()
    expect(screen.getByText('Not listed? It may not be on Health ID yet, or not checked by Health ID support. Give the patient a paper prescription.')).toBeTruthy()
  })

  it('asks for 3 letters before searching', async () => {
    render(<Picker />)
    search('ya')
    expect((await screen.findByRole('alert')).textContent).toBe('Type 3 to 80 letters of the facility’s name.')
    expect(api.destinations).not.toHaveBeenCalled()
  })

  it.each([
    [new HidApiError(429, 'Too many', { code: 'ORDER_DESTINATION_SEARCH_LIMITED' }), 'Too many searches: try again in an hour.'],
    [new HidApiError(400, 'Bad', { code: 'ORDER_DESTINATION_QUERY_INVALID' }), 'Type 3 to 80 letters of the facility’s name.'],
    [new HidApiError(423, 'Paused', { code: 'CROSS_FACILITY_ORDERS_UNAVAILABLE' }), 'Health ID has paused orders between facilities. Try again later.'],
    [new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }), 'Sending orders to other facilities is not available yet.'],
    [new HidApiError(403, 'No', { code: 'PERMISSION_DENIED' }), 'Your role at this facility can’t send orders to other facilities.'],
  ])('says what a refused search means (%s)', async (refusal, says) => {
    api.destinations.mockRejectedValue(refusal)
    render(<Picker />)
    search('Yaba')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(says))
    expect(screen.queryByRole('radio')).toBeNull()
  })
})
