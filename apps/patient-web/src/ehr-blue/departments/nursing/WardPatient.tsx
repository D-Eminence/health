import { useCallback, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { EhrButton, EhrModuleTabs } from '@hid/ui/ehr'
import { nursingApi } from '../../../staff/api'
import { useBluePage } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { FluidBalance } from './FluidBalance'
import { PatientMedicines } from './MedicineRound'
import {
  EYEBROW, NURSING_REFUSED, PATIENT_BASE, PATIENT_TITLE, ROUND_BASE, SCREEN_WARNING, TASKS_BASE, UUID, canOpenWardPatient,
  canReadChart, canReadFluids, canReadRound, canReadTasks, canWriteTasks, learningRefusal, notServed, patientName, refusalWords,
} from './nursingRules'
import { ObservationChart } from './Observations'
import { PatientIdentity } from './parts'
import { TaskForm, TaskList } from './Tasks'

type Tab = 'observations' | 'medicines' | 'fluids' | 'tasks'
const TAB_WORDS: Readonly<Record<Tab, string>> = { observations: 'Observations', medicines: 'Medicines', fluids: 'Fluid balance', tasks: 'Tasks' }

/**
 * One patient's ward chart: `/provider/ward-patient/<admissionId>/<tab>` (the admission's UUID, never a Health ID or a
 * name), with the observation chart, the medicine administration record, fluid balance and the stay's tasks, each tab
 * shown to the roles whose codes read it. Reached from the medicine round, nursing tasks and the handover sheet; not
 * listed in the sidebar. The admission's card (ADT-1 route 12) heads it, named under Q190 A.
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
  const { permissions } = useDeptAccess()
  const loader = useCallback((id: string) => learningRefusal(nursingApi.admission(id, admissionId)), [admissionId])
  const read = useFacilityRead(facilityId, true, loader, 'This patient could not be loaded.')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(0)
  const card = read.value?.admission ?? null
  const open = card !== null && (card.status === 'admitted' || card.status === 'discharge_ready')
  const back = tab === 'medicines' ? ROUND_BASE : TASKS_BASE

  return (
    <DeptPage eyebrow={EYEBROW} title={card ? patientName(card) : PATIENT_TITLE} className="hid-ehr-dept-nursing"
      onBack={() => navigate(card?.wardId ? `${back}?ward=${card.wardId}` : back)} backLabel="Back to the ward"
      description={card ? [card.wardName, card.admissionNumber].filter(Boolean).join(' · ') : undefined}
      primaryAction={tab === 'tasks' && open && canWriteTasks(permissions) && !adding
        ? <EhrButton onClick={() => setAdding(true)}>New task</EhrButton> : undefined}>
      <DeptNotice tone="caution" title="Staff only">{SCREEN_WARNING}</DeptNotice>
      {card ? <PatientIdentity card={card} /> : null}
      {read.caught ? <DeptNotice role="alert" tone={notServed(read.caught) ? 'info' : 'critical'}>{refusalWords(read.caught, 'This patient could not be loaded.')}</DeptNotice> : null}
      {card && !open ? <DeptNotice tone="info">This patient has been discharged. The record can still be read.</DeptNotice> : null}
      {tabs.length > 1 ? (
        <EhrModuleTabs label="Ward chart" currentId={tab}
          tabs={tabs.map(id => ({ id, label: TAB_WORDS[id], href: `${PATIENT_BASE}/${admissionId}/${id}` }))}
          onNavigate={(chosen, event) => { event.preventDefault(); setAdding(false); navigate(chosen.href) }} />
      ) : null}
      {read.value === null && read.loading ? <p className="hid-ehr-state-message" role="status">Loading the patient…</p> : null}
      {read.caught && notServed(read.caught) ? null : (
        <>
          {tab === 'observations' && read.value ? <ObservationChart facilityId={facilityId} admission={card} /> : null}
          {tab === 'medicines' ? <PatientMedicines facilityId={facilityId} admissionId={admissionId} /> : null}
          {tab === 'fluids' && read.value ? <FluidBalance facilityId={facilityId} admission={card} /> : null}
          {tab === 'tasks' ? (
            <>
              {adding && card ? <TaskForm facilityId={facilityId} admission={card}
                onDone={done => { setAdding(false); if (done) setAdded(n => n + 1) }} /> : null}
              <TaskList facilityId={facilityId} where={{ admissionId }} showPatient={false} refreshKey={added} />
            </>
          ) : null}
        </>
      )}
    </DeptPage>
  )
}
