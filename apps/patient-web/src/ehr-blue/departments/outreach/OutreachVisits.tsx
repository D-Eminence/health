import { useCallback, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { CalendarCheck } from 'lucide-react'
import { PageState } from '../../../kasuwa/parts'
import { useFocusById } from '../../../staff/focus'
import { FIELDS_REFUSED, refusalSentences, refusedFields } from '../../../staff/fieldProblem'
import { DeptSection } from '../parts/DeptPage'
import { errorText } from '../parts/errors'
import { useFacilityRead } from '../parts/useFacilityRead'
import { outreachVisitsApi, OUTREACH_VISIT_KINDS, type OutreachVisit, type OutreachVisitInput, type OutreachVisitKind } from './outreachVisitsApi'
import {
  CASE_GONE, controlProps, dayText, ErrorBox, FIRST_VISIT_DAY, FOLLOW_UP_AFTER, followUpText, lagosToday,
  OutreachField, REFERRED_TO_LENGTH, RETRY_NOTE, VISIT_CONFLICT, VISIT_DAY_FUTURE, VISIT_DAY_INVALID, VISIT_DAY_REQUIRED,
  VISIT_DAY_TOO_EARLY, VISIT_FAILED, visitKindText, VISITS_NOT_LOADED, type FieldErrors,
} from './outreachParts'

type VisitField = 'kind' | 'occurredOn' | 'followUpOn' | 'referredTo' | 'notes'
const FIELD_ORDER: readonly VisitField[] = ['kind', 'occurredOn', 'followUpOn', 'referredTo', 'notes']

/** Outreach's 404 for a case that is not there, or not this membership's to read. */
const caseGone = (caught: unknown) => isHidApiError(caught) && caught.status === 404 && caught.code === 'OUTREACH_REGISTRATION_NOT_FOUND'

/** A real calendar day as YYYY-MM-DD: 2026-02-31 is refused, not rolled over into March. */
function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Newest first: by the day it happened, then by when it was recorded. */
function newestFirst(items: readonly OutreachVisit[]): OutreachVisit[] {
  return [...items].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

/**
 * A case's visits, referrals and follow-ups (hid-system 0115), shown only once the backend serves them: the list, newest
 * first, and "Record a visit" for a membership that may write registrations. Who recorded each is not shown.
 */
export function OutreachVisits({ facilityId, caseId, canRead, canWrite, onCaseChanged }: {
  readonly facilityId: string
  readonly caseId: string
  readonly canRead: boolean
  readonly canWrite: boolean
  /** Reads the cases again: a visit changes the case's next follow-up. */
  readonly onCaseChanged: () => Promise<void>
}) {
  const visits = useFacilityRead(facilityId, canRead, useCallback((id: string) => outreachVisitsApi.listCaseVisits(id, caseId), [caseId]), VISITS_NOT_LOADED)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<OutreachVisitKind>('visit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [problems, setProblems] = useState<FieldErrors<VisitField>>({ errors: {}, seq: 0 })
  // The visit last sent and its key: sent again unchanged (after no answer, or a refusal), it carries the same key.
  const attempt = useRef<{ body: string; key: string } | null>(null)
  const focus = useFocusById()
  const id = (field: VisitField) => `outreach-visit-${field}-${caseId}`
  const openerId = `outreach-visit-open-${caseId}`
  const headingId = `outreach-visits-${caseId}`
  const formId = `outreach-visit-form-${caseId}`

  const listError = visits.caught && caseGone(visits.caught) ? CASE_GONE : visits.error
  const items = visits.value ? newestFirst(visits.value) : null

  function refuse(errors: Partial<Record<VisitField, string>>): boolean {
    const first = FIELD_ORDER.find(field => errors[field])
    if (!first) return false
    const here = document.activeElement?.id === id(first)
    setProblems(previous => ({ errors, alert: here ? first : undefined, seq: previous.seq + 1 }))
    if (!here) focus(id(first))
    return true
  }
  function clearProblems() {
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
  }
  const field = (key: VisitField) => ({ error: problems.errors[key], alert: problems.alert === key, seq: problems.seq })

  function openForm() {
    setOpen(true)
    setKind('visit')
    setError('')
    setSaved('')
    clearProblems()
    focus(id('kind'))
  }
  function closeForm() {
    if (busy) return
    setOpen(false)
    setError('')
    clearProblems()
    focus(openerId)
  }

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const text = (name: VisitField) => String(form.get(name) ?? '').trim()
    const occurredOn = text('occurredOn')
    const followUpOn = text('followUpOn')
    const referredTo = kind === 'referral' ? text('referredTo') : ''
    const notes = text('notes')
    setError('')
    setSaved('')
    // Checked as Outreach checks it: a day from 1 Jan 2020 to today in Lagos, a follow-up after it, a place of 2 or more characters.
    const errors: Partial<Record<VisitField, string>> = {}
    if (!occurredOn) errors.occurredOn = VISIT_DAY_REQUIRED
    else if (!isDay(occurredOn)) errors.occurredOn = VISIT_DAY_INVALID
    else if (occurredOn < FIRST_VISIT_DAY) errors.occurredOn = VISIT_DAY_TOO_EARLY
    else if (occurredOn > lagosToday()) errors.occurredOn = VISIT_DAY_FUTURE
    if (followUpOn && !isDay(followUpOn)) errors.followUpOn = VISIT_DAY_INVALID
    else if (followUpOn && isDay(occurredOn) && followUpOn <= occurredOn) errors.followUpOn = FOLLOW_UP_AFTER
    if (referredTo && referredTo.length < 2) errors.referredTo = REFERRED_TO_LENGTH
    if (refuse(errors)) return
    clearProblems()
    const input: OutreachVisitInput = { kind, occurredOn, followUpOn: followUpOn || null, referredTo: referredTo || null, notes: notes || null }
    const body = JSON.stringify(input)
    const key = attempt.current?.body === body ? attempt.current.key : crypto.randomUUID()
    attempt.current = { body, key }
    setBusy(true)
    try {
      await outreachVisitsApi.createCaseVisit(facilityId, caseId, input, key)
      attempt.current = null
      setOpen(false)
      setSaved(`${visitKindText(kind)} recorded.`)
      focus(openerId)
      void visits.refresh()
      void onCaseChanged()
    } catch (caught) {
      const refused = refusedFields(caught)
      if (refused.length > 0) {
        const marked: Partial<Record<VisitField, string>> = {}
        for (const entry of refused) {
          if ((FIELD_ORDER as readonly string[]).includes(entry.field)) marked[entry.field as VisitField] = refusalSentences(entry).join(' ')
        }
        if (!refuse(marked)) setError(FIELDS_REFUSED)
      } else if (caseGone(caught)) {
        attempt.current = null
        setError(CASE_GONE)
        void onCaseChanged()
      } else if (isHidApiError(caught) && caught.status === 409) {
        // Another visit was sent under this key, or a change crossed it: the next save is a new one.
        attempt.current = null
        setError(VISIT_CONFLICT)
      } else {
        setError(errorText(caught, VISIT_FAILED))
      }
    } finally {
      setBusy(false)
    }
  }

  const opener = canWrite && !open
    ? <EhrButton id={openerId} variant="secondary" aria-expanded={false} aria-controls={formId} onClick={openForm}>Record a visit</EhrButton>
    : null

  return (
    <DeptSection title="Visits and follow-ups" headingId={headingId} actions={opener ?? undefined} className="hid-ehr-dept-outreach-visits">
      <p role="status" className="hid-ehr-dept-outreach-saved">{saved}</p>
      {open ? (
        <form id={formId} className="hid-ehr-dept-form hid-ehr-dept-outreach-visit-form" noValidate aria-labelledby={`${formId}-title`}
          onSubmit={event => void record(event)}>
          <h3 id={`${formId}-title`} className="hid-ehr-dept-outreach-visit-title">Record a visit</h3>
          <div className="hid-ehr-dept-form-grid">
            <OutreachField id={id('kind')} label="Type" required {...field('kind')}>
              <EhrSelect name="kind" value={kind}
                onChange={event => { if (!busy) setKind(event.target.value as OutreachVisitKind) }} {...controlProps(id('kind'), problems.errors.kind)}>
                {OUTREACH_VISIT_KINDS.map(value => <option key={value} value={value}>{visitKindText(value)}</option>)}
              </EhrSelect>
            </OutreachField>
            <OutreachField id={id('occurredOn')} label="Date" required hint="The day it happened." {...field('occurredOn')}>
              <EhrInput name="occurredOn" type="date" readOnly={busy} required defaultValue={lagosToday()} min={FIRST_VISIT_DAY} max={lagosToday()}
                {...controlProps(id('occurredOn'), problems.errors.occurredOn, true)} />
            </OutreachField>
            <OutreachField id={id('followUpOn')} label="Next follow-up date" hint="Leave blank if none is planned." {...field('followUpOn')}>
              <EhrInput name="followUpOn" type="date" readOnly={busy} {...controlProps(id('followUpOn'), problems.errors.followUpOn, true)} />
            </OutreachField>
            {kind === 'referral' ? (
              <OutreachField id={id('referredTo')} label="Referred to" hint="Where they were sent, for example a clinic or hospital." {...field('referredTo')}>
                <EhrInput name="referredTo" readOnly={busy} maxLength={160} autoComplete="off" {...controlProps(id('referredTo'), problems.errors.referredTo, true)} />
              </OutreachField>
            ) : null}
            <OutreachField id={id('notes')} label="Notes" full hint="Optional. What happened, and what comes next." {...field('notes')}>
              <EhrTextarea name="notes" readOnly={busy} rows={3} maxLength={1000} {...controlProps(id('notes'), problems.errors.notes, true)} />
            </OutreachField>
          </div>
          <ErrorBox message={error} />
          {error && error !== CASE_GONE ? <small className="hid-ehr-dept-outreach-note">{RETRY_NOTE}</small> : null}
          <div className="hid-ehr-dept-form-actions">
            <EhrButton variant="secondary" className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={closeForm}>Cancel</EhrButton>
            <EhrButton type="submit" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}>
              {busy ? 'Saving…' : 'Save visit'}
            </EhrButton>
          </div>
        </form>
      ) : null}
      {canRead ? (
        <PageState loading={visits.loading} error={items ? null : listError || null} hasData={items !== null} what="visits and follow-ups" rows={2}
          onRetry={() => void visits.refresh()}
          empty={items?.length === 0 ? { icon: CalendarCheck, title: 'No visits yet', description: 'Visits, referrals and follow-ups recorded for this person show here.' } : null}>
          {visits.error && items ? <ErrorBox message={listError} /> : null}
          <ul className="hid-ehr-dept-rows" aria-label="Visits and follow-ups">
            {(items ?? []).map(visit => <VisitRow key={visit.id} visit={visit} />)}
          </ul>
        </PageState>
      ) : null}
    </DeptSection>
  )
}

function VisitRow({ visit }: { readonly visit: OutreachVisit }) {
  const followUp = followUpText(visit.followUpOn)
  const place = visit.referredTo?.trim()
  const notes = visit.notes?.trim()
  return (
    <li>
      <div className="hid-ehr-dept-row-main">
        <span className="hid-ehr-dept-row-title">
          {visitKindText(visit.kind)}{' '}<span className="hid-ehr-dept-muted hid-ehr-dept-outreach-visit-day">{dayText(visit.occurredOn) || 'Date not recorded'}</span>
        </span>
        {place ? <span className="hid-ehr-dept-outreach-visit-line">Referred to {place}</span> : null}
        {followUp ? <span className="hid-ehr-dept-outreach-visit-line">{followUp}</span> : null}
        {notes ? <p className="hid-ehr-dept-outreach-visit-notes">{notes}</p> : null}
      </div>
    </li>
  )
}
