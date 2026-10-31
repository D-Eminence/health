import { PackageOpen, ShoppingBag } from 'lucide-react'
import type { EhrBluePage } from '../types'
import { PillIcon } from '../parts/icons'
import { NewSale } from './NewSale'
import { Pharmacy } from './Pharmacy'
import { StockPage } from './Stock'

export const pharmacyPage: EhrBluePage = {
  path: 'pharmacy',
  group: 'Diagnostics',
  label: 'Pharmacy',
  // Its name among its tabs (New sale, Stock) in a hospital, and in a pharmacy's own menu.
  tabLabel: 'To dispense',
  permission: 'pharmacy.work-item.read',
  status: 'live',
  icon: <PillIcon />,
  element: <Pharmacy />,
}

/*
 * The pharmacy's point-of-care pages (docs/POINT_OF_CARE_SPEC.md §4, §5), built against proposed routes: each says so
 * when they answer 404, and saves nothing. In a hospital they are tabs of Pharmacy; a pharmacy on its own lists them in
 * its menu (frame/BlueFrame.tsx).
 */
export const newSalePage: EhrBluePage = {
  path: 'pharmacy/new-sale',
  group: 'Diagnostics',
  label: 'New sale',
  tabOf: 'pharmacy',
  permission: 'pharmacy.walk-in.create',
  status: 'live',
  icon: <ShoppingBag aria-hidden strokeWidth={1.8} />,
  element: <NewSale />,
}

export const stockPage: EhrBluePage = {
  path: 'pharmacy/stock/*',
  group: 'Diagnostics',
  label: 'Stock',
  tabOf: 'pharmacy',
  permission: 'pharmacy.stock.read',
  status: 'live',
  icon: <PackageOpen aria-hidden strokeWidth={1.8} />,
  element: <StockPage />,
}
