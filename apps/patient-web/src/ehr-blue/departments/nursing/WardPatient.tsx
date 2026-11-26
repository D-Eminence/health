import { useCallback, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { EhrButton, EhrModuleTabs } from '@hid/ui/ehr'
import { nursingApi, type WardPatientCard } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { cameFrom } from '../../clinical/parts/cameFrom'
import { useBluePage } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { FluidBalance } from './FluidBalance'
import { PatientMedicines } from './MedicineRound'
import {
  EYEBROW, NURSING_REFUSED, PATIENT_BASE, PATIENT_TITLE, ROUND_BASE, ROUND_TITLE, SCREEN_WARNING, TASKS_BASE, TASKS_TITLE, UUID,
  canOpenWardPatient, canReadChart, canReadFluids, canReadRound, canReadTasks, canWriteTasks, learningRefusal, notServed, patientName,
  refusalWords,
} from './nursingRules'
import { ObservationChart } from './Observations'
import { PatientIdentity } from './parts'
import { NEW_TASK_ID, TASK_FORM_ID, TaskForm, TaskList } from './Tasks'

type Tab = 'observations' | 'medicines' | 'fluids' | 'tasks'
const TAB_WORDS: Readonly<Record<Tab, string>> = { observations: 'Observations', medicines: 'Medicines', fluids: 'Fluid balance', tasks: 'Tasks' }

/** What the chart says of a stay that is not on the ward now, by its status. */
const NOT_OPEN_WORDS: Readonly<Partial<Record<WardPatientCard['status'], string>>> = {
  discharged: 'This patient has been discharged. The record can still be read.',
  cancelled: 'This admission was cancelled.',
  requested: 'This patient is waiting for a bed.',
}

/**
 * One patient's ward chart: `/provider/ward-patient/<admissionId>/<tab>` (the admission's UUID, never a Health ID or a
 * name), with the observation chart, the medicine administration record, fluid balance and the stay's tasks, each tab
 * shown to the roles whose codes read it. Reached from the medicine round, nursing tasks and the handover sheet; not
 * listed in the sidebar. The admission's card (ADT-1 route 12) heads it, named under Q190 A. The back arrow returns to
 * the list it was opened from (its address kept in router state, cameFrom.ts), whichever tab is shown; an address opened
 * on its own goes back to the ward's medicine round from Medicines, else its nursing tasks.
 */
export function WardPatient() {
  const { facility, permissions } = useDeptAccess()
  const { rest } = useBluePage()
  if (!facility || !canOpenWardPatient(permissions)) return <DeptUnavailable title={PATIENT_TITLE} message={NURSING_REFUSED} />
  const [admissionId = '', asked = ''] = rest.replace(/\/+$/, '').split('/')
  if (!UUID.test(admissionId)) return <Navigate replace to={TASKS_BASE} />
  const tabs = tabsFor(permissions)
  const tab = (tabs.includes(asked as Tab) ? asked : tabs[0]) as Tab
  return <PatientChart key={`${facility.id}-${admissionId}`} facilityId={facility.id} admissionId={admissionId.toLowerCase()} tab={tab} tabs={tabs} />
}

function tabsFor(permissions: readonly string[]): Tab[] {
  const tabs: Tab[] = []
  if (canReadChart(permissions)) tabs.push('observations')
  if (canReadRound(permissions)) tabs.push('medicines')
  if (canReadFluids(permissions)) tabs.push('fluids')
  if (canReadTasks(permissions)) tabs.push('tasks')
  return tabs
}

function PatientChart({ facilityId, admissionId, tab, tabs }: {
  readonly facilityId: string
  readonly admissionId: string
  readonly tab: Tab
  readonly tabs: readonly Tab[]
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { permissions } = useDeptAccess()
  const loader = useCallback((id: string) => learningRefusal(nursingApi.admission(id, admissionId)), [admissionId])
  const read = useFacilityRead(facilityId, true, loader, 'This patient could not be loaded.')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(0)
  const [said, setSaid] = useState('')
  const focus = useFocusById()
  const card = read.value?.admission ?? null
  const open = card !== null && (card.status === 'admitted' || card.status === 'discharge_ready')
  const came = cameFrom(location.state)
  const list = tab === 'medicines' ? ROUND_BASE : TASKS_BASE
  const back = came ?? { to: card?.wardId ? `${list}?ward=${card.wardId}` : list, label: `Back to ${tab === 'medicines' ? ROUND_TITLE : TASKS_TITLE}` }

  return (
    <DeptPage eyebrow={EYEBROW} title={card ? patientName(card) : PATIENT_TITLE} className="hid-ehr-dept-nursing"
      onBack={() => navigate(back.to)} backLabel={back.label}
      description={card ? [card.wardName, card.admissionNumber].filter(Boolean).join(' · ') : undefined}
      primaryAction={tab === 'tasks' && open && canWriteTasks(permissions) && !adding
        ? <EhrButton id={NEW_TASK_ID} onClick={() => { setSaid(''); setAdding(true); focus(TASK_FORM_ID) }}>New task</EhrButton> : undefined}>
      <DeptNotice tone="caution" title="Staff only">{SCREEN_WARNING}</DeptNotice>
      {card ? <PatientIdentity card={card} /> : null}
      {read.caught ? <DeptNotice role="alert" tone={notServed(read.caught) ? 'info' : 'critical'}>{refusalWords(read.caught, 'This patient could not be loaded.')}</DeptNotice> : null}
      {card && !open ? <DeptNotice tone="info">{NOT_OPEN_WORDS[card.status] ?? NOT_OPEN_WORDS.discharged}</DeptNotice> : null}
      {tabs.length > 1 ? (
        <EhrModuleTabs label="Ward chart" currentId={tab}
          tabs={tabs.map(id => ({ id, label: TAB_WORDS[id], href: `${PATIENT_BASE}/${admissionId}/${id}` }))}
          onNavigate={(chosen, event) => {
            event.preventDefault()
            setAdding(false)
            setSaid('')
            // Where the chart was opened from goes with each tab, so the back arrow still returns there.
            navigate(chosen.href, { state: location.state })
          }} />
      ) : null}
      {read.value === null && read.loading ? <p className="hid-ehr-state-message" role="status">Loading the patient…</p> : null}
      {read.caught && notServed(read.caught) ? null : (
        <>
          {tab === 'observations' && read.value ? <ObservationChart facilityId={facilityId} admission={card} /> : null}
          {tab === 'medicines' ? <PatientMedicines facilityId={facilityId} admissionId={admissionId} /> : null}
          {tab === 'fluids' && read.value ? <FluidBalance facilityId={facilityId} admission={card} /> : null}
          {tab === 'tasks' ? (
            <>
              {said ? <p className="hid-ehr-state-message" role="status">{said}</p> : null}
              {adding && card ? <TaskForm facilityId={facilityId} admission={card}
                onDone={done => { setAdding(false); focus(NEW_TASK_ID); if (done) { setSaid('Task added.'); setAdded(n => n + 1) } }} /> : null}
              <TaskList facilityId={facilityId} where={{ admissionId }} showPatient={false} refreshKey={added} />
            </>
          ) : null}
        </>
      )}
    </DeptPage>
  )
}
