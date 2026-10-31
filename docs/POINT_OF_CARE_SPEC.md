# Point of care: payments, walk-ins, price list and stock (pharmacy and lab)

Status: **proposed**. The screens are built against the routes below; hid-system does not serve them yet. Every caller
treats a 404 as "not switched on yet" and never fakes a save. Health ID **records** payments; it never moves money. POS
terminals, banks and HMOs stay outside; staff type in their reference.

Money is an integer in kobo (`amountKobo`), currency `NGN`. Times are ISO 8601 UTC. Every POST takes an
`Idempotency-Key` header. Errors use the existing `{ error: { code, message } }` shape. All routes are scoped to the
signed-in staff member's current facility (`X-Facility-Id`, as elsewhere).

## 1. Payment setup (per facility)

`GET /api/v1/commercial/payment-settings` · `PUT /api/v1/commercial/payment-settings` (`billing.settings.manage`)

```ts
type PaymentMethod = 'cash' | 'pos' | 'transfer' | 'hmo' | 'waiver'
type PaymentSettings = {
  wherePaid: 'cashier' | 'counter' | 'both'          // central cashier, at the pharmacy/lab counter, or either
  methods: PaymentMethod[]                           // accepted here; 'waiver' needs billing.payment.waive
  payBefore: { pharmacy: boolean; lab: boolean }     // true: dispense / take the sample only when paid
  allowDeferredFor: ('emergency' | 'inpatient')[]    // serve now, bill follows
  transferAccount?: { bankName: string; accountName: string; accountNumber: string } | null
  hmos: { id: string; name: string }[]               // HMOs/insurers this facility accepts (NHIA, private HMOs)
  receiptFooter?: string | null
  version: number
}
```

## 2. Price list

`GET /api/v1/commercial/catalogue-items?kind=drug|lab_test|other&q=&page=` · `POST /api/v1/commercial/catalogue-items` ·
`PATCH /api/v1/commercial/catalogue-items/:itemId` (`billing.catalogue.manage`; read: `billing.catalogue.read`) ·
image: upload through the existing files service, then `PATCH { imageFileId }`.

```ts
type CatalogueItem = {
  id: string; kind: 'drug' | 'lab_test' | 'other'; name: string
  strength?: string | null; form?: 'tablet' | 'capsule' | 'liquid' | 'injection' | 'cream' | 'inhaler' | 'drops' | 'other' | null
  packSize?: string | null; imageUrl?: string | null       // a signed URL to the drug's picture, or null
  prescriptionOnly: boolean                                // false: can be sold over the counter
  prices: { cashKobo: number; hmo?: { hmoId: string; amountKobo: number }[] }
  active: boolean; version: number
}
```

## 3. Bills and payments

A bill belongs to one patient (or one anonymous over-the-counter sale) and holds lines. A pharmacy or lab work item
carries a summary of its bill so the queue can show "Paid" without another call.

`GET /api/v1/commercial/bills?status=&source=pharmacy|lab&q=&page=` (`billing.bill.read`) ·
`POST /api/v1/commercial/bills` (`billing.bill.create`) · `GET /api/v1/commercial/bills/:billId` ·
`POST /api/v1/commercial/bills/:billId/payments` (`billing.payment.record`) ·
`POST /api/v1/commercial/bills/:billId/payments/:paymentId/void` (`billing.payment.void`, reason required) ·
`GET /api/v1/commercial/bills/:billId/receipt` (a printable receipt: JSON below, the screen prints it) ·
`POST /api/v1/commercial/bills/:billId/defer` (`billing.bill.defer`, reason: emergency | inpatient).

