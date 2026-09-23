import { HugeiconsIcon } from '@hugeicons/react'
import Menu01Icon from '@hugeicons/core-free-icons/Menu01Icon'
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon'
import Activity01Icon from '@hugeicons/core-free-icons/Activity01Icon'
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon'
import ArrowRight02Icon from '@hugeicons/core-free-icons/ArrowRight02Icon'
import ArrowUpRight01Icon from '@hugeicons/core-free-icons/ArrowUpRight01Icon'
import Attachment01Icon from '@hugeicons/core-free-icons/Attachment01Icon'
import BedSingle01Icon from '@hugeicons/core-free-icons/BedSingle01Icon'
import Calendar03Icon from '@hugeicons/core-free-icons/Calendar03Icon'
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon'
import CodeIcon from '@hugeicons/core-free-icons/CodeIcon'
import DashboardSquare01Icon from '@hugeicons/core-free-icons/DashboardSquare01Icon'
import Database01Icon from '@hugeicons/core-free-icons/Database01Icon'
import File01Icon from '@hugeicons/core-free-icons/File01Icon'
import Hospital01Icon from '@hugeicons/core-free-icons/Hospital01Icon'
import Location01Icon from '@hugeicons/core-free-icons/Location01Icon'
import Medicine02Icon from '@hugeicons/core-free-icons/Medicine02Icon'
import Notification03Icon from '@hugeicons/core-free-icons/Notification03Icon'
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon'
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon'
import Shield01Icon from '@hugeicons/core-free-icons/Shield01Icon'
import TestTube01Icon from '@hugeicons/core-free-icons/TestTube01Icon'
import UserGroupIcon from '@hugeicons/core-free-icons/UserGroupIcon'
import UserIcon from '@hugeicons/core-free-icons/UserIcon'

const icons = {
  menu: Menu01Icon, close: Cancel01Icon,
  activity: Activity01Icon, down: ArrowDown01Icon, arrow: ArrowRight02Icon,
  trend: ArrowUpRight01Icon, attachment: Attachment01Icon, bed: BedSingle01Icon,
  calendar: Calendar03Icon, check: CheckmarkCircle02Icon, code: CodeIcon,
  dashboard: DashboardSquare01Icon, database: Database01Icon, file: File01Icon,
  hospital: Hospital01Icon, location: Location01Icon, medicine: Medicine02Icon,
  bell: Notification03Icon, search: Search01Icon, settings: Settings01Icon,
  shield: Shield01Icon, laboratory: TestTube01Icon, people: UserGroupIcon, person: UserIcon,
} as const

export type HealthIconName = keyof typeof icons

/** Hugeicons' free rounded stroke set, shared across the public product previews. */
export function HealthIcon({ name, size = 20, className }: { name: HealthIconName; size?: number; className?: string }) {
  return <HugeiconsIcon icon={icons[name]} size={size} strokeWidth={1.65} color="currentColor" aria-hidden="true" className={className} />
}
