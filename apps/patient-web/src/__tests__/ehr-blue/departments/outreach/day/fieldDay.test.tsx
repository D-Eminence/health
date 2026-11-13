import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../../harness'
import { AllInOne, DayStart, RegisterPerson, StationWork, VisitView } from '../../../../../ehr-blue/departments/outreach/day'
import { memoryQueueStore, readDaySettings, setOutreachQueueStore, type OutreachQueueStore } from '../../../../../ehr-blue/departments/outreach/offlineQueue'

/*
 * The field day of an Outreach campaign (owner decisions of 13 November 2026): where you are today, registering a person
 * (search first, details, their agreement, the visit code), each station's form found by visit code, one person doing
 * everything, and one person's visit. Every person, campaign and code here is fictional.
 */

const FACILITY = 'f0000000-0000-4000-8000-00000000000a'
const session = vi.hoisted(() => ({ facilityRoles: ['outreach_volunteer'] as string[] }))
vi.mock('../../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write'],
      { id: 'f0000000-0000-4000-8000-00000000000a', name: 'Demo Volunteers', roles: session.facilityRoles })),
  }
})
const api = vi.hoisted(() => ({ outreachCampaigns: vi.fn(), createOutreachCase: vi.fn() }))
type Spec = { method: string; path: string; body?: Record<string, unknown>; headers?: Record<string, string> }
const request = vi.hoisted(() => vi.fn())
vi.mock('../../../../../staff/api', () => ({ staffApi: api, outreachCampaignRequest: request }))

const BASE = '/api/v1/outreach/registration-cases'
const CAMPAIGN = 'camp-1'
const at = `${BASE}/campaigns/${CAMPAIGN}`
const HBSAG = { id: 'hbsag', name: 'Hepatitis B rapid test (HBsAg)', focus: 'hepatitis_b', kind: 'choice', sensitive: true, usesKit: true,
  results: [{ value: 'positive', label: 'Positive', flag: 'abnormal' }, { value: 'negative', label: 'Negative', flag: 'normal' }, { value: 'invalid', label: 'Invalid (test again)', flag: 'invalid' }] }
const MALARIA = { id: 'malaria_rdt', name: 'Malaria rapid test (mRDT)', focus: 'malaria', kind: 'choice', sensitive: false, usesKit: true,
  results: [{ value: 'positive', label: 'Positive', flag: 'abnormal' }, { value: 'negative', label: 'Negative', flag: 'normal' }, { value: 'invalid', label: 'Invalid (test again)', flag: 'invalid' }] }
const PLAN = {
  campaignId: CAMPAIGN, organisationName: 'Demo Volunteers', target: 100, focuses: ['hepatitis_b', 'hypertension', 'malaria'],
  sites: [{ id: 'site-1', name: 'Demo Town Hall', community: 'Demotown', lga: 'Demo', address: '1 Demo Road' },
    { id: 'site-2', name: 'Demo Church Hall', community: 'Democity', lga: 'Demo', address: '2 Demo Road' }],
  package: {
    vitals: [
      { id: 'bp_systolic', name: 'Blood pressure, top number (systolic)', unit: 'mmHg', min: 60, max: 260, decimals: 0, normalText: 'Under 140' },
      { id: 'bp_diastolic', name: 'Blood pressure, bottom number (diastolic)', unit: 'mmHg', min: 30, max: 160, decimals: 0, normalText: 'Under 90' },
    ],
    tests: [HBSAG, MALARIA],
    questions: [{ id: 'htn_known', text: 'Has a health worker ever told you that you have high blood pressure?', kind: 'yesno', focus: 'hypertension' }],
  },
  stationMode: 'split', stations: ['register', 'vitals', 'tests', 'results'],
  partners: [{ id: 'partner-1', name: 'Demo General Hospital', phone: '+2348000000001', address: '3 Demo Road', treats: ['hypertension'] }],
  consent: { text: 'We will record your name and check your blood pressure. You can say no.', version: '2026-11-13', hivText: null, hivVersion: null },
  kits: [{ id: 'kit-1', siteId: 'site-1', testId: 'hbsag', lot: 'HB-1', expiresOn: '2099-01-01', count: 50 },
    { id: 'kit-2', siteId: 'site-1', testId: 'malaria_rdt', lot: 'MR-1', expiresOn: '2099-01-01', count: 50 }],
  rowVersion: 3,
}
const VISIT = {
  id: 'ov-1', campaignId: CAMPAIGN, status: 'identity_resolution_pending', fullName: 'Demo Ada', ageYears: 34, sex: 'female', phone: '+2348000000099',
  temporaryPatientId: 'tmp_1', createdAt: '2026-11-13T09:00:00.000Z', rowVersion: 1, visitCode: 'K7-4F2', healthId: 'HID-DEMAAAA2',
  stationsDone: ['register'], vitals: [], tests: [], answers: [], outcome: null, referral: null, followUp: null,
}

