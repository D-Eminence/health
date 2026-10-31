import { CalendarCheck, SlidersHorizontal, Tags, Wallet } from 'lucide-react'
import type { EhrBluePage } from '../types'
import { EndOfDay } from './EndOfDay'
import { Payments } from './Payments'
import { PaymentSetup } from './PaymentSetup'
import { PriceList } from './PriceList'

/**
 * The point-of-care money pages (docs/POINT_OF_CARE_SPEC.md), under Finance in a hospital's sidebar and in the pharmacy
 * and lab products' own menus (frame/product.ts COUNTER_PAGES). Built against proposed routes: each page says so in one
 * line when they answer 404, and saves nothing.
 */
export const COMMERCE_PATHS = ['payments', 'price-list', 'end-of-day', 'payment-setup'] as const

const icon = (I: typeof Wallet) => <I aria-hidden strokeWidth={1.8} />

export const commercePages: EhrBluePage[] = [
  { path: 'payments', group: 'Finance', label: 'Payments', permission: 'billing.bill.read', status: 'live', icon: icon(Wallet), element: <Payments /> },
  { path: 'price-list', group: 'Finance', label: 'Price list', permission: 'billing.catalogue.read', status: 'live', icon: icon(Tags), element: <PriceList /> },
  { path: 'end-of-day', group: 'Finance', label: 'End of day', permission: 'billing.shift.manage', status: 'live', icon: icon(CalendarCheck), element: <EndOfDay /> },
  { path: 'payment-setup', group: 'Finance', label: 'Payment setup', permission: 'billing.settings.manage', status: 'live', icon: icon(SlidersHorizontal), element: <PaymentSetup /> },
]
