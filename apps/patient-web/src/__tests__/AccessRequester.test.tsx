import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { AccessRequest } from '../api'
import { AccessPage } from '../routes/Portal'
import { requester, requesterKnown } from '../routes/whoHasAccess'
import { ToastProvider } from '../kasuwa/toast'
import { json, press, renderPortal } from './portalHarness'

/**
 * Who asked, on the patient's access requests (hid-system 0128, identity-api at 4c843270): `GET
 * /identity/me/access-requests` items carry `requesterName` and `requesterRole` (each null when Identity could not read
 * it; both left out before 0128). Fictional people and facilities only.
 */
const request = (id: string, extra: Partial<AccessRequest> = {}): AccessRequest => ({
  accessRequestId: `7100000${id}-0000-4000-8000-000000000001`, facilityId: 'facility-1', facilityName: 'Demo Hospital',
  scope: 'read_records', reason: 'Follow-up', status: 'pending', requestedDurationMinutes: 60,
  requestedAt: new Date(Date.now() - 2 * 60_000).toISOString(), approvedAt: null, deniedAt: null, deniedReason: null, ...extra,
})

function accessPage(requests: AccessRequest[]) {
  return renderPortal(<ToastProvider><AccessPage /></ToastProvider>, (path, method) => {
    if (path === '/identity/me' && method === 'GET') return json({})
    if (path === '/identity/me/access-history') return json({ items: [] })
    return json(requests)
  })
}

describe('who asked, in words', () => {
  it('names the staff member and their role, either alone, and neither as before 0128', () => {
    expect(requester({ requesterName: 'Dr Ada Example', requesterRole: 'doctor' })).toBe('Dr Ada Example (Doctor)')
    expect(requester({ requesterName: 'Bola Example', requesterRole: 'nurse' })).toBe('Bola Example (Nurse)')
    expect(requester({ requesterName: 'Dr Ada Example', requesterRole: null })).toBe('Dr Ada Example')
    expect(requester({ requesterName: null, requesterRole: 'pharmacist' })).toBe('A staff member (Pharmacist)')
    expect(requester({ requesterName: '  ', requesterRole: null })).toBe('A staff member')
    expect(requester({})).toBe('A staff member')
    // A role Health ID has no words for is left out, never shown as its code.
    expect(requester({ requesterName: 'Dr Ada Example', requesterRole: 'chief_wizard' })).toBe('Dr Ada Example')
  })

  it('knows who asked only from a name, or a role Health ID has words for', () => {
    expect(requesterKnown({ requesterName: 'Dr Ada Example', requesterRole: null })).toBe(true)
    expect(requesterKnown({ requesterName: null, requesterRole: 'pharmacist' })).toBe(true)
    expect(requesterKnown({ requesterName: '  ', requesterRole: 'chief_wizard' })).toBe(false)
    expect(requesterKnown({ requesterName: null, requesterRole: null })).toBe(false)
    expect(requesterKnown({})).toBe(false)
  })
})

describe('the request cards on Access & sharing', () => {
  it('says who asks by name and role on each card, and in the review', async () => {
    accessPage([
      request('1', { requesterName: 'Dr Ada Example', requesterRole: 'doctor' }),
      request('2', { requesterName: 'Bola Example', requesterRole: 'lab', scope: 'write_records' }),
      request('3', { requesterName: null, requesterRole: null, status: 'approved', approvedAt: new Date().toISOString() }),
    ])
    const rows = await screen.findAllByRole('button', { name: /^Demo Hospital/ })
    const text = rows.map(row => row.textContent ?? '')
    expect(text[0]).toContain('Dr Ada Example (Doctor) wants to view your records for 60 minutes · 2 min ago')
    expect(text[1]).toContain('Bola Example (Laboratory scientist) wants to view and add records for 60 minutes')
    expect(text[2]).toContain('A staff member asked to view your records · 2 min ago')
    await press(rows[0]!)
    const drawer = within(await screen.findByRole('dialog'))
    const asked = drawer.getByText('Asked by')
    expect(asked.nextElementSibling?.textContent).toBe('Dr Ada Example (Doctor)')
  })

  it('says “A staff member”, and adds no Asked by line, when Identity sends no requester (before 0128)', async () => {
    accessPage([request('1')])
    const [row] = await screen.findAllByRole('button', { name: /^Demo Hospital/ })
    expect(row!.textContent).toContain('A staff member wants to view your records for 60 minutes')
    await press(row!)
    await screen.findByRole('dialog')
    expect(screen.queryByText('Asked by')).toBeNull()
  })

  it('adds no Asked by line when Identity sends only a role Health ID has no words for', async () => {
    accessPage([request('1', { requesterName: null, requesterRole: 'chief_wizard' })])
    const [row] = await screen.findAllByRole('button', { name: /^Demo Hospital/ })
    expect(row!.textContent).toContain('A staff member wants to view your records for 60 minutes')
    await press(row!)
    await screen.findByRole('dialog')
    expect(screen.queryByText('Asked by')).toBeNull()
    expect(document.body.textContent).not.toContain('chief_wizard')
  })

  it('says Asked by with the role alone when Health ID has words for it', async () => {
    accessPage([request('1', { requesterName: null, requesterRole: 'pharmacist' })])
    const [row] = await screen.findAllByRole('button', { name: /^Demo Hospital/ })
    await press(row!)
    const drawer = within(await screen.findByRole('dialog'))
    expect(drawer.getByText('Asked by').nextElementSibling?.textContent).toBe('A staff member (Pharmacist)')
  })

  it('names the staff member who used the Access PIN', async () => {
    accessPage([request('1', { reason: 'Patient access PIN verification', status: 'approved', approvedAt: new Date().toISOString(),
      requesterName: 'Dr Ada Example', requesterRole: 'doctor' })])
    const [row] = await screen.findAllByRole('button', { name: /^Demo Hospital/ })
    expect(row!.textContent).toContain('Dr Ada Example (Doctor) used your Access PIN to view your records · 2 min ago')
  })
})
