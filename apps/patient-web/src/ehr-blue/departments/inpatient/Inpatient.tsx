import { useCallback, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { EhrButton, EhrEmptyState, EhrField, EhrSelect } from '@hid/ui/ehr'
import { inpatientApi, type AdmissionCard, type AdmissionList, type AdmissionStatus } from '../../../staff/api'
import { useBluePage } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { AdmissionRecordPage } from './AdmissionRecord'
import { BedBoardView } from './BedBoard'
import {
  EYEBROW, ICU_BASE, ICU_TITLE, INPATIENT_BASE, INPATIENT_TITLE, NOT_AVAILABLE, POLL_MS, UUID, WARDS_REFUSED, canDecide,
  canReadWards, learnFrom, refusalWords,
} from './inpatientRules'
import { NewAdmission } from './NewAdmission'
import { AdmissionItem, ScreenWarning } from './parts'
import { usePolling, useSteadyNotServed } from './hooks'
import './inpatient.css'

/**
 * Inpatient / Wards and ICU in the blue EHR (hid-system ADT-1, 0170-0173), in place of Akos's samples (clinical/sample
 * definitions.ts "inpatient" and "icu", frame/sample/catalog.ts): the admissions list (waiting for a bed first, then
 * the wards, then today's discharges), New admission, and one admission's record with its drawers' work as forms. ICU
 * is a ward type (Q201 A): the same list and record, for ICU wards only, with ICU's bed board above it. Every time is
 * Lagos's, whatever the device's zone. Names follow Q190 A (initials only until the DPO's switch, unless the chart can
 * be read). No Health ID or name in any address: an admission's address carries its UUID only.
 */
export function InpatientPage({ icu = false }: { readonly icu?: boolean }) {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canReadWards(permissions)) return <InpatientUnavailable icu={icu} />
  return <InpatientDesk key={facility.id} facilityId={facility.id} icu={icu} />
}

export function InpatientUnavailable({ icu = false }: { readonly icu?: boolean }) {
  return <DeptUnavailable title={icu ? ICU_TITLE : INPATIENT_TITLE} message={WARDS_REFUSED} />
}

function InpatientDesk({ facilityId, icu }: { readonly facilityId: string; readonly icu: boolean }) {
  const { rest } = useBluePage()
  const [filter, setFilter] = useState<Filter>('')
  const base = icu ? ICU_BASE : INPATIENT_BASE
  const below = rest.replace(/\/+$/, '')
  if (below === '') return <AdmissionsList facilityId={facilityId} icu={icu} filter={filter} onFilter={setFilter} />
  if (below === 'new' && !icu) return <NewAdmission facilityId={facilityId} />
  if (UUID.test(below)) return <AdmissionRecordPage key={below} facilityId={facilityId} admissionId={below.toLowerCase()} base={base} />
  // Anything else (a sample record's id, a mistyped address): the list.
  return <Navigate replace to={base} />
}

type Filter = '' | AdmissionStatus
const FILTERS: ReadonlyArray<readonly [Filter, string]> = [
  ['', 'Open admissions and today’s discharges'],
  ['requested', 'Waiting for a bed'],
  ['admitted', 'Admitted'],
  ['discharge_ready', 'Discharge ready'],
  ['discharged', 'Discharged'],
  ['cancelled', 'Requests cancelled'],
]

interface Group {
  readonly id: string
  readonly title: string
  readonly empty: string
  readonly message: string
  readonly has: (card: AdmissionCard) => boolean
}
const MOVING = 'Patients show here as they move.'
const GROUPS: readonly Group[] = [
  { id: 'waiting', title: 'Waiting for a bed', empty: 'No one is waiting for a bed.', message: MOVING, has: card => card.status === 'requested' },
  { id: 'wards', title: 'On the wards', empty: 'No one is admitted.', message: MOVING, has: card => card.status === 'admitted' || card.status === 'discharge_ready' },
  { id: 'today', title: 'Discharged or cancelled today', empty: 'No one has left today.', message: MOVING, has: card => card.status === 'discharged' || card.status === 'cancelled' },
]
/**
 * ICU's list (wardType=icu) has the requests for an ICU ward only: one waiting list on the page, said so, with the bed
 * board's own left out. A request for any ward waits on Inpatient / Wards.
 */
const ICU_GROUPS: readonly Group[] = GROUPS.map(group => group.id === 'waiting' ? {
  ...group, title: 'Waiting for an ICU bed', empty: 'No one is waiting for an ICU bed.',
  message: 'Requests for an ICU ward show here. Requests for any ward are on Inpatient / Wards.',
} : group)

