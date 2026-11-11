import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type * as HidApi from '@hid/api'
import { Migrate } from '../../../../ehr-blue/departments/migrate/Migrate'
import { parseReadingQuality } from '../../../../ehr-blue/departments/migrate/ReadingQuality'
import { readsReadingQuality } from '../../../../ehr-blue/departments/migrate/readingQualityApi'
import { forgetReadingQualityServed } from '../../../../readingLearningServed'
import { DEMO_HOSPITAL_ID, DEMO_LABORATORY_ID, renderDept } from '../harness'

/**
 * "Reading quality" (Migrate learning, phase 1), on the staff side in Migrate: plain-word tiles from Session B's
 * review-outcome summary for the working facility (GET /api/v1/ocr/quality/summary with X-Facility-ID), added up over
 * its groups, for an actor with Session B's two platform permissions or for the facility's own manager (workforce.manage at
 * the working facility, not awaiting support's review; hid-system #236), offered until a 404 says it isn't served.
 * Requests go through the real contract registry and app boundary, to a fake transport. Fictional data only.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), ocrPublications: vi.fn(),
  createOcrJob: vi.fn(), retryOcrJob: vi.fn(), validateOcrJob: vi.fn(), confirmOcrPatient: vi.fn(), publishOcrValidation: vi.fn(),
  labImport: vi.fn(), pharmacyImport: vi.fn(), encounters: vi.fn(), lookupPatient: vi.fn(), documents: vi.fn(), consentStatus: vi.fn(),
}))
const transport = vi.hoisted(() => ({ request: vi.fn() }))
const session = vi.hoisted(() => ({
  platformPermissions: [] as string[] | undefined,
  /** The membership at the working facility (Demo Hospital): its permissions, and its self-service review. */
  permissions: [] as string[], selfService: undefined as { review: string; organizationType: string } | undefined,
  /** Another membership's permissions, at Demo Laboratory; none when undefined. */
  elsewhere: undefined as string[] | undefined,
}))

vi.mock('../../../../staff/api', () => ({ staffApi: api,
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: object }) => lookup.authorization.decision === 'allow' && !!lookup.patient }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => {
      const current = fakeFacility(session.permissions, { id: hospital, name: 'Demo Hospital', ...(session.selfService ? { selfService: session.selfService } : {}) })
      const context = staffContext(current)
      const actor = { ...context.state.session.actor, ...(session.platformPermissions ? { platformPermissions: session.platformPermissions } : {}),
        facilities: [current, ...(session.elsewhere ? [fakeFacility(session.elsewhere)] : [])] }
      return { ...context, lock: null, activePatient: null, setActivePatient: () => {}, state: { ...context.state, session: { actor } } }
    },
  }
})
vi.mock('../../../../staff/session', () => ({
  staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {}, staffSessionSignal: () => new AbortController().signal,
  endsStaffSession: () => false, reportStaffSessionEnded: () => {},
}))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
// The real registered client (contract registry and app boundary), over a fake transport.
vi.mock('@hid/api', async importOriginal => {
  const actual = await importOriginal<typeof HidApi>()
  return {
    ...actual,
    createRegisteredBrowserClient: (_inner: unknown, app: Parameters<typeof actual.createRegisteredBrowserClient>[1]) =>
      actual.createRegisteredBrowserClient({ baseUrl: 'https://gateway.example.test', request: transport.request,
        get: () => Promise.reject(new Error('unused')), post: () => Promise.reject(new Error('unused')) }, app),
  }
})

const ADMIN = ['platform.admin.access', 'platform.operations.read']
const READING_QUALITY = '/api/v1/ocr/quality/summary'

const reviews = (week: string, counts: object) => ({ week, facilityId: DEMO_HOSPITAL_ID, promptVersion: 'demo-prompt-1', estimated: 0,
  summaryFailed: 0, correctionFields: {}, ...counts })