let roles: string[]
let store: OutreachQueueStore
let visit: Record<string, unknown>
const calls = () => request.mock.calls.map(([, spec]) => spec as Spec)
const posts = (rest: string) => calls().filter(spec => spec.method === 'POST' && spec.path === `${BASE}/ov-1/${rest}`)

beforeEach(() => {
  vi.clearAllMocks()
  store = memoryQueueStore()
  setOutreachQueueStore(store)
  session.facilityRoles = ['outreach_volunteer']
  roles = ['coordinator', 'clinician']
  visit = { ...VISIT }
  api.outreachCampaigns.mockResolvedValue([{ id: CAMPAIGN, name: 'Demo Screening Day', status: 'active', services: ['registration'], startsAt: '2026-11-12T00:00:00.000Z', rowVersion: 1 }])
  api.createOutreachCase.mockImplementation(async (_facility: string, input: Record<string, unknown>) => ({ ...VISIT, ...input, id: 'ov-1' }))
  request.mockImplementation(async (_facility: string, spec: Spec) => {
    if (spec.method === 'GET' && spec.path === `${at}/plan`) return PLAN
    if (spec.method === 'GET' && spec.path === `${at}/team`) {
      return { members: [{ memberId: 'tm-3', name: 'Demo Tester', roles: ['tester'] }], you: { memberId: 'tm-1', roles, siteId: null, station: null } }
    }
    if (spec.method === 'POST' && spec.path === `${at}/participants/search`) {
      if (spec.body?.phone === '08030000001') return { matches: [{ matchId: 'm-1', initials: 'AO', ageYears: 35, sex: 'female', maskedPhone: '•••• ••• 0001', hasHealthId: true, inThisCampaign: false, caseId: null, visitCode: null }] }
      if (spec.body?.phone === '08030000002') return { matches: [{ matchId: 'm-2', initials: 'DA', ageYears: 34, sex: 'female', maskedPhone: '•••• ••• 0099', hasHealthId: true, inThisCampaign: true, caseId: 'ov-1', visitCode: 'K7-4F2' }] }
      return { matches: [] }
    }
    if (spec.method === 'GET' && spec.path === `${at}/visits/by-code/K7-4F2`) return visit
    if (spec.method === 'GET' && spec.path.startsWith(`${at}/visits/by-code/`)) throw new HidApiError(404, 'Not found', { code: 'OUTREACH_VISIT_NOT_FOUND' })
    if (spec.method === 'GET' && spec.path === `${BASE}/ov-1`) return visit
    if (spec.method === 'POST' && spec.path === `${BASE}/ov-1/consent-code`) return { challengeId: 'ch-1', sentTo: '•••• ••• 0099', expiresAt: '2099-01-01T00:00:00.000Z', resendAfterSeconds: 60 }
    if (spec.method === 'POST' && spec.path === `${BASE}/ov-1/consent-code/verify`) {
      if (spec.body?.code !== '123456') throw new HidApiError(400, 'Bad code', { code: 'OTP_INVALID' })
      return { consentId: 'consent-1', purpose: 'registration', method: 'code', language: 'en', version: '2026-11-13', recordedBy: null, witnessName: null, guardianName: null, recordedAt: '2026-11-13T09:00:00.000Z' }
    }
    if (spec.method === 'POST' && spec.path === `${BASE}/ov-1/slip-sms`) return { sentTo: '•••• ••• 0099', deliveryOutcome: 'accepted' }
    if (spec.method === 'POST' && /\/ov-1\/(vitals|tests|answers)$/.test(spec.path)) return visit
    if (spec.method === 'POST' && spec.path === `${BASE}/ov-1/outcome`) return { ...spec.body, confirmedBy: { memberId: 'tm-1', name: 'Demo Scientist', roles }, confirmedAt: '2026-11-13T10:00:00.000Z' }
    if (spec.method === 'POST' && spec.path === `${BASE}/ov-1/referral`) return { ...spec.body, referralId: 'r-1', status: 'made', notes: null, madeAt: '', updatedAt: '', rowVersion: 1 }
    if (spec.method === 'POST' && spec.path === `${BASE}/ov-1/follow-up`) return { ...spec.body, followUpId: 'f-1', status: 'due', notes: null, attempts: 0, updatedAt: '', rowVersion: 1 }
    throw new HidApiError(404, 'Not Found', { code: 'NOT_FOUND' })
  })
})
afterEach(() => setOutreachQueueStore(null))

