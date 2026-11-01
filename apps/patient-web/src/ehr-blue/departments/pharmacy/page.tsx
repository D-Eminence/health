import { Navigate, useLocation } from 'react-router-dom'
import { CalendarCheck, PackageOpen, ReceiptText, ShoppingBag, SlidersHorizontal, Tags } from 'lucide-react'
import { usesNovuBackend } from '../../../backendContract'
import { selfServiceReview, selfServiceType } from '../../../staff/staffAccess'
import type { EhrBluePage } from '../types'
import { useBluePage } from '../../frame/pageContext'
import { productOf } from '../../frame/product'
import { DeptUnavailable } from '../parts/DeptPage'
import { PillIcon } from '../parts/icons'
import { useDeptAccess } from '../parts/access'
import { EndOfDay } from '../commerce/EndOfDay'
import { PaymentSetup } from '../commerce/PaymentSetup'
import { PriceList } from '../commerce/PriceList'
import { Prescriptions } from './Pharmacy'
import { Sales } from './Sales'
import { Sell } from './Sell'
import { StockPage } from './Stock'

/**
 * Pharmacy (the owner's order of 2026-10-31: work first, identity optional). Seven pages, in this order, under one
 * group: in a pharmacy on its own they are the menu; in a hospital they are the Pharmacy group of the sidebar.
 */
const GROUP = 'Pharmacy'
const icon = (I: typeof ShoppingBag) => <I aria-hidden strokeWidth={1.8} />
/**
 * The kinds of self-signed-up facility that get Pharmacy once Health ID support has checked them: the ones whose locked
 * list names it (staff/routes/ReviewBanner.tsx LOCKED). A laboratory, or another kind, is never promised it.
 */
const GETS_PHARMACY: ReadonlySet<string> = new Set(['pharmacy', 'hospital', 'clinic'])

/**
 * Opened by its address without the permission: today's refusal (staff/routes/Operations.tsx Pharmacy) in plain words,
 * and nothing is read. A role that may open another Pharmacy page (Sell, Stock, Sales & receipts…) is told only
 * prescriptions are not in it. The administrator of a facility that signed itself up (the only role there that manages
 * staff) is never told to ask the facility administrator, which they are. While Health ID support checks a facility
 * that will get Pharmacy, Pharmacy is locked for them too (the banner above says so): it opens after the check. Once
 * the facility is checked, they add a pharmacist on the Staff page. A facility that will not get Pharmacy has no step.
 */
function PharmacyUnavailable() {
  const { facility, permissions } = useDeptAccess()
  const otherPharmacyWork = pharmacyPages.some(page => page !== pharmacyPage && page.permission !== undefined && permissions.includes(page.permission))
  const review = usesNovuBackend() ? selfServiceReview(facility) : null
  const getsPharmacy = GETS_PHARMACY.has(selfServiceType(facility) ?? '')
  const administrator = review !== null && permissions.includes('workforce.manage')
  const next = !administrator ? ' Ask your facility administrator.' : review === 'reviewed' && getsPharmacy ? ' Add a pharmacist on the Staff page.' : ''
  const message = review === 'pending' && getsPharmacy
    ? 'Pharmacy opens once Health ID support has checked your facility.'
    : `Your role at this facility doesn’t include ${otherPharmacyWork ? 'prescriptions' : 'pharmacy work'}.${next}`
  return <DeptUnavailable title="Pharmacy unavailable" message={message} />
}

/**
 * The old addresses, so nothing breaks: /pharmacy opens the counter in a pharmacy and Prescriptions in a hospital (or
 * whichever the role may open), /pharmacy?rx=<id> the prescription, /pharmacy/new-sale the counter. A role that may
 * open neither goes to Prescriptions, which says why: never to Sell, which would send it back to /provider, and on the
 * pharmacy. site /provider comes back here.
 */
function PharmacyHome() {
  const { rest } = useBluePage()
  const { search } = useLocation()
  const { permissions } = useDeptAccess()
  const sells = permissions.includes('pharmacy.walk-in.create')
  const reads = permissions.includes('pharmacy.work-item.read')
  const rx = new URLSearchParams(search).get('rx')
  const below = rest.replace(/\/+$/, '')
  const sellFirst = productOf(window.location.hostname, permissions) === 'pharmacy' ? sells : sells && !reads
  const to = rx ? `prescriptions/${encodeURIComponent(rx)}` : below === 'new-sale' ? 'sell' : sellFirst ? 'sell' : 'prescriptions'
  return <Navigate replace to={`/provider/pharmacy/${to}`} />
}

export const pharmacyPages: EhrBluePage[] = [
  // Every page here is partial, not live. Prescriptions and the group's own address work on Health ID, but not yet with
  // today's words and steps throughout; Sell, Sales & receipts, Stock, Products & prices, Till and Settings call
  // point-of-care addresses Health ID does not serve yet (parity report #20).
  // Not listed: the group's own address, taken to its first page.
  { path: 'pharmacy/*', group: GROUP, label: 'Pharmacy', status: 'partial', icon: <PillIcon />, element: <PharmacyHome />, listed: () => false },
  { path: 'pharmacy/sell', group: GROUP, label: 'Sell', permission: 'pharmacy.walk-in.create', status: 'partial', icon: icon(ShoppingBag), element: <Sell /> },
  { path: 'pharmacy/prescriptions/*', group: GROUP, label: 'Prescriptions', permission: 'pharmacy.work-item.read', status: 'partial', keepsState: true,
    icon: <PillIcon />, element: <Prescriptions />, refusal: <PharmacyUnavailable /> },
  { path: 'pharmacy/sales/*', group: GROUP, label: 'Sales & receipts', permission: 'billing.bill.read', status: 'partial', keepsState: true,
    icon: icon(ReceiptText), element: <Sales /> },
  { path: 'pharmacy/stock/*', group: GROUP, label: 'Stock', permission: 'pharmacy.stock.read', status: 'partial', icon: icon(PackageOpen), element: <StockPage /> },
  { path: 'pharmacy/products', group: GROUP, label: 'Products & prices', permission: 'billing.catalogue.read', status: 'partial', icon: icon(Tags),
    element: <PriceList kinds={['drug', 'other']} title="Products & prices" description="What you sell and what it costs: cash and each HMO’s price." /> },
  { path: 'pharmacy/till', group: GROUP, label: 'Till / End of day', permission: 'billing.shift.own', status: 'partial', icon: icon(CalendarCheck), element: <EndOfDay /> },
  { path: 'pharmacy/settings', group: GROUP, label: 'Payment setup', permission: 'billing.settings.manage', status: 'partial', icon: icon(SlidersHorizontal), element: <PaymentSetup /> },
]

/** Prescriptions, by the name earlier code knew Pharmacy's page by. */
export const pharmacyPage: EhrBluePage = pharmacyPages.find(page => page.path === 'pharmacy/prescriptions/*')!
