import type { Bill, PaymentSettings } from '../../../../ehr-blue/departments/commerce/api'

/*
 * Fictional bills and settings in the shapes hid-system BILL-1 answers (docs/EHR_PLANNED_CONTRACT.md "BILL-1" on
 * claude/sprint-billing-backend). Every name, number and code here is invented.
 */

export const HMO_ID = 'a1111111-1111-4111-8111-111111111111'
export const TILL_ID = 'b2222222-2222-4222-8222-222222222222'
export const ITEM_ID = 'c3333333-3333-4333-8333-333333333333'

export function settingsOf(patch: Partial<PaymentSettings> = {}): PaymentSettings {
  return {
    wherePaid: 'both', methods: ['cash', 'pos', 'transfer', 'hmo', 'waiver'], payBefore: { pharmacy: false, lab: false },
    allowDeferredFor: ['emergency'], transferAccount: { bankName: 'Test Bank', accountName: 'Demo Hospital', accountNumber: '0000000000' },
    hmos: [{ id: HMO_ID, name: 'Demo HMO', active: true }], receiptFooter: 'Thank you', dayCloseBy: 'facility', tills: [],
    checkInChargeItemId: null, payBeforeAvailable: false, onlinePaymentAvailable: false, version: 3, ...patch,
  }
}

export function billOf(patch: Partial<Bill> = {}): Bill {
  return {
    id: 'd4444444-4444-4444-8444-444444444444', number: 'B-000412', source: 'visit', status: 'part_paid',
    patient: { patientId: 'e5555555-5555-4555-8555-555555555555', displayName: 'Ada Test', healthIdLast4: '7Q2K' },
    visit: { visitQueueEntryId: 'f6666666-6666-4666-8666-666666666666', queueDay: '2026-11-26' },
    lines: [
      { id: 'line-1', catalogueItemId: ITEM_ID, name: 'Consultation', kind: 'other', quantity: 1, unitKobo: 500000, totalKobo: 500000, workItemId: null, origin: 'check_in', cancelled: false },
      { id: 'line-2', catalogueItemId: null, name: 'Paracetamol 500 mg tablet', kind: 'drug', quantity: 10, unitKobo: 15000, totalKobo: 150000, workItemId: 'work-1', origin: 'pharmacy', cancelled: false },
    ],
    totalKobo: 650000, paidKobo: 300000, waivedKobo: 0, hmoCoveredKobo: 200000, pendingCheckKobo: 0, dueKobo: 150000,
    payments: [{ id: 'pay-1', method: 'cash', amountKobo: 300000, reference: null, receivedBy: 'Bola Cashier', receivedAt: '2026-11-26T08:20:00.000Z',
      voided: false, status: 'recorded', receiptNumber: 'R-2026-000123', tillDayId: 'day-1', paperReceiptNumber: null }],
    hmoCovers: [{ id: 'cover-1', hmoId: HMO_ID, hmoName: 'Demo HMO', amountKobo: 200000, approvalCode: 'AX-221', status: 'pending_claim',
      recordedBy: 'Bola Cashier', recordedAt: '2026-11-26T08:25:00.000Z' }],
    deferred: null, receiptNumber: 'R-2026-000123', handedOverAt: null, createdAt: '2026-11-26T08:10:00.000Z', version: 5,
    ...patch,
  }
}

/** A bill with nothing paid, waived or covered. */
export const unpaidBill = (patch: Partial<Bill> = {}) => billOf({ status: 'unpaid', paidKobo: 0, hmoCoveredKobo: 0, dueKobo: 650000,
  payments: [], hmoCovers: [], receiptNumber: null, ...patch })

export const ok = <T,>(data: T) => ({ ok: true as const, data })
export const off = () => ({ ok: false as const, notAvailable: true as const })
export const refused = (code: string, error: string, status = 409) => ({ ok: false as const, error, code, status })
