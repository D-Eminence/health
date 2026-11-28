import { describe, expect, it } from 'vitest'
import { APP_ROUTE_GRANTS, BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { HID_ENDPOINTS, findEndpoint } from '../registry'

/**
 * Patient billing release 1 with pharmacy point-of-care stock (hid-system BILL-1, migrations 0162-0167, on
 * claude/sprint-billing-backend; docs/EHR_PLANNED_CONTRACT.md "BILL-1"). Not live: every entry stays proposed until the
 * backend is signed and served. The routes, their methods, the codes each needs (BILL-1's table), the provider portal's
 * grants, and Paystack's webhook kept away from browsers.
 */
const BILLING: readonly (readonly [string, string, readonly string[], Readonly<Record<string, readonly string[]>>])[] = [
  ['commercial.paymentSettings', '/api/v1/commercial/payment-settings', ['GET', 'PUT'], { GET: ['billing.bill.read'], PUT: ['billing.settings.manage'] }],
  ['commercial.catalogueItems', '/api/v1/commercial/catalogue-items', ['GET', 'POST'], { GET: ['billing.catalogue.read'], POST: ['billing.catalogue.manage'] }],
  ['commercial.catalogueUnpricedCodes', '/api/v1/commercial/catalogue-items/unpriced-codes', ['GET'], { GET: ['billing.catalogue.manage'] }],
  ['commercial.catalogueItem', '/api/v1/commercial/catalogue-items/:itemId', ['PATCH'], { PATCH: ['billing.catalogue.manage'] }],
  ['commercial.bills', '/api/v1/commercial/bills', ['GET', 'POST'], { GET: ['billing.bill.read'], POST: ['billing.bill.create'] }],
  ['commercial.billSummary', '/api/v1/commercial/bills/summary', ['GET'], { GET: ['billing.bill.read'] }],
  ['commercial.bill', '/api/v1/commercial/bills/:billId', ['GET'], { GET: ['billing.bill.read'] }],
  ['commercial.billLines', '/api/v1/commercial/bills/:billId/lines', ['POST'], { POST: ['billing.bill.create'] }],
  ['commercial.billLineCancel', '/api/v1/commercial/bills/:billId/lines/:lineId/cancel', ['POST'], { POST: ['billing.bill.adjust'] }],
  ['commercial.billPayments', '/api/v1/commercial/bills/:billId/payments', ['POST'], { POST: ['billing.payment.record'] }],
  ['commercial.billPaymentConfirm', '/api/v1/commercial/bills/:billId/payments/:paymentId/confirm', ['POST'], { POST: ['billing.payment.confirm'] }],
  ['commercial.billPaymentVoid', '/api/v1/commercial/bills/:billId/payments/:paymentId/void', ['POST'], { POST: ['billing.payment.void'] }],
  ['commercial.billHmoCoverCancel', '/api/v1/commercial/bills/:billId/hmo-covers/:coverId/cancel', ['POST'], { POST: ['billing.payment.void'] }],
  ['commercial.billDefer', '/api/v1/commercial/bills/:billId/defer', ['POST'], { POST: ['billing.bill.defer'] }],
  ['commercial.billPatient', '/api/v1/commercial/bills/:billId/patient', ['POST'], { POST: ['billing.bill.create'] }],
  ['commercial.billVoid', '/api/v1/commercial/bills/:billId/void', ['POST'], { POST: ['billing.bill.adjust'] }],
  ['commercial.billReceipt', '/api/v1/commercial/bills/:billId/receipt', ['GET'], { GET: ['billing.bill.read'] }],
  ['commercial.billOnlinePaymentLinks', '/api/v1/commercial/bills/:billId/online-payment-links', ['POST'], { POST: ['billing.payment.record'] }],
  ['commercial.outstanding', '/api/v1/commercial/outstanding', ['GET'], { GET: ['billing.report.read'] }],
  ['commercial.hmoReceivables', '/api/v1/commercial/hmo-receivables', ['GET'], { GET: ['billing.report.read'] }],
  ['commercial.currentShift', '/api/v1/commercial/shifts/current', ['GET'], { GET: ['billing.shift.own'] }],
  ['commercial.shifts', '/api/v1/commercial/shifts', ['GET', 'POST'], { GET: ['billing.shift.manage'], POST: ['billing.shift.own'] }],
  ['commercial.shiftClose', '/api/v1/commercial/shifts/:shiftId/close', ['POST'], { POST: ['billing.shift.own'] }],
  ['pharmacy.stock', '/api/v1/pharmacy/stock', ['GET'], { GET: ['pharmacy.stock.read'] }],
  ['pharmacy.stockReceipts', '/api/v1/pharmacy/stock/receipts', ['POST'], { POST: ['pharmacy.stock.manage'] }],
  ['pharmacy.stockAdjustments', '/api/v1/pharmacy/stock/adjustments', ['POST'], { POST: ['pharmacy.stock.manage'] }],
  ['pharmacy.stockMovements', '/api/v1/pharmacy/stock/:catalogueItemId/movements', ['GET'], { GET: ['pharmacy.stock.read'] }],
  ['pharmacy.stockSettings', '/api/v1/pharmacy/stock/:catalogueItemId/settings', ['PUT'], { PUT: ['pharmacy.stock.manage'] }],
  ['pharmacy.walkInOrders', '/api/v1/pharmacy/walk-in-orders', ['POST'], { POST: ['pharmacy.walk-in.create'] }],
  ['pharmacy.saleHandOver', '/api/v1/pharmacy/sales/:billId/hand-over', ['POST'], { POST: ['pharmacy.dispensing.create'] }],
]

describe('BILL-1 in the contract registry', () => {
  it.each(BILLING)('%s: its path, methods and codes, proposed and noted as BILL-1 until served', (name, path, methods, permissions) => {
    const endpoint = findEndpoint(name)
    expect(endpoint).toMatchObject({ path, methods, permissions, status: 'proposed', auth: { kind: 'authenticated' } })
    expect(endpoint?.note).toMatch(/^BILL-1 \(hid-system 0162-0167/)
    expect(endpoint?.note).not.toMatch(/permission/i)
  })

  it('grants the provider portal every billing route, and no other application', () => {
    for (const [name] of BILLING) expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
    expect(() => assertEndpointAllowed('patient-web', 'commercial.bills')).toThrow(BoundaryViolationError)
    expect(APP_ROUTE_GRANTS['staff-web']?.commercial).toEqual(expect.arrayContaining(BILLING.filter(([name]) => name.startsWith('commercial.')).map(([name]) => name)))
  })

  it('takes the day’s summary and the unpriced codes as their own routes, not as a bill or an item', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/commercial/bills/summary').name).toBe('commercial.billSummary')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/commercial/bills/b0000000-0000-4000-8000-000000000002').name).toBe('commercial.bill')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/commercial/catalogue-items/unpriced-codes').name).toBe('commercial.catalogueUnpricedCodes')
    expect(assertRegisteredBrowserRequest('PUT', '/api/v1/pharmacy/stock/c0000000-0000-4000-8000-000000000003/settings').name).toBe('pharmacy.stockSettings')
  })

  it('keeps Paystack’s webhook away from every browser (BILL-14, built but switched off)', () => {
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/commercial/paystack/webhook')).toThrow(BrowserRouteError)
    expect(HID_ENDPOINTS.some(endpoint => endpoint.path.includes('paystack'))).toBe(false)
  })

  it('leaves the lab’s walk-ins and result shares outside BILL-1, still served by no release', () => {
    for (const name of ['lab.walkInRequests', 'lab.resultShares', 'files.orderPhotos']) {
      expect(findEndpoint(name)?.status).toBe('proposed')
      expect(findEndpoint(name)?.note).toMatch(/^Point of care/)
    }
  })
})
