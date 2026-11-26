import { useCallback, useEffect, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate } from '@hid/ui/display'
import { EhrButton, EhrEmptyState, EhrField, EhrSelect } from '@hid/ui/ehr'
import { workforceApi, type DepartmentInCharge, type DepartmentInCharges } from '../../../staff/api'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useCurrentMembers, useIdempotencyKeys, useStaffNames, withMembers } from './hooks'
import { RELOAD_AFTER, departmentText, learnFrom, personText, refusalWords } from './rosterRules'

/** A department can have up to 5 people in charge (IN_CHARGE_LIMIT_REACHED). */
const MOST_IN_CHARGE = 5

/**
 * Who is in charge of each department (routes 6-8, Q245 A and Q-ROS-8 A): the administrator names them, up to 5 per
 * department. An in-charge edits, publishes and marks attendance on that department's rosters, and decides leave sent to
 * it. Ending one keeps the record. Only staff who can see the roster can be put in charge (the server checks).
 */
export function InCharges({ facilityId }: { readonly facilityId: string }) {
  const { membershipId } = useDeptAccess()
  const keyFor = useIdempotencyKeys()
  const [answer, setAnswer] = useState<DepartmentInCharges | null>(null)
  const [readProblem, setReadProblem] = useState<string | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ department: string; text: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const { members, failed } = useCurrentMembers(facilityId, true)

  const load = useCallback(async () => {
    setReadProblem(null)
    try {
      const read = await workforceApi.inCharges(facilityId)
      learnFrom(facilityId)
      setAnswer(read)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(facilityId, caught)
      setReadProblem(refusalWords(caught, 'The in-charges could not be loaded. Try again.'))
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])

  const names = withMembers(useStaffNames(facilityId, (answer?.departments ?? []).flatMap(item => item.inCharges.map(card => card.membershipId))), members)

  async function add(departmentCode: string) {
    const chosen = choice[departmentCode]
    if (busy || !chosen) return
    const body = { departmentCode, membershipId: chosen }
    setBusy(`add-${departmentCode}`)
    setProblem(null)
    setAnnouncement('')
    try {
      const added = await workforceApi.addInCharge(facilityId, body, keyFor('add', body))
      setAnswer(current => current ? { departments: current.departments.map(item => item.departmentCode === departmentCode
        ? { ...item, inCharges: [...item.inCharges.filter(card => card.inChargeId !== added.inCharge.inChargeId), added.inCharge] } : item) } : current)
      setChoice(current => ({ ...current, [departmentCode]: '' }))
      setAnnouncement(`${personText(chosen, names, membershipId)} is now in charge of ${departmentText(departmentCode)}.`)
    } catch (caught) {
      learnFrom(facilityId, caught)
      setProblem({ department: departmentCode, text: refusalWords(caught, 'The in-charge could not be added. Try again.') })
    } finally { setBusy(null) }
  }

  async function end(card: DepartmentInCharge) {
    if (busy) return
    setBusy(`end-${card.inChargeId}`)
    setProblem(null)
    setAnnouncement('')
    try {
      await workforceApi.endInCharge(facilityId, card, keyFor(`end-${card.inChargeId}`, card.rowVersion))
      setAnswer(current => current ? { departments: current.departments.map(item => ({ ...item,
        inCharges: item.inCharges.filter(other => other.inChargeId !== card.inChargeId) })) } : current)
      setAnnouncement(`${personText(card.membershipId, names, membershipId)} is no longer in charge of ${departmentText(card.departmentCode)}.`)
    } catch (caught) {
      learnFrom(facilityId, caught)
      setProblem({ department: card.departmentCode, text: refusalWords(caught, 'The in-charge could not be ended. Try again.') })
      if (isHidApiError(caught) && RELOAD_AFTER.has(caught.code)) void load()
    } finally { setBusy(null) }
  }

  return (
    <DeptPage title="In-charges" className="hid-ehr-dept-roster"
      description="Who is in charge of each department. An in-charge makes and publishes its rosters, marks attendance, and decides leave sent to it.">
      <p className="hid-ehr-sr-only" role="status">{announcement}</p>
      {failed ? <DeptNotice tone="critical">The staff list could not be loaded, so nobody can be added now. Reload the page to try again.</DeptNotice> : null}
      {readProblem ? (
        <DeptNotice role="alert" tone="critical">
          <p>{readProblem}</p>
          <EhrButton variant="secondary" size="sm" onClick={() => void load()}>Try again</EhrButton>
        </DeptNotice>
      ) : null}
      {answer === null && !readProblem ? <p className="hid-ehr-state-message" role="status">Loading the in-charges…</p> : null}
      {answer?.departments.length === 0
        ? <EhrEmptyState title="No departments" message="Add this facility’s departments to its profile first." /> : null}
      {answer?.departments.map(item => {
        const headingId = `in-charge-${item.departmentCode}`
        const taken = item.inCharges.map(card => card.membershipId.toLowerCase())
        const choices = members.filter(member => !taken.includes(member.membershipId.toLowerCase()))
        const full = item.inCharges.length >= MOST_IN_CHARGE
        return (
          <DeptSection key={item.departmentCode} title={departmentText(item.departmentCode)} headingId={headingId}>
            {item.inCharges.length === 0 ? <p className="hid-ehr-dept-muted">Nobody is in charge yet. Administrators edit its rosters.</p> : (
              <ul className="hid-ehr-dept-roster-in-charges" aria-labelledby={headingId}>
                {item.inCharges.map(card => {
                  const name = personText(card.membershipId, names, membershipId)
                  return (
                    <li key={card.inChargeId}>
                      <span><strong>{name}</strong> <small>since {formatDate(card.since)}</small></span>
                      <EhrButton size="sm" variant="secondary" busy={busy === `end-${card.inChargeId}`}
                        aria-label={`End ${name} in charge of ${departmentText(item.departmentCode)}`} onClick={() => void end(card)}>End</EhrButton>
                    </li>
                  )
                })}
              </ul>
            )}
            {problem?.department === item.departmentCode ? <DeptNotice role="alert" tone="critical">{problem.text}</DeptNotice> : null}
            {full ? <p className="hid-ehr-dept-muted">A department can have up to {MOST_IN_CHARGE} people in charge.</p> : (
              <form className="hid-ehr-dept-roster-in-charge-add" noValidate onSubmit={event => { event.preventDefault(); void add(item.departmentCode) }}>
                <EhrField label={`Put someone in charge of ${departmentText(item.departmentCode)}`} controlId={`${headingId}-choice`}>
                  <EhrSelect value={choice[item.departmentCode] ?? ''} onChange={event => setChoice(current => ({ ...current, [item.departmentCode]: event.target.value }))}>
                    <option value="">Choose…</option>
                    {choices.map(member => <option key={member.membershipId} value={member.membershipId}>{member.name}</option>)}
                  </EhrSelect>
                </EhrField>
                <EhrButton type="submit" size="sm" busy={busy === `add-${item.departmentCode}`} disabled={!choice[item.departmentCode]}>Add in-charge</EhrButton>
              </form>
            )}
          </DeptSection>
        )
      })}
    </DeptPage>
  )
}
