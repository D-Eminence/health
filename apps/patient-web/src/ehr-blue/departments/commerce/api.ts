import { createApiClient, isHidApiError, type HttpMethod, type QueryValue } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { getEnvironment } from '../../../staff/env'
import { staffSessionGeneration, staffSessionSignal, untilStaffSessionReady } from '../../../staff/session'
import { refusalText } from '../../../staff/fieldProblem'
import { learnBillingServed } from './served'

/**
 * Patient billing release 1 with pharmacy point-of-care stock (hid-system BILL-1, migrations 0162-0167; the contract is
 * docs/EHR_PLANNED_CONTRACT.md "BILL-1" on hid-system claude/sprint-billing-backend, built on docs/POINT_OF_CARE_SPEC.md):
 * payment setup, the price list (the facility's one item master, BILL-7), bills and their payments and HMO cover,
 * receipts, outstanding balances, end of day, pharmacy stock and counter sales. The lab's walk-ins and results sent to
 * outside doctors (§4 and §6) are not in BILL-1 and stay proposed.
 *
 * Every call answers one of three shapes, and a 404 that is not a missing record (BILLING_NOT_AVAILABLE, or a backend
 * without these routes) is always `notAvailable`, "not switched on yet": nothing here pretends to save. Each answer at a
 * facility also teaches served.ts whether billing is served there. Health ID records payments; it never moves money.
 * Money is kobo (integers), times ISO UTC, a day is the Lagos day. No Health ID or NIN is ever put in an address: a
 * Health ID goes in a body (a counter sale, putting a sale on a Health ID), and a search that looks like one is refused
 * before it is sent (searchTextRefused).
 *
 * Its own client, registered as the provider portal ('staff-web') like staff/api.ts, so the contract registry and the
 * app boundary guard every request; each request waits for the staff session it was made in and ends with it.
 */

// ------------------------------------------------------------------ types --
/** The ways to pay staff can choose. `online` (Paystack, BILL-14) is built but switched off, so it is never offered. */
export type PaymentMethod = 'cash' | 'pos' | 'transfer' | 'hmo' | 'waiver'
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'pos', 'transfer', 'hmo', 'waiver']
/** A payment on a bill: one of the ways above (never `hmo`, which is HMO cover), or `online` once it is switched on. */
export type RecordedMethod = Exclude<PaymentMethod, 'hmo'> | 'online'

export interface TransferAccount { bankName: string; accountName: string; accountNumber: string }
/** An HMO the facility accepts. Never deleted: `active: false` hides it from Take payment and keeps its history. */
export interface Hmo { id: string; name: string; active?: boolean }
/** Who opens and closes a day (§7): the whole facility as one, each cashier their own, or each till. */
export type DayCloseBy = 'facility' | 'cashier' | 'till'
/** A till. Never deleted: `active: false` hides it (refused TILL_DAY_OPEN while a day is open on it). */
export interface Till { id: string; name: string; active?: boolean }

export interface PaymentSettings {
  wherePaid: 'cashier' | 'counter' | 'both'
  methods: PaymentMethod[]
  payBefore: { pharmacy: boolean; lab: boolean }
  /** Always holds `emergency` (BILL-3: cannot be switched off). */
  allowDeferredFor: ('emergency' | 'inpatient')[]
  transferAccount?: TransferAccount | null
  hmos: Hmo[]
  receiptFooter?: string | null
  /** How the day is closed here; with 'till', the tills a day is opened on. */
  dayCloseBy: DayCloseBy
  tills: Till[]
  /** An active Service whose line opens every visit's bill at check-in, or null. */
  checkInChargeItemId?: string | null
  /** Whether "pay before" may be switched on (the clinical lead's sign-off of BILL-3); off: built but switched off. */
  payBeforeAvailable?: boolean
  /** Whether paying online is switched on (BILL-14); off everywhere in release 1. */
  onlinePaymentAvailable?: boolean
  version: number
}
/** PUT payment-settings: the whole object, a new HMO or till without its id, and the version read. */
export interface PaymentSettingsInput extends Omit<PaymentSettings, 'hmos' | 'tills' | 'version' | 'payBeforeAvailable' | 'onlinePaymentAvailable'> {
  hmos: { id?: string; name: string; active: boolean }[]
  tills: { id?: string; name: string; active: boolean }[]
  expectedVersion: number
}

export type CatalogueKind = 'drug' | 'lab_test' | 'other'
export type CatalogueForm = 'tablet' | 'capsule' | 'liquid' | 'injection' | 'cream' | 'inhaler' | 'drops' | 'other'
/** The national list an item is linked to by its fixed code (ORD-7): HID-MED for a drug, LOINC or HID-LAB for a test. */
export type NationalCodeSystem = 'HID-MED' | 'LOINC' | 'HID-LAB'
export interface CatalogueItem {
  id: string; kind: CatalogueKind; name: string
  strength?: string | null; form?: CatalogueForm | null
  packSize?: string | null; imageUrl?: string | null
  prescriptionOnly: boolean
  nationalCodeSystem?: NationalCodeSystem | null; nationalCode?: string | null
  orderable?: boolean
  prices: { cashKobo: number; hmo?: { hmoId: string; amountKobo: number }[] }
  /** Whether pharmacy stock is counted for it (drugs only; set by the stock settings route). */
  stockKept?: boolean
  active: boolean; version: number
}
/** POST /catalogue-items: an item without its server fields. */
export type CatalogueItemInput = Omit<CatalogueItem, 'id' | 'version' | 'imageUrl' | 'stockKept' | 'active'>
/** PATCH /catalogue-items/:itemId: only the fields that change, with the version read. `kind` never changes. */
export type CatalogueItemPatch = Partial<Omit<CatalogueItemInput, 'kind'>> & { active?: boolean; expectedVersion: number }
/** A national code that reached this facility's pharmacy or lab with no priced item, in the last 30 days (a count only). */
export interface UnpricedCode { codeSystem: NationalCodeSystem; code: string; display: string; count: number }

