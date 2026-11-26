import type { ReactNode } from 'react'
import type { EhrBluePage } from '../../frame/types'
import { ClinicalShifts } from './ClinicalShifts'
import { ShiftHandover } from './Handover'
import { MedicineRound } from './MedicineRound'
import {
  ASSIGN_MANAGE, HANDOVER_TITLE, MAR_READ, NURSING_REFUSED, PATIENT_TITLE, ROUND_TITLE, SHIFTS_REFUSED, SHIFTS_TITLE,
  SHIFT_MANAGE, TASKS_TITLE, TASK_READ, VITAL_READ, nursingServed, subscribeNursingServed, useNursingServed,
} from './nursingRules'
import { NotSwitchedOn } from './parts'
import { NursingTasks } from './Tasks'
import { WardPatient } from './WardPatient'
import { DeptUnavailable } from '../parts/DeptPage'
import './nursing.css'

/** A small line icon in the sidebar's stroke style. Hidden: the page's label names it. */
function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg className="hid-ehr-dept-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

/**
 * Once a read has answered 404 (an ehr-api before NUR-1) or 503 NURSING_NOT_AVAILABLE (either flag off), the page says
 * "not switched on yet" in place of itself; its address still opens. Built, but off until the clinical lead's checklist
 * and the owner's go-live (Q160 A).
 */
function Served({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return useNursingServed() === false ? <NotSwitchedOn title={title} /> : <>{children}</>
}

/** Listed in the sidebar and search while nothing has said nursing is not served here. */
const listed = () => nursingServed() !== false

/**
 * Nursing on the ward (hid-system NUR-1, 0174-0177, on hid-system #343): Nursing tasks in place of Akos's sample (same
 * address, same place under Care), and beside it the Medicine round and Shift handover; Clinical shifts under Settings;
 * and one patient's ward chart (observations, medicines, fluid balance, tasks) reached from them, never listed.
 * Partial, not live: the routes are proposed until #343 is live, and production keeps them off until go-live. Each page
 * opens with its own code, so the backend's roles decide (nurses, clinicians and doctors; admins set shifts up).
 */
export const nursingPages: EhrBluePage[] = [
  {
    path: 'nursing-tasks/*', group: 'Clinical', label: TASKS_TITLE, permission: TASK_READ, status: 'partial', keepsState: true,
    icon: <Icon><path d="M9 11l2 2 4-4" /><rect x="4" y="4" width="16" height="16" rx="3" /></Icon>,
    element: <Served title={TASKS_TITLE}><NursingTasks /></Served>,
    refusal: <DeptUnavailable title={TASKS_TITLE} message={NURSING_REFUSED} />,
    listed, listedChanges: subscribeNursingServed,
  },
  {
    path: 'medicine-round/*', group: 'Clinical', label: ROUND_TITLE, permission: MAR_READ, status: 'partial', keepsState: true,
    icon: <Icon><rect x="3.5" y="9" width="17" height="6" rx="3" transform="rotate(-35 12 12)" /><path d="M10 8.5l3.5 6" /></Icon>,
    element: <Served title={ROUND_TITLE}><MedicineRound /></Served>,
    refusal: <DeptUnavailable title={ROUND_TITLE} message={NURSING_REFUSED} />,
    listed, listedChanges: subscribeNursingServed,
  },
  {
    path: 'handover/*', group: 'Clinical', label: HANDOVER_TITLE, permission: TASK_READ, status: 'partial', keepsState: true,
    icon: <Icon><path d="M4 8h12l-3-3M20 16H8l3 3" /></Icon>,
    element: <Served title={HANDOVER_TITLE}><ShiftHandover /></Served>,
    refusal: <DeptUnavailable title={HANDOVER_TITLE} message={NURSING_REFUSED} />,
    listed, listedChanges: subscribeNursingServed,
  },
  {
    path: 'ward-patient/*', group: 'Clinical', label: PATIENT_TITLE, permission: TASK_READ, orPermissions: [MAR_READ, VITAL_READ],
    status: 'partial', keepsState: true,
    element: <Served title={PATIENT_TITLE}><WardPatient /></Served>,
    refusal: <DeptUnavailable title={PATIENT_TITLE} message={NURSING_REFUSED} />,
    // Reached from the ward lists with an admission's id; nothing to open on its own.
    listed: () => false,
  },
  {
    path: 'clinical-shifts/*', group: 'Settings', label: SHIFTS_TITLE, permission: SHIFT_MANAGE, orPermissions: [ASSIGN_MANAGE],
    status: 'partial', keepsState: true,
    icon: <Icon><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></Icon>,
    element: <Served title={SHIFTS_TITLE}><ClinicalShifts /></Served>,
    refusal: <DeptUnavailable title={SHIFTS_TITLE} message={SHIFTS_REFUSED} />,
    listed, listedChanges: subscribeNursingServed,
  },
]

