import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { HealthChecks, leaveHealthChecks, SCREENING_CLASH, SCREENING_MERGED, SCREENING_RELOAD_OFFLINE, SCREENING_INCOMPLETE, SCREENING_INVALID, SCREENING_KEPT, SCREENING_NOT_FOUND, SCREENING_OFFLINE,
  SCREENING_REDACTED, SCREENING_RELOADED } from '../../../../ehr-blue/departments/outreach/HealthChecks'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { memoryQueueStore, setOutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { REGISTRATION_NOTICE_VERSION, registrationNotice, registrationNotice20261101 } from '../../../../outreachTerms'

/*
 * "Health checks" on a registration (outreach-api 0118): hidden while Outreach does not serve the route, the whole
 * screening saved with a key per save attempt and If-Match after the first save, every refusal in plain words, nothing
 * typed lost without signal. With the registration's area and the list's "Health checks recorded". Fictional data only.
 */

const GROUP_ID = '0e7c0000-0000-4000-8000-000000000001'
const CASE_ID = 'case-1'
const session = vi.hoisted(() => ({ permissions: ['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write'] }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(session.permissions,
      { id: '0e7c0000-0000-4000-8000-000000000001', name: 'Ajegunle Health Volunteers', roles: ['outreach_volunteer'] })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachCasesPage: vi.fn(), createOutreachCase: vi.fn(),
  linkExistingOutreachCase: vi.fn(), outreachCampaignGovernance: vi.fn(), outreachCampaignStaff: vi.fn(),
  outreachInvitations: vi.fn(), createOutreachInvitation: vi.fn(), outreachScreening: vi.fn(), saveOutreachScreening: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const CAMPAIGN = { id: 'campaign-1', name: 'Ajegunle health week', status: 'active', services: ['registration'], startsAt: '2026-11-01T00:00:00.000Z', rowVersion: 2 }
const pending = (id: string, extra: Record<string, unknown> = {}) => ({ id, campaignId: 'campaign-1', status: 'identity_resolution_pending',
  fullName: 'Kemi Balogun', ageYears: 30, sex: 'female', temporaryPatientId: `tmp_${id}`, createdAt: '2026-11-14T09:00:00.000Z', rowVersion: 1, ...extra })

const NULLS = {
  bpSystolic: null, bpDiastolic: null, pulseBpm: null, temperatureC: null, weightKg: null, heightCm: null, glucoseValue: null,
  glucoseUnit: null, glucoseTiming: null, malariaRdt: null, hearingLeft: null, hearingRight: null, mainComplaint: null,
  seenByClinician: null, clinicianName: null, outcome: null, medicinesGiven: null, referred: null, referredTo: null,
}
const saved = (version: number, values: Record<string, unknown>) => ({ ...NULLS, ...values, caseId: CASE_ID, version,
  recordedAt: '2026-11-14T09:30:00.000Z', recordedByMembershipId: 'membership-demo-1', updatedAt: '2026-11-14T09:30:00.000Z' })

beforeEach(() => {
  // The list's first read (hid-system#247) is today's request; an Outreach before paging answers it with no cursor.
  api.outreachCasesPage.mockImplementation(async (facilityId: string) => ({ items: await api.outreachCases(facilityId), nextCursor: null }))
  vi.clearAllMocks()
  session.permissions = ['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write']
  setOutreachQueueStore(memoryQueueStore())
  api.outreachCampaigns.mockResolvedValue([CAMPAIGN])
  api.outreachCases.mockResolvedValue([])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins', organiserStatus: 'unverified' })
  api.outreachCampaignMembers.mockResolvedValue([{ id: 'm-1', campaignId: 'campaign-1', membershipId: 'membership-demo-1', role: 'member', createdAt: '2026-11-01T00:00:00.000Z' }])
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'member', people: [] })
  api.outreachInvitations.mockResolvedValue({ members: [], invitations: [] })
  api.outreachScreening.mockResolvedValue({ screening: null })
  sessionStorage.clear()
  localStorage.clear()
})

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}

