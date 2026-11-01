import { Navigate, useLocation } from 'react-router-dom'
import { CalendarCheck, PackageOpen, ReceiptText, ShoppingBag, SlidersHorizontal, Tags } from 'lucide-react'
import type { EhrBluePage } from '../types'
import { useBluePage } from '../../frame/pageContext'
import { productOf } from '../../frame/product'
import { DeptUnavailable } from '../parts/DeptPage'
import { PillIcon } from '../parts/icons'
import { useDeptAccess } from '../parts/access'
import { EndOfDay } from '../commerce/EndOfDay'
import { PaymentSetup } from '../commerce/PaymentSetup'
import { PriceList } from '../commerce/PriceList'
import { pointOfCareOpen, pointOfCareShown } from '../commerce/served'
import { Prescriptions } from './Pharmacy'
import { Sales } from './Sales'
import { Sell } from './Sell'
import { StockPage } from './Stock'

/**
 * Pharmacy (the owner's order of 2026-10-31: work first, identity optional). Seven pages, in this order, under one
 * group: in a pharmacy on its own they are the menu; in a hospital they are the Pharmacy group of the sidebar.
 * Sell, Sales & receipts, Stock, Products & prices, Till and Settings call point-of-care routes Health ID does not serve
 * yet: they show at the demo facilities only (commerce/served.ts). Prescriptions is today's pharmacy, at every facility.
 */
const GROUP = 'Pharmacy'
const icon = (I: typeof ShoppingBag) => <I aria-hidden strokeWidth={1.8} />
/** Opened by its address without the permission: today's own words (staff/routes/Operations.tsx Pharmacy), and nothing is read. */
const pharmacyUnavailable = <DeptUnavailable title="Pharmacy unavailable" message="This facility membership needs pharmacy work-item read permission." />

/**
 * The old addresses, so nothing breaks: /pharmacy opens the counter in a pharmacy and Prescriptions in a hospital (or
 * whichever the role may open), /pharmacy?rx=<id> the prescription, /pharmacy/new-sale the counter.
 */
function PharmacyHome() {
  const { rest } = useBluePage()
  const { search } = useLocation()
  const { facilityId, permissions } = useDeptAccess()
  // Sell shows only where the point-of-care routes may answer: anywhere else the counter is Prescriptions.
  const counter = pointOfCareOpen(facilityId)
  const sells = counter && permissions.includes('pharmacy.walk-in.create')
  const reads = permissions.includes('pharmacy.work-item.read')
  const rx = new URLSearchParams(search).get('rx')
  const below = rest.replace(/\/+$/, '')
  const sellFirst = counter && (productOf(window.location.hostname, permissions) === 'pharmacy' ? sells || !reads : sells && !reads)
  const to = rx ? `prescriptions/${encodeURIComponent(rx)}` : below === 'new-sale' ? 'sell' : sellFirst ? 'sell' : 'prescriptions'
  return <Navigate replace to={`/provider/pharmacy/${to}`} />
}

export const pharmacyPages: EhrBluePage[] = [
  // Not listed: the group's own address, taken to its first page.
  { path: 'pharmacy/*', group: GROUP, label: 'Pharmacy', status: 'live', icon: <PillIcon />, element: <PharmacyHome />, listed: () => false },
  { path: 'pharmacy/sell', group: GROUP, label: 'Sell', permission: 'pharmacy.walk-in.create', status: 'live', icon: icon(ShoppingBag), element: <Sell />,
    visible: pointOfCareShown },
  { path: 'pharmacy/prescriptions/*', group: GROUP, label: 'Prescriptions', permission: 'pharmacy.work-item.read', status: 'live', keepsState: true,
    icon: <PillIcon />, element: <Prescriptions />, refusal: pharmacyUnavailable },
  { path: 'pharmacy/sales/*', group: GROUP, label: 'Sales & receipts', permission: 'billing.bill.read', status: 'live', keepsState: true,
    icon: icon(ReceiptText), element: <Sales />, visible: pointOfCareShown },
  { path: 'pharmacy/stock/*', group: GROUP, label: 'Stock', permission: 'pharmacy.stock.read', status: 'live', icon: icon(PackageOpen), element: <StockPage />,
    visible: pointOfCareShown },
  { path: 'pharmacy/products', group: GROUP, label: 'Products & prices', permission: 'billing.catalogue.read', status: 'live', icon: icon(Tags),
    element: <PriceList kinds={['drug', 'other']} title="Products & prices" description="What you sell and what it costs: cash and each HMO’s price." />,
    visible: pointOfCareShown },
  { path: 'pharmacy/till', group: GROUP, label: 'Till / End of day', permission: 'billing.shift.own', status: 'live', icon: icon(CalendarCheck), element: <EndOfDay />,
    visible: pointOfCareShown },
  { path: 'pharmacy/settings', group: GROUP, label: 'Payment setup', permission: 'billing.settings.manage', status: 'live', icon: icon(SlidersHorizontal),
    element: <PaymentSetup />, visible: pointOfCareShown },
]

/** Prescriptions, by the name earlier code knew Pharmacy's page by. */
export const pharmacyPage: EhrBluePage = pharmacyPages.find(page => page.path === 'pharmacy/prescriptions/*')!