const items = (week: string, kind: string, decisions: Record<string, number>) => ({ week, facilityId: DEMO_HOSPITAL_ID, kind,
  promptVersion: 'demo-prompt-1', items: Object.values(decisions).reduce((sum, count) => sum + count, 0), decisions, byConfidence: {},
  byReadBy: {}, hardPage: {}, fieldChanges: {}, checkReasons: {} })

/** Session B's answer (hid.ocr.quality-summary/v1): two weeks shown, one held back, and some small reason counts left out. */
const ANSWER = {
  schema: 'hid.ocr.quality-summary/v1', from: '2026-10-12', to: '2026-11-08', scope: 'bound_facility', minGroupSize: 20, truncated: false,
  reviewGroups: [
    reviews('2026-W42', { reviews: 120, validated: 110, rejected: 10, reviewConfirmed: 90, missedItems: 9,
      rejectionReasons: { wrong_patient: 5, duplicate_document: 5 }, removalReasons: { not_on_paper: 9, duplicate: 14, some_later_code: 5 },
      changeReasons: { misread: 80 }, smallCellsHidden: 2 }),
    reviews('2026-W43', { reviews: 90, validated: 88, rejected: 2, reviewConfirmed: 70, missedItems: 4,
      rejectionReasons: {}, removalReasons: { unreadable: 21 }, changeReasons: { misread: 7, clinical_update: 12 } }),
    { week: '2026-W44', facilityId: DEMO_HOSPITAL_ID, promptVersion: 'demo-prompt-1', suppressed: true },
  ],
  itemGroups: [
    items('2026-W42', 'medicine', { kept_unchanged: 700, kept_changed: 80, removed: 23 }),
    items('2026-W43', 'lab_result', { kept_unchanged: 540, kept_changed: 19, removed: 21 }),
    { week: '2026-W44', facilityId: DEMO_HOSPITAL_ID, kind: 'allergy', promptVersion: 'demo-prompt-1', suppressed: true },
  ],
}

let answer: () => Promise<unknown> = async () => ANSWER
const qualityCalls = () => transport.request.mock.calls.map(([spec]) => spec as { path: string; method: string; query?: unknown;
  headers: Record<string, string> }).filter(spec => spec.path === READING_QUALITY)