export type BillStatus = 'unpaid' | 'part_paid' | 'paid' | 'deferred' | 'void'
/** A visit's bill (one waiting-list entry), or a pharmacy or lab sale (BILL-1). */
export type BillSource = 'visit' | 'pharmacy' | 'lab'
export type LineOrigin = 'check_in' | 'pharmacy' | 'lab' | 'counter' | 'manual'
export interface BillLine {
  id: string; catalogueItemId: string | null; name: string; quantity: number; unitKobo: number; totalKobo: number
  kind?: CatalogueKind; workItemId?: string | null; origin?: LineOrigin | null
  /** The pharmacy's quantity was not in the item's unit: the cashier checks it. */
  checkQuantity?: boolean; note?: string | null; cancelled?: boolean
  /**
   * The work item's dispensing was reversed. The server cancels such a line when the bill can lose it; one still live
   * was paid for, so a refund is due (cancel the payment, then the line).
   */
  dispensingReversed?: boolean
}
export interface Payment {
  id: string; method: RecordedMethod; amountKobo: number
  /** POS RRN or transfer reference. */
  reference?: string | null
  waivedBy?: string | null; reason?: string | null
  /** Staff display names, never account ids. */
  receivedBy: string; receivedAt: string; voided: boolean
  /** A transfer is 'pending_check' until someone else confirms it (billing.payment.confirm). */
  status?: 'recorded' | 'pending_check' | 'confirmed' | null
  receiptNumber?: string | null; tillDayId?: string | null
  voidedBy?: string | null; voidedAt?: string | null; voidReason?: string | null
  /** The number from the paper receipt book, when it was taken while the system was down (BILL-6). */
  paperReceiptNumber?: string | null
}
/** What an HMO is to pay on a bill (BILL-8): owed by the HMO until a claim is accepted. Never money received. */
export interface HmoCover {
  id: string; hmoId: string; hmoName: string; amountKobo: number; approvalCode: string
  status: 'pending_claim' | 'cancelled' | 'claimed' | 'accepted' | 'rejected'
  recordedBy: string; recordedAt: string
}
/** A patient as a bill shows them: the display name and the last 4 characters of the Health ID, never the whole one. */
export interface BillPatient { patientId: string | null; displayName: string; healthIdLast4?: string | null }
export type DeferredReason = 'emergency' | 'inpatient' | 'unknown_patient'
export interface Bill {
  id: string; number: string; source: BillSource; status: BillStatus
  /** null: an anonymous counter sale (then `displayName` is the name the customer gave, or "Counter sale"). */
  patient: BillPatient | null
  displayName?: string | null
  /** A counter sale (POST pharmacy/walk-in-orders). */
  counter?: boolean
  visit?: { visitQueueEntryId: string; queueDay: string } | null
  lines: BillLine[]
  totalKobo: number; paidKobo: number; dueKobo: number
  waivedKobo?: number; hmoCoveredKobo?: number; pendingCheckKobo?: number
  payments: Payment[]; hmoCovers?: HmoCover[]
  deferred?: { reason: DeferredReason; by: 'system' | 'staff'; at: string } | null
  receiptNumber?: string | null; createdAt: string; version: number
  /** A counter sale: when its items were handed over, or null while they wait. */
  handedOverAt?: string | null
}
/** The bill summary a pharmacy or lab work item carries; null or absent when it has no line ("Not billed"). */
export type WorkItemBill = {
  billId: string; status: BillStatus; dueKobo: number; receiptNumber?: string | null
  pendingCheckKobo?: number; deferred?: DeferredReason | null
  /** The dispensing was reversed after its line was paid: a refund is due. */
  dispensingReversed?: boolean
} | null

export interface PaymentInput {
  method: PaymentMethod; amountKobo: number
  /** POS RRN, transfer reference, or the HMO's approval code. */
  reference?: string | null; hmoId?: string | null; reason?: string | null
  tillId?: string | null; paperReceiptNumber?: string | null; expectedVersion?: number
}
export interface BillInput {
  source: BillSource
  /** A waiting-list entry (the visit), or nobody, for a pharmacy or lab sale. Never a free patient id. */
  patient: { visitQueueEntryId: string } | { anonymous: true; name?: string | null }
  lines: { catalogueItemId: string; quantity: number }[]
}

