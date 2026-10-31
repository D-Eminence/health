import { createApiClient, isHidApiError, type HttpMethod, type QueryValue } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { getEnvironment } from '../../../staff/env'
import { staffSessionGeneration, staffSessionSignal, untilStaffSessionReady } from '../../../staff/session'
import { refusalText } from '../../../staff/fieldProblem'

/**
 * Point of care (docs/POINT_OF_CARE_SPEC.md): payment setup, the price list, bills and their payments, receipts, walk-ins,
 * stock, lab results sent to outside doctors and end of day. The routes are proposed: hid-system does not serve them yet.
 * Every call answers one of three shapes, and a 404 (or 501) is always `notAvailable`, "not switched on yet": nothing
 * here pretends to save. Health ID records payments; it never moves money. Money is kobo (integers), times ISO UTC.
 *
 * Its own client, registered as the provider portal ('staff-web') like staff/api.ts, so the contract registry and the
 * app boundary guard every request; each request waits for the staff session it was made in and ends with it.
 */

// ------------------------------------------------------------------ types --
export type PaymentMethod = 'cash' | 'pos' | 'transfer' | 'hmo' | 'waiver'
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'pos', 'transfer', 'hmo', 'waiver']

export interface TransferAccount { bankName: string; accountName: string; accountNumber: string }
export interface Hmo { id: string; name: string }

export interface PaymentSettings {
  wherePaid: 'cashier' | 'counter' | 'both'
  methods: PaymentMethod[]
  payBefore: { pharmacy: boolean; lab: boolean }
  allowDeferredFor: ('emergency' | 'inpatient')[]
  transferAccount?: TransferAccount | null
  hmos: Hmo[]
  receiptFooter?: string | null
  version: number
}

export type CatalogueKind = 'drug' | 'lab_test' | 'other'
export type CatalogueForm = 'tablet' | 'capsule' | 'liquid' | 'injection' | 'cream' | 'inhaler' | 'drops' | 'other'
export interface CatalogueItem {
  id: string; kind: CatalogueKind; name: string
  strength?: string | null; form?: CatalogueForm | null
  packSize?: string | null; imageUrl?: string | null
  prescriptionOnly: boolean
  prices: { cashKobo: number; hmo?: { hmoId: string; amountKobo: number }[] }
  active: boolean; version: number
}
/** POST /catalogue-items: an item without its server fields. */
export type CatalogueItemInput = Omit<CatalogueItem, 'id' | 'version' | 'imageUrl'>
/** PATCH /catalogue-items/:itemId: the fields that change, with the version read, or the image's file id. */
export type CatalogueItemPatch = Partial<CatalogueItemInput> & { expectedVersion: number; imageFileId?: string | null }

export type BillStatus = 'unpaid' | 'part_paid' | 'paid' | 'deferred' | 'void'
export type BillSource = 'pharmacy' | 'lab'
export interface BillLine {
  id: string; catalogueItemId: string | null; name: string; quantity: number; unitKobo: number; totalKobo: number
  workItemId?: string | null
}
export interface Payment {
  id: string; method: PaymentMethod; amountKobo: number
  /** POS RRN, transfer reference or HMO approval code. */
  reference?: string | null
  hmoId?: string | null; waivedBy?: string | null; reason?: string | null
  receivedBy: string; receivedAt: string; voided: boolean
  /** A transfer is 'pending_check' until someone with billing.payment.confirm confirms it. */
  status?: 'recorded' | 'pending_check' | 'confirmed' | null
}
export interface BillPatient { patientId: string | null; displayName: string; healthId?: string | null }
export interface Bill {
  id: string; number: string; source: BillSource; status: BillStatus
  /** null: an anonymous over-the-counter sale. */
  patient: BillPatient | null
  lines: BillLine[]; totalKobo: number; paidKobo: number; dueKobo: number; payments: Payment[]
  receiptNumber?: string | null; createdAt: string; version: number
}
/** The bill summary a pharmacy or lab work item carries; null when it has no bill. */
export type WorkItemBill = { billId: string; status: BillStatus; dueKobo: number; receiptNumber?: string | null } | null

export interface PaymentInput {
  method: PaymentMethod; amountKobo: number
  reference?: string | null; hmoId?: string | null; reason?: string | null
}
export interface BillInput {
  source: BillSource
  patient: { patientId: string } | { anonymous: true }
  lines: { catalogueItemId: string; quantity: number; workItemId?: string | null }[]
}

