import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { lagosDay } from '@hid/ui/display'
import { inpatientApi, type Census, type CensusCounts, type Ward } from '../../../staff/api'
import { useBluePage } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { BedBoardView } from './BedBoard'
import {
  EYEBROW, WARDS_BASE, WARDS_REFUSED, WARDS_TITLE, canReadWards, censusRange, dayText, learnFrom, notServed, refusalWords,
  wardTypeText,
} from './inpatientRules'
import { ScreenWarning } from './parts'
import './inpatient.css'

/**
 * Wards & Beds in the blue EHR (hid-system ADT-1 routes 1, 7, 8 and 9), in place of Akos's sample (clinical/sample
 * definitions.ts "wards": Bed name, Ward; Complete bed turnover, Place in maintenance, Release from maintenance): the bed
 * board of one ward at a time, and the census (counts only, never a patient) for today or a Lagos day up to 90 days back.
 */
export function WardsAndBeds() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canReadWards(permissions)) return <WardsAndBedsUnavailable />
  return <WardsDesk key={facility.id} facilityId={facility.id} />
}

export function WardsAndBedsUnavailable() {
  return <DeptUnavailable title={WARDS_TITLE} message={WARDS_REFUSED} />
}

function WardsDesk({ facilityId }: { readonly facilityId: string }) {
  const { rest } = useBluePage()
  const [wardId, setWardId] = useState('')
  const below = rest.replace(/\/+$/, '')
  if (below === '') return <BoardTab facilityId={facilityId} wardId={wardId} onWard={setWardId} />
  if (below === 'census') return <CensusTab facilityId={facilityId} />
  return <Navigate replace to={WARDS_BASE} />
}

function Tabs({ current }: { readonly current: 'board' | 'census' }) {
  const navigate = useNavigate()
  return (
    <div className="hid-ehr-dept-inpatient-actions" role="group" aria-label="Wards & Beds views">
      <EhrButton variant={current === 'board' ? 'primary' : 'secondary'} aria-pressed={current === 'board'} icon={null}
        onClick={() => navigate(WARDS_BASE)}>Bed board</EhrButton>
      <EhrButton variant={current === 'census' ? 'primary' : 'secondary'} aria-pressed={current === 'census'} icon={null}
        onClick={() => navigate(`${WARDS_BASE}/census`)}>Census</EhrButton>
    </div>
  )
}

function BoardTab({ facilityId, wardId, onWard }: { readonly facilityId: string; readonly wardId: string; readonly onWard: (id: string) => void }) {
  const loader = useCallback((id: string) => inpatientApi.wards(id).then(answer => { learnFrom(); return answer },
    caught => { learnFrom(caught); throw caught }), [])
  const wards = useFacilityRead<{ items: Ward[] }>(facilityId, true, loader, 'The wards could not be loaded.')
  const active = (wards.value?.items ?? []).filter(ward => ward.active)
  const chosen = active.find(ward => ward.wardId === wardId) ?? active[0]
  useEffect(() => { if (chosen && chosen.wardId !== wardId) onWard(chosen.wardId) }, [chosen, wardId, onWard])
  const unavailable = wards.caught !== null && notServed(wards.caught)
  const error = wards.error ? refusalWords(wards.caught, wards.error) : ''

  return (
    <DeptPage eyebrow={EYEBROW} title={WARDS_TITLE} description="Every bed on the ward, who is in it, and beds to turn over. The census counts the whole facility."
      secondaryActions={<EhrButton variant="secondary" onClick={() => void wards.refresh()} busy={wards.loading && wards.value !== null}>Refresh</EhrButton>}>
      <Tabs current="board" />
      <ScreenWarning />
      {error ? <DeptNotice role="alert" tone={unavailable ? 'info' : 'critical'}>{error}</DeptNotice> : null}
      {wards.value === null && wards.loading && !error ? <p className="hid-ehr-state-message" role="status">Loading the wards…</p> : null}
      {wards.value !== null && active.length === 0 ? (
        <DeptNotice tone="info">This facility has no wards yet. An admin sets them up in Ward configuration.</DeptNotice>
      ) : null}
      {active.length > 0 && chosen ? (
        <>
          <div className="hid-ehr-dept-inpatient-controls">
            <EhrField label="Ward" controlId="wards-ward">
              <EhrSelect value={chosen.wardId} onChange={event => onWard(event.target.value)}>
                {active.map(ward => (
                  <option key={ward.wardId} value={ward.wardId}>{`${ward.name} (${wardTypeText(ward.wardType)}): ${ward.available} free`}</option>
                ))}
              </EhrSelect>
            </EhrField>
          </div>
          <BedBoardView key={chosen.wardId} facilityId={facilityId} which={{ wardId: chosen.wardId }} headingId="wards-board" />
        </>
      ) : null}
    </DeptPage>
  )
}

