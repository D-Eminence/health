import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CardPreview, SharedCardPage, SharedCardPreview } from '../routes/SharedCard'
import { publicSiteHref } from '../productSites'
import { createTestSessionValue, SessionContext } from '../session'
import { json, patientApi, press, problem, profile, renderPortal, type Handler } from './portalHarness'

/**
 * Sharing by card under the owner's decision 25 (2026-11-01): a shared link opens the card only after a one-time code
 * emailed to the address shared with. Health ID does not send those codes, so the page a link opens is dormant: it says
 * plainly the link can't be opened and reads nothing, so nothing can be learned or shown from a link. The patient's
 * preview of that page is off with it (HCS-03): it would show a provider page that does not exist. Behind the same
 * switch, the preview copes with production's records answer, which sends only visits and signed notes (the other
 * sections are left out, not empty), and with a read that fails (HCS-18).
 */
const TOKEN = 'k3Jx9QpLm2Vt7RwYz5NcBd8FgHs4Ae6U'

afterEach(() => { vi.restoreAllMocks() })

describe('the page a shared link opens', () => {
  for (const at of [`/card/${TOKEN}`, '/card']) {
    it(`says plainly the link can't be opened, at ${at.replace(TOKEN, ':token')}, and reads nothing`, async () => {
      const { sent } = renderPortal(<Routes>
        <Route path="/card" element={<SharedCardPage />} />
        <Route path="/card/:token" element={<SharedCardPage />} />
      </Routes>, () => problem(500, 'UNEXPECTED', 'Nothing should be read'), {}, { at })
      expect(screen.getByRole('heading', { level: 1, name: 'This link can’t be opened' })).toBeTruthy()
      expect(screen.getByRole('main')).toBeTruthy()
      expect(screen.getByText('Health ID doesn’t open records from a link like this, so nothing is shown here. If a patient '
        + 'shared their records with you, ask them to show you their Health ID card.')).toBeTruthy()
      // Health ID's own page for patients on the public site, never another organisation's.
      expect(screen.getByRole('link', { name: 'About Health ID' }).getAttribute('href')).toBe('https://healthidentitydirectory.com/patients')
      // Give any read a chance to start: none does, and the link's secret goes nowhere.
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(sent).toEqual([])
      expect(document.body.textContent).not.toContain(TOKEN)
      expect(document.title).toBe('Link can’t be opened · Health ID')
      // No card, no records, no one's name.
      expect(screen.queryByText(/records$/)).toBeNull()
      expect(screen.queryByText('Shared with you')).toBeNull()
    })
  }

  // HCS-19: no "yet" (a teaser of something not built), and the only link is the product's own public site.
  it('promises nothing to come, and links only to the Health ID public site', () => {
    renderPortal(<Routes><Route path="/card/:token" element={<SharedCardPage />} /></Routes>, () => problem(500, 'UNEXPECTED', 'unread'), {},
      { at: `/card/${TOKEN}` })
    expect(document.body.textContent).not.toMatch(/\byet\b/i)
    expect(document.title).not.toMatch(/\byet\b/i)
    const about = screen.getByRole('link', { name: 'About Health ID' })
    expect(about.getAttribute('href')).toBe('https://healthidentitydirectory.com/patients')
    expect(document.body.innerHTML).not.toContain('healthid.ng')
  })

  it('names the public site of the deployment it is on', () => {
    expect(publicSiteHref('app.healthidentitydirectory.com')).toBe('https://healthidentitydirectory.com/')
    expect(publicSiteHref('localhost')).toBe('https://healthidentitydirectory.com/')
    expect(publicSiteHref('staging.healthidentitydirectory.com')).toBe('https://www.staging.healthidentitydirectory.com/')
    expect(publicSiteHref('ehr.staging.healthidentitydirectory.com')).toBe('https://www.staging.healthidentitydirectory.com/')
  })
})

// HCS-03: the provider page the preview showed does not exist (the link is dormant), so the preview is off with it.
describe('the patient\'s preview of the provider page, while the card link is off', () => {
  it('shows no provider page: it opens Access & sharing instead, and reads nothing for it', async () => {
    const { sent } = renderPortal(<Routes>
      <Route path="/card/preview" element={<SharedCardPreview />} />
      <Route path="/access" element={<h1>Access page</h1>} />
    </Routes>, path => path === '/identity/me' ? json(profile) : problem(404, 'NOT_FOUND', path), {}, { at: '/card/preview' })
    expect(await screen.findByRole('heading', { name: 'Access page' })).toBeTruthy()
    expect(screen.queryByText(/what a provider sees/)).toBeNull()
    expect(screen.queryByText('Until ended')).toBeNull()
    expect(sent.filter(item => item.path === '/ehr/me/records')).toEqual([])
  })
})

