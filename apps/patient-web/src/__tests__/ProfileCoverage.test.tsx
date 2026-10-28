import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { PatientProfile } from '../api'
import type { ProfileDetails } from '../profileParity'
import { ProfilePage } from '../routes/Portal'
import { json, openSection, press, problem, profile, renderPortal, type Handler, type Sent } from './portalHarness'

/**
 * "Coverage" on the profile (hid-1.0 parity B3): the hospital the patient uses now, with the sign-up's hospital
 * suggestions, and their HMO's name, saved against the version read (GET and PUT /identity/me/profile-details).
 */
const DETAILS = '/identity/me/profile-details'
const patient: PatientProfile = { ...profile, email: 'ada@example.com', phone: '+2348031234567', phoneVerified: false, hasPhoto: false }

function gateway(start: ProfileDetails, put?: (body: unknown) => Response): Handler & { saved: () => ProfileDetails } {
  let saved = start
  const handler = ((path: string, method: string, body: unknown) => {
    if (path === '/identity/me' && method === 'GET') return json(patient)
    if (path === DETAILS && method === 'GET') return json(saved)
    if (path === DETAILS && method === 'PUT') {
      const answer = put?.(body)
      if (answer) return answer
      const sent = body as { hospitalCurrentlyUsing: string | null; hmoName: string | null; expectedVersion: number }
      if (sent.expectedVersion !== saved.rowVersion) return problem(409, 'VERSION_CONFLICT', 'Stale')
      saved = { hospitalCurrentlyUsing: sent.hospitalCurrentlyUsing, hmoName: sent.hmoName, rowVersion: saved.rowVersion + 1 }
      return json(saved)
    }
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }) as Handler & { saved: () => ProfileDetails }
  handler.saved = () => saved
  return handler
}
const card = async () => within(await openSection('Coverage'))
const puts = (sent: Sent[]) => sent.filter(request => request.path === DETAILS && request.method === 'PUT')

