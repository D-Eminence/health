import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { AccessRequest } from '../api'
import { AccessPage } from '../routes/Portal'
import {
  accessLevelLabel, consultationLabel, dayLabel, fileSizeLabel, fileTypeLabel, patientAccessStatusLabel, scanStatusLabel, visitClassLabel,
  visitStatusLabel,
} from '../plainLabels'
import { json, press, renderPortal } from './portalHarness'

/**
 * Owner, 2 November: the demo video showed raw words on real screens ("Write · until …", "Consultation 7ce24bd5",
 * "image/jpeg · 56 KiB", "ambulatory · started … · in progress"). Patient and facility screens say them in plain words,
 * and a value not known here gets a plain fallback, never the value itself.
 */
describe('plain labels', () => {
  it('says what a facility may do, never the permission word', () => {
    expect(accessLevelLabel('write')).toBe('Can view and add records')
    expect(accessLevelLabel('Write')).toBe('Can view and add records')
    expect(accessLevelLabel('write_records')).toBe('Can view and add records')
    expect(accessLevelLabel('read')).toBe('Can view records')
    expect(accessLevelLabel('read_records')).toBe('Can view records')
    expect(accessLevelLabel('break_glass')).toBe('Emergency access')
    expect(accessLevelLabel('admin_override')).toBe('Access to records')
    expect(accessLevelLabel(null)).toBe('Access to records')
  })

  it('names a consultation by its day, never by its id', () => {
    const now = new Date(2026, 10, 2, 10, 0)
    expect(consultationLabel({ startedAt: new Date(2026, 10, 2, 8, 30).toISOString() }, now)).toBe('Consultation · today')
    expect(consultationLabel({ startedAt: new Date(2026, 10, 1, 8, 30).toISOString() }, now)).toBe('Consultation · yesterday')
    expect(consultationLabel({ startedAt: new Date(2026, 8, 21, 9, 0).toISOString() }, now)).toMatch(/^Consultation · 21 Sept?$/)
    expect(consultationLabel({ startedAt: new Date(2025, 8, 21, 9, 0).toISOString() }, now)).toMatch(/^Consultation · 21 Sept? 2025$/)
    expect(consultationLabel({ startedAt: 'not a date' }, now)).toBe('Consultation')
    expect(dayLabel('2026-11-02', now)).toBe('today')
  })

  it('names the kind of visit and where it is in plain words', () => {
    expect(visitClassLabel('ambulatory')).toBe('Outpatient visit')
    expect(visitClassLabel('AMB')).toBe('Outpatient visit')
    expect(visitClassLabel('emergency')).toBe('Emergency visit')
    expect(visitClassLabel('inpatient')).toBe('Inpatient stay')
    expect(visitClassLabel('IMP')).toBe('Inpatient stay')
    expect(visitClassLabel('home')).toBe('Home visit')
    expect(visitClassLabel('virtual')).toBe('Virtual visit')
    expect(visitClassLabel('VR')).toBe('Virtual visit')
    expect(visitClassLabel('psychiatric_x')).toBe('Visit')
    expect(visitStatusLabel('in_progress')).toBe('In progress')
    expect(visitStatusLabel('finished')).toBe('Finished')
    expect(visitStatusLabel('completed')).toBe('Finished')
    expect(visitStatusLabel('weird_state')).toBe('Status not known')
  })

  it('names a file’s type and size, never the media type', () => {
    expect(`${fileTypeLabel('image/jpeg')} · ${fileSizeLabel(56 * 1024)}`).toBe('JPEG image · 56 KB')
    expect(fileTypeLabel('image/png')).toBe('PNG image')
    expect(fileTypeLabel('application/pdf')).toBe('PDF document')
    expect(fileTypeLabel('image/tiff')).toBe('TIFF image')
    expect(fileTypeLabel('application/x-msdownload')).toBe('File')
    expect(fileTypeLabel(null)).toBe('File')
    expect(fileSizeLabel('57344')).toBe('56 KB')
    expect(fileSizeLabel(0)).toBe('0 KB')
    expect(fileSizeLabel(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(fileSizeLabel(null)).toBe('Size unknown')
  })

  it('says a virus check in words, or nothing', () => {
    expect(scanStatusLabel('pending')).toBe('Being checked for viruses')
    expect(scanStatusLabel('infected')).toBe('Blocked: virus found')
    expect(scanStatusLabel('failed')).toBe('Couldn’t be checked')
    expect(scanStatusLabel('mystery_state')).toBe('')
  })
})

const grant = (id: string, scope: string, facilityName: string) => ({
  consentGrantId: id, scope, purpose: 'direct-care', status: 'active', startsAt: '2026-10-08T09:00:00Z', expiresAt: '2026-12-09T10:00:00Z',
  reason: null, facilityName, breakGlass: false, patientRevocable: true,
})
const request = (scope: string): AccessRequest => ({
  accessRequestId: '70000000-0000-4000-8000-000000000001', facilityId: 'facility-1', facilityName: 'Ikeja Clinic', scope,
  reason: 'Follow-up', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-08T09:00:00Z', approvedAt: null,
  deniedAt: null, deniedReason: null,
})

describe('the patient’s Access page', () => {
  it('says what each facility can do with the records, in plain words', async () => {
    renderPortal(<AccessPage />, path => path === '/identity/me/access-requests' ? json([request('write')]) : json({ items: [
      grant('60000000-0000-4000-8000-000000000001', 'write', 'Lagos General'),
      grant('60000000-0000-4000-8000-000000000002', 'read', 'Ikeja Clinic'),
      grant('60000000-0000-4000-8000-000000000003', 'admin_override', 'Kano Hospital'),
    ] }))
    await screen.findAllByText('Ikeja Clinic')
    await press(screen.getByRole('button', { name: / Review the request from Ikeja Clinic/ }))
    expect(screen.getByText('Access asked for').nextElementSibling?.textContent).toBe('Can view and add records')
    expect(screen.getAllByRole('button', { name: /^Approve the request from Ikeja Clinic, Can view and add records, / })).toHaveLength(1)

    await press(screen.getByRole('button', { name: /^Who has access/ }))
    // Each access sits under its facility's heading; what it allows is a line of its own, above when it runs.
    const access = (facility: string) => within(screen.getByRole('heading', { level: 3, name: facility }).parentElement!
      .nextElementSibling as HTMLElement).getByRole('listitem')
    expect(within(access('Lagos General')).getByText('Can view and add records')).toBeTruthy()
    expect(within(access('Ikeja Clinic')).getByText('Can view records')).toBeTruthy()
    expect(within(access('Kano Hospital')).getByText('Access to records')).toBeTruthy()
    expect(screen.queryByText(/^Write\b/)).toBeNull()
    expect(screen.queryByText(/^Read\b/)).toBeNull()
    expect(screen.queryByText(/admin.override/i)).toBeNull()
    expect(screen.getAllByRole('button', { name: /^End access for Lagos General, Can view and add records, / })).toHaveLength(1)

  })
})

describe('access status for the patient', () => {
  it('says the owner’s words, case aside, and a plain word for anything else', () => {
    expect(['Revoked', 'denied', 'EXPIRED', 'active', 'pending'].map(patientAccessStatusLabel))
      .toEqual(['Ended', 'You said no', 'Time ran out', 'Active', 'Waiting for you'])
    expect(patientAccessStatusLabel('superseded_by_admin')).toBe('Closed')
    expect(patientAccessStatusLabel(null)).toBe('Closed')
  })
})