async function press(element: HTMLElement) {
  await act(async () => { fireEvent.click(element) })
}
async function type(element: HTMLElement, value: string) {
  await act(async () => { fireEvent.change(element, { target: { value } }) })
}
const button = (name: string | RegExp) => screen.getByRole('button', { name })
const radio = (name: string | RegExp) => screen.getByRole('radio', { name })

async function registerScreen(onDone = vi.fn()) {
  renderDept(<RegisterPerson campaignId={CAMPAIGN} onDone={onDone} />)
  await screen.findByRole('heading', { name: 'Register a person' })
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Phone number or Health ID' })))
  return onDone
}
async function details({ name, sex, age }: { name: string; sex?: 'Female' | 'Male'; age?: string }) {
  await type(await screen.findByRole('textbox', { name: 'Full name' }), name)
  if (sex) await press(radio(sex))
  if (age !== undefined) await type(screen.getByRole('textbox', { name: 'Age in years' }), age)
  await press(button(/Next: their agreement/))
}

describe('RegisterPerson', () => {
  it('searches by phone in the body, never the address, and registers someone found with their own record', async () => {
    const onDone = await registerScreen()
    await type(screen.getByRole('textbox', { name: 'Phone number or Health ID' }), '08030000001')
    await press(button('Search'))
    const search = calls().find(spec => spec.path.endsWith('/participants/search'))!
    expect(search).toMatchObject({ method: 'POST', path: `${at}/participants/search`, body: { phone: '08030000001' } })
    expect(JSON.stringify(calls().map(spec => spec.path))).not.toContain('0803')
    const found = await screen.findByRole('list', { name: 'People found' })
    expect(within(found).getByText('35 years · Female · phone •••• ••• 0001')).toBeTruthy()
    await press(within(found).getByRole('button', { name: 'Yes, that’s them' }))
    // Their sex, age and phone come with them; the name is asked.
    expect(radio('Female').getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Age in years' }) as HTMLInputElement).value).toBe('35')
    expect(screen.getByText('Their own Health ID record is used. Check their name and age with them.')).toBeTruthy()
    await details({ name: 'Demo Ada' })
    expect(screen.getByRole('note', { name: 'What they agree to' }).textContent).toContain('We will record your name')
    await press(button('They agreed out loud'))
    expect(api.createOutreachCase).toHaveBeenCalledTimes(1)
    const [facility, input, command] = api.createOutreachCase.mock.calls[0]!
    expect(facility).toBe(FACILITY)
    expect(input).toEqual({ campaignId: CAMPAIGN, fullName: 'Demo Ada', sex: 'female', ageYears: 35, phone: '08030000001',
      operationalNotes: undefined, consent: { textVersion: '2026-11-13', language: 'en', method: 'verbal_read_aloud' } })
    expect(command.localCommandId).toMatch(/^[0-9a-f-]{36}$/)
    expect(command.temporaryPatientId).toMatch(/^tmp_/)
    expect(await screen.findByLabelText('Visit code K 7 - 4 F 2')).toBeTruthy()
    expect(screen.getAllByText('HID-DEMAAAA2').length).toBeGreaterThan(0)
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'ov-1', visitCode: 'K7-4F2' }))
    await press(button('Text it to them'))
    const sms = posts('slip-sms')
    expect(sms).toHaveLength(1)
    expect(sms[0]!.body).toEqual({ kind: 'visit_code', language: 'en' })
    expect(sms[0]!.headers?.['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText('Sent to •••• ••• 0099.')).toBeTruthy()
    // Next person: the search again, empty and focused.
    await press(button('Next person'))
    const box = screen.getByRole('textbox', { name: 'Phone number or Health ID' }) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(box))
  })

  it('checks the details as Outreach does, and asks a parent or guardian for anyone under 18', async () => {
    await registerScreen()
    await press(button('New person, no search'))
    await press(button(/Next: their agreement/))
    expect(screen.getByText('Enter their full name.')).toBeTruthy()
    expect(screen.getByText('Choose their sex.')).toBeTruthy()
    expect(screen.getByText('Enter their age. A best guess is fine.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Full name' })))
    await details({ name: 'Demo Child', sex: 'Male', age: '12' })
    await press(button('Parent or guardian agreed'))
    expect(api.createOutreachCase).not.toHaveBeenCalled()
    expect(screen.getByText('This person is under 18. Enter the name of the parent or guardian who agreed.')).toBeTruthy()
    await type(screen.getByRole('textbox', { name: 'Parent or guardian’s name' }), 'Demo Parent')
    await press(button('Parent or guardian agreed'))
    expect(api.createOutreachCase.mock.calls[0]![1].consent).toEqual({ textVersion: '2026-11-13', language: 'en', method: 'guardian', guardianName: 'Demo Parent' })
    expect(api.createOutreachCase.mock.calls[0]![1].ageYears).toBe(12)
  })

  it('works out the age from a date of birth', async () => {
    await registerScreen()
    await press(button('New person, no search'))
    await type(screen.getByRole('textbox', { name: 'Full name' }), 'Demo Born')
    await press(radio('Female'))
    await press(radio('Date of birth'))
    const born = new Date()
    born.setFullYear(born.getFullYear() - 40)
    born.setDate(born.getDate() - 2)
    const iso = `${born.getFullYear()}-${String(born.getMonth() + 1).padStart(2, '0')}-${String(born.getDate()).padStart(2, '0')}`
    await type(screen.getByLabelText('Date of birth', { selector: 'input' }), iso)
    expect(screen.getByText('40 years old')).toBeTruthy()
    await press(button(/Next: their agreement/))
    await press(button('They agreed out loud'))
    expect(api.createOutreachCase.mock.calls[0]![1].ageYears).toBe(40)
  })

  it('records agreement by a code sent to their phone, with an Idempotency-Key on each step', async () => {
    await registerScreen()
    await press(button('New person, no search'))
    await details({ name: 'Demo Ada', sex: 'Female', age: '34' })
    // No phone given: a code can't be sent.
    expect(button('Send code to their phone').getAttribute('aria-disabled')).toBe('true')
    await press(button('Back'))
    await type(screen.getByRole('textbox', { name: /Phone number/ }), '08000000099')
    await press(button(/Next: their agreement/))
    await press(button('Send code to their phone'))
    expect(api.createOutreachCase).toHaveBeenCalledTimes(1)
    expect(posts('consent-code')[0]!.body).toEqual({ purpose: 'registration', language: 'en', version: '2026-11-13' })
    const code = await screen.findByRole('textbox', { name: 'Code' })
    await type(code, '111111')
    expect(await screen.findByText('That code is not right. Ask them to read it again.')).toBeTruthy()
    await type(code, '123456')
    const verify = posts('consent-code/verify')
    expect(verify.map(spec => spec.body)).toEqual([{ challengeId: 'ch-1', code: '111111' }, { challengeId: 'ch-1', code: '123456' }])
    expect(verify.every(spec => /^[0-9a-f-]{36}$/.test(spec.headers?.['Idempotency-Key'] ?? ''))).toBe(true)
    expect(await screen.findByText(/agreed by code/)).toBeTruthy()
  })

  it('keeps a registration on this phone at an outreach group with no connection, and makes up no code', async () => {
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await registerScreen()
    await press(button('New person, no search'))
    await details({ name: 'Demo Offline', sex: 'Male', age: '40' })
    await press(button('They agreed out loud'))
    expect(await screen.findByText('Saved on this phone')).toBeTruthy()
    expect(screen.getByText('The code arrives when you’re back online.')).toBeTruthy()
    expect(screen.queryByText(/Visit code/)).toBeNull()
    const kept = await store.list()
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ localCommandId: api.createOutreachCase.mock.calls[0]![2].localCommandId, state: 'waiting',
      input: { fullName: 'Demo Offline', campaignId: CAMPAIGN } })
  })

  it('sends the same command again after a refusal, so a person is registered once', async () => {
    session.facilityRoles = ['outreach_officer']
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(500, 'Fault', { code: 'INTERNAL' }))
    await registerScreen()
    await press(button('New person, no search'))
    await details({ name: 'Demo Retry', sex: 'Female', age: '22' })
    await press(button('They agreed out loud'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    await press(button('They agreed out loud'))
    expect(api.createOutreachCase).toHaveBeenCalledTimes(2)
    expect(api.createOutreachCase.mock.calls[1]![2]).toEqual(api.createOutreachCase.mock.calls[0]![2])
    expect(await store.list()).toEqual([])
  })

  it('opens the visit of someone already registered in this campaign instead of registering them twice', async () => {
    await registerScreen()
    await type(screen.getByRole('textbox', { name: 'Phone number or Health ID' }), '08030000002')
    await press(button('Search'))
    expect(await screen.findByText('Already registered here: visit code K7-4F2')).toBeTruthy()
    await press(button('Yes, that’s them'))
    expect(await screen.findByRole('heading', { name: 'Already registered: Demo Ada' })).toBeTruthy()
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })

  it('checks the Health ID typed before searching', async () => {
    await registerScreen()
    await press(radio('Health ID'))
    await type(screen.getByRole('textbox', { name: 'Phone number or Health ID' }), 'nope')
    await press(button('Search'))
    expect(screen.getByText('Enter the Health ID as written on their card. It starts with HID-.')).toBeTruthy()
    await type(screen.getByRole('textbox', { name: 'Phone number or Health ID' }), 'hid-demaaaa2')
    await press(button('Search'))
    expect(calls().find(spec => spec.path.endsWith('/participants/search'))!.body).toEqual({ healthId: 'HID-DEMAAAA2' })
  })
})