beforeEach(() => {
  vi.clearAllMocks()
  forgetReadingQualityServed()
  session.platformPermissions = [...ADMIN]
  session.permissions = ['ocr.job.read', 'ocr.job.write']
  session.selfService = undefined
  session.elsewhere = undefined
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  answer = async () => ANSWER
  transport.request.mockImplementation((spec: { path: string }) => spec.path === READING_QUALITY ? answer()
    : Promise.reject(new Error(`unexpected ${spec.path}`)))
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const tile = (name: string) => screen.getByRole('article', { name })

async function openQuality() {
  renderDept(<Migrate />)
  await press(await screen.findByRole('button', { name: 'Reading quality' }))
}

describe('Reading quality, in Migrate', () => {
  it('is offered only to an actor with both platform permissions, and nothing is read until it is opened', async () => {
    expect(readsReadingQuality({ platformPermissions: ADMIN })).toBe(true)
    expect(readsReadingQuality({ platformPermissions: ['platform.admin.access'] })).toBe(false)
    expect(readsReadingQuality({ permissions: ADMIN })).toBe(false)
    expect(readsReadingQuality(undefined)).toBe(false)
    session.platformPermissions = ['platform.admin.access']
    const { unmount } = renderDept(<Migrate />)
    await screen.findByRole('heading', { name: 'Find document job' })
    expect(screen.queryByRole('button', { name: 'Reading quality' })).toBeNull()
    unmount()
    session.platformPermissions = [...ADMIN]
    renderDept(<Migrate />)
    expect(await screen.findByRole('button', { name: 'Reading quality' })).toBeTruthy()
    expect(qualityCalls()).toHaveLength(0)
  })

  it('reads this facility’s summary and shows its counts as plain-word tiles, with no code or ID', async () => {
    await openQuality()
    await screen.findByRole('heading', { name: 'Items read from paper' })
    expect(document.activeElement?.id).toBe('migrate-view-title')
    expect(qualityCalls()).toEqual([expect.objectContaining({ method: 'GET', path: READING_QUALITY,
      headers: expect.objectContaining({ 'X-Facility-ID': DEMO_HOSPITAL_ID, 'X-Purpose-Of-Use': 'healthcare-operations' }) })])
    expect(qualityCalls()[0]!.query ?? {}).toEqual({})
    expect(screen.getByText('Weeks from 12 October 2026 to 8 November 2026, at this facility.')).toBeTruthy()
    expect(within(tile('Documents checked and saved')).getByText('198')).toBeTruthy()
    expect(within(tile('Checks where every item was looked at')).getByText('160 of 198')).toBeTruthy()
    expect(within(tile('Items kept as read')).getByText('1,240')).toBeTruthy()
    expect(within(tile('Items changed')).getByText('99')).toBeTruthy()
    expect(within(tile('Changed because the AI misread the paper')).getByText('87')).toBeTruthy()
    expect(within(tile('Changed because the paper was out of date')).getByText('12')).toBeTruthy()
    // A reason the page has no words for is never shown; one the server left out isn't listed.
    const removed = within(tile('Items removed, and why'))
    expect(removed.getByText('44')).toBeTruthy()
    expect(within(removed.getByRole('list', { name: 'Items removed, by reason' })).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['Not on the paper9', 'Written twice14', 'Can’t read it21'])
    expect(within(tile('Items the reading missed')).getByText('13')).toBeTruthy()
    const rejected = within(tile('Documents rejected, and why'))
    expect(rejected.getByText('12')).toBeTruthy()
    expect(within(rejected.getByRole('list')).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Wrong patient5',
      'Same document twice5'])
    // What was held back is said in words.
    const leftOut = within(screen.getByRole('region', { name: 'What these figures leave out' }))
    expect(leftOut.getByText(/too few checks, or too few people checking, to show/)).toBeTruthy()
    expect(leftOut.getByText(/fewer than 5 times in a week/)).toBeTruthy()
    const page = document.body.textContent ?? ''
    expect(page).not.toMatch(/misread\b(?! the)|clinical_update|not_on_paper|lab_result|wrong_patient|some_later_code|kept_unchanged|W4\d|demo-prompt|98d00002|suppressed|quality\/summary/)
    expect(screen.queryByRole('alert')).toBeNull()
    // Back goes to the list, with focus on the way in.
    await press(screen.getByRole('button', { name: 'Back to list' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reading quality' })))
  })

  it('shows 0 for a change reason nobody gave, and counts nothing from an empty answer', async () => {
    expect(parseReadingQuality({ reviewGroups: [], itemGroups: [] })).toMatchObject({ anyShown: false, heldBack: 0, validated: 0 })
    answer = async () => ({ ...ANSWER, reviewGroups: [reviews('2026-W43', { reviews: 30, validated: 30, rejected: 0, reviewConfirmed: 0,
      missedItems: 0, rejectionReasons: {}, removalReasons: {}, changeReasons: { misread: 7 } })], itemGroups: [] })
    await openQuality()
    await screen.findByRole('heading', { name: 'Items read from paper' })
    expect(within(tile('Changed because the paper was out of date')).getByText('0')).toBeTruthy()
    expect(screen.queryByText(/too few to show/i)).toBeNull()
    expect(screen.queryByRole('region', { name: 'What these figures leave out' })).toBeNull()
  })

  it('says “None, or too few to show” for a change reason absent only when the server held back small reason counts', async () => {
    answer = async () => ({ ...ANSWER, reviewGroups: [reviews('2026-W43', { reviews: 30, validated: 30, rejected: 0, reviewConfirmed: 0,
      missedItems: 0, rejectionReasons: {}, removalReasons: {}, changeReasons: { misread: 7 }, smallCellsHidden: 1 })], itemGroups: [] })
    await openQuality()
    await screen.findByRole('heading', { name: 'Items read from paper' })
    expect(within(tile('Changed because the paper was out of date')).getByText('None, or too few to show')).toBeTruthy()
    expect(within(tile('Changed because the AI misread the paper')).getByText('7')).toBeTruthy()
  })

  it('when every group was held back, says so in words instead of a page of zeros', async () => {
    answer = async () => ({ ...ANSWER,
      reviewGroups: [{ week: '2026-W44', facilityId: DEMO_HOSPITAL_ID, promptVersion: 'demo-prompt-1', suppressed: true }],
      itemGroups: [{ week: '2026-W44', facilityId: DEMO_HOSPITAL_ID, kind: 'allergy', promptVersion: 'demo-prompt-1', suppressed: true }] })
    await openQuality()
    expect(await screen.findByRole('heading', { name: 'Too few checks to show' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Items read from paper' })).toBeNull()
    expect(screen.queryByText('0 of 0')).toBeNull()
    expect(document.body.textContent).not.toMatch(/W44|demo-prompt|suppressed/)
  })

  it('while the backend does not serve it (404): says it isn’t available yet, calmly, and stops offering it', async () => {
    answer = () => Promise.reject(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
    await openQuality()
    expect(await screen.findByRole('heading', { name: 'Not available yet' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/404|NOT_FOUND|Not found/)
    await press(screen.getByRole('button', { name: 'Back to list' }))
    await waitFor(() => expect(document.activeElement?.id).toBe('ocr-find-title'))
    expect(screen.queryByRole('button', { name: 'Reading quality' })).toBeNull()
  })

  it('says a failed read in plain words, with Refresh to try again', async () => {
    answer = () => Promise.reject(new HidApiError(503, 'upstream down', { code: 'SERVICE_UNAVAILABLE' }))
    await openQuality()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Reading quality could not be loaded.')
    expect(alert.textContent).not.toMatch(/SERVICE_UNAVAILABLE|upstream/)
    answer = async () => ANSWER
    await press(within(alert).getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('heading', { name: 'Items read from paper' })).toBeTruthy()
  })
})

describe('Reading quality, for a facility’s own manager (hid-system #236)', () => {
  const MANAGER = ['ocr.job.read', 'workforce.manage']
  const hospital = (permissions: string[], selfService?: { review: string; organizationType: string }) => ({
    id: DEMO_HOSPITAL_ID, permissions, ...(selfService ? { selfService } : {}) })
  const actorAt = (current: { id: string }, ...facilities: object[]) => ({ kind: 'staff', facility: current, facilities })

  beforeEach(() => {
    session.platformPermissions = undefined
    session.permissions = [...MANAGER]
  })

  it('decides as Session B does: workforce.manage on the membership at the working facility, its current one, not awaiting review', () => {
    const managed = hospital(['workforce.manage'])
    expect(readsReadingQuality(actorAt(managed, managed), DEMO_HOSPITAL_ID)).toBe(true)
    // Reviewed, or never self-service: either counts. Awaiting support's review does not.
    expect(readsReadingQuality(actorAt(managed, hospital(['workforce.manage'], { review: 'reviewed', organizationType: 'hospital' })), DEMO_HOSPITAL_ID)).toBe(true)
    const pending = hospital(['workforce.manage'], { review: 'pending', organizationType: 'hospital' })
    expect(readsReadingQuality(actorAt(pending, pending), DEMO_HOSPITAL_ID)).toBe(false)
    // workforce.manage at another facility never counts, nor on the facility's own copy outside the membership list.
    const other = { id: DEMO_LABORATORY_ID, permissions: ['workforce.manage'] }
    const plain = hospital(['ocr.job.read'])
    expect(readsReadingQuality(actorAt(plain, plain, other), DEMO_HOSPITAL_ID)).toBe(false)
    expect(readsReadingQuality(actorAt(managed, plain), DEMO_HOSPITAL_ID)).toBe(false)
    // The facility sent must be the actor's current one.
    expect(readsReadingQuality(actorAt(plain, plain, other), DEMO_LABORATORY_ID)).toBe(false)
    expect(readsReadingQuality(actorAt(managed, managed))).toBe(false)
    expect(readsReadingQuality({ ...actorAt(managed, managed), kind: 'patient' }, DEMO_HOSPITAL_ID)).toBe(false)
    // A platform administrator as before, wherever they work.
    expect(readsReadingQuality({ ...actorAt(plain, plain), platformPermissions: ADMIN }, DEMO_HOSPITAL_ID)).toBe(true)
  })

  it('offers it to the manager at the working facility, and reads that facility’s figures when opened', async () => {
    await openQuality()
    await screen.findByRole('heading', { name: 'Items read from paper' })
    expect(qualityCalls()).toEqual([expect.objectContaining({ method: 'GET', path: READING_QUALITY,
      headers: expect.objectContaining({ 'X-Facility-ID': DEMO_HOSPITAL_ID }) })])
    expect(within(tile('Documents checked and saved')).getByText('198')).toBeTruthy()
  })

  it.each([
    ['holds workforce.manage only at another facility', () => { session.permissions = ['ocr.job.read']; session.elsewhere = ['workforce.manage'] }],
    ['manages a facility still awaiting support’s review', () => { session.selfService = { review: 'pending', organizationType: 'hospital' } }],
    ['is staff without workforce.manage or the platform permissions', () => { session.permissions = ['ocr.job.read', 'ocr.job.write'] }],
  ])('does not offer it to someone who %s, and reads nothing', async (_name, arrange) => {
    arrange()
    renderDept(<Migrate />)
    await screen.findByRole('heading', { name: 'Find document job' })
    expect(screen.queryByRole('button', { name: 'Reading quality' })).toBeNull()
    expect(qualityCalls()).toHaveLength(0)
  })

  it('a manager without OCR job read still gets Migrate’s own refusal: the page that offers it is not open to them', async () => {
    session.permissions = ['workforce.manage']
    renderDept(<Migrate />)
    expect(screen.getByRole('alert').textContent).toBe('Reading scanned documents isn’t available at your facility yet.')
    expect(screen.queryByRole('button', { name: 'Reading quality' })).toBeNull()
    expect(qualityCalls()).toHaveLength(0)
  })

  it('when fewer than 3 people’s checks were counted, says so in one calm sentence, with no figures and no code', async () => {
    answer = async () => ({ schema: 'hid.ocr.quality-summary/v1', from: '2026-10-12', to: '2026-11-08', scope: 'bound_facility',
      available: false, reason: 'too_few_reviewers' })
    await openQuality()
    expect(await screen.findByText('Not enough reviews yet to show figures for this facility.')).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Items read from paper' })).toBeNull()
    expect(screen.queryByText(/Weeks from/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/too_few_reviewers|available|bound_facility|\b0 of 0\b/)
  })

  it('says any other answer without figures in a calm general sentence', async () => {
    answer = async () => ({ schema: 'hid.ocr.quality-summary/v1', available: false, reason: 'some_later_reason' })
    await openQuality()
    expect(await screen.findByText('Figures can’t be shown for this facility at the moment. Nothing needs doing.')).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.queryByText('Not enough reviews yet to show figures for this facility.')).toBeNull()
    expect(document.body.textContent).not.toMatch(/some_later_reason/)
  })

  it('says a weeks-and-people hold-back in words true for a manager', async () => {
    answer = async () => ({ ...ANSWER,
      reviewGroups: [{ week: '2026-W44', facilityId: DEMO_HOSPITAL_ID, promptVersion: 'demo-prompt-1', suppressed: true }],
      itemGroups: [] })
    await openQuality()
    await screen.findByRole('heading', { name: 'Too few checks to show' })
    expect(screen.getByText(/too few checks, or too few people checking, at this facility in these weeks/)).toBeTruthy()
  })

  it('a refusal (403) is plain, true for a manager too, and names no permission or role', async () => {
    answer = () => Promise.reject(new HidApiError(403, 'Platform administration or facility management is required', { code: 'PERMISSION_DENIED' }))
    await openQuality()
    expect(await screen.findByText('Reading quality isn’t open to you at this facility.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/PERMISSION_DENIED|403|administrat|workforce|manage/i)
  })
})