const COUNTS: ReadonlyArray<readonly [keyof CensusCounts, string]> = [
  ['beds', 'Beds'], ['occupied', 'Occupied'], ['available', 'Free'], ['cleaning', 'Cleaning'], ['maintenance', 'Under maintenance'],
  ['overflowInUse', 'Overflow in use'], ['admitted', 'Admitted'], ['transfersIn', 'Moved in'], ['transfersOut', 'Moved out'],
  ['discharged', 'Discharged'], ['died', 'Died'], ['waitingForBed', 'Waiting for a bed'], ['midnightCount', 'At midnight'],
]

function CensusTab({ facilityId }: { readonly facilityId: string }) {
  const range = censusRange()
  const [date, setDate] = useState(range.max)
  const [problem, setProblem] = useState('')
  const [asked, setAsked] = useState(range.max)
  const loader = useCallback((id: string) => inpatientApi.census(id, asked === lagosDay() ? undefined : asked)
    .then(answer => { learnFrom(); return answer }, caught => { learnFrom(caught); throw caught }), [asked])
  const census = useFacilityRead<Census>(facilityId, true, loader, 'The census could not be loaded.')
  const unavailable = census.caught !== null && notServed(census.caught)
  const error = census.error ? refusalWords(census.caught, census.error, 'Choose today or a day up to 90 days back.') : ''

  function show() {
    if (!date || date < range.min || date > range.max) { setProblem('Choose today or a day up to 90 days back.'); return }
    setProblem('')
    if (date === asked) void census.refresh()
    else setAsked(date)
  }

  const value = census.value
  return (
    <DeptPage eyebrow={EYEBROW} title={WARDS_TITLE} description="Counts for the whole facility and each ward. No patient is named here.">
      <Tabs current="census" />
      {error ? <DeptNotice role="alert" tone={unavailable ? 'info' : 'critical'}>{error}</DeptNotice> : null}
      {!unavailable ? (
        <form className="hid-ehr-dept-inpatient-controls" noValidate onSubmit={event => { event.preventDefault(); show() }}>
          <EhrField label="Day" controlId="census-day" error={problem || undefined} hint="Lagos time. Today or up to 90 days back.">
            <EhrInput type="date" value={date} min={range.min} max={range.max} onChange={event => setDate(event.target.value)} />
          </EhrField>
          <EhrButton type="submit" variant="secondary" icon={null} busy={census.loading && census.value !== null}>Show</EhrButton>
        </form>
      ) : null}
      {value === null && census.loading && !error ? <p className="hid-ehr-state-message" role="status">Loading the census…</p> : null}
      {value ? (
        <>
          <DeptSection title={`The facility on ${dayText(value.date)}`} headingId="census-facility">
            <dl className="hid-ehr-dept-inpatient-counts" aria-labelledby="census-facility">
              {COUNTS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value.facility[key]}</dd></div>)}
            </dl>
          </DeptSection>
          <DeptSection title="Each ward" headingId="census-wards">
            {value.wards.length === 0 ? <p className="hid-ehr-dept-inpatient-hint">No wards yet.</p> : (
              <div className="hid-ehr-dept-inpatient-table-wrap">
                <table className="hid-ehr-dept-inpatient-table" aria-labelledby="census-wards">
                  <thead><tr><th scope="col">Ward</th>{COUNTS.map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr></thead>
                  <tbody>
                    {value.wards.map(ward => (
                      <tr key={ward.wardId}>
                        <th scope="row">{ward.name} <span className="hid-ehr-dept-inpatient-hint">({wardTypeText(ward.wardType)})</span></th>
                        {COUNTS.map(([key]) => <td key={key}>{ward[key]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DeptSection>
        </>
      ) : null}
    </DeptPage>
  )
}
