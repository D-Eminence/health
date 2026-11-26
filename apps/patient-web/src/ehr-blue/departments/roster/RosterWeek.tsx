import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { formatDate } from '@hid/ui/display'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput } from '@hid/ui/ehr'
import { workforceApi, type DutyRosterListItem, type DutyRosterWeek } from '../../../staff/api'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useIdempotencyKeys } from './hooks'
import {
  BASE, DESCRIPTION, TITLE, addDays, departmentText, isDay, learnFrom, mondayOf, refusalWords, rosterStatusText,
  rosterStatusTone, thisWeek, weekInRange, weekText,
} from './rosterRules'

/**
 * Rosters (route 15): each department's roster for one week, Monday to Sunday in Lagos. Everyone with the roster code
 * sees the published ones; editors (administrators, and a department's in-charges) also see drafts and the departments
 * with no roster yet, which they make a draft for (route 17).
 */
export function RosterWeek({ facilityId, week, onWeek, onInChargeOf }: {
  readonly facilityId: string
  readonly week: string
  readonly onWeek: (week: string) => void
  readonly onInChargeOf: (departments: readonly string[]) => void
}) {
  const navigate = useNavigate()
  const keyFor = useIdempotencyKeys()
  const [answer, setAnswer] = useState<DutyRosterWeek | null>(null)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [making, setMaking] = useState<string | null>(null)
  const [makeProblem, setMakeProblem] = useState<string | null>(null)
  const inRange = weekInRange(week)

  const load = useCallback(async () => {
    if (!weekInRange(week)) return
    setLoading(true)
    setProblem(null)
    try {
      const read = await workforceApi.rosters(facilityId, week)
      learnFrom(facilityId)
      setAnswer(read)
      onInChargeOf(read.inChargeOf ?? [])
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(facilityId, caught)
      setProblem(refusalWords(caught, 'The rosters could not be loaded. Try again.'))
    } finally { setLoading(false) }
  }, [facilityId, week, onInChargeOf])

  useEffect(() => { void load() }, [load])

  async function make(item: DutyRosterListItem) {
    if (making) return
    const body = { departmentCode: item.departmentCode, weekStart: week }
    setMaking(item.departmentCode)
    setMakeProblem(null)
    try {
      const made = await workforceApi.createRoster(facilityId, body, keyFor('create', body))
      navigate(`${BASE}/${made.roster.rosterId}`)
    } catch (caught) {
      learnFrom(facilityId, caught)
      setMakeProblem(refusalWords(caught, 'The roster could not be made. Try again.'))
    } finally { setMaking(null) }
  }

  const items = answer?.weekStart === week ? answer.items : []
  const today = thisWeek()
  return (
    <DeptPage title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-roster"
      secondaryActions={<EhrButton variant="secondary" busy={loading && answer !== null} onClick={() => void load()}>Refresh</EhrButton>}>
      <DeptSection title="Which week" headingId="roster-week-title">
        <div className="hid-ehr-dept-roster-week" role="group" aria-labelledby="roster-week-title">
          <EhrField label="Week of" controlId="roster-week" hint={inRange ? weekText(week) : 'Choose a week from 8 weeks ago to 26 weeks ahead.'}>
            <EhrInput type="date" value={week} onChange={event => { if (isDay(event.target.value)) onWeek(mondayOf(event.target.value)) }} />
          </EhrField>
          <div className="hid-ehr-dept-roster-week-steps">
            <EhrButton size="sm" variant="quiet" disabled={!weekInRange(addDays(week, -7))} onClick={() => onWeek(addDays(week, -7))}>Previous week</EhrButton>
            <EhrButton size="sm" variant="quiet" disabled={week === today} onClick={() => onWeek(today)}>This week</EhrButton>
            <EhrButton size="sm" variant="quiet" disabled={!weekInRange(addDays(week, 7))} onClick={() => onWeek(addDays(week, 7))}>Next week</EhrButton>
          </div>
        </div>
      </DeptSection>

      <DeptSection title={inRange ? `Week of ${formatDate(week)}` : 'Rosters'} headingId="roster-list-title">
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
        {makeProblem ? <DeptNotice role="alert" tone="critical">{makeProblem}</DeptNotice> : null}
        {loading && answer?.weekStart !== week ? <p className="hid-ehr-state-message" role="status">Loading rosters…</p> : null}
        {answer?.weekStart === week && items.length === 0
          ? <EhrEmptyState title="No rosters this week" message="No department has published a roster for this week yet." />
          : null}
        {items.length > 0 ? (
          <ul className="hid-ehr-dept-roster-list" aria-label="Rosters this week">
            {items.map(item => (
              <li key={item.departmentCode} className="hid-ehr-dept-roster-list-item">
                <div>
                  <h3 className="hid-ehr-dept-roster-list-name">
                    {item.rosterId ? <Link to={`${BASE}/${item.rosterId}`}>{departmentText(item.departmentCode)}</Link> : departmentText(item.departmentCode)}
                  </h3>
                  <p className="hid-ehr-dept-muted">
                    {item.rosterId ? `${item.assignmentCount} dut${item.assignmentCount === 1 ? 'y' : 'ies'}` : 'No roster for this week yet'}
                    {item.publishedAt ? ` · Published ${formatDate(item.publishedAt)}` : ''}
                    {answer?.inChargeOf.includes(item.departmentCode) ? ' · You are in charge' : ''}
                  </p>
                </div>
                <div className="hid-ehr-dept-roster-list-actions">
                  <EhrBadge tone={rosterStatusTone(item.status, item.changedSincePublished)}>{rosterStatusText(item.status, item.changedSincePublished)}</EhrBadge>
                  {!item.rosterId && item.canEdit ? (
                    <EhrButton size="sm" busy={making === item.departmentCode} aria-label={`Make a draft roster for ${departmentText(item.departmentCode)}`}
                      onClick={() => void make(item)}>Make a draft roster</EhrButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </DeptSection>
    </DeptPage>
  )
}