describe('Coverage', () => {
  it('shows the hospital and HMO saved, and saves a change with the version read', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway({ hospitalCurrentlyUsing: 'Lagos General Hospital', hmoName: null, rowVersion: 4 }),
      {}, { parityB3: true })
    const shown = await card()
    const hospital = shown.getByRole('combobox', { name: 'Hospital you currently use' }) as HTMLInputElement
    const hmo = shown.getByRole('textbox', { name: 'HMO name' }) as HTMLInputElement
    expect(hospital.value).toBe('Lagos General Hospital')
    expect(hmo.value).toBe('')
    const save = shown.getByRole('button', { name: 'Save coverage' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(hmo, { target: { value: '  Hygeia\tHMO  ' } })
    expect(hmo.value).toBe('  Hygeia HMO  ')
    expect(save.disabled).toBe(false)
    await press(save)
    expect(await shown.findByText('Your coverage details were saved.')).toBeTruthy()
    expect(puts(sent)).toEqual([{ path: DETAILS, method: 'PUT', body: { hospitalCurrentlyUsing: 'Lagos General Hospital', hmoName: 'Hygeia HMO', expectedVersion: 4 } }])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Coverage' })))
    // Saved: the button waits for the next change, and the next save goes with the new version.
    expect((shown.getByRole('button', { name: 'Save coverage' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(hospital, { target: { value: '' } })
    await press(shown.getByRole('button', { name: 'Save coverage' }))
    await waitFor(() => expect(puts(sent)).toHaveLength(2))
    expect(puts(sent)[1]?.body).toEqual({ hospitalCurrentlyUsing: null, hmoName: 'Hygeia HMO', expectedVersion: 5 })
  })

  it('keeps each field to 120 characters', async () => {
    renderPortal(<ProfilePage />, gateway({ hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 0 }), {}, { parityB3: true })
    const shown = await card()
    const hmo = shown.getByRole('textbox', { name: 'HMO name' }) as HTMLInputElement
    expect(hmo.maxLength).toBe(120)
    expect((shown.getByRole('combobox', { name: 'Hospital you currently use' }) as HTMLInputElement).maxLength).toBe(120)
    fireEvent.change(hmo, { target: { value: 'x'.repeat(130) } })
    expect(hmo.value).toHaveLength(120)
  })

  it('says the details changed elsewhere on a stale version, and shows the latest', async () => {
    const handler = gateway({ hospitalCurrentlyUsing: 'Old Hospital', hmoName: null, rowVersion: 2 })
    renderPortal(<ProfilePage />, handler, {}, { parityB3: true })
    const shown = await card()
    // Saved in another window meanwhile.
    void handler(DETAILS, 'PUT', { hospitalCurrentlyUsing: 'Elsewhere Hospital', hmoName: 'AXA Mansard', expectedVersion: 2 })
    fireEvent.change(shown.getByRole('textbox', { name: 'HMO name' }), { target: { value: 'Hygeia HMO' } })
    await press(shown.getByRole('button', { name: 'Save coverage' }))
    expect((await shown.findByRole('alert')).textContent).toMatch(/were changed somewhere else .* so these were not saved/)
    await waitFor(() => expect((shown.getByRole('textbox', { name: 'HMO name' }) as HTMLInputElement).value).toBe('AXA Mansard'))
    expect((shown.getByRole('combobox', { name: 'Hospital you currently use' }) as HTMLInputElement).value).toBe('Elsewhere Hospital')
    expect(handler.saved().rowVersion).toBe(3)
  })

  it('says what Identity refused', async () => {
    renderPortal(<ProfilePage />, gateway({ hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 0 },
      () => problem(400, 'VALIDATION_FAILED', 'The HMO name is not valid.')), {}, { parityB3: true })
    const shown = await card()
    fireEvent.change(shown.getByRole('textbox', { name: 'HMO name' }), { target: { value: 'Hygeia' } })
    await press(shown.getByRole('button', { name: 'Save coverage' }))
    expect((await shown.findByRole('alert')).textContent).toBe('The HMO name is not valid.')
  })

  it('offers the hospital suggestions of the sign-up', async () => {
    renderPortal(<ProfilePage />, gateway({ hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 0 }), {}, { parityB3: true })
    const hospital = (await card()).getByRole('combobox', { name: 'Hospital you currently use' })
    fireEvent.focus(hospital)
    fireEvent.change(hospital, { target: { value: 'Aba Gen' } })
    expect(await screen.findByRole('option', { name: /Aba General Hospital/ })).toBeTruthy()
  })

  it('is not shown by an Identity that does not serve it (404)', async () => {
    renderPortal(<ProfilePage />, (path, method) => path === '/identity/me' && method === 'GET' ? json(patient) : problem(404, 'NOT_FOUND', path))
    await screen.findByRole('heading', { name: 'Bio-data' })
    await waitFor(() => expect(document.getElementById('contact-details')).not.toBeNull())
    expect(screen.queryByRole('heading', { name: 'Coverage' })).toBeNull()
  })

  it('says when it could not be read, with its own Try again', async () => {
    let fail = true
    renderPortal(<ProfilePage />, (path, method) => {
      if (path === '/identity/me' && method === 'GET') return json(patient)
      if (path === DETAILS) return fail ? problem(500, 'INTERNAL', 'Coverage is unavailable.') : json({ hospitalCurrentlyUsing: null, hmoName: 'Hygeia', rowVersion: 1 })
      return problem(404, 'NOT_FOUND', path)
    }, {}, { parityB3: true })
    const shown = await card()
    expect((await shown.findByRole('alert')).textContent).toContain('Coverage is unavailable.')
    fail = false
    await press(shown.getByRole('button', { name: 'Try again loading your coverage details' }))
    await waitFor(() => expect((shown.getByRole('textbox', { name: 'HMO name' }) as HTMLInputElement).value).toBe('Hygeia'))
  })
})