/** GET /bills/:billId/receipt: what the screen prints. */
export interface ReceiptData {
  receiptNumber: string
  facility: { name: string; address?: string | null; phone?: string | null }
  bill: Bill
  issuedAt: string
  issuedBy: string
  footer?: string | null
}

export type WalkInPatient =
  | { kind: 'health_id'; healthId: string }
  | { kind: 'quick'; name: string; phone: string; sex?: 'female' | 'male' | null; ageYears?: number | null; dateOfBirth?: string | null }
  | { kind: 'anonymous' }
export interface OutsideOrder {
  prescriberName: string; facilityName?: string | null; writtenOn?: string | null
  photoFileId?: string | null; prescriberEmail?: string | null; prescriberPhone?: string | null
}
export interface WalkInOrder {
  patient: WalkInPatient; outside?: OutsideOrder | null
  items: { catalogueItemId: string; quantity: number; dose?: string | null; frequency?: string | null; durationDays?: number | null }[]
}
export interface WalkInLabRequest {
  patient: Exclude<WalkInPatient, { kind: 'anonymous' }>; outside?: OutsideOrder | null
  tests: { catalogueItemId: string }[]; clinicalNote?: string | null; priority: 'routine' | 'urgent'
}
export interface WalkInAnswer { workItemIds: string[]; bill: Bill }

export interface StockLine {
  catalogueItemId: string; name: string; strength?: string | null; form?: string | null; imageUrl?: string | null
  onHand: number; unit: string; reorderLevel: number
  batches: { batchId: string; batchNumber: string; expiresOn: string; quantity: number }[]
}
export interface StockReceipt {
  supplier?: string | null; invoiceNumber?: string | null
  lines: { catalogueItemId: string; batchNumber: string; expiresOn: string; quantity: number; unitCostKobo?: number | null }[]
}
export interface StockAdjustment {
  catalogueItemId: string; batchId: string; change: number; reason: 'damaged' | 'expired' | 'count' | 'returned'; note?: string | null
}
export interface StockMovement {
  id: string; kind: 'receipt' | 'adjustment' | 'dispensing' | string; change: number; batchId?: string | null
  reason?: string | null; at: string; by?: string | null
}

export interface ResultShare { shareId: string; sentTo: string; expiresAt: string }

export interface ShiftTotal { method: PaymentMethod; count: number; amountKobo: number }
export interface Shift {
  id: string; openedBy: string; openedAt: string; closedAt?: string | null; openingCashKobo: number
  totals: ShiftTotal[]
  expectedCashKobo: number; countedCashKobo?: number | null; differenceKobo?: number | null
  unpaidBills: { count: number; amountKobo: number }; deferredBills: { count: number; amountKobo: number }
}

/** A page of a list. `nextPage` null at the end. */
export interface ListPage<T> { items: T[]; nextPage?: number | null; total?: number | null }

/** Every call's answer: the data, "not switched on yet" (404/501), or a refusal said in words. */
export type CommerceResult<T> =
  | { ok: true; data: T }
  | { ok: false; notAvailable: true }
  | { ok: false; notAvailable?: false; error: string; code?: string; status?: number }

// ----------------------------------------------------------------- client --
const transport = createApiClient({
  baseUrl: getEnvironment().apiBaseUrl,
  clientId: 'staff-web',
  sessionMode: 'cookie',
})
const client = createRegisteredBrowserClient(transport, 'staff-web')

type Query = Record<string, QueryValue>