describe('the patient\'s preview of their card, once the card link opens', () => {
  /** Production's records answer (Novu, patient-records.service.ts): visits and signed notes only. */
  const productionRecords = {
    encounters: [{ id: 'enc-1', facilityId: 'fac-1', encounterType: 'outpatient', status: 'completed', startedAt: '2026-10-20T09:00:00.000Z', endedAt: null }],
    notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'fac-1', noteType: 'progress', title: 'Follow-up visit', status: 'signed', revisionNo: 1,
      content: 'Blood pressure better on the new dose.', signedAt: '2026-10-20T10:00:00.000Z' }],
    importedRecords: [], importedHealthProfile: null, limit: 50,
  }

  function preview(records: unknown) {
    return renderPortal(<Routes><Route path="/card/preview" element={<CardPreview />} /></Routes>, path => {
      if (path === '/identity/me') return json(profile)
      if (path === '/ehr/me/records') return json(records)
      return problem(404, 'NOT_FOUND', `Cannot GET ${path}`)
    }, {}, { at: '/card/preview' })
  }

  it('shows the visits and notes production sends, without the sections it leaves out', async () => {
    preview(productionRecords)
    expect(await screen.findByRole('heading', { name: 'Visits' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Clinical notes' })).toBeTruthy()
    expect(screen.getByText('Follow-up visit')).toBeTruthy()
    expect(screen.getByText('Blood pressure better on the new dose.')).toBeTruthy()
    for (const missing of ['Diagnoses', 'Medicines', 'Lab tests', 'Vitals', 'Documents']) {
      expect(screen.queryByRole('heading', { name: missing })).toBeNull()
    }
  })

  it('names the tab for what it is, as every patient page does', async () => {
    preview(productionRecords)
    expect(await screen.findByRole('heading', { name: 'Visits' })).toBeTruthy()
    expect(document.title).toBe('Preview of your card · Health ID')
  })

  it('says there are no records yet when production sends none', async () => {
    preview({ encounters: [], notes: [], limit: 50 })
    expect(await screen.findByText('No records yet')).toBeTruthy()
  })

  it('reads a section that comes malformed as empty', async () => {
    preview({ ...productionRecords, diagnoses: null, prescriptions: { items: [] } })
    expect(await screen.findByRole('heading', { name: 'Visits' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Diagnoses' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Medicines' })).toBeNull()
  })

  /** The preview with the share just made, as the done step's link will pass it. */
  function previewOf(share: unknown, handler: Handler) {
    const { api, sent } = patientApi(handler)
    render(<MemoryRouter initialEntries={[{ pathname: '/card/preview', state: share }]}>
      <SessionContext.Provider value={createTestSessionValue({ kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1' }, api)}>
        <Routes><Route path="/card/preview" element={<CardPreview />} /></Routes>
      </SessionContext.Provider></MemoryRouter>)
    return { sent }
  }
  /** A read that fails, and is not one the client tries again by itself. */
  const failure = () => json({ type: 'about:blank', title: 'Unavailable', status: 503, code: 'UPSTREAM_UNAVAILABLE',
    detail: 'This information is unavailable right now.', retryable: false }, 503)
  const served: Handler = path => path === '/identity/me' ? json(profile) : path === '/ehr/me/records' ? json(productionRecords) : problem(404, 'NOT_FOUND', path)

  // HCS-03: what it printed was always "View only" and "Until ended", whatever the share was.
  it('prints the share just made: what they can do and until when', async () => {
    previewOf({ level: 'clinical_review', expiresAt: '2026-11-10T12:00:00.000Z' }, served)
    await screen.findByRole('heading', { name: 'Visits' })
    expect(screen.getByText('Clinical Review')).toBeTruthy()
    expect(screen.getByText('10 Nov 2026')).toBeTruthy()
    expect(screen.queryByText('View Only')).toBeNull()
    expect(screen.queryByText('Until ended')).toBeNull()
  })

  it('makes up no level or end date when it is not given the share', async () => {
    previewOf(null, served)
    await screen.findByRole('heading', { name: 'Visits' })
    expect(screen.queryByText('View Only')).toBeNull()
    expect(screen.queryByText('Until ended')).toBeNull()
    expect(screen.queryByText('Access')).toBeNull()
  })

  // HCS-18: a failed read showed "Loading your card…" for ever, with no way on.
  it('says the card could not be loaded, with Try again and a way back, and shows it once it loads', async () => {
    let failed = true
    const { sent } = previewOf(null, path => path === '/identity/me' ? failed ? failure() : json(profile) : served(path, 'GET', null))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load your card')
    expect(screen.queryByText('Loading your card…')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to Access & sharing' }).getAttribute('href')).toBe('/access')
    failed = false
    await press(screen.getByRole('button', { name: /^Try again/ }))
    expect(await screen.findByRole('heading', { name: 'Ada Example’s records' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ada Example’s records' })))
    expect(sent.filter(item => item.path === '/identity/me').length).toBe(2)
  })

  it('says the records could not be loaded, with Try again, rather than loading for ever', async () => {
    let failed = true
    previewOf(null, path => path === '/ehr/me/records' && failed ? failure() : served(path, 'GET', null))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load your records')
    expect(screen.queryByText('Loading records…')).toBeNull()
    failed = false
    await act(async () => { await press(screen.getByRole('button', { name: /^Try again/ })) })
    expect(await screen.findByRole('heading', { name: 'Visits' })).toBeTruthy()
  })
})