describe('DayStart', () => {
  it('offers the plan’s sites and stations as big choices, and remembers them on this device', async () => {
    const onStart = vi.fn()
    renderDept(<DayStart campaignId={CAMPAIGN} onStart={onStart} />)
    expect(await screen.findByRole('heading', { name: 'Where are you today?' })).toBeTruthy()
    expect(screen.getByText('All sent')).toBeTruthy()
    const stations = await screen.findByRole('radiogroup', { name: 'Your station' })
    // Only the stations in the plan: no counselling here.
    expect(within(stations).getAllByRole('radio')).toHaveLength(4)
    expect(within(stations).queryByRole('radio', { name: /^Counselling/ })).toBeNull()
    await press(button('Start at this station'))
    expect(screen.getByText('Choose where you are.')).toBeTruthy()
    expect(onStart).not.toHaveBeenCalled()
    await press(radio(/^Demo Town Hall/))
    await press(radio(/^Tests/))
    // A tester's kit lots for this site.
    expect(screen.getByRole('radiogroup', { name: 'Kit lot for Hepatitis B rapid test (HBsAg)' })).toBeTruthy()
    await press(button('Start at this station'))
    expect(onStart).toHaveBeenCalledTimes(1)
    const saved = await readDaySettings(store, { accountId: 'staff-demo-1', facilityId: FACILITY }, CAMPAIGN)
    expect(saved).toMatchObject({ siteId: 'site-1', station: 'tests', kitLots: { hbsag: 'HB-1', malaria_rdt: 'MR-1' } })
  })

  it('says plainly when the campaign has no plan yet', async () => {
    request.mockImplementation(async () => { throw new HidApiError(404, 'No plan', { code: 'OUTREACH_PLAN_NOT_FOUND' }) })
    renderDept(<DayStart campaignId={CAMPAIGN} onStart={vi.fn()} />)
    expect(await screen.findByText('No plan yet')).toBeTruthy()
  })
})

