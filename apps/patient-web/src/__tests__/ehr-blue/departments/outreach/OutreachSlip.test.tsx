import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { OutreachCaseView } from '../../../../ehr-blue/departments/outreach/OutreachCaseView'
import {
  CHECKS_RECORDED, eventDateText, GET_HEALTH_ID_LATER, KEEP_SLIP, OutreachSlip,
} from '../../../../ehr-blue/departments/outreach/OutreachSlip'

/*
 * The slip a person takes home from an outreach: group, campaign, event date, who, when registered, their Health ID
 * when they have one, and the claim code only straight after "No email or phone" made it here. Never a health value,
 * and the claim code is never kept. Fictional data only.
 */

const GROUP_ID = '0e7c0000-0000-4000-8000-000000000001'
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return { useStaff: () => staffContext(fakeFacility(['outreach.registration.read', 'outreach.registration.write'],
    { id: GROUP_ID, name: 'Demo Outreach Group', roles: ['outreach_volunteer'] })) }
})
const api = vi.hoisted(() => ({ createUnverifiedOutreachHealthId: vi.fn(), outreachScreening: vi.fn(), startOutreachHealthId: vi.fn() }))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const CAMPAIGN = { id: 'campaign-1', name: 'Demo screening day', status: 'active', services: ['registration'],
  startsAt: '2026-11-14T07:00:00.000Z', endsAt: '2026-11-14T15:00:00.000Z', rowVersion: 1 }
const ITEM = { id: 'case-1', campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: 'Kemi Balogun', ageYears: 30, sex: 'female',
  createdAt: '2026-11-14T08:30:00.000Z', rowVersion: 1, healthId: null, hasScreening: true }
/** A screening as Outreach answers it: none of it may reach the slip. */
const SCREENING = { screening: { version: 1, systolicMmHg: 182, diastolicMmHg: 117, glucose: 14.2, glucoseUnit: 'mmol/L', weightKg: 61, heightCm: 158 } }

let setItem: ReturnType<typeof vi.spyOn>
let print: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  print = vi.fn()
  vi.stubGlobal('print', print)
  api.outreachScreening.mockResolvedValue(SCREENING)
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})

afterEach(() => {
  vi.unstubAllGlobals()
  // The claim code (or anything else) is never kept in the browser.
  expect(setItem).not.toHaveBeenCalled()
})

const slip = () => document.querySelector<HTMLElement>('[data-outreach-slip]')

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}

function renderCase(item: Record<string, unknown> = ITEM) {
  return renderDept(<OutreachCaseView facilityId={GROUP_ID} item={item as never} campaign={CAMPAIGN} canLink={false} canWrite group created={false}
    listError="" onBack={() => undefined} onChanged={async () => undefined} onFocusHeading={() => undefined} />)
}

