import type { Bill, CatalogueForm, OutsideOrder, PaymentSettings, WorkItemBill } from '../commerce/api'
import type { DrugForm } from './drugForm'

/*
 * What a pharmacy or lab work item carries of point of care (docs/POINT_OF_CARE_SPEC.md §3–§5), read without any
 * request: its bill summary, stock on hand and the outside order it came with. Today's backend sends none of them.
 */

/** A work item's stock on hand (§5), or null when Pharmacy sends none. */
export interface WorkItemStock { readonly onHand: number; readonly unit: string }

/** The point-of-care fields a pharmacy or lab work item may carry (§3, §4, §5); absent from today's backend. */
interface PointOfCareFields { readonly bill?: WorkItemBill; readonly stock?: WorkItemStock | null; readonly outside?: OutsideOrder | null }

/** The bill summary on a work item: undefined when the backend sends none at all (payments not on), null when not billed. */
export function billOf(item: object): WorkItemBill | undefined {
  return (item as PointOfCareFields).bill
}
export function stockOf(item: object): WorkItemStock | null {
  return (item as PointOfCareFields).stock ?? null
}
export function outsideOf(item: object): OutsideOrder | null {
  return (item as PointOfCareFields).outside ?? null
}

/** Whether a bill holds the work back: unpaid or part paid. Paid, deferred, cancelled or none: no. */
export function billOwing(bill: WorkItemBill | undefined): boolean {
  return Boolean(bill && (bill.status === 'unpaid' || bill.status === 'part_paid'))
}

/** The bill summary a full bill makes. */
export function summaryOf(bill: Bill): NonNullable<WorkItemBill> {
  return { billId: bill.id, status: bill.status, dueKobo: bill.dueKobo, receiptNumber: bill.receiptNumber ?? null }
}

/** Whether payment comes before the work here, for this kind of work. */
export function paysFirst(settings: PaymentSettings | null | undefined, source: 'pharmacy' | 'lab'): boolean {
  return Boolean(settings?.payBefore[source])
}

/** The price list's form, as the drawn tiles name it. */
export function drugFormFromCatalogue(form: CatalogueForm | string | null | undefined): DrugForm {
  switch (form) {
    case 'liquid': return 'syrup'
    case 'tablet': case 'capsule': case 'injection': case 'cream': case 'inhaler': case 'drops': return form
    default: return 'other'
  }
}