async function station(name: 'vitals' | 'tests' | 'results') {
  renderDept(<StationWork campaignId={CAMPAIGN} station={name} />)
  const code = await screen.findByRole('textbox', { name: 'Visit code' })
  await waitFor(() => expect(document.activeElement).toBe(code))
  // Typed small and without the dash: found as soon as the code is whole.
  await type(code, 'k74f2')
  expect(calls().some(spec => spec.method === 'GET' && spec.path === `${at}/visits/by-code/K7-4F2`)).toBe(true)
  await screen.findByRole('region', { name: 'Patient: Demo Ada' })
}

describe('StationWork', () => {
  it('finds the person by code, flags readings in words as typed, and saves vitals and answers with Idempotency-Keys', async () => {
    await station('vitals')
    expect(screen.getByText(/Visit K7-4F2 · 34 years/)).toBeTruthy()
    const top = screen.getByRole('textbox', { name: 'Blood pressure, top number (systolic)' })
    await waitFor(() => expect(document.activeElement).toBe(top))
    expect(top.getAttribute('inputmode')).toBe('decimal')
    await type(top, '186')
    expect(screen.getByText('Very high: needs to be seen today')).toBeTruthy()
    expect(screen.getByText('Blood pressure is very high (top number 186). Needs to be seen today.')).toBeTruthy()
    // Enter moves to the next reading.
    await act(async () => { fireEvent.keyDown(top, { key: 'Enter' }) })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Blood pressure, bottom number (diastolic)' })))
    await type(screen.getByRole('textbox', { name: 'Blood pressure, bottom number (diastolic)' }), '400')
    await press(button('Save'))
    expect(screen.getByText('Check this number: it should be between 30 and 160 mmHg.')).toBeTruthy()
    expect(posts('vitals')).toHaveLength(0)
    await type(screen.getByRole('textbox', { name: 'Blood pressure, bottom number (diastolic)' }), '95')
    await press(within(screen.getByRole('radiogroup', { name: /high blood pressure/ })).getByRole('radio', { name: 'Yes' }))
    await press(button('Save'))
    expect(posts('vitals')[0]!.body).toMatchObject({ siteId: null, readings: { bp_systolic: 186, bp_diastolic: 95 } })
    expect(posts('answers')[0]!.body).toEqual({ answers: [{ questionId: 'htn_known', value: 'yes' }] })
    const keys = [...posts('vitals'), ...posts('answers')].map(spec => spec.headers?.['Idempotency-Key'])
    expect(new Set(keys).size).toBe(2)
    expect(await screen.findByText('Saved')).toBeTruthy()
    await press(button('Next person'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Visit code' })))
  })

  it('keeps a save on this phone when the network is gone, and resends a refused one with the same key', async () => {
    await station('vitals')
    request.mockImplementationOnce(async () => { throw new HidApiError(409, 'Closed', { code: 'OUTREACH_CAMPAIGN_CLOSED' }) })
    await type(screen.getByRole('textbox', { name: 'Blood pressure, top number (systolic)' }), '120')
    await press(button('Save'))
    expect(await screen.findByText('This campaign is finished. Nothing more can be recorded in it.')).toBeTruthy()
    // What was typed is kept; the retry is the same command.
    expect((screen.getByRole('textbox', { name: 'Blood pressure, top number (systolic)' }) as HTMLInputElement).value).toBe('120')
    request.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
    await press(button('Save'))
    expect(await screen.findByText(/Saved on this phone/)).toBeTruthy()
    const tried = posts('vitals').map(spec => spec.headers?.['Idempotency-Key'])
    expect(tried).toHaveLength(2)
    expect(tried[0]).toBe(tried[1])
    const waiting = await store.listWrites()
    expect(waiting).toHaveLength(1)
    expect(waiting[0]).toMatchObject({ localCommandId: tried[0], caseId: 'ov-1', campaignId: CAMPAIGN, command: { kind: 'vitals' } })
  })

  it('says when no one has the code', async () => {
    renderDept(<StationWork campaignId={CAMPAIGN} station="vitals" />)
    await type(await screen.findByRole('textbox', { name: 'Visit code' }), 'AA-AAA')
    expect(await screen.findByText('No one has the code AA-AAA here. Check the slip.')).toBeTruthy()
  })

  it('shows sensitive tests only to counsellors and clinicians', async () => {
    roles = ['tester']
    await station('tests')
    expect(screen.getByText('Done by the counsellor.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Hepatitis B rapid test (HBsAg) result' })).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Malaria rapid test (mRDT) result' })).toBeTruthy()
  })

  it('asks for a second test after an invalid one, and sends both attempts with the kit lot', async () => {
    await station('tests')
    const malaria = screen.getByRole('radiogroup', { name: 'Malaria rapid test (mRDT) result' })
    await press(within(malaria).getByRole('radio', { name: 'Invalid' }))
    expect(screen.getAllByText('Test again with a new kit')).toHaveLength(1)
    await press(within(screen.getByRole('radiogroup', { name: 'Malaria rapid test (mRDT) result, second test' })).getByRole('radio', { name: 'Positive' }))
    await press(button('Save'))
    // The one unexpired lot is picked for them.
    const results = (posts('tests')[0]!.body as { results: Array<Record<string, unknown>> }).results
    expect(results.map(({ result, attempt, kitLot }) => ({ result, attempt, kitLot }))).toEqual([
      { result: 'invalid', attempt: 1, kitLot: 'MR-1' }, { result: 'positive', attempt: 2, kitLot: 'MR-1' }])
    expect(posts('tests')[0]!.headers?.['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('asks for the kit lot when the site has more than one', async () => {
    const { saveDaySettings } = await import('../../../../../ehr-blue/departments/outreach/offlineQueue')
    await saveDaySettings(store, { accountId: 'staff-demo-1', facilityId: FACILITY }, CAMPAIGN, { siteId: 'site-1', station: 'tests', kitLots: {} })
    PLAN.kits.push({ id: 'kit-3', siteId: 'site-1', testId: 'malaria_rdt', lot: 'MR-2', expiresOn: '2099-01-01', count: 10 })
    try {
      await station('tests')
      await press(within(screen.getByRole('radiogroup', { name: 'Malaria rapid test (mRDT) result' })).getByRole('radio', { name: 'Negative' }))
      await press(button('Save'))
      expect(posts('tests')).toHaveLength(0)
      expect(screen.getByText('Choose the kit lot for the Malaria rapid test (mRDT).')).toBeTruthy()
      await press(radio(/^Kit lot MR-2/))
      await press(button('Save'))
      expect((posts('tests')[0]!.body as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({ kitLot: 'MR-2', kitId: 'kit-3' })
      // Remembered for the next person.
      expect((await readDaySettings(store, { accountId: 'staff-demo-1', facilityId: FACILITY }, CAMPAIGN))?.kitLots).toEqual({ malaria_rdt: 'MR-2' })
    } finally {
      PLAN.kits.pop()
    }
  })

  it('uses the community of the site this phone is at', async () => {
    const { saveDaySettings } = await import('../../../../../ehr-blue/departments/outreach/offlineQueue')
    await saveDaySettings(store, { accountId: 'staff-demo-1', facilityId: FACILITY }, CAMPAIGN, { siteId: 'site-2', station: 'register' })
    await registerScreen()
    await press(button('New person, no search'))
    await waitFor(() => expect((screen.getByRole('textbox', { name: /Community/ }) as HTMLInputElement).value).toBe('Democity'))
    await details({ name: 'Demo Ada', sex: 'Female', age: '34' })
    await press(button('They agreed out loud'))
    expect(api.createOutreachCase.mock.calls[0]![1].operationalNotes).toBe('Community: Democity')
  })

  it('records results with the remembered kit lot', async () => {
    const { saveDaySettings } = await import('../../../../../ehr-blue/departments/outreach/offlineQueue')
    await saveDaySettings(store, { accountId: 'staff-demo-1', facilityId: FACILITY }, CAMPAIGN, { siteId: 'site-1', station: 'tests', kitLots: { malaria_rdt: 'MR-1' } })
    await station('tests')
    await press(within(screen.getByRole('radiogroup', { name: 'Hepatitis B rapid test (HBsAg) result' })).getByRole('radio', { name: 'Negative' }))
    await press(within(screen.getByRole('radiogroup', { name: 'Malaria rapid test (mRDT) result' })).getByRole('radio', { name: 'Invalid' }))
    await press(within(screen.getByRole('radiogroup', { name: 'Malaria rapid test (mRDT) result, second test' })).getByRole('radio', { name: 'Negative' }))
    await press(button('Save'))
    const results = (posts('tests')[0]!.body as { results: Array<Record<string, unknown>> }).results
    expect(results.map(({ testId, result, attempt, kitLot, kitId }) => ({ testId, result, attempt, kitLot, kitId }))).toEqual([
      { testId: 'hbsag', result: 'negative', attempt: 1, kitLot: 'HB-1', kitId: 'kit-1' },
      { testId: 'malaria_rdt', result: 'invalid', attempt: 1, kitLot: 'MR-1', kitId: 'kit-2' },
      { testId: 'malaria_rdt', result: 'negative', attempt: 2, kitLot: 'MR-1', kitId: 'kit-2' },
    ])
  })

  it('suggests the outcome, and lets only a counsellor or clinician confirm it', async () => {
    roles = ['vitals']
    visit = { ...VISIT, vitals: [{ entryId: 'v1', readings: { bp_systolic: 186, bp_diastolic: 118 }, takenAt: '2026-11-13T09:10:00.000Z', recordedBy: 'tm-3' }] }
    await station('results')
    expect(screen.getByText('Refer (urgent)')).toBeTruthy()
    expect(screen.getByText('Blood pressure is very high (186/118 mmHg). Needs to be seen today.')).toBeTruthy()
    expect(screen.getByText('A counsellor or clinician confirms the outcome. Send them to the results station.')).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Confirm the outcome' })).toBeNull()
  })

  it('confirms a referral to a partner with its reason, and asks again before a lower outcome than suggested', async () => {
    visit = { ...VISIT, vitals: [{ entryId: 'v1', readings: { bp_systolic: 186, bp_diastolic: 118 }, takenAt: '2026-11-13T09:10:00.000Z', recordedBy: 'tm-3' }] }
    await station('results')
    await press(radio('Normal'))
    await press(button('Confirm: Normal'))
    expect(await screen.findByRole('dialog', { name: 'Less than suggested' })).toBeTruthy()
    await press(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await press(radio('Refer'))
    expect(radio('Urgent: today').getAttribute('aria-checked')).toBe('true')
    // The one partner is chosen for them.
    expect(radio(/^Demo General Hospital/).getAttribute('aria-checked')).toBe('true')
    await press(button('Confirm: Refer (urgent)'))
    expect(posts('outcome')[0]!.body).toEqual({ kind: 'refer', urgency: 'urgent', reason: 'Blood pressure is very high (186/118 mmHg). Needs to be seen today.',
      suggestedKind: 'refer', suggestedUrgency: 'urgent' })
    expect(posts('referral')[0]!.body).toEqual({ partnerId: 'partner-1', urgency: 'urgent', reason: 'Blood pressure is very high (186/118 mmHg). Needs to be seen today.' })
    expect(await screen.findByText('Referred to Demo General Hospital.')).toBeTruthy()
    await press(button('Text the result'))
    expect(posts('slip-sms')[0]!.body).toEqual({ kind: 'results' })
  })

  it('books a follow-up in two weeks by default', async () => {
    await station('results')
    await press(radio('Follow up'))
    const date = screen.getByLabelText('Follow up on') as HTMLInputElement
    const due = new Date()
    due.setDate(due.getDate() + 14)
    expect(date.value).toBe(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`)
    await type(screen.getByRole('textbox', { name: 'Why, in a few words' }), 'Check blood pressure again.')
    await press(button('Confirm: Follow up'))
    expect(posts('follow-up')[0]!.body).toEqual({ dueOn: date.value, reason: 'Check blood pressure again.' })
  })
})

describe('VisitView', () => {
  it('shows everything recorded, by station, with who; sensitive results only for those allowed', async () => {
    roles = ['registrar']
    visit = { ...VISIT, sensitiveHidden: true, stationsDone: ['register', 'vitals'],
      vitals: [{ entryId: 'v1', readings: { bp_systolic: 150, bp_diastolic: 85 }, takenAt: '2026-11-13T09:10:00.000Z', recordedBy: 'tm-3' }],
      tests: [{ entryId: 't1', testId: 'hbsag', result: 'positive', attempt: 1, kitLot: 'HB-1', takenAt: '2026-11-13T09:20:00.000Z', flag: 'abnormal', recordedBy: 'tm-3' }] }
    const onBack = vi.fn()
    renderDept(<VisitView campaignId={CAMPAIGN} caseId="ov-1" onBack={onBack} />)
    expect(await screen.findByRole('heading', { name: 'Demo Ada' })).toBeTruthy()
    expect(calls().some(spec => spec.method === 'GET' && spec.path === `${BASE}/ov-1`)).toBe(true)
    expect(screen.getByText('Some results are shown only to a counsellor or clinician.')).toBeTruthy()
    expect(screen.queryByText('Positive')).toBeNull()
    expect(screen.getByText(/Demo Tester/)).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
    await press(button('Back'))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('AllInOne', () => {
  it('registers, then takes vital signs, tests and the outcome on one screen with a progress strip', async () => {
    renderDept(<AllInOne campaignId={CAMPAIGN} />)
    const progress = await screen.findByRole('navigation', { name: 'Progress' })
    expect(within(progress).getAllByRole('link').map(link => link.textContent)).toEqual(['1Register, now', '2Vital signs', '3Tests', '4Outcome'])
    await press(button('New person, no search'))
    await details({ name: 'Demo Ada', sex: 'Female', age: '34' })
    await press(button('They agreed out loud'))
    expect(await screen.findByRole('heading', { name: 'Vital signs' })).toBeTruthy()
    expect(within(progress).getByRole('link', { name: /Register, done/ })).toBeTruthy()
    await type(screen.getByRole('textbox', { name: 'Blood pressure, top number (systolic)' }), '120')
    await press(within(screen.getByRole('region', { name: 'Vital signs' })).getByRole('button', { name: 'Save' }))
    expect(posts('vitals')).toHaveLength(1)
    expect(await within(progress).findByRole('link', { name: /Vital signs, done/ })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Outcome' })).toBeTruthy()
  })
})

describe('OutreachCaseView', () => {
  it('shows a campaign registration’s visit code and Health ID, with its slip to print', async () => {
    const { OutreachCaseView } = await import('../../../../../ehr-blue/departments/outreach/OutreachCaseView')
    renderDept(<OutreachCaseView facilityId={FACILITY} item={VISIT} campaign={undefined} canLink={false} group created listError=""
      onBack={vi.fn()} onChanged={async () => undefined} onFocusHeading={vi.fn()} />)
    expect(screen.getByLabelText('Visit code K 7 - 4 F 2')).toBeTruthy()
    expect(screen.getAllByText('HID-DEMAAAA2').length).toBeGreaterThan(0)
    expect(button('Print slip')).toBeTruthy()
  })
})