/** GET /bills/:billId/receipt: what the screen prints. A receipt for an HMO cover does not exist. */
export interface ReceiptData {
  receiptNumber: string
  facility: { name: string; address?: string | null; phone?: string | null }
  bill: Bill
  payment?: Payment | null
  /** The payment was voided: the receipt keeps its number and prints "Cancelled". */
  cancelled?: boolean
  paperReceiptNumber?: string | null
  issuedAt: string
  issuedBy: string
  footer?: string | null
}

/** The Home billing card (GET bills/summary): numbers only, no patient. */
export interface BillSummary {
  date: string; billedKobo: number; collectedKobo: number; waivedKobo: number; hmoCoveredKobo: number
  outstandingKobo: number; billCount: number
}
/** Patients who owe, oldest bill first (GET outstanding). */
export interface OutstandingPatient {
  patient: BillPatient | null
  bills: { billId: string; number: string; createdAt: string; dueKobo: number; deferred: boolean }[]
  dueKobo: number; oldestDays: number
}
export interface OutstandingPage { items: OutstandingPatient[]; totalDueKobo: number; nextPage?: number | null }
/** What each HMO owes (GET hmo-receivables). */
export interface HmoOwes { hmoId: string; hmoName: string; count: number; amountKobo: number; oldestDays: number }

/**
 * Who a walk-in is for: their Health ID (one made at the counter through facility registration counts), or no one, for
 * an over-the-counter sale at a pharmacy. There is no "quick details" patient: someone without a Health ID gets one.
 */
export type WalkInPatient =
  | { kind: 'health_id'; healthId: string }
  /**
   * No Health ID (the owner's decision: care comes first, identity is optional). A name and phone when the customer
   * gives them, for the receipt and to find the sale again; a prescription-only item needs the doctor's prescription
   * (`outside`) instead of a Health ID.
   */
  | { kind: 'anonymous'; name?: string | null; phone?: string | null }
export interface OutsideOrder {
  prescriberName: string; facilityName?: string | null; writtenOn?: string | null
  photoFileId?: string | null; prescriberEmail?: string | null; prescriberPhone?: string | null
}
export interface WalkInOrder {
  patient: WalkInPatient; outside?: OutsideOrder | null
  /**
   * A sale at the counter: handed over across the counter (POST pharmacy/sales/:billId/hand-over). Release 1 takes
   * counter sales only (BILL-13): queuing an outside prescription is refused 409 WALK_IN_QUEUE_NOT_AVAILABLE.
   */
  counter?: boolean
  items: { catalogueItemId: string; quantity: number; dose?: string | null; frequency?: string | null; durationDays?: number | null }[]
}
/**
 * Who a lab walk-in is for (owner decision 2026-10-31: work first, identity optional): always the basics, all four
 * required (to label the sample, read results against the right ranges and send them by SMS), and their Health ID
 * when they have one.
 */
export interface LabWalkInPatient {
  name: string; ageYears: number; sex: 'female' | 'male'; phone: string; healthId?: string | null
}
export interface WalkInLabRequest {
  patient: LabWalkInPatient; outside?: OutsideOrder | null
  tests: { catalogueItemId: string }[]; clinicalNote?: string | null; priority: 'routine' | 'urgent'
}
export interface WalkInAnswer { workItemIds: string[]; bill: Bill }
/** A counter sale handed over: when, and the bill as it now stands. */
export interface SaleHandOver { handedOverAt: string; bill: Bill }

export interface StockBatch { batchId: string; batchNumber: string; expiresOn: string; quantity: number; expired?: boolean }
export interface StockLine {
  catalogueItemId: string; name: string; strength?: string | null; form?: string | null; imageUrl?: string | null
  /** On hand in batches that have not expired. */
  onHand: number
  /** On hand in expired batches: never given out, waiting for an "expired" adjustment. */
  expiredOnHand?: number
  unit: string; reorderLevel: number
  batches: StockBatch[]
  version?: number
}
export interface StockReceipt {
  supplier?: string | null; invoiceNumber?: string | null
  lines: { catalogueItemId: string; batchNumber: string; expiresOn: string; quantity: number; unitCostKobo?: number | null }[]
}
export interface StockAdjustment {
  catalogueItemId: string; batchId: string; change: number; reason: 'damaged' | 'expired' | 'count' | 'returned'; note?: string | null
}
/** PUT pharmacy/stock/:catalogueItemId/settings: counts stock for the item, in this unit, with a reorder level. */
export interface StockSettings { unit: string; reorderLevel: number; expectedVersion: number }
export interface StockMovement {
  id: string
  kind: 'receipt' | 'adjustment' | 'dispensing' | 'counter_sale' | string
  change: number; batchId?: string | null; batchNumber?: string | null
  reason?: string | null; at: string; by?: string | null
}

/** The largest photo or picture the upload takes (§4): 10 MB. */
export const ORDER_PHOTO_MAX_BYTES = 10 * 1024 * 1024

export interface ResultShare { shareId: string; sentTo: string; expiresAt: string }
/** Where a released lab result goes (§6): by email (the doctor, or the patient) or by SMS (the patient). */
export interface ResultShareInput { channel: 'email' | 'sms'; to: string }

