import { useCallback, useEffect, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { formatTimeOrDateTime } from '@hid/ui/display'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrSelect } from '@hid/ui/ehr'
import { workforceApi, type MyDuty, type OnDutyItem } from '../../../staff/api'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useDepartments, useStaffNames } from './hooks'
import {
  attendanceText, attendanceTone, dayText, departmentText, lagosToday, learnFrom, personText, refusalWords, timeRangeText,
} from './rosterRules'

/**
 * Who is on duty now (route 21): duties on published rosters whose shift is running now, by department. Someone marked
 * absent is left out; for a swapped duty, the person who worked instead is shown, marked as covering.
 */
export function OnDutyNow({ facilityId }: { readonly facilityId: string }) {
  const { membershipId } = useDeptAccess()
  const [departmentCode, setDepartmentCode] = useState('')
  const departments = useDepartments(facilityId)
  const [answer, setAnswer] = useState<{ key: string; at: string; items: OnDutyItem[] } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setProblem(null)
    try {
      const read = await workforceApi.onDuty(facilityId, departmentCode || undefined)
      learnFrom(facilityId)
      setAnswer({ key: departmentCode, at: read.at, items: read.items })
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(facilityId, caught)
      setProblem(refusalWords(caught, 'Who is on duty could not be loaded. Try again.'))
    } finally { setLoading(false) }
  }, [facilityId, departmentCode])
  useEffect(() => { void load() }, [load])

  const items = answer?.key === departmentCode ? answer.items : []
  const names = useStaffNames(facilityId, items.flatMap(item => [item.membershipId, item.coveringForMembershipId]))
  const grouped = [...new Set(items.map(item => item.departmentCode))].sort()
    .map(code => ({ code, items: items.filter(item => item.departmentCode === code) }))

  return (
    <DeptPage title="On duty now" description="Who is working now, from the published rosters and the attendance marked."
      className="hid-ehr-dept-roster"
      secondaryActions={<EhrButton variant="secondary" busy={loading && answer !== null} onClick={() => void load()}>Refresh</EhrButton>}>
      <DeptSection title="Department" headingId="on-duty-filter-title">
        <EhrField label="Department" controlId="on-duty-department"
          hint={answer ? `As at ${formatTimeOrDateTime(answer.at)}` : undefined}>
          <EhrSelect value={departmentCode} onChange={event => setDepartmentCode(event.target.value)}>
            <option value="">Every department</option>
            {departments.map(code => <option key={code} value={code}>{departmentText(code)}</option>)}
          </EhrSelect>
        </EhrField>
      </DeptSection>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      {answer?.key !== departmentCode && !problem ? <p className="hid-ehr-state-message" role="status">Loading who is on duty…</p> : null}
      {answer?.key === departmentCode && items.length === 0
        ? <EhrEmptyState title="Nobody on duty" message="No published roster has a shift running now." /> : null}
      {grouped.map(group => (
        <DeptSection key={group.code} title={departmentText(group.code)} headingId={`on-duty-${group.code}`}>
          <ul className="hid-ehr-dept-roster-on-duty" aria-labelledby={`on-duty-${group.code}`}>
            {group.items.map(item => (
              <li key={`${item.membershipId}-${item.shiftId}-${item.startsAt}`}>
                <strong>{personText(item.membershipId, names, membershipId)}</strong>
                <span>{item.shiftName} · {timeRangeText(item)}</span>
                {item.coveringForMembershipId
                  ? <span>Covering for {personText(item.coveringForMembershipId, names, membershipId)}</span>
                  : <EhrBadge tone={attendanceTone(item.attendance)}>{attendanceText(item.attendance)}</EhrBadge>}
              </li>
            ))}
          </ul>
        </DeptSection>
      ))}
    </DeptPage>
  )
}

/** My duties (route 22): the session's own duties on published rosters, from 7 days ago to 28 days ahead. */
export function MyDuties({ facilityId }: { readonly facilityId: string }) {
  const [items, setItems] = useState<MyDuty[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const read = await workforceApi.myDuties(facilityId)
      learnFrom(facilityId)
      setItems([...read.items].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(facilityId, caught)
      setProblem(refusalWords(caught, 'Your duties could not be loaded. Try again.'))
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])

  const today = lagosToday()
  const coming = (items ?? []).filter(item => item.dutyDate >= today)
  const past = (items ?? []).filter(item => item.dutyDate < today).reverse()
  const list = (duties: readonly MyDuty[], label: string) => (
    <ul className="hid-ehr-dept-roster-duties" aria-label={label}>
      {duties.map(duty => (
        <li key={duty.assignmentId}>
          <strong>{dayText(duty.dutyDate)}{duty.dutyDate === today ? ' (today)' : ''}</strong>
          <span>{duty.shiftName} · {timeRangeText(duty)}</span>
          <span>{departmentText(duty.departmentCode)}</span>
          {duty.attendance !== 'not_marked' ? <EhrBadge tone={attendanceTone(duty.attendance)}>{attendanceText(duty.attendance)}</EhrBadge> : null}
        </li>
      ))}
    </ul>
  )
  return (
    <DeptPage title="My duties" description="Your duties on published rosters, from last week to four weeks ahead." className="hid-ehr-dept-roster">
      {problem ? (
        <DeptNotice role="alert" tone="critical">
          <p>{problem}</p>
          <EhrButton variant="secondary" size="sm" onClick={() => void load()}>Try again</EhrButton>
        </DeptNotice>
      ) : null}
      {items === null && !problem ? <p className="hid-ehr-state-message" role="status">Loading your duties…</p> : null}
      {items ? (
        <>
          <DeptSection title="Coming up" headingId="my-duties-coming">
            {coming.length === 0 ? <EhrEmptyState title="No duties coming up" message="Nothing is published for you in the next four weeks." />
              : list(coming, 'Duties coming up')}
          </DeptSection>
          {past.length > 0 ? <DeptSection title="Last week" headingId="my-duties-past">{list(past, 'Duties last week')}</DeptSection> : null}
        </>
      ) : null}
    </DeptPage>
  )
}
