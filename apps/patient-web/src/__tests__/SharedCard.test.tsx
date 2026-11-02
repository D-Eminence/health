import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { SharedCardPage, SharedCardPreview } from '../routes/SharedCard'
import { json, problem, profile, renderPortal } from './portalHarness'

/**
 * Sharing by card under the owner's decision 25 (2026-11-01): a shared link opens the card only after a one-time code
 * emailed to the address shared with. Until Health ID sends those codes, the page a link opens is dormant: it says this
 * isn't available yet and reads nothing, so nothing can be learned or shown from a link. The patient's own preview of the
 * card stays, and copes with production's records answer, which sends only visits and signed notes (the other sections
 * are left out, not empty).
 */
const TOKEN = 'k3Jx9QpLm2Vt7RwYz5NcBd8FgHs4Ae6U'

afterEach(() => { vi.restoreAllMocks() })

describe('the page a shared link opens', () => {
  for (const at of [`/card/${TOKEN}`, '/card']) {
    it(`says plainly it isn't available yet, at ${at.replace(TOKEN, ':token')}, and reads nothing`, async () => {
      const { sent } = renderPortal(<Routes>
        <Route path="/card" element={<SharedCardPage />} />
        <Route path="/card/:token" element={<SharedCardPage />} />
      </Routes>, () => problem(500, 'UNEXPECTED', 'Nothing should be read'), {}, { at })
      expect(screen.getByRole('heading', { level: 1, name: 'This isn’t available yet' })).toBeTruthy()
      expect(screen.getByRole('main')).toBeTruthy()
      expect(screen.getByText('Opening a shared Health ID card from a link isn’t available yet. No health information is shown here.')).toBeTruthy()
      // Give any read a chance to start: none does, and the link's secret goes nowhere.
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(sent).toEqual([])
      expect(document.body.textContent).not.toContain(TOKEN)
      expect(document.title).toBe('Not available yet · Health ID')
      // No card, no records, no one's name.
      expect(screen.queryByText(/records$/)).toBeNull()
      expect(screen.queryByText('Shared with you')).toBeNull()
    })
  }
})

describe('the patient\'s preview of their card', () => {
  /** Production's records answer (Novu, patient-records.service.ts): visits and signed notes only. */
  const productionRecords = {
    encounters: [{ id: 'enc-1', facilityId: 'fac-1', encounterType: 'outpatient', status: 'completed', startedAt: '2026-10-20T09:00:00.000Z', endedAt: null }],
    notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'fac-1', noteType: 'progress', title: 'Follow-up visit', status: 'signed', revisionNo: 1,
      content: 'Blood pressure better on the new dose.', signedAt: '2026-10-20T10:00:00.000Z' }],
    importedRecords: [], importedHealthProfile: null, limit: 50,
  }

  function preview(records: unknown) {
    return renderPortal(<Routes><Route path="/card/preview" element={<SharedCardPreview />} /></Routes>, path => {
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
})
