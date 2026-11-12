import { useSyncExternalStore } from 'react'
import { createApiClient, isHidApiError } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { getEnvironment } from '../../../staff/env'
import { endsStaffSession, reportStaffSessionEnded, staffSessionGeneration, staffSessionSignal, untilStaffSessionReady } from '../../../staff/session'

/*
 * A patient's records imported from paper, as Lab and Pharmacy list them (hid-system Session B, not on
 * staging-novu-ci-20261005 yet: branches claude/ecstatic-ramanujan-q4i1eo-lab-patient-imports e0cd6ee8 and
 * claude/ecstatic-ramanujan-q4i1eo-pharmacy-patient-imports 73da2432):
 *
 * - GET /api/v1/lab/imports?patientId=&cursor=&limit= (lab-imports.controller.ts list, ListLabImportsQueryDto): limit
 *   1-50 (20 by default), newest received first, answering { records, nextCursor }; each record is the projection of
 *   GET /api/v1/lab/imports/:importId with its observations in order. Needs lab.import.read; 403
 *   LAB_IMPORT_ACCESS_DENIED without the patient's read_records.
 * - GET /api/v1/pharmacy/imports?patientId=&limit=&cursor= (pharmacy.controller.ts listImports,
 *   ListImportedMedicationsQueryDto): limit 1-100 (50 by default), newest first, answering { items, nextCursor }; each
 *   item is the projection of GET /api/v1/pharmacy/imports/:importId. Needs pharmacy.import.read.
 *
 * Both are direct care at the working facility (X-Facility-ID, X-Purpose-Of-Use), as staff/api.ts reads one import. A
 * backend that does not serve a list answers 404 (the gateway's API_ROUTE_NOT_FOUND, or NOT_FOUND): `notServed`, and
 * the page shows nothing of it. Each page read is audited by its service, so nothing here reads one by itself.
 *
 * Its own client, registered as the provider portal ('staff-web') like staff/api.ts and commerce/api.ts, so the
 * contract registry and the app boundary guard every request; each request waits for the staff session it was made in
 * and ends with it.
 */

export interface PaperLabObservation {
  readonly id: string
  readonly ordinal: number
  readonly testName: string
  readonly value?: string | null
  readonly valueText?: string | null
  readonly unit?: string | null
  readonly referenceRange?: string | null
  readonly abnormalFlag?: string | null
  readonly reportedAt?: string | null
  readonly status?: string | null
}

export interface PaperLabImport {
  readonly id: string
  readonly patientId: string
  /** accepted, entered_in_error or amended (hid-system lab migration 0017). */
  readonly status: string
  readonly externalLabName?: string | null
  readonly reportedAt?: string | null
  readonly receivedAt?: string | null
  readonly observations: readonly PaperLabObservation[]
}

export interface PaperMedicine {
  readonly id: string
  readonly patientId: string
  readonly medicationText: string
  readonly strengthText?: string | null
  readonly doseText?: string | null
  readonly frequencyText?: string | null
  readonly historicalContext?: string | null
  readonly createdAt?: string | null
}

export interface PaperPage<T> { readonly items: readonly T[]; readonly nextCursor: string | null }

/** Records shown a page at a time. */
export const PAPER_PAGE_SIZE = 20

/** A list's answer: a page, not served here (404), refused for this role (403), or not read. */
export type PaperListResult<T> =
  | { readonly ok: true; readonly page: PaperPage<T> }
  | { readonly ok: false; readonly notServed: true }
  | { readonly ok: false; readonly refused: true }
  | { readonly ok: false; readonly failed: true }

/** Made on first use, so importing this module reads no configuration. */
let registered: ReturnType<typeof createRegisteredBrowserClient> | null = null
function client(): ReturnType<typeof createRegisteredBrowserClient> {
  registered ??= createRegisteredBrowserClient(createApiClient({
    baseUrl: getEnvironment().apiBaseUrl,
    clientId: 'staff-web',
    sessionMode: 'cookie',
  }), 'staff-web')
  return registered
}

/** The gateway's answer for a route it does not serve, or the service's own for one it lacks. */
function routeNotServed(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 404 && (caught.code === 'NOT_FOUND' || caught.code === 'API_ROUTE_NOT_FOUND')
}

function bad(): never { throw new Error('The list answered in a shape this page does not read.') }

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseCursor(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' && value ? value : bad()
}

