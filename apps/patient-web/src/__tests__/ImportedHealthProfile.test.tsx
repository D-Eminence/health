import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { parseImportedHealthProfile } from '../importedRecords'
import { ProfilePage } from '../routes/Portal'
import { json, openSection, problem, profile, renderPortal, sectionToggle, type Handler } from './portalHarness'

const novu = vi.hoisted(() => ({ on: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => novu.on }))
afterEach(() => { novu.on = true })

/**
 * A migrated patient's hid-1.0 health details: Novu's GET ehr/me/records carries them as importedHealthProfile
 * (hid-system patient-records.service.ts read, imported-records.query.ts readImportedHealthProfile), null for anyone
 * else. The profile shows them read-only, as "From your hid-1.0 account", only when there is something to show.
 */
const HEALTH = {
  content: {
    blood_group: 'O+', genotype: 'AS', allergies: 'Penicillin\nShellfish', chronic_conditions: '  ',
    current_medications: 'Amlodipine 5mg daily', medical_notes: null,
  },
  updatedAt: '2025-11-03T09:00:00Z',
}
const records = (importedHealthProfile: unknown) => ({ encounters: [], notes: [], importedRecords: [], importedHealthProfile, limit: 50 })
function gateway(recordsAnswer: () => Response): Handler {
  return (path, method) => {
    if (path === '/identity/me' && method === 'GET') return json(profile)
    if (path === '/ehr/me/records' && method === 'GET') return recordsAnswer()
    return problem(500, 'UNEXPECTED', `${method} ${path}`)
  }
}
const card = () => openSection('From your hid-1.0 account')

describe('your hid-1.0 health details, on the profile', () => {
  it('shows the details the patient kept, read-only, and only those with something in them', async () => {
    renderPortal(<ProfilePage />, gateway(() => json(records(HEALTH))))
    const shown = within(await card())
    const rows = shown.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent])
    expect(rows).toEqual([['Blood group', 'O+'], ['Genotype', 'AS'], ['Allergies', 'Penicillin\nShellfish'],
      ['Current medications', 'Amlodipine 5mg daily']])
    expect(shown.getByText(/Carried over from hid-1.0, last updated on/).textContent).toMatch(/They can't be changed here\.$/)
    expect(shown.queryByRole('textbox')).toBeNull()
    // Its one button opens and closes it.
    expect(shown.getAllByRole('button')).toEqual([sectionToggle('From your hid-1.0 account')])
    // The bio-data is still first.
    expect(screen.getByRole('heading', { name: 'Bio-data' })).toBeTruthy()
  })

  it('is not shown for a patient with no hid-1.0 details', async () => {
    renderPortal(<ProfilePage />, gateway(() => json(records(null))))
    expect(await screen.findByRole('heading', { name: 'Bio-data' })).toBeTruthy()
    await screen.findByText('Ada Example')
    expect(screen.queryByRole('heading', { name: 'From your hid-1.0 account' })).toBeNull()
  })

  it('is not shown when the records cannot be read, and the profile stays', async () => {
    renderPortal(<ProfilePage />, gateway(() => problem(503, 'EHR_UNAVAILABLE', 'Records are unavailable.')))
    expect(await screen.findByText('Ada Example')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'From your hid-1.0 account' })).toBeNull()
    // Counting the alerts in the sections that are closed, too.
    expect(screen.queryByRole('alert', { hidden: true })).toBeNull()
  })

  it('reads no records from hid-system main, which sends no such details', async () => {
    novu.on = false
    const { sent } = renderPortal(<ProfilePage />, gateway(() => json(records(HEALTH))))
    expect(await screen.findByText('Ada Example')).toBeTruthy()
    expect(sent[0]?.path).toBe('/identity/me')
    expect(sent.some(request => request.path.startsWith('/ehr/'))).toBe(false)
    expect(screen.queryByRole('heading', { name: 'From your hid-1.0 account' })).toBeNull()
  })
})

describe('reading the hid-1.0 health details', () => {
  it('keeps only fields with text, trimmed, and leaves out hid-1.0\'s default "Unknown" blood group', () => {
    expect(parseImportedHealthProfile({ content: { blood_group: 'Unknown', genotype: ' AA ', allergies: 7, extra: 'x' }, updatedAt: '2025-01-01' }))
      .toEqual({ content: { genotype: 'AA' }, updatedAt: '2025-01-01' })
  })

  it('is null when there is nothing to show, or the answer cannot be read', () => {
    expect(parseImportedHealthProfile(null)).toBeNull()
    expect(parseImportedHealthProfile(undefined)).toBeNull()
    expect(parseImportedHealthProfile({ content: { blood_group: 'unknown', genotype: '' }, updatedAt: '2025-01-01' })).toBeNull()
    expect(parseImportedHealthProfile({ content: 'O+' })).toBeNull()
    expect(parseImportedHealthProfile([{ content: {} }])).toBeNull()
  })

  it('has no date when the answer gives none', () => {
    expect(parseImportedHealthProfile({ content: { genotype: 'SS' } })).toEqual({ content: { genotype: 'SS' }, updatedAt: null })
  })
})