```ts
type BillStatus = 'unpaid' | 'part_paid' | 'paid' | 'deferred' | 'void'
type BillLine = { id: string; catalogueItemId: string | null; name: string; quantity: number; unitKobo: number; totalKobo: number;
  workItemId?: string | null }
type Payment = { id: string; method: PaymentMethod; amountKobo: number; reference?: string | null  // POS RRN, transfer ref, HMO approval code
  hmoId?: string | null; waivedBy?: string | null; reason?: string | null; receivedBy: string; receivedAt: string; voided: boolean }
type Bill = { id: string; number: string /* "B-000412" */; source: 'pharmacy' | 'lab'; status: BillStatus
  patient: { patientId: string | null; displayName: string; healthId?: string | null } | null   // null: anonymous OTC sale
  lines: BillLine[]; totalKobo: number; paidKobo: number; dueKobo: number; payments: Payment[]
  receiptNumber?: string | null; createdAt: string; version: number }
// Added to pharmacy and lab work items (GET work-items, GET work-item):
type WorkItemBill = { billId: string; status: BillStatus; dueKobo: number; receiptNumber?: string | null } | null
// Also added to pharmacy and lab work items made from a walk-in: the outside order (§4), so "Send to doctor" can fill in
// the referring doctor's email.
type WorkItemOutside = OutsideOrder | null   // field name: `outside`
```

Rules: a payment above `dueKobo` is refused `409 OVERPAYMENT` (cash change is worked out on screen, not stored);
`transfer` is recorded as `pending_check` until a staff member with `billing.payment.confirm` confirms it
(`POST …/payments/:paymentId/confirm`); dispense or sample collection is refused `409 PAYMENT_REQUIRED` when
`payBefore` is on and the bill is neither paid nor deferred.

## 4. Walk-ins and outside orders

`POST /api/v1/pharmacy/walk-in-orders` (`pharmacy.walk-in.create`) · `POST /api/v1/lab/walk-in-requests` (`lab.walk-in.create`)

```ts
// A walk-in with no Health ID gets one first, through the EXISTING facility registration (served today):
// POST /identity/nin/resolve → registration case → approve-new or link-existing → POST …/enroll { email } → { patientId, hid }.
// The Health ID and sign-in are emailed to the customer by enrolment; the walk-in then goes ahead as kind 'health_id'.
// Needs (owner decision 2026-10-31): enrolment by phone (SMS) for customers with no email; the form asks for a phone but
// nothing can send it today.
type WalkInPatient =
  | { kind: 'health_id'; healthId: string }
  | { kind: 'anonymous' }                       // pharmacy only, and only for items with prescriptionOnly false
type OutsideOrder = { prescriberName: string; facilityName?: string | null; writtenOn?: string | null
  photoFileId?: string | null; prescriberEmail?: string | null; prescriberPhone?: string | null }
// pharmacy
type WalkInOrder = { patient: WalkInPatient; outside?: OutsideOrder | null
  items: { catalogueItemId: string; quantity: number; dose?: string | null; frequency?: string | null; durationDays?: number | null }[] }
// lab
type WalkInLabRequest = { patient: { kind: 'health_id'; healthId: string }; outside?: OutsideOrder | null
  tests: { catalogueItemId: string }[]; clinicalNote?: string | null; priority: 'routine' | 'urgent' }
// both answer { workItemIds: string[]; bill: Bill }
```

Photos of outside prescriptions and lab request forms: `POST /api/v1/files/order-photos` (multipart, image only, max
10 MB; `pharmacy.walk-in.create` or `lab.walk-in.create`) answers `{ fileId }`, used as `photoFileId`. The same route
with `billing.catalogue.manage` stores price-list pictures (`imageFileId`). Neither exists today: the only upload is for
patient documents.

## 5. Stock (pharmacy)

`GET /api/v1/pharmacy/stock?q=&filter=low|expiring&page=` (`pharmacy.stock.read`) ·
`POST /api/v1/pharmacy/stock/receipts` (goods received; `pharmacy.stock.manage`) ·
`POST /api/v1/pharmacy/stock/adjustments` (damaged, expired, count correction; reason required; `pharmacy.stock.manage`) ·
`GET /api/v1/pharmacy/stock/:catalogueItemId/movements`.

```ts
type StockLine = { catalogueItemId: string; name: string; strength?: string | null; form?: string | null; imageUrl?: string | null
  onHand: number; unit: string; reorderLevel: number
  batches: { batchId: string; batchNumber: string; expiresOn: string; quantity: number }[] }
type StockReceipt = { supplier?: string | null; invoiceNumber?: string | null
  lines: { catalogueItemId: string; batchNumber: string; expiresOn: string; quantity: number; unitCostKobo?: number | null }[] }
type StockAdjustment = { catalogueItemId: string; batchId: string; change: number; reason: 'damaged' | 'expired' | 'count' | 'returned'; note?: string | null }
```

