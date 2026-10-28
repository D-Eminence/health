import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { PatientProfile } from '../api'
import type { HealthProfile } from '../profileParity'
import { draftFromImported } from '../routes/HealthInformation'
import { ProfilePage } from '../routes/Portal'
import { json, openSection, press, problem, profile, renderPortal, type Handler, type Sent } from './portalHarness'

const novu = vi.hoisted(() => ({ on: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => novu.on }))
afterEach(() => { novu.on = true })

/**
 * "Health information" on the profile (hid-1.0 parity B3, the owner's decision of 2026-10-28): the six things the
 * patient says about their health, kept in EHR apart from clinicians' records (GET and PUT /ehr/me/health-profile).
 * With nothing entered yet, the form starts from what the patient kept in hid-1.0.
 */
const HEALTH = '/ehr/me/health-profile'
const patient: PatientProfile = { ...profile, email: 'ada@example.com', phone: '+2348031234567', phoneVerified: false, hasPhoto: false }
const nothing: HealthProfile = { bloodGroup: null, genotype: null, allergies: null, currentMedications: null, chronicConditions: null,
  medicalNotes: null, rowVersion: 0, updatedAt: null }
const hid1 = { content: { blood_group: 'o positive', genotype: 'A S', allergies: 'Penicillin\r\nShellfish', current_medications: 'Amlodipine 5mg',
  chronic_conditions: 'Hypertension', medical_notes: 'Prefers a female doctor' }, updatedAt: '2025-11-03T09:00:00Z' }

function gateway(start: HealthProfile, imported: unknown = null, put?: (body: unknown) => Response): Handler {
  let saved = start
  return (path, method, body) => {
    if (path === '/identity/me' && method === 'GET') return json(patient)
    if (path === '/ehr/me/records' && method === 'GET') return json({ encounters: [], notes: [], importedRecords: [], importedHealthProfile: imported, limit: 50 })
    if (path === HEALTH && method === 'GET') return json(saved)
    if (path === HEALTH && method === 'PUT') {
      const answer = put?.(body)
      if (answer) return answer
      const { expectedVersion, ...fields } = body as HealthProfile & { expectedVersion: number }
      if (expectedVersion !== saved.rowVersion) return problem(409, 'VERSION_CONFLICT', 'Stale')
      saved = { ...fields, rowVersion: saved.rowVersion + 1, updatedAt: '2026-10-28T10:00:00.000Z' }
      return json(saved)
    }
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }
}
const card = async () => within(await openSection('Health information'))
const puts = (sent: Sent[]) => sent.filter(request => request.path === HEALTH && request.method === 'PUT')
const values = (shown: ReturnType<typeof within>) => [
  ...shown.getAllByRole('combobox').map((field: HTMLElement) => [field.getAttribute('id'), (field as HTMLSelectElement).value]),
  ...shown.getAllByRole('textbox').map((field: HTMLElement) => [field.getAttribute('id'), (field as HTMLTextAreaElement).value]),
]

