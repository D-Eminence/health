import { useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { EhrModuleTabs } from '@hid/ui/ehr'
import { useBluePage } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { InCharges } from './InCharges'
import { LeaveToDecide, MyLeave } from './Leave'
import { MyDuties, OnDutyNow } from './OnDuty'
import { RosterCard } from './RosterCard'
import { RosterWeek } from './RosterWeek'
import {
  BASE, DESCRIPTION, NOT_AVAILABLE, NOT_AVAILABLE_MORE, READ_REFUSED, ROSTER_ID, TITLE, canAskLeave, canManage, canRead,
  thisWeek, useDutyRosterServed,
} from './rosterRules'
import './roster.css'

/**
 * The duty roster (hid-system ROS-1, 0200-0202) in place of Akos's "Shifts & Roster" sample: each department's roster for
 * a week on the facility's clinical shifts (NUR-1), its duties saved all at once and published, attendance marked by the
 * in-charge, who is on duty now, each person's own duties and leave, the leave an in-charge or administrator decides, and
 * who is in charge of each department. Every day and time is Lagos's, whatever the device's zone; no Health ID, NIN or
 * name in any address (a roster's UUID only).
 *
 * Partial, not live: its routes are proposed (built on claude/sprint-hr-backend), and production keeps them off at real
 * facilities until the clinical lead's checklist and the owner's go-live (Q160 A). Once a read answers 404 or 503
 * DUTY_ROSTER_NOT_AVAILABLE, the page says it is not switched on yet and the sidebar stops listing it; at a demo
 * facility the Shifts & Roster sample stays as it is.
 */
export function DutyRoster() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !(canRead(permissions) || canAskLeave(permissions))) return <DeptUnavailable title={TITLE} message={READ_REFUSED} />
  return <RosterDesk key={facility.id} facilityId={facility.id} />
}

/** What the page says where the roster is not served here (the flag off, or an identity-api before ROS-1). */
export function RosterNotSwitchedOn() {
  return (
    <DeptPage title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-roster">
      <DeptNotice tone="info" role="status" title={NOT_AVAILABLE}>{NOT_AVAILABLE_MORE}</DeptNotice>
    </DeptPage>
  )
}

type View = 'rosters' | 'on-duty' | 'my-duties' | 'my-leave' | 'leave' | 'in-charges'
const VIEWS: readonly View[] = ['on-duty', 'my-duties', 'my-leave', 'leave', 'in-charges']
const VIEW_LABELS: Readonly<Record<View, string>> = {
  rosters: 'Rosters', 'on-duty': 'On duty now', 'my-duties': 'My duties', 'my-leave': 'My leave', leave: 'Leave to decide',
  'in-charges': 'In-charges',
}

function RosterDesk({ facilityId }: { readonly facilityId: string }) {
  const { rest } = useBluePage()
  const navigate = useNavigate()
  const { permissions } = useDeptAccess()
  const served = useDutyRosterServed(facilityId)
  // The week the Rosters view shows, kept while a roster below it is open (the page keeps its state).
  const [week, setWeek] = useState(() => thisWeek())
  // The departments this person is in charge of, as the week's list says (route 15's inChargeOf).
  const [inChargeOf, setInChargeOf] = useState<readonly string[]>([])
  if (served === false) return <RosterNotSwitchedOn />

  const reads = canRead(permissions)
  const manages = canManage(permissions)
  const tabs: View[] = [
    ...reads ? ['rosters', 'on-duty'] as const : [],
    'my-duties',
    ...canAskLeave(permissions) ? ['my-leave'] as const : [],
    ...manages || inChargeOf.length > 0 ? ['leave'] as const : [],
    ...manages ? ['in-charges'] as const : [],
  ]
  const below = rest.replace(/\/+$/, '')
  const view: View | 'roster' | null = below === '' ? (reads ? 'rosters' : 'my-duties') : ROSTER_ID.test(below) ? 'roster'
    : (VIEWS as readonly string[]).includes(below) ? below as View : null
  // Anything else (a sample record's id from the frame's own store, a mistyped address): the page's first view.
  if (view === null || (view === 'rosters' && !reads)) return <Navigate replace to={BASE} />

  const nav = (
    <EhrModuleTabs label={TITLE} className="hid-ehr-dept-roster-tabs" currentId={view === 'roster' ? 'rosters' : view}
      tabs={tabs.map(id => ({ id, label: VIEW_LABELS[id], href: id === 'rosters' ? BASE : `${BASE}/${id}` }))}
      onNavigate={(tab, event) => { event.preventDefault(); navigate(tab.href) }} />
  )
  let content: ReactNode
  switch (view) {
    case 'roster': content = <RosterCard key={below} facilityId={facilityId} rosterId={below.toLowerCase()} />; break
    case 'rosters': content = <RosterWeek facilityId={facilityId} week={week} onWeek={setWeek} onInChargeOf={setInChargeOf} />; break
    case 'on-duty': content = reads ? <OnDutyNow facilityId={facilityId} /> : <DeptUnavailable title={VIEW_LABELS['on-duty']} message={READ_REFUSED} />; break
    case 'my-duties': content = <MyDuties facilityId={facilityId} />; break
    case 'my-leave': content = <MyLeave facilityId={facilityId} />; break
    case 'leave': content = <LeaveToDecide facilityId={facilityId} />; break
    case 'in-charges': content = <InCharges facilityId={facilityId} />; break
  }
  return <div className="hid-ehr-dept-roster-desk">{tabs.length > 1 ? nav : null}{content}</div>
}