export interface ShiftTotal { method: RecordedMethod; count: number; amountKobo: number }
export interface Shift {
  id: string; openedBy: string; openedAt: string; closedAt?: string | null; closedBy?: string | null; openingCashKobo: number
  /** Whose day it is: the facility's, one cashier's (cashierName), or one till's (tillId, tillName). */
  scope: DayCloseBy
  cashierName?: string | null; tillId?: string | null; tillName?: string | null
  /** Money taken by way of paying, less what was cancelled in this day. Never waivers or HMO cover. */
  totals: ShiftTotal[]
  /** Waivers in this day: listed apart, never in the cash expected. */
  waivers?: { count: number; amountKobo: number }
  /** HMO cover recorded in this day: owed by the HMO, for information only. */
  hmoCovered?: { count: number; amountKobo: number }
  expectedCashKobo: number; countedCashKobo?: number | null; differenceKobo?: number | null; note?: string | null
  /** Left open over midnight, from 06:00 Lagos. */
  overdue?: boolean
  unpaidBills: { count: number; amountKobo: number }; deferredBills: { count: number; amountKobo: number }
  version?: number
}

/** A page of a list. `nextPage` null at the end. */
export interface ListPage<T> { items: T[]; nextPage?: number | null; total?: number | null }

/** Every call's answer: the data, "not switched on yet" (404/501), or a refusal said in words. */
export type CommerceResult<T> =
  | { ok: true; data: T }
  | { ok: false; notAvailable: true }
  | { ok: false; notAvailable?: false; error: string; code?: string; status?: number }

// ----------------------------------------------------------------- client --
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

type Query = Record<string, QueryValue>

/** Whether a path is one of BILL-1's routes, whose answers say whether billing is served at the facility. */
const BILLING_ROUTE = /^\/api\/v1\/(commercial\/(payment-settings|catalogue-items|bills|outstanding|hmo-receivables|shifts)|pharmacy\/(stock|walk-in-orders|sales))(\/|$)/

/**
 * One request, in this module's answer shape. Facility scoped; every write carries an Idempotency-Key. Billing routes run
 * for healthcare operations (X-Purpose-Of-Use, which the routes that show patients need); the lab's proposed routes and
 * the photo upload send nothing of the kind.
 */