function renderChecks(canWrite = true) {
  return renderDept(<HealthChecks facilityId={GROUP_ID} caseId={CASE_ID} canWrite={canWrite} />)
}

const region = () => screen.getByRole('region', { name: 'Health checks' })
const box = (name: RegExp | string) => within(region()).getByRole('textbox', { name }) as HTMLInputElement
const type = (name: RegExp | string, value: string) => fireEvent.change(box(name), { target: { value } })
const choose = (name: RegExp | string, value: string) =>
  fireEvent.change(within(region()).getByRole('combobox', { name }), { target: { value } })
const saveButton = () => within(region()).getByRole('button', { name: 'Save health checks' })

describe('Health checks', () => {
  it.each(['NOT_FOUND', 'API_ROUTE_NOT_FOUND'])('is not shown while Outreach does not serve the route (404 %s)', async code => {
    api.outreachScreening.mockRejectedValue(new HidApiError(404, 'x', { code }))
    renderChecks()
    await waitFor(() => expect(api.outreachScreening).toHaveBeenCalledWith(GROUP_ID, CASE_ID, expect.anything()))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Health checks' })).toBeNull())
  })

  it('is on the case view after a registration is saved, with its groups', async () => {
    api.createOutreachCase.mockResolvedValue(pending(CASE_ID))
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: 'New registration' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: 'Kemi Balogun' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: '30' } })
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    expect(await screen.findByText('Registration saved')).toBeTruthy()
    await within(region()).findByRole('button', { name: 'Save health checks' })
    for (const group of ['Vital signs', 'Blood sugar', 'Malaria test', 'Hearing', 'Consultation', 'Medicines given', 'Referral']) {
      expect(within(region()).getByRole('group', { name: group })).toBeTruthy()
    }
  })

  it('saves the whole screening the first time with a new key and no version, then with its version', async () => {
    api.saveOutreachScreening.mockResolvedValueOnce({ screening: saved(1, { bpSystolic: 128, bpDiastolic: 84, weightKg: 70, heightCm: 170,
      glucoseValue: 6.1, glucoseUnit: 'mmol/L', glucoseTiming: 'random', malariaRdt: 'negative', medicinesGiven: [{ name: 'Paracetamol', dose: '500 mg' }] }) })
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    const systolic = box(/Blood pressure, top number/)
    expect(systolic.inputMode).toBe('numeric')
    expect(box(/^Temperature/).inputMode).toBe('decimal')
    type(/Blood pressure, top number/, '128')
    type(/Blood pressure, bottom number/, '84')
    type(/^Weight/, '70')
    type(/^Height/, '170')
    expect(within(region()).getByText(/BMI about/).textContent).toContain('24.2')
    type(/^Reading/, '6.1')
    choose(/^Unit/, 'mmol/L')
    choose(/Fasting or random/, 'random')
    choose(/Malaria rapid test/, 'negative')
    await press(within(region()).getByRole('button', { name: 'Add a medicine' }))
    type(/^Medicine 1/, 'Paracetamol')
    type(/Dose of medicine 1/, '500 mg')
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(1))
    const [facility, caseId, body, write] = api.saveOutreachScreening.mock.calls[0]!
    expect([facility, caseId]).toEqual([GROUP_ID, CASE_ID])
    expect(body).toEqual({ ...NULLS, bpSystolic: 128, bpDiastolic: 84, weightKg: 70, heightCm: 170, glucoseValue: 6.1, glucoseUnit: 'mmol/L',
      glucoseTiming: 'random', malariaRdt: 'negative', medicinesGiven: [{ name: 'Paracetamol', dose: '500 mg' }] })
    expect(write.version).toBeUndefined()
    expect(write.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(await within(region()).findByText('Health checks saved.')).toBeTruthy()

    api.saveOutreachScreening.mockResolvedValueOnce({ screening: saved(2, { bpSystolic: 130, bpDiastolic: 84 }) })
    type(/Blood pressure, top number/, '130')
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(2))
    const second = api.saveOutreachScreening.mock.calls[1]![3]
    expect(second.version).toBe(1)
    expect(second.idempotencyKey).not.toBe(write.idempotencyKey)
  })

  it('fills the form from a saved screening, and says when it was saved', async () => {
    api.outreachScreening.mockResolvedValue({ screening: saved(3, { temperatureC: 37.4, seenByClinician: true, clinicianName: 'Dr Demo', referred: true,
      referredTo: 'General Hospital', medicinesGiven: [{ name: 'ACT', dose: null }] }) })
    renderChecks()
    await waitFor(() => expect(box(/^Temperature/).value).toBe('37.4'))
    expect(box(/Clinician’s name/).value).toBe('Dr Demo')
    expect(box(/Referred to/).value).toBe('General Hospital')
    expect(box(/^Medicine 1/).value).toBe('ACT')
    expect(region().textContent).toContain('Last saved')
  })

  it('checks every field before sending anything, focus on the first refused', async () => {
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    await press(saveButton())
    expect(within(region()).getByText('Enter at least one health check before saving.')).toBeTruthy()
    type(/Blood pressure, top number/, '120')
    type(/^Temperature/, '36.55')
    type(/^Reading/, '5')
    await press(saveButton())
    expect(within(region()).getByText('Enter both blood pressure numbers, or neither.')).toBeTruthy()
    expect(within(region()).getByText('Enter a temperature from 30.0 to 45.0 °C, with one decimal place at most.')).toBeTruthy()
    expect(within(region()).getByText('Choose the unit of the blood sugar reading.')).toBeTruthy()
    expect(within(region()).getByText('Choose fasting or random.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(box(/Blood pressure, bottom number/)))
    expect(api.saveOutreachScreening).not.toHaveBeenCalled()
  })

  it('shows the clinician’s name only when seen, and where to only when referred', async () => {
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    expect(within(region()).queryByRole('textbox', { name: /Clinician’s name/ })).toBeNull()
    expect(within(region()).queryByRole('textbox', { name: /Referred to/ })).toBeNull()
    choose(/Seen by a clinician/, 'yes')
    choose(/^Referred$/, 'yes')
    expect(box(/Clinician’s name/)).toBeTruthy()
    expect(box(/Referred to/)).toBeTruthy()
  })

  it('adds and removes medicines, up to 10', async () => {
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    for (let index = 0; index < 10; index += 1) await press(within(region()).getByRole('button', { name: 'Add a medicine' }))
    expect(within(region()).queryByRole('button', { name: 'Add a medicine' })).toBeNull()
    expect(within(region()).getByText('Up to 10 medicines.')).toBeTruthy()
    await press(within(region()).getByRole('button', { name: 'Remove medicine 3' }))
    expect(within(within(region()).getByRole('list', { name: 'Medicines given' })).getAllByRole('listitem')).toHaveLength(9)
  })

  it('without signal, says so, keeps everything typed, and sends the same key when saved again', async () => {
    api.saveOutreachScreening.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ screening: saved(1, { pulseBpm: 80 }) })
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Pulse/, '80')
    await press(saveButton())
    expect(await within(region()).findByText(SCREENING_OFFLINE)).toBeTruthy()
    expect(SCREENING_OFFLINE).toContain('Save again when you have signal.')
    expect(box(/^Pulse/).value).toBe('80')
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(2))
    expect(api.saveOutreachScreening.mock.calls[1]![3].idempotencyKey).toBe(api.saveOutreachScreening.mock.calls[0]![3].idempotencyKey)
    expect(await within(region()).findByText('Health checks saved.')).toBeTruthy()
  })

  it.each([[412, 'VERSION_CONFLICT'], [409, 'OUTREACH_SCREENING_EXISTS'], [428, 'IF_MATCH_REQUIRED']])(
    'on %s %s sends nothing over the other save, keeps the typing, and reloads only when asked', async (status, code) => {
      api.outreachScreening.mockResolvedValueOnce({ screening: saved(1, { pulseBpm: 70, malariaRdt: 'negative' }) })
        .mockResolvedValueOnce({ screening: saved(2, { pulseBpm: 90, malariaRdt: 'positive' }) })
      api.saveOutreachScreening.mockRejectedValueOnce(new HidApiError(status, 'x', { code }))
        .mockResolvedValueOnce({ screening: saved(3, { pulseBpm: 95, malariaRdt: 'positive' }) })
      renderChecks()
      await waitFor(() => expect(box(/^Pulse/).value).toBe('70'))
      type(/^Pulse/, '75')
      await press(saveButton())
      expect(await within(region()).findByText(SCREENING_RELOADED)).toBeTruthy()
      expect(SCREENING_RELOADED).toBe('Someone else saved checks for this person while you were typing. Press Show their checks: your typing stays.')
      // Every field is sent back, so one station never erases another's entries.
      expect(api.saveOutreachScreening.mock.calls[0]![2]).toEqual({ ...NULLS, pulseBpm: 75, malariaRdt: 'negative' })
      expect(api.saveOutreachScreening.mock.calls[0]![3].version).toBe(1)
      expect(box(/^Pulse/).value).toBe('75')
      expect(api.saveOutreachScreening).toHaveBeenCalledTimes(1)
      await press(within(region()).getByRole('button', { name: 'Show their checks' }))
      // Their checks are read; this volunteer's own change (the pulse) is kept on top, marked, and nothing typed is lost.
      expect(await within(region()).findByText(SCREENING_MERGED)).toBeTruthy()
      expect(box(/^Pulse/).value).toBe('75')
      expect(within(region()).queryByText(SCREENING_RELOADED)).toBeNull()
      await press(saveButton())
      await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(2))
      // Their malaria result is kept, with this volunteer's pulse, on their version.
      expect(api.saveOutreachScreening.mock.calls[1]![2]).toEqual({ ...NULLS, pulseBpm: 75, malariaRdt: 'positive' })
      expect(api.saveOutreachScreening.mock.calls[1]![3].version).toBe(2)
      expect(api.saveOutreachScreening.mock.calls[1]![3].idempotencyKey).not.toBe(api.saveOutreachScreening.mock.calls[0]![3].idempotencyKey)
    })

  it('after a clash, a failed read of their checks keeps the typing and the way to try again', async () => {
    api.outreachScreening.mockResolvedValueOnce({ screening: saved(1, { pulseBpm: 70, malariaRdt: 'negative' }) })
      .mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ screening: saved(2, { pulseBpm: 90, malariaRdt: 'positive' }) })
    api.saveOutreachScreening.mockRejectedValueOnce(new HidApiError(412, 'x', { code: 'VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ screening: saved(3, { pulseBpm: 75, malariaRdt: 'positive' }) })
    renderChecks()
    await waitFor(() => expect(box(/^Pulse/).value).toBe('70'))
    type(/^Pulse/, '75')
    await press(saveButton())
    expect(await within(region()).findByText(SCREENING_RELOADED)).toBeTruthy()
    await press(within(region()).getByRole('button', { name: 'Show their checks' }))
    expect(await within(region()).findByText(SCREENING_RELOAD_OFFLINE)).toBeTruthy()
    // Nothing replaced: the typing and the form are still here, and leaving still asks.
    expect(box(/^Pulse/).value).toBe('75')
    expect(saveButton()).toBeTruthy()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    expect(leaveHealthChecks()).toBe(false)
    confirm.mockRestore()
    // With signal again, their checks come in under the typing.
    await press(within(region()).getByRole('button', { name: 'Show their checks' }))
    expect(await within(region()).findByText(SCREENING_MERGED)).toBeTruthy()
    expect(box(/^Pulse/).value).toBe('75')
    expect((within(region()).getByRole('combobox', { name: /Malaria rapid test/ }) as HTMLSelectElement).value).toBe('positive')
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(2))
    expect(api.saveOutreachScreening.mock.calls[1]![2]).toEqual({ ...NULLS, pulseBpm: 75, malariaRdt: 'positive' })
    expect(api.saveOutreachScreening.mock.calls[1]![3].version).toBe(2)
  })

  it('after a clash, keeps the other station’s medicines: this station saved a medicine earlier, then only typed a pulse', async () => {
    const paracetamol = { name: 'Paracetamol', dose: '1 g' }
    const antimalarial = { name: 'Artemether-lumefantrine', dose: '4 tablets twice a day' }
    api.outreachScreening.mockResolvedValueOnce({ screening: null })
      .mockResolvedValueOnce({ screening: saved(2, { medicinesGiven: [paracetamol, antimalarial] }) })
    api.saveOutreachScreening.mockResolvedValueOnce({ screening: saved(1, { medicinesGiven: [paracetamol] }) })
      .mockRejectedValueOnce(new HidApiError(412, 'x', { code: 'VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ screening: saved(3, { pulseBpm: 88, medicinesGiven: [paracetamol, antimalarial] }) })
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    await press(within(region()).getByRole('button', { name: 'Add a medicine' }))
    type(/^Medicine 1/, 'Paracetamol')
    type(/^Dose of medicine 1/, '1 g')
    await press(saveButton())
    expect(await within(region()).findByText('Health checks saved.')).toBeTruthy()
    // Meanwhile another station adds an antimalarial (version 2). This station types a pulse only.
    type(/^Pulse/, '88')
    await press(saveButton())
    expect(await within(region()).findByText(SCREENING_RELOADED)).toBeTruthy()
    await press(within(region()).getByRole('button', { name: 'Show their checks' }))
    await waitFor(() => expect(box(/^Medicine 2/).value).toBe('Artemether-lumefantrine'))
    expect(box(/^Pulse/).value).toBe('88')
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(3))
    expect(api.saveOutreachScreening.mock.calls[2]![2]).toEqual({ ...NULLS, pulseBpm: 88, medicinesGiven: [paracetamol, antimalarial] })
  })

  it('after a clash, keeps the medicines both stations added', async () => {
    const paracetamol = { name: 'Paracetamol', dose: '1 g' }
    api.outreachScreening.mockResolvedValueOnce({ screening: saved(1, { medicinesGiven: [paracetamol] }) })
      .mockResolvedValueOnce({ screening: saved(2, { medicinesGiven: [paracetamol, { name: 'Artemether-lumefantrine', dose: null }] }) })
    api.saveOutreachScreening.mockRejectedValueOnce(new HidApiError(412, 'x', { code: 'VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ screening: saved(3, {}) })
    renderChecks()
    await waitFor(() => expect(box(/^Medicine 1/).value).toBe('Paracetamol'))
    await press(within(region()).getByRole('button', { name: 'Add a medicine' }))
    type(/^Medicine 2/, 'ORS')
    await press(saveButton())
    expect(await within(region()).findByText(SCREENING_RELOADED)).toBeTruthy()
    await press(within(region()).getByRole('button', { name: 'Show their checks' }))
    await waitFor(() => expect(box(/^Medicine 3/).value).toBe('ORS'))
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(2))
    expect(api.saveOutreachScreening.mock.calls[1]![2].medicinesGiven).toEqual([paracetamol, { name: 'Artemether-lumefantrine', dose: null }, { name: 'ORS', dose: null }])
  })

  it('a case with a saved medicine is not “not saved”: after loading it, and after saving', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      api.outreachScreening.mockResolvedValueOnce({ screening: saved(1, { medicinesGiven: [{ name: 'Paracetamol', dose: '1 g' }] }) })
      renderChecks()
      await waitFor(() => expect(box(/^Medicine 1/).value).toBe('Paracetamol'))
      expect(leaveHealthChecks()).toBe(true)
      type(/^Pulse/, '72')
      api.saveOutreachScreening.mockResolvedValueOnce({ screening: saved(2, { pulseBpm: 72, medicinesGiven: [{ name: 'Paracetamol', dose: '1 g' }] }) })
      await press(saveButton())
      expect(await within(region()).findByText('Health checks saved.')).toBeTruthy()
      await act(async () => { await Promise.resolve() })
      expect(leaveHealthChecks()).toBe(true)
      expect(confirm).not.toHaveBeenCalled()
    } finally {
      confirm.mockRestore()
    }
  })

  it('after a save whose answer was lost, checks what Outreach holds before saving again (no false conflict)', async () => {
    api.outreachScreening.mockResolvedValueOnce({ screening: saved(1, { pulseBpm: 70 }) })
      .mockResolvedValueOnce({ screening: saved(2, { pulseBpm: 75 }) })
    api.saveOutreachScreening.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ screening: saved(3, { pulseBpm: 75, temperatureC: 37.2 }) })
    renderChecks()
    await waitFor(() => expect(box(/^Pulse/).value).toBe('70'))
    type(/^Pulse/, '75')
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(1))
    // The first save did land (version 2 holds pulse 75): the next one goes on version 2, not as a conflict on 1.
    type(/^Temperature/, '37.2')
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(2))
    expect(api.saveOutreachScreening.mock.calls[1]![3].version).toBe(2)
    expect(within(region()).queryByText(SCREENING_RELOADED)).toBeNull()
  })

  it('saves nothing when only a unit or timing is chosen', async () => {
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    const unit = within(region()).getByRole('combobox', { name: /unit/i }) as HTMLSelectElement
    fireEvent.change(unit, { target: { value: unit.options[1]!.value } })
    await press(saveButton())
    expect(api.saveOutreachScreening).not.toHaveBeenCalled()
  })

  it('rounds a height to whole centimetres as the field is left', async () => {
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Height/, '165.6')
    fireEvent.blur(box(/^Height/))
    expect(box(/^Height/).value).toBe('166')
    expect(region().textContent).toContain('Whole centimetres')
  })

  it('marks the field a 422 OUTREACH_SCREENING_OUT_OF_RANGE names', async () => {
    api.saveOutreachScreening.mockRejectedValue(new HidApiError(422, 'x', { code: 'OUTREACH_SCREENING_OUT_OF_RANGE', detail: 'heightCm is out of range' }))
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Height/, '170')
    await press(saveButton())
    expect(await within(region()).findByText('Height is outside what Health ID accepts. Check it and try again.')).toBeTruthy()
    expect(box(/^Height/).getAttribute('aria-invalid')).toBe('true')
  })

  it.each([
    [422, 'OUTREACH_SCREENING_OUT_OF_RANGE', 'A value is outside what Health ID accepts. Check the numbers and try again.'],
    [422, 'OUTREACH_SCREENING_INCOMPLETE', SCREENING_INCOMPLETE],
    [400, 'VALIDATION_FAILED', SCREENING_INVALID],
    [409, 'IDEMPOTENCY_CONFLICT', SCREENING_CLASH],
    [404, 'OUTREACH_REGISTRATION_NOT_FOUND', SCREENING_NOT_FOUND],
  ])('says %s %s in plain words', async (status, code, words) => {
    api.saveOutreachScreening.mockRejectedValue(new HidApiError(status, 'x', { code }))
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Pulse/, '80')
    await press(saveButton())
    expect(await within(region()).findByText(words)).toBeTruthy()
    expect(box(/^Pulse/).value).toBe('80')
  })

  it('a new key after 409 IDEMPOTENCY_CONFLICT', async () => {
    api.saveOutreachScreening.mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'IDEMPOTENCY_CONFLICT' }))
      .mockResolvedValueOnce({ screening: saved(1, { pulseBpm: 80 }) })
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Pulse/, '80')
    await press(saveButton())
    await within(region()).findByText(SCREENING_CLASH)
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(2))
    expect(api.saveOutreachScreening.mock.calls[1]![3].idempotencyKey).not.toBe(api.saveOutreachScreening.mock.calls[0]![3].idempotencyKey)
  })

  it('says the details were deleted (409 OUTREACH_REGISTRATION_REDACTED), and offers no save', async () => {
    api.saveOutreachScreening.mockRejectedValue(new HidApiError(409, 'x', { code: 'OUTREACH_REGISTRATION_REDACTED' }))
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Pulse/, '80')
    await press(saveButton())
    expect(await within(region()).findByText(SCREENING_REDACTED)).toBeTruthy()
    expect(within(region()).queryByRole('button', { name: 'Save health checks' })).toBeNull()
  })

  it('is read only without registration write', async () => {
    api.outreachScreening.mockResolvedValue({ screening: saved(1, { pulseBpm: 72 }) })
    renderChecks(false)
    await waitFor(() => expect(box(/^Pulse/).value).toBe('72'))
    expect(box(/^Pulse/).readOnly).toBe(true)
    expect(within(region()).queryByRole('button', { name: 'Save health checks' })).toBeNull()
    expect(within(region()).queryByRole('button', { name: 'Add a medicine' })).toBeNull()
  })
})

