/**
 * The EHR's icons, by the names the design gives them (its sidebar, top bar and panels). Every one is decorative: the
 * label beside it, or the button's own name, says what it is.
 */

import { HugeiconsIcon } from '@hugeicons/react'
import Home01Icon from '@hugeicons/core-free-icons/Home01Icon'
import UserIcon from '@hugeicons/core-free-icons/UserIcon'
import Calendar03Icon from '@hugeicons/core-free-icons/Calendar03Icon'
import Route01Icon from '@hugeicons/core-free-icons/Route01Icon'
import Activity01Icon from '@hugeicons/core-free-icons/Activity01Icon'
import StethoscopeIcon from '@hugeicons/core-free-icons/StethoscopeIcon'
import TestTube01Icon from '@hugeicons/core-free-icons/TestTube01Icon'
import ScanIcon from '@hugeicons/core-free-icons/ScanIcon'
import Medicine02Icon from '@hugeicons/core-free-icons/Medicine02Icon'
import BedIcon from '@hugeicons/core-free-icons/BedIcon'
import Table01Icon from '@hugeicons/core-free-icons/Table01Icon'
import Note01Icon from '@hugeicons/core-free-icons/Note01Icon'
import Tick02Icon from '@hugeicons/core-free-icons/Tick02Icon'
import Alert02Icon from '@hugeicons/core-free-icons/Alert02Icon'
import FavouriteIcon from '@hugeicons/core-free-icons/FavouriteIcon'
import Scissor01Icon from '@hugeicons/core-free-icons/Scissor01Icon'
import MonitorDotIcon from '@hugeicons/core-free-icons/MonitorDotIcon'
import BandageIcon from '@hugeicons/core-free-icons/BandageIcon'
import Invoice01Icon from '@hugeicons/core-free-icons/Invoice01Icon'
import Shield01Icon from '@hugeicons/core-free-icons/Shield01Icon'
import PackageIcon from '@hugeicons/core-free-icons/PackageIcon'
import Share08Icon from '@hugeicons/core-free-icons/Share08Icon'
import AmbulanceIcon from '@hugeicons/core-free-icons/AmbulanceIcon'
import BloodBagIcon from '@hugeicons/core-free-icons/BloodBagIcon'
import Video01Icon from '@hugeicons/core-free-icons/Video01Icon'
import Clock01Icon from '@hugeicons/core-free-icons/Clock01Icon'
import Certificate01Icon from '@hugeicons/core-free-icons/Certificate01Icon'
import Flag02Icon from '@hugeicons/core-free-icons/Flag02Icon'
import SquareLock02Icon from '@hugeicons/core-free-icons/SquareLock02Icon'
import Tag01Icon from '@hugeicons/core-free-icons/Tag01Icon'
import Hospital01Icon from '@hugeicons/core-free-icons/Hospital01Icon'
import Car01Icon from '@hugeicons/core-free-icons/Car01Icon'
import UserMultipleIcon from '@hugeicons/core-free-icons/UserMultipleIcon'
import ChartLineData01Icon from '@hugeicons/core-free-icons/ChartLineData01Icon'
import HistoryIcon from '@hugeicons/core-free-icons/HistoryIcon'
import Building03Icon from '@hugeicons/core-free-icons/Building03Icon'
import PencilEdit01Icon from '@hugeicons/core-free-icons/PencilEdit01Icon'
import CreditCardIcon from '@hugeicons/core-free-icons/CreditCardIcon'
import FileVerifiedIcon from '@hugeicons/core-free-icons/FileVerifiedIcon'
import Notification03Icon from '@hugeicons/core-free-icons/Notification03Icon'
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon'
import CheckListIcon from '@hugeicons/core-free-icons/CheckListIcon'
import DocumentValidationIcon from '@hugeicons/core-free-icons/DocumentValidationIcon'
import Location01Icon from '@hugeicons/core-free-icons/Location01Icon'
import FileEditIcon from '@hugeicons/core-free-icons/FileEditIcon'
import Route02Icon from '@hugeicons/core-free-icons/Route02Icon'
import Wifi01Icon from '@hugeicons/core-free-icons/Wifi01Icon'
import Logout03Icon from '@hugeicons/core-free-icons/Logout03Icon'
import Cash01Icon from '@hugeicons/core-free-icons/Cash01Icon'

const ICONS = {
  home: Home01Icon,
  user: UserIcon,
  calendar: Calendar03Icon,
  route: Route01Icon,
  activity: Activity01Icon,
  stethoscope: StethoscopeIcon,
  flask: TestTube01Icon,
  scan: ScanIcon,
  pill: Medicine02Icon,
  bed: BedIcon,
  ward: Table01Icon,
  notes: Note01Icon,
  check: Tick02Icon,
  alert: Alert02Icon,
  heart: FavouriteIcon,
  scissors: Scissor01Icon,
  monitor: MonitorDotIcon,
  tooth: BandageIcon,
  receipt: Invoice01Icon,
  shield: Shield01Icon,
  box: PackageIcon,
  share: Share08Icon,
  truck: AmbulanceIcon,
  droplet: BloodBagIcon,
  video: Video01Icon,
  clock: Clock01Icon,
  badge: Certificate01Icon,
  flag: Flag02Icon,
  lock: SquareLock02Icon,
  tag: Tag01Icon,
  wardSettings: Hospital01Icon,
  vehicleSettings: Car01Icon,
  users: UserMultipleIcon,
  chart: ChartLineData01Icon,
  history: HistoryIcon,
  building: Building03Icon,
  edit: PencilEdit01Icon,
  subscription: CreditCardIcon,
  review: FileVerifiedIcon,
  bell: Notification03Icon,
  search: Search01Icon,
  checklist: CheckListIcon,
  document: DocumentValidationIcon,
  outreach: Location01Icon,
  registration: FileEditIcon,
  tour: Route02Icon,
  signal: Wifi01Icon,
  signOut: Logout03Icon,
  cash: Cash01Icon,
} as const

export type EhrIconName = keyof typeof ICONS

export const EHR_ICON_NAMES = Object.keys(ICONS) as EhrIconName[]

export interface EhrIconProps {
  readonly name: EhrIconName
  readonly size?: number
}

export function EhrIcon({ name, size = 18 }: EhrIconProps) {
  return <HugeiconsIcon icon={ICONS[name]} size={size} strokeWidth={1.65} aria-hidden />
}
