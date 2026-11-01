import { Navigate, useLocation } from 'react-router-dom'
import { CalendarCheck, ClipboardList, FileText, FlaskConical, Plus, SlidersHorizontal, Tags } from 'lucide-react'
import type { StaffSession } from '../../../staff/api'
import { LAB_WORK, refusedWorkText } from '../../../staff/refusedWork'
import type { EhrBluePage } from '../types'
import { productOf } from '../../frame/product'
import { DeptUnavailable } from '../parts/DeptPage'
import { FlaskIcon } from '../parts/icons'
import { useDeptAccess } from '../parts/access'
import { EndOfDay } from '../commerce/EndOfDay'
import { PaymentSetup } from '../commerce/PaymentSetup'
import { PriceList } from '../commerce/PriceList'
import { Laboratory } from './Laboratory'
import { NewRequest } from './NewRequest'
import { Results } from './Results'

/**
 * Laboratory (the owner's order of 2026-10-31: work first, identity optional). Six pages, in this order: New request,
 * Work list, Results, Tests & prices, Till / End of day, Settings. In a lab on its own they are the whole menu, under
 * one group; in a hospital, the sidebar's one Laboratory item opens them as tabs.
 */
const GROUP = 'Laboratory'
/**
 * The refusal at the Laboratory's entry, Work list and Results for a role that can't read the lab's work. Screens name
 * no permission (the owner's rule), so today's words, which named the one lacking, give way to plain words, chosen by who
 * reads them as the Pharmacy's refusal chooses its own (refusedWorkText): a self-signed-up facility's administrator is
 * never told to ask themselves. It names only what is refused: a role may still raise a New request without it.
 */
function LabUnavailable() {
  const { facility, permissions } = useDeptAccess()
  return <DeptUnavailable title="Laboratory unavailable" message={refusedWorkText(facility, permissions, LAB_WORK)} />
}
const icon = (I: typeof Plus) => <I aria-hidden strokeWidth={1.8} />

/** Listed in a hospital's sidebar only: a lab on its own lists its six pages instead. */
const inHospital = (session: StaffSession) => productOf(window.location.hostname, session.actor.facility?.permissions ?? []) === 'ehr'

/** The old addresses, so nothing breaks: /laboratory opens the work list, /laboratory?work=<id> that request. */
function LabHome() {
  const work = new URLSearchParams(useLocation().search).get('work')
  return <Navigate replace to={work ? `/provider/laboratory/work/${encodeURIComponent(work)}` : '/provider/laboratory/work'} />
}

export const laboratoryPage: EhrBluePage = {
  path: 'laboratory',
  group: 'Diagnostics',
  label: 'Laboratory',
  permission: 'lab.work-item.read',
  status: 'live',
  icon: <FlaskIcon />,
  element: <LabHome />,
  ownTab: false,
  listed: inHospital,
  // Opened by its address without the permission: the Laboratory's own refusal, and nothing is read.
  refusal: <LabUnavailable />,
}

export const labPages: EhrBluePage[] = [
  { path: 'laboratory/new', group: GROUP, label: 'New request', tabOf: 'laboratory', permission: 'lab.walk-in.create', status: 'live',
    icon: icon(Plus), element: <NewRequest /> },
  { path: 'laboratory/work/*', group: GROUP, label: 'Work list', tabOf: 'laboratory', permission: 'lab.work-item.read', status: 'live', keepsState: true,
    icon: icon(ClipboardList), element: <Laboratory />, refusal: <LabUnavailable /> },
  { path: 'laboratory/results/*', group: GROUP, label: 'Results', tabOf: 'laboratory', permission: 'lab.work-item.read', status: 'live', keepsState: true,
    icon: icon(FileText), element: <Results />, refusal: <LabUnavailable /> },
  { path: 'laboratory/tests', group: GROUP, label: 'Tests & prices', tabOf: 'laboratory', permission: 'billing.catalogue.read', status: 'live',
    icon: icon(Tags), element: <PriceList kinds={['lab_test']} title="Tests & prices" description="The tests you offer and what each costs: cash and each HMO’s price." /> },
  { path: 'laboratory/till', group: GROUP, label: 'Till / End of day', tabOf: 'laboratory', permission: 'billing.shift.own', status: 'live',
    icon: icon(CalendarCheck), element: <EndOfDay /> },
  { path: 'laboratory/settings', group: GROUP, label: 'Payment setup', tabOf: 'laboratory', permission: 'billing.settings.manage', status: 'live',
    icon: icon(SlidersHorizontal), element: <PaymentSetup /> },
  // The old New walk-in address: never listed and no tab, it opens New request.
  { path: 'laboratory/new-walk-in', group: GROUP, label: 'New request', permission: 'lab.walk-in.create', status: 'live', listed: () => false,
    icon: <FlaskConical aria-hidden strokeWidth={1.8} />, element: <Navigate replace to="/provider/laboratory/new" /> },
]