Dispensing takes from the batch that expires first unless the body names `batchId`. A work item carries
`stock: { onHand: number; unit: string } | null` so picking can show "Out of stock". Dispensing more than on hand is
refused `409 OUT_OF_STOCK`.

## 6. Lab results to outside doctors

`POST /api/v1/lab/accessions/:accessionId/result-shares` (`lab.result.share`) body `{ email: string }`, answers
`{ shareId, sentTo, expiresAt }`. The email carries a link that opens the released result only (the same model as the
patient's card share). The patient always sees released results on their Health ID.

## 7. End of day

The facility picks how the day is closed (owner decision 2026-10-31: all three, chosen in Payment setup):
`PaymentSettings.dayCloseBy: 'facility' | 'cashier' | 'till'` and `PaymentSettings.tills: { id: string; name: string }[]`.

- `facility`: one day for everyone.
- `cashier`: every staff member opens and closes their own day; the totals count the payments they took.
- `till`: the day is opened on a named till (`tillId` in the open body); totals count payments taken on that till.

`GET /api/v1/commercial/shifts/current` (`billing.shift.own`): the facility's open day, the signed-in cashier's, or with
`?tillId=` that till's; null when none is open. · `POST /api/v1/commercial/shifts` (`billing.shift.own`) open,
`{ openingCashKobo, tillId? }` (tillId required in till mode) · `POST /api/v1/commercial/shifts/:shiftId/close`
(`billing.shift.own` for your own day or till; another's needs `billing.shift.manage`) `{ countedCashKobo, note? }` ·
`GET /api/v1/commercial/shifts?date=` or `?status=open` (`billing.shift.manage`: every cashier's or till's day).

```ts
type Shift = { id: string; scope: 'facility' | 'cashier' | 'till'; cashierName?: string | null; tillId?: string | null; tillName?: string | null
  openedBy: string; openedAt: string; closedAt?: string | null; openingCashKobo: number
  totals: { method: PaymentMethod; count: number; amountKobo: number }[]
  expectedCashKobo: number; countedCashKobo?: number | null; differenceKobo?: number | null
  unpaidBills: { count: number; amountKobo: number }; deferredBills: { count: number; amountKobo: number } }
```

A payment records the shift it was taken in (`shiftId`), so totals do not depend on time windows. One open day per
scope: a second open for the same facility, cashier or till is refused `409 SHIFT_ALREADY_OPEN`.

## Permissions (new)

billing.settings.manage, billing.catalogue.read, billing.catalogue.manage, billing.bill.read, billing.bill.create,
billing.bill.defer, billing.payment.record, billing.payment.confirm, billing.payment.void, billing.payment.waive,
billing.shift.own, billing.shift.manage, pharmacy.walk-in.create, pharmacy.stock.read, pharmacy.stock.manage, lab.walk-in.create,
lab.result.share.

## Front-end module (apps/patient-web/src/ehr-blue/departments/commerce/)

- `api.ts`: typed calls for every route above (`commerce.*`), each answering `{ ok, data } | { ok:false, notAvailable:true } | { ok:false, error }`.
- `money.ts`: `naira(kobo)` → "₦12,500.00"; `parseNaira(text)` → kobo | null.
- `BillBadge.tsx`: `<BillBadge bill={WorkItemBill} />` → Paid · Unpaid ₦x · Part paid · Bill follows · Not billed.
- `TakePayment.tsx`: `<TakePayment bill onPaid onClose open />` a Drawer that records cash (with change), POS (RRN),
  transfer (reference, shows the account), HMO (pick HMO + approval code) or waiver (reason), only methods the
  settings allow; then the receipt.
- `Receipt.tsx`: printable receipt (Print uses window.print with a print stylesheet).
- `NotSwitchedOn.tsx`: the one honest notice for a 404.
- Pages: Payments (cashier queue of bills), Price list, End of day, Payment setup.