function AdmissionsList({ facilityId, icu, filter, onFilter }: {
  readonly facilityId: string
  readonly icu: boolean
  readonly filter: Filter
  readonly onFilter: (value: Filter) => void
}) {
  const navigate = useNavigate()
  const { permissions } = useDeptAccess()
  const loader = useCallback((id: string) => inpatientApi.admissions(id, {
    ...(filter ? { status: filter } : {}), ...(icu ? { wardType: 'icu' as const } : {}),
  }).then(answer => { learnFrom(); return answer }, caught => { learnFrom(caught); throw caught }), [filter, icu])
  const list = useFacilityRead<AdmissionList>(facilityId, true, loader, 'The admissions could not be loaded.')
  const { refresh } = list
  usePolling(refresh, POLL_MS)
  // Kept while the list is read again (every minute): a page switched off stays so, without a moment of controls.
  const unavailable = useSteadyNotServed(list)
  const error = unavailable ? NOT_AVAILABLE : list.error ? refusalWords(list.caught, list.error) : ''
  const items = list.value?.items ?? []
  const base = icu ? ICU_BASE : INPATIENT_BASE

  return (
    <DeptPage eyebrow={EYEBROW} title={icu ? ICU_TITLE : INPATIENT_TITLE}
      description={icu
        ? 'Patients in the ICU wards and their beds. ICU is a ward type: admit, move and discharge as on any ward.'
        : 'Patients waiting for a bed, on the wards and discharged today. Open one to give a bed, move them or discharge them.'}
      primaryAction={canDecide(permissions) && !unavailable
        ? <EhrButton onClick={() => navigate(`${INPATIENT_BASE}/new`)}>New admission</EhrButton> : undefined}
      secondaryActions={<EhrButton variant="secondary" onClick={() => void refresh()} busy={list.loading && list.value !== null}>Refresh</EhrButton>}>
      <ScreenWarning />
      {error ? <DeptNotice role="alert" tone={unavailable ? 'info' : 'critical'}>{error}</DeptNotice> : null}

      {icu && !unavailable ? <BedBoardView facilityId={facilityId} which={{ wardType: 'icu' }} headingId="icu-board" recordBase={ICU_BASE} waiting={false} /> : null}

      {!unavailable ? (
        <div className="hid-ehr-dept-inpatient-controls">
          <EhrField label="Show" controlId={`${icu ? 'icu' : 'inpatient'}-filter`}>
            <EhrSelect value={filter} onChange={event => onFilter(event.target.value as Filter)}>
              {FILTERS.map(([value, words]) => <option key={value} value={value}>{words}</option>)}
            </EhrSelect>
          </EhrField>
        </div>
      ) : null}
      {list.value === null && list.loading && !error ? <p className="hid-ehr-state-message" role="status">Loading the admissions…</p> : null}

      {list.value !== null && !unavailable ? (
        filter === '' ? (icu ? ICU_GROUPS : GROUPS).map(group => {
          const cards = items.filter(group.has)
          const headingId = `${icu ? 'icu' : 'inpatient'}-${group.id}`
          return (
            <DeptSection key={group.id} title={`${group.title} (${cards.length})`} headingId={headingId}>
              {cards.length === 0 ? <EhrEmptyState title={group.empty} message={group.message} /> : (
                <ul className="hid-ehr-dept-inpatient-list" aria-labelledby={headingId}>
                  {cards.map(card => <AdmissionItem key={card.admissionId} card={card} base={base} />)}
                </ul>
              )}
            </DeptSection>
          )
        }) : (
          <DeptSection title={`${FILTERS.find(([value]) => value === filter)?.[1] ?? ''} (${items.length})`} headingId="inpatient-filtered">
            {items.length === 0 ? <EhrEmptyState title="No admissions to show." message="Choose another list above." /> : (
              <ul className="hid-ehr-dept-inpatient-list" aria-labelledby="inpatient-filtered">
                {items.map(card => <AdmissionItem key={card.admissionId} card={card} base={base} />)}
              </ul>
            )}
          </DeptSection>
        )
      ) : null}
      {list.value?.hasMore && !unavailable ? (
        <DeptNotice tone="caution">Only the first {list.value.limit} admissions are shown. Choose a list above to see the rest.</DeptNotice>
      ) : null}
    </DeptPage>
  )
}