/** Only the patient asked about is shown: a record of anyone else makes the whole answer unreadable. */
function parseLab(answer: unknown, patientId: string): PaperPage<PaperLabImport> {
  const value = answer as { records?: unknown; nextCursor?: unknown } | null
  if (!value || typeof value !== 'object' || !Array.isArray(value.records)) bad()
  const items = value.records.map((raw): PaperLabImport => {
    const record = raw as Record<string, unknown> | null
    if (!record || typeof record.id !== 'string' || record.patientId !== patientId || !Array.isArray(record.observations)) bad()
    const observations = (record.observations as unknown[]).map((rawObservation, at): PaperLabObservation => {
      const item = rawObservation as Record<string, unknown> | null
      if (!item || typeof item.testName !== 'string') bad()
      return {
        id: typeof item.id === 'string' ? item.id : `${record.id as string}-${at}`,
        ordinal: typeof item.ordinal === 'number' ? item.ordinal : at,
        testName: item.testName, value: text(item.value), valueText: text(item.valueText), unit: text(item.unit),
        referenceRange: text(item.referenceRange), abnormalFlag: text(item.abnormalFlag), reportedAt: text(item.reportedAt),
        status: text(item.status),
      }
    }).sort((a, b) => a.ordinal - b.ordinal)
    return {
      id: record.id, patientId, status: text(record.status) ?? 'accepted', externalLabName: text(record.externalLabName),
      reportedAt: text(record.reportedAt), receivedAt: text(record.receivedAt), observations,
    }
  })
  return { items, nextCursor: parseCursor(value.nextCursor) }
}

function parseMedicines(answer: unknown, patientId: string): PaperPage<PaperMedicine> {
  const value = answer as { items?: unknown; nextCursor?: unknown } | null
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) bad()
  const items = value.items.map((raw): PaperMedicine => {
    const item = raw as Record<string, unknown> | null
    if (!item || typeof item.id !== 'string' || item.patientId !== patientId || typeof item.medicationText !== 'string') bad()
    return {
      id: item.id, patientId, medicationText: item.medicationText, strengthText: text(item.strengthText), doseText: text(item.doseText),
      frequencyText: text(item.frequencyText), historicalContext: text(item.historicalContext), createdAt: text(item.createdAt),
    }
  })
  return { items, nextCursor: parseCursor(value.nextCursor) }
}

/**
 * What this page has learned of each list: served and read (a page answered), or not served (404). In memory only, for
 * the page's life; null until a list has answered either.
 */
export interface PaperListsServed { readonly lab: boolean | null; readonly pharmacy: boolean | null }
let served: PaperListsServed = { lab: null, pharmacy: null }
const listeners = new Set<() => void>()

function learn(list: keyof PaperListsServed, value: boolean) {
  if (served[list] === value) return
  served = { ...served, [list]: value }
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const current = () => served

/** Whether each list is served, as the lists' own answers said; null until one has. */
export function usePaperListsServed(): PaperListsServed {
  return useSyncExternalStore(subscribe, current, current)
}

/** For tests: forget what was learned, as a new page would. */
export function forgetPaperListsServed(): void {
  served = { lab: null, pharmacy: null }
  for (const listener of listeners) listener()
}

async function list<T>(which: keyof PaperListsServed, path: string, facilityId: string, patientId: string, cursor: string | undefined,
  parse: (answer: unknown, patientId: string) => PaperPage<T>, signal?: AbortSignal): Promise<PaperListResult<T>> {
  const sentIn = staffSessionGeneration()
  const query: Record<string, string> = { patientId, limit: String(PAPER_PAGE_SIZE), ...(cursor ? { cursor } : {}) }
  try {
    const answer = await client().request<unknown>({
      method: 'GET', path, query,
      headers: { 'X-Facility-ID': facilityId, 'X-Purpose-Of-Use': 'direct-care' },
      signal: signal ? eitherAborted(signal, staffSessionSignal()) : staffSessionSignal(),
      beforeAttempt: () => untilStaffSessionReady(sentIn),
      dedupe: false,
    })
    const page = parse(answer, patientId)
    learn(which, true)
    return { ok: true, page }
  } catch (caught) {
    if (signal?.aborted) throw caught
    if (routeNotServed(caught)) { learn(which, false); return { ok: false, notServed: true } }
    if (endsStaffSession(caught)) reportStaffSessionEnded(sentIn)
    if (isHidApiError(caught) && caught.status === 403) return { ok: false, refused: true }
    return { ok: false, failed: true }
  }
}

function eitherAborted(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (first.aborted || second.aborted) return AbortSignal.abort()
  const both = new AbortController()
  const abort = () => both.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  return both.signal
}

export const paperRecordsApi = {
  /** One page of the patient's lab results imported from paper, newest received first. */
  labImports: (facilityId: string, patientId: string, cursor?: string, signal?: AbortSignal) =>
    list('lab', '/api/v1/lab/imports', facilityId, patientId, cursor, parseLab, signal),
  /** One page of the patient's medicines imported from paper, newest first. */
  medicines: (facilityId: string, patientId: string, cursor?: string, signal?: AbortSignal) =>
    list('pharmacy', '/api/v1/pharmacy/imports', facilityId, patientId, cursor, parseMedicines, signal),
}
