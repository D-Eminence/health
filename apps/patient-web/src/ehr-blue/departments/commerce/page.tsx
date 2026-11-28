import { CalendarCheck, SlidersHorizontal, Tags, Wallet } from 'lucide-react'
import type { StaffSession } from '../../../staff/api'
import type { EhrBluePage } from '../types'
import { EndOfDay } from './EndOfDay'
import { Payments } from './Payments'
import { PaymentSetup } from './PaymentSetup'
import { PriceList } from './PriceList'
import { pointOfCareShown } from './served'

/**
 * Patient billing release 1 (hid-system BILL-1, on docs/POINT_OF_CARE_SPEC.md), under Finance in a hospital's sidebar and
 * in the lab product's own menu (frame/product.ts COUNTER_PAGES): Payments (with Outstanding balances), Price list, End
 * of day and Payment setup. They show at the demo facilities, and at any facility whose billing routes answer
 * (served.ts); a read that answers 404 says "Billing is not switched on at this facility yet" and saves nothing.
 */
export const COMMERCE_PATHS = ['payments', 'price-list', 'end-of-day', 'payment-setup'] as const

const icon = (I: typeof Wallet) => <I aria-hidden strokeWidth={1.8} />

/**
 * Permissions of staff whose own department's menu already holds these pages (Pharmacy: Sales & receipts, Products &
 * prices, Till / End of day, Settings). For them Finance is not listed in the sidebar; its addresses still open.
 * Hospital finance staff keep it: anyone who confirms transfers or manages every cashier's day.
 */
export const COUNTER_MENU_PERMISSIONS: string[] = ['pharmacy.work-item.read', 'pharmacy.walk-in.create']
const FINANCE_PERMISSIONS: readonly string[] = ['billing.payment.confirm', 'billing.shift.manage']
export const financeListed = (session: StaffSession) => {
  const held = session.actor.facility?.permissions ?? []
  return FINANCE_PERMISSIONS.some(permission => held.includes(permission)) || !COUNTER_MENU_PERMISSIONS.some(permission => held.includes(permission))
}

// Partial, not live: BILL-1 is on hid-system claude/sprint-billing-backend and not signed yet (0162-0167). Partial, never
// sample, which would change who may open them.
export const commercePages: EhrBluePage[] = [
  { path: 'payments', group: 'Finance', label: 'Payments', permission: 'billing.bill.read', status: 'partial', icon: icon(Wallet), element: <Payments />, listed: financeListed, visible: pointOfCareShown },
  { path: 'price-list', group: 'Finance', label: 'Price list', permission: 'billing.catalogue.read', status: 'partial', icon: icon(Tags), element: <PriceList />, listed: financeListed, visible: pointOfCareShown },
  // Opening and closing a day is billing.shift.own; those who see every day (billing.shift.manage, an administrator) see
  // the overview even without a day of their own.
  { path: 'end-of-day', group: 'Finance', label: 'End of day', permission: 'billing.shift.own', orPermissions: ['billing.shift.manage'], status: 'partial', icon: icon(CalendarCheck), element: <EndOfDay />, listed: financeListed, visible: pointOfCareShown },
  { path: 'payment-setup', group: 'Finance', label: 'Payment setup', permission: 'billing.settings.manage', status: 'partial', icon: icon(SlidersHorizontal), element: <PaymentSetup />, listed: financeListed, visible: pointOfCareShown },
]
