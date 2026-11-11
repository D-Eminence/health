import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import type { StaffSession } from '../../../../staff/api'
import { readingQualityPage } from '../../../../ehr-blue/departments/migrate/page'
import { DEMO_HOSPITAL, DEMO_LABORATORY, SESSION, facility, json, openStaffApp, problem, serve, where, type Answer, type Sent } from '../../frame/blueHarness'

/*
 * Reading quality as a page of its own (/provider/ocr/quality), for a facility's own manager who has no Document OCR:
 * the same rule as hid-system #236, workforce.manage at the X-Facility-ID facility, not while that facility awaits Health
 * ID support's review, or a platform administrator's two platform permissions. It is listed in the sidebar only for
 * them, opens in the frame without OCR job read, and says a manager's figures cover finished weeks only. Every account,
 * facility and figure is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const departments = await import('../../../../ehr-blue/departments/pages')
    return { ...actual, BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': departments }) }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SUMMARY = 'GET /api/v1/ocr/quality/summary'
const ADMIN = ['platform.admin.access', 'platform.operations.read']
const PENDING = { review: 'pending', organizationType: 'hospital' }

type Membership = ReturnType<typeof facility> & { selfService?: { review: string; organizationType: string } }

/** A self-service facility administrator at Demo Hospital: workforce.manage, and no OCR job read. */
const manager = (selfService?: { review: string; organizationType: string }): Membership =>
  ({ ...facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage', 'identity.consent.write'], ['org_admin']), ...(selfService ? { selfService } : {}) })

function actor(current: Membership, facilities: Membership[], platformPermissions?: string[]) {
  return { id: 'staff-demo-1', email: 'demo.manager@example.test', displayName: 'Demo Manager', roles: ['org_admin'], permissions: [],
    facilities, facility: current, ...(platformPermissions ? { platformPermissions } : {}) }
}
const sessionOf = (current: Membership, facilities: Membership[], platformPermissions?: string[]): Answer =>
  () => json({ actor: actor(current, facilities, platformPermissions), expiresAt: '2026-11-30T12:00:00.000Z' })
const sessionValue = (current: Membership, facilities: Membership[], platformPermissions?: string[]) =>
  ({ actor: actor(current, facilities, platformPermissions), expiresAt: '2026-11-30T12:00:00.000Z' }) as unknown as StaffSession
const many = (answer: Answer, count = 6): Answer[] => Array.from({ length: count }, () => answer)

/** Session B's answer for Demo Hospital: one finished week shown. */
const ANSWER = {
  schema: 'hid.ocr.quality-summary/v1', from: '2026-10-12', to: '2026-11-08', scope: 'bound_facility', minGroupSize: 20, truncated: false,
  reviewGroups: [{ week: '2026-W43', facilityId: DEMO_HOSPITAL, promptVersion: 'demo-prompt-1', reviews: 40, validated: 36, rejected: 4,
    reviewConfirmed: 30, missedItems: 2, rejectionReasons: {}, removalReasons: {}, changeReasons: { misread: 6 } }],
  itemGroups: [{ week: '2026-W43', facilityId: DEMO_HOSPITAL, kind: 'medicine', promptVersion: 'demo-prompt-1', items: 120,
    decisions: { kept_unchanged: 100, kept_changed: 12, removed: 8 } }],
}

const navLink = async (name: string) => within(await screen.findByRole('navigation', { name: 'Main navigation' })).queryByRole('link', { name })
const summaries = (sent: Sent[]) => sent.filter(request => request.route === SUMMARY)

describe('the page entry', () => {
  it('needs no Migrate permission, and shows by #236’s rule at the working facility', () => {
    expect(readingQualityPage.path).toBe('ocr/quality')
    expect(readingQualityPage.permission).toBeUndefined()
    const visible = (session: StaffSession) => readingQualityPage.visible?.(session)
    const managed = manager()
    expect(visible(sessionValue(managed, [managed]))).toBe(true)
    const pending = manager(PENDING)
    expect(visible(sessionValue(pending, [pending]))).toBe(false)
    const plain = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    const elsewhere = facility(DEMO_LABORATORY, 'Demo Laboratory', ['workforce.manage'])
    expect(visible(sessionValue(plain, [plain, elsewhere]))).toBe(false)
    expect(visible(sessionValue(plain, [plain], ADMIN))).toBe(true)
    expect(visible(sessionValue(plain, [plain], ['platform.admin.access']))).toBe(false)
  })
})

describe('a self-service facility administrator with workforce.manage and no OCR job read', () => {
  it('sees Reading quality in the sidebar, opens it, and sees the facility’s figures for finished weeks', async () => {
    const managed = manager()
    const sent = serve({ [SESSION]: many(sessionOf(managed, [managed])), [SUMMARY]: [() => json(ANSWER)] })
    await openStaffApp('/provider')
    // Network & Services folds until opened, as for every page in it.
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Network & Services' }))
    const link = await navLink('Reading quality')
    expect(link?.getAttribute('href')).toBe('/provider/ocr/quality')
    // Migrate's own page is still not open to them.
    expect(await navLink('Document OCR')).toBeNull()
    expect(summaries(sent)).toHaveLength(0)
    await act(async () => { fireEvent.click(link!) })
    await waitFor(() => expect(where()).toBe('/provider/ocr/quality'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Reading quality')
    await screen.findByRole('heading', { name: 'Items read from paper' })
    expect(within(screen.getByRole('article', { name: 'Documents checked and saved' })).getByText('36')).toBeDefined()
    expect(screen.getByText('Figures cover finished weeks only.')).toBeDefined()
    expect(summaries(sent)).toHaveLength(1)
    expect(summaries(sent)[0]!.headers.get('X-Facility-ID')).toBe(DEMO_HOSPITAL)
    expect(screen.queryByText('Reading scanned documents isn’t available at your facility yet.')).toBeNull()
    expect(screen.queryByText(/is not open to you here/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/workforce|ocr\.job|org_admin|kept_unchanged|2026-W43|demo-prompt/)
  })

  it('when fewer than 3 people’s checks were counted, says so in one calm sentence, with no figures', async () => {
    const managed = manager()
    serve({ [SESSION]: many(sessionOf(managed, [managed])), [SUMMARY]: [() => json({ schema: 'hid.ocr.quality-summary/v1',
      from: '2026-10-12', to: '2026-11-08', scope: 'bound_facility', available: false, reason: 'too_few_reviewers' })] })
    await openStaffApp('/provider/ocr/quality')
    expect(await screen.findByText('Not enough reviews yet to show figures for this facility.')).toBeDefined()
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.queryByText('Figures cover finished weeks only.')).toBeNull()
    expect(document.body.textContent).not.toMatch(/too_few_reviewers/)
  })

  it('before the read is served (404), says it isn’t available yet, calmly, and the entry stops being listed', async () => {
    const managed = manager()
    serve({ [SESSION]: many(sessionOf(managed, [managed])), [SUMMARY]: [() => problem(404, 'API_ROUTE_NOT_FOUND', 'Not found')] })
    await openStaffApp('/provider/ocr/quality')
    expect(await screen.findByRole('heading', { name: 'Not available yet' })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    const { readingQualityPage: page } = await import('../../../../ehr-blue/departments/migrate/page')
    expect(page.listed?.(sessionValue(managed, [managed]))).toBe(false)
  })
})

describe('the same administrator while the facility awaits Health ID support’s review', () => {
  it('has no entry, and the page’s address refuses in plain words, reading nothing', async () => {
    const pending = manager(PENDING)
    const sent = serve({ [SESSION]: many(sessionOf(pending, [pending])) })
    await openStaffApp('/provider/ocr/quality')
    expect(await navLink('Reading quality')).toBeNull()
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Reading quality')
    expect(screen.getByText('Reading quality opens here once Health ID support has reviewed this facility.')).toBeDefined()
    expect(screen.queryByText(/part of the Health ID demo only|is not open to you here/)).toBeNull()
    expect(summaries(sent)).toHaveLength(0)
  })
})

describe('workforce.manage only at another facility', () => {
  it('has no entry, and the address refuses, reading nothing', async () => {
    const plain = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], ['clinician'])
    const elsewhere = facility(DEMO_LABORATORY, 'Demo Laboratory', ['workforce.manage'], ['org_admin'])
    const sent = serve({ [SESSION]: many(sessionOf(plain, [plain, elsewhere])) })
    await openStaffApp('/provider/ocr/quality')
    expect(await navLink('Reading quality')).toBeNull()
    expect(await screen.findByText('Reading quality isn’t open to you at this facility.')).toBeDefined()
    expect(summaries(sent)).toHaveLength(0)
  })
})

describe('a platform administrator', () => {
  it('has the entry, and sees the figures without the finished-weeks note', async () => {
    const plain = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], ['clinician'])
    const sent = serve({ [SESSION]: many(sessionOf(plain, [plain], ADMIN)), [SUMMARY]: [() => json(ANSWER)] })
    await openStaffApp('/provider/ocr/quality')
    expect(await navLink('Reading quality')).not.toBeNull()
    await screen.findByRole('heading', { name: 'Items read from paper' })
    expect(screen.queryByText('Figures cover finished weeks only.')).toBeNull()
    expect(summaries(sent)[0]!.headers.get('X-Facility-ID')).toBe(DEMO_HOSPITAL)
  })
})

describe('staff with neither workforce.manage nor the platform permissions', () => {
  it('has no entry, and the address refuses, reading nothing', async () => {
    const plain = facility(DEMO_HOSPITAL, 'Demo Hospital', ['ocr.job.read', 'identity.consent.write'], ['clinician'])
    const sent = serve({ [SESSION]: many(sessionOf(plain, [plain])) })
    await openStaffApp('/provider/ocr/quality')
    expect(await navLink('Reading quality')).toBeNull()
    expect(await navLink('Document OCR')).not.toBeNull()
    expect(await screen.findByText('Reading quality isn’t open to you at this facility.')).toBeDefined()
    expect(summaries(sent)).toHaveLength(0)
  })
})