/** One request, in this module's answer shape. Facility scoped; every write carries an Idempotency-Key. */
async function call<T>(method: HttpMethod, path: string, facilityId: string,
  options: { body?: unknown; query?: Query; idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<CommerceResult<T>> {
  const sentIn = staffSessionGeneration()
  const write = method !== 'GET'
  const query = options.query ? Object.fromEntries(Object.entries(options.query).filter(([, value]) => value !== undefined && value !== null && value !== '')) : undefined
  try {
    const data = await client.request<T>({
      method, path,
      ...(query && Object.keys(query).length > 0 ? { query } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
      headers: { 'X-Facility-ID': facilityId, ...(write ? { 'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID() } : {}) },
      signal: options.signal ? anyAborted(options.signal, staffSessionSignal()) : staffSessionSignal(),
      beforeAttempt: () => untilStaffSessionReady(sentIn),
      ...(write ? {} : { dedupe: false }),
    })
    return { ok: true, data }
  } catch (caught) {
    if (isHidApiError(caught) && (caught.status === 404 || caught.status === 501) && !isRecordNotFound(caught.code)) return { ok: false, notAvailable: true }
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught
    return {
      ok: false, error: messageOf(caught),
      ...(isHidApiError(caught) ? { code: caught.code, status: caught.status } : {}),
    }
  }
}

/**
 * A 404 that names a record the service knows it lacks (COMMERCIAL_BILL_NOT_FOUND) is a missing record, not a module
 * that is off. The gateway's own 404 (API_ROUTE_NOT_FOUND, NOT_FOUND) means the routes are not served here.
 */
function isRecordNotFound(code: string): boolean {
  return /^(COMMERCIAL|BILLING|PHARMACY|LAB)_[A-Z_]+_NOT_FOUND$/.test(code)
}

const PLAIN: Readonly<Record<string, string>> = {
  OVERPAYMENT: 'That is more than the amount due. Take the amount due and give the change.',
  PAYMENT_REQUIRED: 'This needs to be paid first.',
  OUT_OF_STOCK: 'There isn’t enough in stock.',
  VERSION_CONFLICT: 'Someone else changed this just now. Close it and open it again.',
  PRECONDITION_FAILED: 'Someone else changed this just now. Close it and open it again.',
  FORBIDDEN: 'You don’t have permission to do this here.',
}

function messageOf(caught: unknown): string {
  if (isHidApiError(caught)) {
    if (PLAIN[caught.code]) return PLAIN[caught.code]!
    if (caught.status === 403) return PLAIN.FORBIDDEN!
    if (caught.status === 409 && /VERSION|CONFLICT/.test(caught.code)) return PLAIN.VERSION_CONFLICT!
    if (caught.status === 0 || caught.status >= 500) return 'Couldn’t reach Health ID. Check the connection and try again.'
  }
  return refusalText(caught, 'Something went wrong. Try again.')
}

function anyAborted(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (first.aborted || second.aborted) return AbortSignal.abort()
  const both = new AbortController()
  const abort = () => both.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  return both.signal
}

const C = '/api/v1/commercial'
const id = (value: string) => encodeURIComponent(value)

// ------------------------------------------------------------------- calls --
export const commerce = {
  // §1 Payment setup
  paymentSettings: (facilityId: string, signal?: AbortSignal) =>
    call<PaymentSettings>('GET', `${C}/payment-settings`, facilityId, { signal }),
  savePaymentSettings: (facilityId: string, settings: PaymentSettings, idempotencyKey?: string) =>
    call<PaymentSettings>('PUT', `${C}/payment-settings`, facilityId, { body: settings, idempotencyKey }),

  // §2 Price list
  catalogueItems: (facilityId: string, filter: { kind?: CatalogueKind; q?: string; page?: number } = {}, signal?: AbortSignal) =>
    call<ListPage<CatalogueItem>>('GET', `${C}/catalogue-items`, facilityId, { query: { kind: filter.kind, q: filter.q, page: filter.page }, signal }),
  createCatalogueItem: (facilityId: string, item: CatalogueItemInput, idempotencyKey?: string) =>
    call<CatalogueItem>('POST', `${C}/catalogue-items`, facilityId, { body: item, idempotencyKey }),
  updateCatalogueItem: (facilityId: string, itemId: string, patch: CatalogueItemPatch, idempotencyKey?: string) =>
    call<CatalogueItem>('PATCH', `${C}/catalogue-items/${id(itemId)}`, facilityId, { body: patch, idempotencyKey }),

  // §3 Bills and payments
  bills: (facilityId: string, filter: { status?: BillStatus | 'open'; source?: BillSource; q?: string; page?: number } = {}, signal?: AbortSignal) =>
    call<ListPage<Bill>>('GET', `${C}/bills`, facilityId, { query: { status: filter.status, source: filter.source, q: filter.q, page: filter.page }, signal }),
  createBill: (facilityId: string, bill: BillInput, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills`, facilityId, { body: bill, idempotencyKey }),
  bill: (facilityId: string, billId: string, signal?: AbortSignal) =>
    call<Bill>('GET', `${C}/bills/${id(billId)}`, facilityId, { signal }),
  recordPayment: (facilityId: string, billId: string, payment: PaymentInput, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/payments`, facilityId, { body: payment, idempotencyKey }),
  voidPayment: (facilityId: string, billId: string, paymentId: string, reason: string, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/payments/${id(paymentId)}/void`, facilityId, { body: { reason }, idempotencyKey }),
  confirmPayment: (facilityId: string, billId: string, paymentId: string, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/payments/${id(paymentId)}/confirm`, facilityId, { body: {}, idempotencyKey }),
  receipt: (facilityId: string, billId: string, signal?: AbortSignal) =>
    call<ReceiptData>('GET', `${C}/bills/${id(billId)}/receipt`, facilityId, { signal }),
  deferBill: (facilityId: string, billId: string, reason: 'emergency' | 'inpatient', idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/defer`, facilityId, { body: { reason }, idempotencyKey }),

  // §4 Walk-ins and outside orders
  pharmacyWalkIn: (facilityId: string, order: WalkInOrder, idempotencyKey?: string) =>
    call<WalkInAnswer>('POST', '/api/v1/pharmacy/walk-in-orders', facilityId, { body: order, idempotencyKey }),
  labWalkIn: (facilityId: string, request: WalkInLabRequest, idempotencyKey?: string) =>
    call<WalkInAnswer>('POST', '/api/v1/lab/walk-in-requests', facilityId, { body: request, idempotencyKey }),

  // §5 Stock (pharmacy)
  stock: (facilityId: string, filter: { q?: string; filter?: 'low' | 'expiring'; page?: number } = {}, signal?: AbortSignal) =>
    call<ListPage<StockLine>>('GET', '/api/v1/pharmacy/stock', facilityId, { query: { q: filter.q, filter: filter.filter, page: filter.page }, signal }),
  receiveStock: (facilityId: string, receipt: StockReceipt, idempotencyKey?: string) =>
    call<{ lines: StockLine[] }>('POST', '/api/v1/pharmacy/stock/receipts', facilityId, { body: receipt, idempotencyKey }),
  adjustStock: (facilityId: string, adjustment: StockAdjustment, idempotencyKey?: string) =>
    call<StockLine>('POST', '/api/v1/pharmacy/stock/adjustments', facilityId, { body: adjustment, idempotencyKey }),
  stockMovements: (facilityId: string, catalogueItemId: string, signal?: AbortSignal) =>
    call<ListPage<StockMovement>>('GET', `/api/v1/pharmacy/stock/${id(catalogueItemId)}/movements`, facilityId, { signal }),

  // §6 Lab results to outside doctors
  shareLabResult: (facilityId: string, accessionId: string, email: string, idempotencyKey?: string) =>
    call<ResultShare>('POST', `/api/v1/lab/accessions/${id(accessionId)}/result-shares`, facilityId, { body: { email }, idempotencyKey }),

  // §7 End of day
  currentShift: (facilityId: string, signal?: AbortSignal) =>
    call<Shift | null>('GET', `${C}/shifts/current`, facilityId, { signal }),
  openShift: (facilityId: string, openingCashKobo: number, idempotencyKey?: string) =>
    call<Shift>('POST', `${C}/shifts`, facilityId, { body: { openingCashKobo }, idempotencyKey }),
  closeShift: (facilityId: string, shiftId: string, countedCashKobo: number, note?: string | null, idempotencyKey?: string) =>
    call<Shift>('POST', `${C}/shifts/${id(shiftId)}/close`, facilityId, { body: { countedCashKobo, ...(note ? { note } : {}) }, idempotencyKey }),
  shifts: (facilityId: string, date?: string, signal?: AbortSignal) =>
    call<ListPage<Shift>>('GET', `${C}/shifts`, facilityId, { query: { date }, signal }),
}

// ------------------------------------------------------------------ words --
export const METHOD_LABEL: Readonly<Record<PaymentMethod, string>> = {
  cash: 'Cash', pos: 'POS', transfer: 'Transfer', hmo: 'HMO', waiver: 'Waiver',
}
export const BILL_STATUS_LABEL: Readonly<Record<BillStatus, string>> = {
  unpaid: 'Unpaid', part_paid: 'Part paid', paid: 'Paid', deferred: 'Bill follows', void: 'Cancelled',
}
export const SOURCE_LABEL: Readonly<Record<BillSource, string>> = { pharmacy: 'Pharmacy', lab: 'Lab' }
