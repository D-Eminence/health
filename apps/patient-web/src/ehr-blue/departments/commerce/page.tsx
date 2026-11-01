import { CalendarCheck, SlidersHorizontal, Tags, Wallet } from 'lucide-react'
import type { StaffSession } from '../../../staff/api'
import type { EhrBluePage } from '../types'
import { EndOfDay } from './EndOfDay'
import { Payments } from './Payments'
import { PaymentSetup } from './PaymentSetup'
import { PriceList } from './PriceList'
import { pointOfCareShown } from './served'

/**
 * The point-of-care money pages (docs/POINT_OF_CARE_SPEC.md), under Finance in a hospital's sidebar and in the lab
 * product's own menu (frame/product.ts COUNTER_PAGES). Built against proposed routes: each page says so in one line when
 * they answer 404, and saves nothing. Until Health ID serves them, they show at the demo facilities only (served.ts).
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
const financeListed = (session: StaffSession) => {
  const held = session.actor.facility?.permissions ?? []
  return FINANCE_PERMISSIONS.some(permission => held.includes(permission)) || !COUNTER_MENU_PERMISSIONS.some(permission => held.includes(permission))
}

export const commercePages: EhrBluePage[] = [
  { path: 'payments', group: 'Finance', label: 'Payments', permission: 'billing.bill.read', status: 'live', icon: icon(Wallet), element: <Payments />, listed: financeListed, visible: pointOfCareShown },
  { path: 'price-list', group: 'Finance', label: 'Price list', permission: 'billing.catalogue.read', status: 'live', icon: icon(Tags), element: <PriceList />, listed: financeListed, visible: pointOfCareShown },
  { path: 'end-of-day', group: 'Finance', label: 'End of day', permission: 'billing.shift.own', status: 'live', icon: icon(CalendarCheck), element: <EndOfDay />, listed: financeListed, visible: pointOfCareShown },
  { path: 'payment-setup', group: 'Finance', label: 'Payment setup', permission: 'billing.settings.manage', status: 'live', icon: icon(SlidersHorizontal), element: <PaymentSetup />, listed: financeListed, visible: pointOfCareShown },
]