/*
 * A reload never loses health checks typed (the owner's "no hassle" rule, 14 November 2026): what is typed and not saved
 * is kept for this tab (sessionStorage, never localStorage), brought back on top of the checks as saved, and dropped once
 * saved; the browser no longer asks before a reload; a save whose answer was lost is still checked after one. Fictional.
 */
describe('Health checks through a reload', () => {
  /** The page goes and comes back: everything in memory is lost, the tab's own storage is not. */
  function reload() {
    cleanup()
    return renderChecks()
  }
  const kept = () => Object.keys(sessionStorage).filter(key => key.includes('health-checks:'))

  it('brings back what was typed and not saved, kept for this tab only, and drops it once saved', async () => {
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Pulse/, '80')
    choose(/Malaria rapid test/, 'negative')
    await waitFor(() => expect(kept()).toHaveLength(1))
    expect(kept()[0]).toContain(`staff-demo-1:${GROUP_ID}:${CASE_ID}`)
    expect(JSON.stringify({ ...localStorage })).not.toContain('80')

    reload()
    await waitFor(() => expect(box(/^Pulse/).value).toBe('80'))
    expect((within(region()).getByRole('combobox', { name: /Malaria rapid test/ }) as HTMLSelectElement).value).toBe('negative')
    expect(within(region()).getByText(SCREENING_KEPT)).toBeTruthy()

    api.saveOutreachScreening.mockResolvedValueOnce({ screening: saved(1, { pulseBpm: 80, malariaRdt: 'negative' }) })
    await press(saveButton())
    expect(await within(region()).findByText('Health checks saved.')).toBeTruthy()
    expect(api.saveOutreachScreening.mock.calls[0]![2]).toEqual({ ...NULLS, pulseBpm: 80, malariaRdt: 'negative' })
    await waitFor(() => expect(kept()).toEqual([]))
    api.outreachScreening.mockResolvedValue({ screening: saved(1, { pulseBpm: 80, malariaRdt: 'negative' }) })
    reload()
    await waitFor(() => expect(box(/^Pulse/).value).toBe('80'))
    expect(within(region()).queryByText(SCREENING_KEPT)).toBeNull()
  })

  it('brings typing back on top of checks someone else saved meanwhile', async () => {
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Pulse/, '80')
    await waitFor(() => expect(kept()).toHaveLength(1))
    api.outreachScreening.mockResolvedValue({ screening: saved(1, { malariaRdt: 'positive' }) })
    reload()
    await waitFor(() => expect(box(/^Pulse/).value).toBe('80'))
    expect((within(region()).getByRole('combobox', { name: /Malaria rapid test/ }) as HTMLSelectElement).value).toBe('positive')
    api.saveOutreachScreening.mockResolvedValueOnce({ screening: saved(2, { pulseBpm: 80, malariaRdt: 'positive' }) })
    await press(saveButton())
    await waitFor(() => expect(api.saveOutreachScreening).toHaveBeenCalledTimes(1))
    expect(api.saveOutreachScreening.mock.calls[0]![2]).toEqual({ ...NULLS, pulseBpm: 80, malariaRdt: 'positive' })
    expect(api.saveOutreachScreening.mock.calls[0]![3].version).toBe(1)
  })

  it('does not ask before a reload, since nothing typed is lost', async () => {
    renderChecks()
    await waitFor(() => expect(saveButton()).toBeTruthy())
    type(/^Pulse/, '80')
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(false)
  })

  it('after a reload, still checks a save whose answer was lost before saving again', async () => {
    api.outreachScreening.mockResolvedValue({ screening: saved(1, { pulseBpm: 70 }) })
    api.saveOutreachScreening.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderChecks()
    await waitFor(() => expect(box(/^Pulse/).value).toBe('70'))
    type(/^Pulse/, '75')
    await press(saveButton())
    expect(await within(region()).findByText(SCREENING_OFFLINE)).toBeTruthy()
    await waitFor(() => expect(kept()).toHaveLength(1))
    expect(JSON.stringify({ ...localStorage })).not.toContain('75')

    // That save did land (version 2 holds pulse 75), and the page was reloaded before anyone knew.
    api.outreachScreening.mockResolvedValue({ screening: saved(2, { pulseBpm: 75 }) })
    reload()
    await waitFor(() => expect(box(/^Pulse/).value).toBe('75'))
    await press(saveButton())
    // Outreach is asked what it holds, finds that save, and nothing is sent again.
    expect(await within(region()).findByText('Health checks saved.')).toBeTruthy()
    expect(api.saveOutreachScreening).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(kept()).toEqual([]))
  })
})