describe('the outreach slip', () => {
  it('says who, where and when, with their Health ID, and no health values', () => {
    render(<OutreachSlip groupName="Demo Outreach Group" campaign={CAMPAIGN} item={{ ...ITEM, healthId: 'HID-ABC123' } as never} healthId="HID-ABC123" />)
    const text = document.body.textContent ?? ''
    for (const words of ['Demo Outreach Group', 'Demo screening day', 'Event date14 Nov 2026', 'Kemi Balogun', '30 years · Female',
      'HID-ABC123', CHECKS_RECORDED]) expect(text).toContain(words)
    expect(text).toMatch(/Registered14 Nov 2026, \d{2}:30/)
    expect(text).not.toContain(GET_HEALTH_ID_LATER)
    expect(text).not.toContain('Claim code')
    expect(text).not.toContain(KEEP_SLIP)
  })

  it('says where to get a Health ID later when they have none, and nothing of health checks when none were recorded', () => {
    render(<OutreachSlip groupName="Demo Outreach Group" campaign={CAMPAIGN} item={{ ...ITEM, hasScreening: false } as never} healthId={null} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain(GET_HEALTH_ID_LATER)
    expect(text).not.toMatch(/HID-/)
    expect(text).not.toContain(CHECKS_RECORDED)
    expect(text).not.toContain('Claim code')
  })

  it('prints the claim code only when it is passed in', () => {
    render(<OutreachSlip groupName="Demo Outreach Group" campaign={CAMPAIGN} item={ITEM as never} healthId="HID-UNVER1" claimCode="K7Q-4MZ" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Claim code')
    expect(text).toContain('K7Q-4MZ')
    expect(text).toContain(KEEP_SLIP)
  })

  it('writes an event over more than one day as its first and last day', () => {
    expect(eventDateText({ startsAt: '2026-11-14T07:00:00.000Z', endsAt: '2026-11-15T15:00:00.000Z' })).toBe('14 Nov 2026 to 15 Nov 2026')
    expect(eventDateText({ startsAt: '2026-11-14T07:00:00.000Z', endsAt: null })).toBe('14 Nov 2026')
    expect(eventDateText(undefined)).toBe('')
  })
})

describe('Print slip on a registration', () => {
  it('prints the slip alone from the case view, without a Health ID, and without any health value read for the page', async () => {
    renderCase()
    await press(screen.getByRole('button', { name: 'Print slip' }))
    expect(print).toHaveBeenCalledTimes(1)
    const paper = slip()!
    expect(paper.parentElement).toBe(document.body)
    expect(paper.getAttribute('aria-hidden')).toBe('true')
    expect(paper.textContent).toContain('Kemi Balogun')
    expect(paper.textContent).toContain(GET_HEALTH_ID_LATER)
    expect(paper.textContent).toContain(CHECKS_RECORDED)
    for (const value of ['182', '117', '14.2', 'mmol', '61', '158']) expect(paper.textContent).not.toContain(value)
  })

  it('prints the Health ID a registration carries', async () => {
    renderCase({ ...ITEM, healthId: 'HID-ABC123', healthIdCreatedByOutreach: true })
    await press(screen.getAllByRole('button', { name: 'Print slip' })[0]!)
    expect(slip()!.textContent).toContain('HID-ABC123')
    expect(slip()!.textContent).not.toContain('Claim code')
  })

  it('prints the claim code right after "No email or phone", from the claim-code display, and never again once the view is left', async () => {
    api.createUnverifiedOutreachHealthId.mockResolvedValue({ healthId: 'HID-UNVER1', claimCode: 'K7Q-4MZ', registration: { ...ITEM, healthId: 'HID-UNVER1' } })
    const view = renderCase()
    const region = screen.getByRole('region', { name: 'Create Health ID' })
    await press(within(region).getByRole('checkbox', { name: /They want a Health ID/ }))
    await press(within(region).getByRole('radio', { name: /No email or phone/ }))
    await press(within(region).getByRole('button', { name: 'Create Health ID' }))
    expect(await within(region).findByText('K7Q-4MZ')).toBeTruthy()
    await press(within(region).getByRole('button', { name: 'Print slip' }))
    expect(print).toHaveBeenCalledTimes(1)
    expect(slip()!.textContent).toContain('HID-UNVER1')
    expect(slip()!.textContent).toContain('K7Q-4MZ')
    expect(slip()!.textContent).toContain(KEEP_SLIP)
    // The page's own Print slip prints the same while the view is open.
    await act(async () => { window.dispatchEvent(new Event('afterprint')) })
    expect(slip()).toBeNull()
    await press(screen.getAllByRole('button', { name: 'Print slip' })[0]!)
    expect(slip()!.textContent).toContain('K7Q-4MZ')
    // Nothing kept it: not the browser's storage, not the address.
    expect(JSON.stringify({ ...localStorage })).not.toContain('K7Q-4MZ')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('K7Q-4MZ')
    expect(window.location.href).not.toContain('K7Q-4MZ')
    // Opened again (the list read again names the Health ID), the claim code is gone.
    await act(async () => { window.dispatchEvent(new Event('afterprint')) })
    view.unmount()
    renderCase({ ...ITEM, healthId: 'HID-UNVER1' })
    await press(screen.getAllByRole('button', { name: 'Print slip' })[0]!)
    expect(slip()!.textContent).toContain('HID-UNVER1')
    expect(slip()!.textContent).not.toContain('K7Q-4MZ')
    expect(slip()!.textContent).not.toContain('Claim code')
  })

  it('still prints when the screening route is not served', async () => {
    api.outreachScreening.mockRejectedValue(new HidApiError(404, 'x', { code: 'API_ROUTE_NOT_FOUND' }))
    renderCase({ ...ITEM, hasScreening: false })
    await press(screen.getByRole('button', { name: 'Print slip' }))
    expect(slip()!.textContent).not.toContain(CHECKS_RECORDED)
  })
})