describe('Health information', () => {
  it('starts from what the patient kept in hid-1.0 while they have entered nothing, and saves it as theirs', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(nothing, hid1), {}, { parityB3: true })
    const shown = await card()
    await waitFor(() => expect(values(shown)).toEqual([
      ['health-bloodGroup', 'O+'], ['health-genotype', 'AS'], ['health-allergies', 'Penicillin\nShellfish'],
      ['health-currentMedications', 'Amlodipine 5mg'], ['health-chronicConditions', 'Hypertension'], ['health-medicalNotes', 'Prefers a female doctor'],
    ]))
    expect(shown.getByText(/We started this from the health details you kept in hid-1.0/)).toBeTruthy()
    expect(shown.getByRole('textbox', { name: 'Medical notes for my care team' })).toBeTruthy()
    await press(shown.getByRole('button', { name: 'Save health information' }))
    expect(await shown.findByText('Your health information was saved.')).toBeTruthy()
    expect(puts(sent)).toEqual([{ path: HEALTH, method: 'PUT', body: { bloodGroup: 'O+', genotype: 'AS', allergies: 'Penicillin\nShellfish',
      currentMedications: 'Amlodipine 5mg', chronicConditions: 'Hypertension', medicalNotes: 'Prefers a female doctor', expectedVersion: 0 } }])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Health information' })))
    // Now the patient's own: the hid-1.0 note goes, and the date it was saved shows.
    expect(shown.queryByText(/We started this from the health details you kept in hid-1.0/)).toBeNull()
    expect(shown.getByText(/^Last saved /)).toBeTruthy()
    // The hid-1.0 details stay, read-only, in their own card.
    expect(screen.getByRole('heading', { name: 'From your hid-1.0 account' })).toBeTruthy()
  })

  it('starts from what the patient saved, not hid-1.0, once they have entered something', async () => {
    const saved = { ...nothing, genotype: 'SS' as const, rowVersion: 2, updatedAt: '2026-10-27T10:00:00.000Z' }
    renderPortal(<ProfilePage />, gateway(saved, hid1), {}, { parityB3: true })
    const shown = await card()
    await waitFor(() => expect(values(shown)).toEqual([['health-bloodGroup', ''], ['health-genotype', 'SS'], ['health-allergies', ''],
      ['health-currentMedications', ''], ['health-chronicConditions', ''], ['health-medicalNotes', '']]))
    expect((shown.getByRole('button', { name: 'Save health information' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps a profile cleared after a save empty: the hid-1.0 details start the form only until the first save', async () => {
    const saved = { ...nothing, bloodGroup: 'A-' as const, allergies: 'Latex', rowVersion: 2, updatedAt: '2026-10-27T10:00:00.000Z' }
    const { sent } = renderPortal(<ProfilePage />, gateway(saved, hid1), {}, { parityB3: true })
    const shown = await card()
    await waitFor(() => expect((shown.getByRole('combobox', { name: 'Blood group' }) as HTMLSelectElement).value).toBe('A-'))
    fireEvent.change(shown.getByRole('combobox', { name: 'Blood group' }), { target: { value: '' } })
    fireEvent.change(shown.getByRole('textbox', { name: 'Allergies' }), { target: { value: '' } })
    await press(shown.getByRole('button', { name: 'Save health information' }))
    expect(await shown.findByText('Your health information was saved.')).toBeTruthy()
    expect(puts(sent)).toEqual([{ path: HEALTH, method: 'PUT', body: { bloodGroup: null, genotype: null, allergies: null, currentMedications: null,
      chronicConditions: null, medicalNotes: null, expectedVersion: 2 } }])
    // Saved empty at version 3: the form stays as the patient left it, with nothing from hid-1.0 and nothing to save.
    expect(values(shown).every(([, value]) => value === '')).toBe(true)
    expect(shown.queryByText(/We started this from the health details you kept in hid-1.0/)).toBeNull()
    expect((shown.getByRole('button', { name: 'Save health information' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves a form started from hid-1.0 even when the patient empties it, so they can say they have none', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(nothing, hid1), {}, { parityB3: true })
    const shown = await card()
    await waitFor(() => expect((shown.getByRole('combobox', { name: 'Blood group' }) as HTMLSelectElement).value).toBe('O+'))
    for (const name of ['Blood group', 'Genotype']) fireEvent.change(shown.getByRole('combobox', { name }), { target: { value: '' } })
    for (const name of ['Allergies', 'Current medications', 'Chronic conditions', 'Medical notes for my care team']) {
      fireEvent.change(shown.getByRole('textbox', { name }), { target: { value: '' } })
    }
    await press(shown.getByRole('button', { name: 'Save health information' }))
    expect(await shown.findByText('Your health information was saved.')).toBeTruthy()
    expect(puts(sent)).toEqual([{ path: HEALTH, method: 'PUT', body: { bloodGroup: null, genotype: null, allergies: null, currentMedications: null,
      chronicConditions: null, medicalNotes: null, expectedVersion: 0 } }])
    // Saved empty at version 1: nothing from hid-1.0 comes back, and there is nothing to save.
    expect(values(shown).every(([, value]) => value === '')).toBe(true)
    expect(shown.queryByText(/We started this from the health details you kept in hid-1.0/)).toBeNull()
    expect((shown.getByRole('button', { name: 'Save health information' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not send a save whose body would be over 8,000 bytes, as text in a script of several bytes a character can be', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(nothing), {}, { parityB3: true })
    const shown = await card()
    // Yoruba with its tone marks: each "ẹ̀" is two characters and five bytes, so 1000 characters are 2,500 bytes.
    const yoruba = 'ẹ̀'.repeat(500)
    for (const name of ['Allergies', 'Current medications', 'Chronic conditions', 'Medical notes for my care team']) {
      fireEvent.change(shown.getByRole('textbox', { name }), { target: { value: yoruba } })
    }
    await press(shown.getByRole('button', { name: 'Save health information' }))
    expect((await shown.findByRole('alert')).textContent)
      .toBe('Your health information is too long to save. Shorten the longer fields, then save again.')
    expect(puts(sent)).toEqual([])
    // Shortened to fit, it goes: the same number of characters in plain letters takes 1,000 bytes.
    for (const name of ['Chronic conditions', 'Medical notes for my care team']) {
      fireEvent.change(shown.getByRole('textbox', { name }), { target: { value: 'x'.repeat(1000) } })
    }
    await press(shown.getByRole('button', { name: 'Save health information' }))
    expect(await shown.findByText('Your health information was saved.')).toBeTruthy()
    const body = JSON.stringify(puts(sent)[0]?.body)
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(8000)
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(7000)
  })

  it('sends a cleared field as null, keeps newlines and drops other control characters', async () => {
    const saved = { ...nothing, bloodGroup: 'A-' as const, allergies: 'Latex', rowVersion: 1, updatedAt: '2026-10-27T10:00:00.000Z' }
    const { sent } = renderPortal(<ProfilePage />, gateway(saved), {}, { parityB3: true })
    const shown = await card()
    fireEvent.change(shown.getByRole('combobox', { name: 'Blood group' }), { target: { value: '' } })
    fireEvent.change(shown.getByRole('textbox', { name: 'Allergies' }), { target: { value: '   ' } })
    fireEvent.change(shown.getByRole('textbox', { name: 'Chronic conditions' }), { target: { value: 'Asthma\r\n\tsince 2010\u0007' } })
    await press(shown.getByRole('button', { name: 'Save health information' }))
    await waitFor(() => expect(puts(sent)).toHaveLength(1))
    expect(puts(sent)[0]?.body).toEqual({ bloodGroup: null, genotype: null, allergies: null, currentMedications: null,
      chronicConditions: 'Asthma\n since 2010', medicalNotes: null, expectedVersion: 1 })
  })

  it('offers the blood groups and genotypes, and keeps each text to 1000 characters', async () => {
    renderPortal(<ProfilePage />, gateway(nothing), {}, { parityB3: true })
    const shown = await card()
    const options = (name: string) => within(shown.getByRole('combobox', { name })).getAllByRole('option').map(option => option.textContent)
    expect(options('Blood group')).toEqual(['Not stated', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
    expect(options('Genotype')).toEqual(['Not stated', 'AA', 'AS', 'AC', 'SS', 'SC', 'CC'])
    for (const name of ['Allergies', 'Current medications', 'Chronic conditions', 'Medical notes for my care team']) {
      expect((shown.getByRole('textbox', { name }) as HTMLTextAreaElement).maxLength).toBe(1000)
    }
    const allergies = shown.getByRole('textbox', { name: 'Allergies' }) as HTMLTextAreaElement
    fireEvent.change(allergies, { target: { value: 'x'.repeat(1200) } })
    expect(allergies.value).toHaveLength(1000)
  })

  it('says it changed elsewhere on a stale version, and shows the latest', async () => {
    let saved: HealthProfile = { ...nothing, rowVersion: 4, updatedAt: '2026-10-27T10:00:00.000Z' }
    renderPortal(<ProfilePage />, (path, method, body) => {
      if (path === HEALTH && method === 'PUT') { saved = { ...saved, genotype: 'AC', rowVersion: 5 }; return problem(409, 'VERSION_CONFLICT', 'Stale') }
      if (path === HEALTH) return json(saved)
      return gateway(nothing)(path, method, body)
    }, {}, { parityB3: true })
    const shown = await card()
    fireEvent.change(shown.getByRole('combobox', { name: 'Blood group' }), { target: { value: 'B+' } })
    await press(shown.getByRole('button', { name: 'Save health information' }))
    expect((await shown.findByRole('alert')).textContent).toMatch(/was changed somewhere else .* so this was not saved/)
    await waitFor(() => expect((shown.getByRole('combobox', { name: 'Genotype' }) as HTMLSelectElement).value).toBe('AC'))
    expect((shown.getByRole('combobox', { name: 'Blood group' }) as HTMLSelectElement).value).toBe('')
  })

  it('is not shown where EHR does not serve it (404)', async () => {
    renderPortal(<ProfilePage />, gateway(nothing, hid1))
    await screen.findByRole('heading', { name: 'From your hid-1.0 account' })
    expect(screen.queryByRole('heading', { name: 'Health information' })).toBeNull()
  })

  it('starts empty on hid-system main, which sends no hid-1.0 details', async () => {
    novu.on = false
    const { sent } = renderPortal(<ProfilePage />, gateway(nothing, hid1), {}, { parityB3: true })
    const shown = await card()
    await waitFor(() => expect(values(shown).every(([, value]) => value === '')).toBe(true))
    expect(sent.some(request => request.path === '/ehr/me/records')).toBe(false)
  })
})

describe('the first draft from hid-1.0', () => {
  it('takes a blood group or genotype only when it is one of the choices', () => {
    expect(draftFromImported({ content: { blood_group: 'Rhesus positive', genotype: 'AO', allergies: '  ' }, updatedAt: null }))
      .toEqual({ bloodGroup: '', genotype: '', allergies: '  ', currentMedications: '', chronicConditions: '', medicalNotes: '' })
  })
})