describe('the registration’s area and the list', () => {
  it('asks for no area while Outreach does not serve health checks yet (its registrations carry no hasScreening)', async () => {
    api.outreachCases.mockResolvedValue([pending('case-old')])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: 'New registration' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
    expect(screen.queryByRole('textbox', { name: /Area, town or LGA/ })).toBeNull()
  })

  it('sends the area typed, and shows it on the case', async () => {
    api.outreachCases.mockResolvedValue([pending('case-old', { hasScreening: false })])
    api.createOutreachCase.mockResolvedValue(pending(CASE_ID, { area: 'Ajegunle, Ajeromi-Ifelodun' }))
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: 'New registration' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: 'Kemi Balogun' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: '30' } })
    const area = screen.getByRole('textbox', { name: /Area, town or LGA/ }) as HTMLInputElement
    expect(area.maxLength).toBe(100)
    fireEvent.change(area, { target: { value: '  Ajegunle,   Ajeromi-Ifelodun ' } })
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalled())
    expect(api.createOutreachCase.mock.calls[0]![1].area).toBe('Ajegunle, Ajeromi-Ifelodun')
    expect(await screen.findByText('Ajegunle, Ajeromi-Ifelodun')).toBeTruthy()
  })

  it('sends no area when none is typed', async () => {
    api.createOutreachCase.mockResolvedValue(pending(CASE_ID))
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: 'New registration' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: 'Kemi Balogun' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: '30' } })
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalled())
    expect('area' in api.createOutreachCase.mock.calls[0]![1]).toBe(false)
  })

  it('says “Health checks recorded” on a registration that has them', async () => {
    api.outreachCases.mockResolvedValue([pending('case-a', { hasScreening: true }), pending('case-b', { fullName: 'Ada Obi', hasScreening: false })])
    renderDept(<Outreach />)
    const kemi = await screen.findByRole('button', { name: /Kemi Balogun/ })
    expect(kemi.textContent).toContain('Health checks recorded')
    expect(screen.getByRole('button', { name: /Ada Obi/ }).textContent).not.toContain('Health checks recorded')
  })

  it('tells the person, in the 2026-11-14 notice, that health checks are written down and a Health ID is their choice', () => {
    const notice = registrationNotice('Ajegunle Health Volunteers')
    expect(notice).toEqual([
      'Ajegunle Health Volunteers is registering people at this event on Health ID Outreach.',
      'We will write down your name, age and sex, the area where you live, your phone number or email if you want to give them, and the results of today\'s health checks, so the team can care for you and follow up.',
      'Only this outreach team and Health ID can see your details. Ajegunle Health Volunteers and Health ID are both responsible for looking after them.',
      'If you agree, we will also make a Health ID for you from these details. You can start using it later with your email, or with the code on your slip, and add the rest of your details then.',
      'If you don\'t get a Health ID, your details are deleted 1 year after the campaign closes (or 1 year after it starts, if it is never closed).',
      'You can say no to being registered. You can also say yes to being registered but no to a Health ID.',
      'To have your details deleted sooner, or to complain, contact Health ID support.',
    ])
    expect(REGISTRATION_NOTICE_VERSION).toBe('outreach-notice-2026-11-14')
    expect(registrationNotice20261101('x').join(' ')).toContain('This does not give you a Health ID.')
  })
})
