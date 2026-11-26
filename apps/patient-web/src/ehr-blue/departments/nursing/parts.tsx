import { useCallback } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { EhrBadge, EhrField, EhrSelect } from '@hid/ui/ehr'
import { nursingApi, type WardPatientCard, type WardSummary } from '../../../staff/api'
import { fromHere } from '../../clinical/parts/cameFrom'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CHART_ACCESS, NOT_AVAILABLE, NO_WARDS, SCREEN_WARNING, UUID, learningRefusal, notServed, patientFacts, patientName, refusalWords,
} from './nursingRules'

/** "Staff only": every ward list says it (Q190 A). */
export function ScreenWarning() {
  return <DeptNotice tone="caution" title="Staff only">{SCREEN_WARNING}</DeptNotice>
}

/** A page whose routes are not served here: an ehr-api before NUR-1, or either flag off. Built, but off. */
export function NotSwitchedOn({ title }: { readonly title: string }) {
  return (
    <DeptPage title={title}>
      <DeptNotice tone="info" role="status">{NOT_AVAILABLE}</DeptNotice>
    </DeptPage>
  )
}

/**
 * Chart content needs the patient's record open, as today's vitals and notes do. Ward-team access (ADT-1 route 23) is
 * switched off (Q156 A), so the way is the usual one: Patients.
 */
export function ChartAccessNotice() {
  return (
    <DeptNotice tone="info" role="status" title="Record not open">
      {CHART_ACCESS} <Link className="hid-ehr-dept-link" to="/provider/patients">Find the patient on Patients</Link>
    </DeptNotice>
  )
}

/** The patient as a ward list may show them: the name only where the chart can be read, else the initials (Q190 A). */
export function PatientIdentity({ card, bedName }: { readonly card: WardPatientCard; readonly bedName?: string | null }) {
  return (
    <>
      <p className="hid-ehr-dept-waiting-identity">
        <span>{[bedName ?? card.bedName, patientFacts(card)].filter(Boolean).join(' · ')}</span>
        {card.healthIdLast4 ? <span aria-label={`Health ID ending ${card.healthIdLast4}`}>•••• {card.healthIdLast4}</span> : null}
      </p>
      {card.nameHidden || card.chartBlocked || card.recordKind === 'unknown' ? (
        <div className="hid-ehr-dept-waiting-badges">
          {/* An unknown patient's label is their name: "Unknown patient" says it, as the Inpatient pages do. */}
          {card.nameHidden && card.recordKind !== 'unknown' ? <EhrBadge tone="neutral">Name hidden</EhrBadge> : null}
          {card.recordKind === 'unknown' ? <EhrBadge tone="caution">Unknown patient</EhrBadge> : null}
          {card.chartBlocked ? <EhrBadge tone="critical">Chart cannot be opened</EhrBadge> : null}
        </div>
      ) : null}
    </>
  )
}

/**
 * A patient's ward chart, opened from a ward list: the list's address goes with it (router state, cameFrom.ts), so the
 * chart's back arrow returns to that list, its ward, day and shift, named by `back` ("Back to Shift handover"). Only the
 * list's address: never a patient detail.
 */
export function PatientLink({ card, to, back }: { readonly card: WardPatientCard; readonly to: string; readonly back: string }) {
  const location = useLocation()
  return <Link className="hid-ehr-dept-link" to={to} state={fromHere(`${location.pathname}${location.search}`, back)}>{patientName(card)}</Link>
}

/** A fact of a record entered in error that is not struck through with it: who recorded it, and why it is in error. */
export const KEPT = 'hid-ehr-dept-nursing-kept'

/** The ward a list is for, kept in the address (`?ward=<uuid>`: a ward's id, never a patient's), and the wards read. */
export function useWardChoice(facilityId: string, purpose: 'direct-care' | 'healthcare-operations' = 'direct-care') {
  const [params, setParams] = useSearchParams()
  const loader = useCallback((id: string) => learningRefusal(nursingApi.wards(id, purpose)), [purpose])
  const wards = useFacilityRead(facilityId, true, loader, 'The wards could not be loaded.')
  const active = (wards.value?.items ?? []).filter(ward => ward.active)
  const asked = params.get('ward') ?? ''
  const wardId = UUID.test(asked) && active.some(ward => ward.wardId === asked.toLowerCase()) ? asked.toLowerCase()
    : active.length === 1 ? active[0]!.wardId : ''
  const choose = useCallback((next: string) => {
    setParams(previous => {
      const copy = new URLSearchParams(previous)
      if (next) copy.set('ward', next)
      else copy.delete('ward')
      return copy
    }, { replace: true })
  }, [setParams])
  return { wards, active, wardId, ward: active.find(ward => ward.wardId === wardId) ?? null, choose }
}

export function WardPicker({ active, wardId, onChoose, label = 'Ward' }: {
  readonly active: readonly WardSummary[]
  readonly wardId: string
  readonly onChoose: (wardId: string) => void
  readonly label?: string
}) {
  return (
    <EhrField label={label} className="hid-ehr-dept-nursing-ward">
      <EhrSelect value={wardId} onChange={event => onChoose(event.target.value)}>
        <option value="">Choose a ward</option>
        {active.map(ward => <option key={ward.wardId} value={ward.wardId}>{ward.name}</option>)}
      </EhrSelect>
    </EhrField>
  )
}

/** The ward read's outcome: loading, not switched on, refused, or no wards yet. Null once there are wards to choose. */
export function WardsState({ wards, active }: {
  readonly wards: { value: unknown; loading: boolean; caught: unknown; error: string }
  readonly active: readonly WardSummary[]
}) {
  if (wards.caught) {
    return <DeptNotice role="alert" tone={notServed(wards.caught) ? 'info' : 'critical'}>{refusalWords(wards.caught, 'The wards could not be loaded.')}</DeptNotice>
  }
  if (wards.value === null) return wards.loading ? <p className="hid-ehr-state-message" role="status">Loading the wards…</p> : null
  return active.length === 0 ? <DeptNotice tone="info">{NO_WARDS}</DeptNotice> : null
}