async function call<T>(method: HttpMethod, path: string, facilityId: string,
  options: { body?: unknown; query?: Query; idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<CommerceResult<T>> {
  const sentIn = staffSessionGeneration()
  const write = method !== 'GET'
  const billing = BILLING_ROUTE.test(path)
  const query = options.query ? Object.fromEntries(Object.entries(options.query).filter(([, value]) => value !== undefined && value !== null && value !== '')) : undefined
  try {
    const data = await client().request<T>({
      method, path,
      ...(query && Object.keys(query).length > 0 ? { query } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
      headers: {
        'X-Facility-ID': facilityId,
        ...(billing ? { 'X-Purpose-Of-Use': 'healthcare-operations' } : {}),
        ...(write ? { 'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID() } : {}),
      },
      signal: options.signal ? anyAborted(options.signal, staffSessionSignal()) : staffSessionSignal(),
      beforeAttempt: () => untilStaffSessionReady(sentIn),
      ...(write ? {} : { dedupe: false }),
    })
    if (billing) learnBillingServed(facilityId, true)
    return { ok: true, data }
  } catch (caught) {
    if (isHidApiError(caught) && (caught.status === 404 || caught.status === 501) && !isRecordNotFound(caught.code)) {
      if (billing) learnBillingServed(facilityId, false)
      return { ok: false, notAvailable: true }
    }
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught
    // A refusal in BILL-1's own words is an answer: the routes are there. Anything else (a 503, a lost connection, a
    // gateway's own refusal) says nothing either way.
    if (billing && isHidApiError(caught) && caught.status >= 400 && caught.status < 500 && Object.hasOwn(BILLING_WORDS, caught.code)) {
      learnBillingServed(facilityId, true)
    }
    return {
      ok: false, error: messageOf(caught),
      ...(isHidApiError(caught) ? { code: caught.code, status: caught.status } : {}),
    }
  }
}

/**
 * A 404 that names a record the service knows it lacks is a missing record, not a module that is off. BILL-1's own:
 * BILL_NOT_FOUND, CATALOGUE_ITEM_NOT_FOUND, PAYMENT_NOT_FOUND, SHIFT_NOT_FOUND, RECEIPT_NOT_FOUND, PATIENT_NOT_FOUND;
 * and any COMMERCIAL_, BILLING_, PHARMACY_ or LAB_ …_NOT_FOUND. The gateway's own 404 (API_ROUTE_NOT_FOUND, NOT_FOUND),
 * BILLING_NOT_AVAILABLE and ONLINE_PAYMENT_NOT_AVAILABLE mean the routes are not served or not switched on here.
 */
function isRecordNotFound(code: string): boolean {
  return RECORD_NOT_FOUND.has(code) || /^(COMMERCIAL|BILLING|PHARMACY|LAB)_[A-Z_]+_NOT_FOUND$/.test(code)
}
const RECORD_NOT_FOUND: ReadonlySet<string> = new Set(['BILL_NOT_FOUND', 'CATALOGUE_ITEM_NOT_FOUND', 'PAYMENT_NOT_FOUND',
  'SHIFT_NOT_FOUND', 'RECEIPT_NOT_FOUND', 'PATIENT_NOT_FOUND'])

const NOT_FOUND_HERE = 'This was not found at this facility.'
const CHANGED = 'Someone else changed this. Reload it and try again.'
/** The words staff see for each refusal (BILL-1's error table). None says "permission". */
export const BILLING_WORDS: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Check the highlighted fields.',
  BILLING_SEARCH_TEXT_NOT_ALLOWED: 'Search by bill number, receipt number or name. Do not type a Health ID or NIN here.',
  BILLING_NOT_ALLOWED: 'Your role here does not include this. Ask a billing officer or administrator.',
  SECOND_PERSON_REQUIRED: 'Another member of staff must do this, not the person who recorded the payment.',
  PAYMENT_AT_CASHIER_ONLY: 'Payments here are taken at the cashier.',
  BILL_NOT_FOUND: NOT_FOUND_HERE, CATALOGUE_ITEM_NOT_FOUND: NOT_FOUND_HERE, PAYMENT_NOT_FOUND: NOT_FOUND_HERE,
  SHIFT_NOT_FOUND: NOT_FOUND_HERE, RECEIPT_NOT_FOUND: NOT_FOUND_HERE, PATIENT_NOT_FOUND: NOT_FOUND_HERE,
  OVERPAYMENT: 'That is more than is due. Enter the amount due or less.',
  PAYMENT_METHOD_NOT_ACCEPTED: 'This facility does not take that payment method.',
  PAYMENT_NOT_PENDING: 'This transfer has already been checked or cancelled.',
  PAYMENT_ALREADY_VOIDED: 'This payment was already cancelled.',
  PAYMENT_REQUIRED: 'This bill must be paid first.',
  PAYMENT_PENDING_CHECK: 'A transfer on this bill is waiting to be checked.',
  BILL_VOID: 'This bill was cancelled.',
  BILL_HAS_PAYMENTS: 'This bill has payments. Cancel them first.',
  LINE_CANCEL_BELOW_PAID: 'More has been paid than the bill would total. Cancel a payment first.',
  BILL_NOT_A_COUNTER_SALE: 'Only a counter sale can be put on a Health ID or handed over here.',
  TILL_DAY_NOT_OPEN: 'Open your day first.',
  SHIFT_ALREADY_OPEN: 'A day is already open here.',
  TILL_DAY_OPEN: 'Close the open day first.',
  PAY_BEFORE_NOT_AVAILABLE: 'Pay before is not switched on yet.',
  EMERGENCY_DEFERRAL_REQUIRED: 'Emergency patients are always served first. This cannot be switched off.',
  DEFERRAL_REASON_NOT_AVAILABLE: 'Inpatient billing is not available yet.',
  NATIONAL_CODE_NOT_FOUND: 'This code is not on the national list.',
  NATIONAL_CODE_ALREADY_PRICED: 'Another item already has this code.',
  CATALOGUE_ITEM_EXISTS: 'An active item already has this name.',
  CATALOGUE_LIMIT: 'This facility has 5,000 items. Withdraw one first.',
  OUT_OF_STOCK: 'Not enough in stock.',
  STOCK_BELOW_ZERO: 'Stock cannot go below zero.',
  STOCK_NOT_KEPT: 'Stock is not counted for this item.',
  STOCK_UNIT_LOCKED: 'The unit cannot change while there is stock.',
  STOCK_UNIT_MISMATCH: 'Dispense in the item’s stock unit.',
  BATCH_EXPIRY_MISMATCH: 'This batch number already has another expiry date.',
  ALREADY_HANDED_OVER: 'These items were already handed over.',
  WALK_IN_QUEUE_NOT_AVAILABLE: 'Sell it at the counter. Queuing outside prescriptions is not available yet.',
  VERSION_CONFLICT: CHANGED, PRECONDITION_FAILED: CHANGED,
  PRESCRIPTION_REQUIRED: 'This medicine needs a doctor’s prescription.',
  BILLING_UNAVAILABLE: 'Billing is not available right now.',
}
/** BILLING_NOT_ALLOWED's words, for any refusal of a role (403) this module has no words for. */
export const NOT_IN_YOUR_ROLE = BILLING_WORDS.BILLING_NOT_ALLOWED!

/** A refusal in plain words: this module's own for the codes it knows, else refusalText's (never the server's text). */
function messageOf(caught: unknown): string {
  if (isHidApiError(caught)) {
    if (Object.hasOwn(BILLING_WORDS, caught.code)) return BILLING_WORDS[caught.code]!
    if (caught.status === 403) return NOT_IN_YOUR_ROLE
    if ((caught.status === 409 || caught.status === 412) && /VERSION|CONFLICT/.test(caught.code)) return CHANGED
    if ((caught.status === 0 && caught.code !== 'REQUEST_CANCELLED') || caught.status >= 500) return 'Couldn’t reach Health ID. Check the connection and try again.'
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

/**
 * Whether search text looks like a Health ID or an 11-digit NIN, which the billing searches refuse (and never log):
 * refused here first, so it never reaches an address. The backend's own test (commercial-errors.ts searchTextRefused).
 */
export function searchTextRefused(q: string | null | undefined): boolean {
  if (!q) return false
  const compact = q.replace(/[\s-]+/g, '')
  return /HID-[A-HJ-NP-Z2-9]{2,}/i.test(q) || /\d{11,}/.test(compact)
}
/** The refusal a page gets for such a search, without sending it. */
const searchRefused = <T,>(): Promise<CommerceResult<T>> => Promise.resolve({ ok: false, error: BILLING_WORDS.BILLING_SEARCH_TEXT_NOT_ALLOWED!,
  code: 'BILLING_SEARCH_TEXT_NOT_ALLOWED', status: 400 })

/** A list's answer as the pages take it: BILL-1's price list says `more`, every other list `nextPage`. */
type Paged<T> = { items: T[]; nextPage?: number | null; more?: boolean; page?: number; total?: number | null }
function paged<T>(result: CommerceResult<Paged<T>>): CommerceResult<ListPage<T>> {
  if (!result.ok) return result
  const { items, nextPage, more, page, total } = result.data
  return { ok: true, data: { items: items ?? [], nextPage: nextPage ?? (more ? (page ?? 1) + 1 : null), ...(total !== undefined ? { total } : {}) } }
}
const map = <A, B>(result: CommerceResult<A>, change: (data: A) => B): CommerceResult<B> => result.ok ? { ok: true, data: change(result.data) } : result

const C = '/api/v1/commercial'
const id = (value: string) => encodeURIComponent(value)

// ------------------------------------------------------------------- calls --
export const commerce = {
  // §1 Payment setup
  paymentSettings: (facilityId: string, signal?: AbortSignal) =>
    call<PaymentSettings>('GET', `${C}/payment-settings`, facilityId, { signal }),
  savePaymentSettings: (facilityId: string, settings: PaymentSettingsInput, idempotencyKey?: string) =>
    call<PaymentSettings>('PUT', `${C}/payment-settings`, facilityId, { body: settings, idempotencyKey }),

  // §2 Price list
  catalogueItems: async (facilityId: string, filter: { kind?: CatalogueKind; q?: string; active?: boolean; page?: number } = {}, signal?: AbortSignal) =>
    searchTextRefused(filter.q) ? searchRefused<ListPage<CatalogueItem>>()
      : paged(await call<Paged<CatalogueItem>>('GET', `${C}/catalogue-items`, facilityId,
        { query: { kind: filter.kind, q: filter.q && filter.q.trim().length >= 2 ? filter.q.trim() : undefined, active: filter.active, page: filter.page }, signal })),
  createCatalogueItem: (facilityId: string, item: CatalogueItemInput, idempotencyKey?: string) =>
    call<CatalogueItem>('POST', `${C}/catalogue-items`, facilityId, { body: item, idempotencyKey }),
  updateCatalogueItem: (facilityId: string, itemId: string, patch: CatalogueItemPatch, idempotencyKey?: string) =>
    call<CatalogueItem>('PATCH', `${C}/catalogue-items/${id(itemId)}`, facilityId, { body: patch, idempotencyKey }),
  /** The national codes that reached the pharmacy or lab with no price here (billing.catalogue.manage). */
  unpricedCodes: (facilityId: string, signal?: AbortSignal) =>
    call<{ items: UnpricedCode[] }>('GET', `${C}/catalogue-items/unpriced-codes`, facilityId, { signal }),

  // §3 Bills and payments
  /** `date` (YYYY-MM-DD, the Lagos day): the bills made that day, newest first. `q` never a Health ID or NIN. */
  bills: async (facilityId: string, filter: { status?: BillStatus | 'open'; source?: BillSource; q?: string; date?: string; page?: number } = {}, signal?: AbortSignal) =>
    searchTextRefused(filter.q) ? searchRefused<ListPage<Bill>>()
      : paged(await call<Paged<Bill>>('GET', `${C}/bills`, facilityId,
        { query: { status: filter.status, source: filter.source, q: filter.q && filter.q.trim().length >= 2 ? filter.q.trim() : undefined, date: filter.date, page: filter.page }, signal })),
  /** Home's billing card: a Lagos day's totals, numbers only. */
  billSummary: (facilityId: string, date?: string, signal?: AbortSignal) =>
    call<BillSummary>('GET', `${C}/bills/summary`, facilityId, { query: { date }, signal }),
  createBill: (facilityId: string, bill: BillInput, idempotencyKey?: string) =>
    call<Bill & { merged?: boolean }>('POST', `${C}/bills`, facilityId, { body: bill, idempotencyKey }),
  bill: (facilityId: string, billId: string, signal?: AbortSignal) =>
    call<Bill>('GET', `${C}/bills/${id(billId)}`, facilityId, { signal }),
  addLine: (facilityId: string, billId: string, line: { catalogueItemId: string; quantity: number; note?: string | null; expectedVersion: number }, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/lines`, facilityId, { body: line, idempotencyKey }),
  cancelLine: (facilityId: string, billId: string, lineId: string, reason: string, expectedVersion: number, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/lines/${id(lineId)}/cancel`, facilityId, { body: { reason, expectedVersion }, idempotencyKey }),
  /** A payment, or HMO cover (method `hmo`: recorded as owed by the HMO, never as a payment). */
  recordPayment: (facilityId: string, billId: string, payment: PaymentInput, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/payments`, facilityId, { body: payment, idempotencyKey }),
  /** Cancels a payment (a refund is one, with "Refund: …"): by someone other than the person who took it. */
  voidPayment: (facilityId: string, billId: string, paymentId: string, reason: string, expectedVersion?: number, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/payments/${id(paymentId)}/void`, facilityId,
      { body: { reason, ...(expectedVersion !== undefined ? { expectedVersion } : {}) }, idempotencyKey }),
  confirmPayment: (facilityId: string, billId: string, paymentId: string, expectedVersion?: number, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/payments/${id(paymentId)}/confirm`, facilityId,
      { body: expectedVersion !== undefined ? { expectedVersion } : {}, idempotencyKey }),
  cancelHmoCover: (facilityId: string, billId: string, coverId: string, reason: string, expectedVersion: number, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/hmo-covers/${id(coverId)}/cancel`, facilityId, { body: { reason, expectedVersion }, idempotencyKey }),
  voidBill: (facilityId: string, billId: string, reason: string, expectedVersion: number, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/void`, facilityId, { body: { reason, expectedVersion }, idempotencyKey }),
  /** One payment's receipt, or without `paymentId` the latest. */
  receipt: (facilityId: string, billId: string, signal?: AbortSignal, paymentId?: string) =>
    call<ReceiptData>('GET', `${C}/bills/${id(billId)}/receipt`, facilityId, { query: { paymentId }, signal }),
  /** Inpatient is refused until the Inpatient department ships (DEFERRAL_REASON_NOT_AVAILABLE). */
  deferBill: (facilityId: string, billId: string, reason: 'emergency' | 'inpatient', idempotencyKey?: string, note?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/defer`, facilityId, { body: { reason, ...(note ? { note } : {}) }, idempotencyKey }),
  /**
   * A counter sale made without a Health ID, put on one afterwards (the customer was given a Health ID after paying):
   * only the bill moves; no clinical record is written. The Health ID is in the body, a patient lookup, audited.
   */
  attachPatient: (facilityId: string, billId: string, healthId: string, idempotencyKey?: string) =>
    call<Bill>('POST', `${C}/bills/${id(billId)}/patient`, facilityId, { body: { healthId }, idempotencyKey }),
  /** Paying online through the facility's own Paystack (BILL-14): built, switched off; answers notAvailable until then. */
  onlinePaymentLink: (facilityId: string, billId: string, amountKobo: number, idempotencyKey?: string) =>
    call<{ authorizationUrl: string; reference: string; expiresAt: string }>('POST', `${C}/bills/${id(billId)}/online-payment-links`, facilityId,
      { body: { amountKobo }, idempotencyKey }),

  // §5 of BILL-1: outstanding balances and what HMOs owe (billing.report.read)
  outstanding: (facilityId: string, filter: { olderThanDays?: number; page?: number } = {}, signal?: AbortSignal) =>
    call<OutstandingPage>('GET', `${C}/outstanding`, facilityId, { query: { olderThanDays: filter.olderThanDays, page: filter.page }, signal }),
  hmoReceivables: (facilityId: string, signal?: AbortSignal) =>
    call<{ items: HmoOwes[] }>('GET', `${C}/hmo-receivables`, facilityId, { signal }),

  // §4 Walk-ins and outside orders
  pharmacyWalkIn: (facilityId: string, order: WalkInOrder, idempotencyKey?: string) =>
    call<WalkInAnswer>('POST', '/api/v1/pharmacy/walk-in-orders', facilityId, { body: order, idempotencyKey }),
  /**
   * A counter sale handed over (pharmacy.dispensing.create): every drug line is taken from the batch that expires first.
   * Refused 409 PAYMENT_REQUIRED until the sale is paid, 409 OUT_OF_STOCK when short.
   */
  handOverSale: (facilityId: string, billId: string, idempotencyKey?: string, expectedVersion?: number) =>
    call<SaleHandOver>('POST', `/api/v1/pharmacy/sales/${id(billId)}/hand-over`, facilityId,
      { body: expectedVersion !== undefined ? { expectedVersion } : {}, idempotencyKey }),
  labWalkIn: (facilityId: string, request: WalkInLabRequest, idempotencyKey?: string) =>
    call<WalkInAnswer>('POST', '/api/v1/lab/walk-in-requests', facilityId, { body: request, idempotencyKey }),
  /**
   * A photo of an outside prescription or lab request form (its `fileId` is the walk-in's `photoFileId`). Multipart, one
   * image, at most 10 MB. Proposed: BILL-1 refuses a photo on a counter sale and a picture on the price list until it ships.
   */
  uploadOrderPhoto: (facilityId: string, image: Blob, idempotencyKey?: string) => {
    const body = new FormData()
    body.append('file', image)
    return call<{ fileId: string }>('POST', '/api/v1/files/order-photos', facilityId, { body, idempotencyKey })
  },

  // §5 Stock (pharmacy)
  stock: async (facilityId: string, filter: { q?: string; filter?: 'low' | 'expiring'; page?: number } = {}, signal?: AbortSignal) =>
    searchTextRefused(filter.q) ? searchRefused<ListPage<StockLine>>()
      : paged(await call<Paged<StockLine>>('GET', '/api/v1/pharmacy/stock', facilityId,
        { query: { q: filter.q && filter.q.trim().length >= 2 ? filter.q.trim() : undefined, filter: filter.filter, page: filter.page }, signal })),
  receiveStock: async (facilityId: string, receipt: StockReceipt, idempotencyKey?: string) =>
    map(await call<{ items?: StockLine[]; lines?: StockLine[] }>('POST', '/api/v1/pharmacy/stock/receipts', facilityId, { body: receipt, idempotencyKey }),
      data => ({ lines: data.items ?? data.lines ?? [] })),
  adjustStock: (facilityId: string, adjustment: StockAdjustment, idempotencyKey?: string) =>
    call<StockLine>('POST', '/api/v1/pharmacy/stock/adjustments', facilityId, { body: adjustment, idempotencyKey }),
  stockMovements: async (facilityId: string, catalogueItemId: string, signal?: AbortSignal, page?: number) =>
    paged(await call<Paged<StockMovement>>('GET', `/api/v1/pharmacy/stock/${id(catalogueItemId)}/movements`, facilityId, { query: { page }, signal })),
  /** Counts stock for a drug on the price list, or changes its unit (not while it has stock) and reorder level. */
  stockSettings: (facilityId: string, catalogueItemId: string, settings: StockSettings, idempotencyKey?: string) =>
    call<StockLine>('PUT', `/api/v1/pharmacy/stock/${id(catalogueItemId)}/settings`, facilityId, { body: settings, idempotencyKey }),

  // §6 Lab results to outside doctors
  shareLabResult: (facilityId: string, accessionId: string, share: ResultShareInput, idempotencyKey?: string) =>
    call<ResultShare>('POST', `/api/v1/lab/accessions/${id(accessionId)}/result-shares`, facilityId, { body: share, idempotencyKey }),

  // §7 End of day
  /** The open day: the facility's, the signed-in cashier's, or (with `tillId`) that till's; null when none is open. */
  currentShift: async (facilityId: string, scope: { tillId?: string } = {}, signal?: AbortSignal) =>
    map(await call<{ shift?: Shift | null; scope?: DayCloseBy } | Shift | null>('GET', `${C}/shifts/current`, facilityId, { query: { tillId: scope.tillId }, signal }),
      data => data && typeof data === 'object' && 'shift' in data ? data.shift ?? null : data && 'id' in data ? data : null),
  openShift: (facilityId: string, openingCashKobo: number, scope: { tillId?: string } = {}, idempotencyKey?: string) =>
    call<Shift>('POST', `${C}/shifts`, facilityId, { body: { openingCashKobo, ...(scope.tillId ? { tillId: scope.tillId } : {}) }, idempotencyKey }),
  /** A note is needed when the count differs from what was expected. */
  closeShift: (facilityId: string, shiftId: string, countedCashKobo: number, note: string | null, expectedVersion: number, idempotencyKey?: string) =>
    call<Shift>('POST', `${C}/shifts/${id(shiftId)}/close`, facilityId, { body: { countedCashKobo, ...(note ? { note } : {}), expectedVersion }, idempotencyKey }),
  /** Days by date, or every day open now (`status: 'open'`): the cashiers' or tills' overview. */
  shifts: async (facilityId: string, filter: { date?: string; status?: 'open' } = {}, signal?: AbortSignal) =>
    paged(await call<Paged<Shift>>('GET', `${C}/shifts`, facilityId, { query: { date: filter.date, status: filter.status }, signal })),
}

// ------------------------------------------------------------------ words --
export const METHOD_LABEL: Readonly<Record<PaymentMethod | RecordedMethod, string>> = {
  cash: 'Cash', pos: 'POS', transfer: 'Transfer', hmo: 'HMO', waiver: 'Waiver', online: 'Online',
}
export const BILL_STATUS_LABEL: Readonly<Record<BillStatus, string>> = {
  unpaid: 'Unpaid', part_paid: 'Part paid', paid: 'Paid', deferred: 'Bill follows', void: 'Cancelled',
}
export const DAY_CLOSE_LABEL: Readonly<Record<DayCloseBy, string>> = { facility: 'Whole facility', cashier: 'Each cashier', till: 'Each till' }
export const SOURCE_LABEL: Readonly<Record<BillSource, string>> = { visit: 'Visit', pharmacy: 'Pharmacy', lab: 'Lab' }
export const DEFERRED_LABEL: Readonly<Record<DeferredReason, string>> = {
  emergency: 'Emergency', inpatient: 'Admitted', unknown_patient: 'Unknown patient',
}
/** The kind of item in words: the screen says "Service" for `other` (BILL-2: the price list is the Service catalogue). */
export const KIND_LABEL: Readonly<Record<CatalogueKind, string>> = { drug: 'Drug', lab_test: 'Lab test', other: 'Service' }

/** Who a bill is for, in words: the patient, the name a counter customer gave, or "Counter sale". */
export function billName(bill: Pick<Bill, 'patient' | 'displayName'>): string {
  return bill.patient?.displayName ?? bill.displayName ?? 'Counter sale'
}
/** "Health ID ending 7Q2K": the last four only, never the whole Health ID. */
export function healthIdEnding(patient: BillPatient | null | undefined): string | null {
  return patient?.healthIdLast4 ? `Health ID ending ${patient.healthIdLast4}` : null
}
