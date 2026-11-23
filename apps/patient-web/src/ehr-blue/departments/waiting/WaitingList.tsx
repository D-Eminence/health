import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import {
  staffApi, visitQueueApi, type VisitQueueCard, type VisitQueueChange, type VisitQueueCheckIn, type VisitQueueStage,
} from '../../../staff/api'
import { matchRefExpired, ninStatusLabel, type PatientSearchCard } from '../../../staff/patientSearch'
import { useFocusById } from '../../../staff/focus'
import { SEARCH_EXPIRED, noCardText, searchRefusal } from '../../clinical/patients/searchWords'
import { useDeptAccess } from '../parts/access'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { errorText } from '../parts/errors'
import { birthDateText, countText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  CHECK_IN_INVALID, CHECK_IN_SEARCH_MISSING, CHECK_IN_SEARCH_REFUSED, CLOSING_STAGES, DESCRIPTION, EARLIER_DAY, EMPTY_SEARCH,
  EYEBROW, NEXT_STEP, OPEN_STAGES, POLL_MS, RELOAD_AFTER, SEARCH_EMPTY, SEARCH_HINT, STAGE_WORDS, TITLE, TRIAGE_LEVELS,
  UNAVAILABLE_MESSAGE, UNAVAILABLE_TITLE, UPDATE_INVALID,
  VISIT_QUEUE_REFUSALS, assigneeText, bornText, canSearchPatients, canSeePatients, canUseWaitingList, checkedInText,
  checkInWhen, closedCutText, closedTitle, cutShort, fromEarlierDay, healthIdEnding, isOpen, lagosToday, searchKeys, sexText,
  stageText, stageTone, timeText, triageText, triageTone, type SearchValues,
} from './waitingRules'
import './waiting.css'

/**
 * The waiting list (hid-system 0135, EHR-C7) in the blue EHR, under Front desk: check a patient in from a patient search
 * card (its matchRef, never a Health ID), and move each patient on through the stages, set their triage level and who
 * will see them. The list is read again every 30 seconds while the page is open, and every change sends the row version
 * the card showed, so a change someone else made first is never overwritten.
 *
 * A card shows identity details only (name, sex, date of birth, the last 4 characters of the Health ID), never clinical
 * content, and gives no access to the chart: that still needs the patient's consent. Nothing typed or found goes to
 * storage, the address or router state.
 */
export function WaitingList() {
  const { facility, permissions, membershipId } = useDeptAccess()
  if (!facility || !canUseWaitingList(permissions)) return <WaitingListUnavailable />
  return <WaitingDesk key={facility.id} facilityId={facility.id} membershipId={membershipId} permissions={permissions} />
}

export function WaitingListUnavailable() {
  return <DeptUnavailable title={UNAVAILABLE_TITLE} message={UNAVAILABLE_MESSAGE} />
}

/**
 * The refusal's words: the waiting list's own, else the departments' plain words. `invalid`: what a 400
 * VALIDATION_FAILED means for this request (ehr-api's checks of the body), never the fields it names.
 */
function refusal(caught: unknown, fallback: string, invalid?: string): string {
  if (isHidApiError(caught) && Object.hasOwn(VISIT_QUEUE_REFUSALS, caught.code)) return VISIT_QUEUE_REFUSALS[caught.code]!
  if (invalid && isHidApiError(caught) && caught.code === 'VALIDATION_FAILED') return invalid
  return errorText(caught, fallback)
}

/**
 * A refused patient search here. Patients' Search by name words a 403 or 404 for its own card ("by name", "use the Health
 * ID"); this form searches by Health ID and phone too, and checks patients in from no other search.
 */
function checkInSearchRefusal(caught: unknown): string {
  if (isHidApiError(caught) && caught.status === 403) return CHECK_IN_SEARCH_REFUSED
  if (isHidApiError(caught) && caught.status === 404) return CHECK_IN_SEARCH_MISSING
  return searchRefusal(caught)
}

interface Notice { readonly tone: DeptNoticeTone; readonly text: string }

function WaitingDesk({ facilityId, membershipId, permissions }: {
  readonly facilityId: string
  readonly membershipId: string | undefined
  readonly permissions: readonly string[]
}) {
  const [includeClosed, setIncludeClosed] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const focus = useFocusById()
  // Each answer remembers whether it was read with the closed rows, so the "Finished or left today" section never
  // says "No one yet" from an answer read without them.
  const loader = useCallback((id: string) => visitQueueApi.list(id, includeClosed)
    .then(answer => ({ ...answer, withClosed: includeClosed })), [includeClosed])
  const list = useFacilityRead(facilityId, true, loader, 'The waiting list could not be loaded.')
  const { refresh } = list
  // The cards each change answered with (its new stage and row version), shown until a read brings a newer one: the
  // card's next action then sends the row version the member's own change made, not the one before it.
  const [saved, setSaved] = useState<Readonly<Record<string, VisitQueueCard>>>({})

  // Read again every 30 seconds while the page is shown (the contract's polling), and when it comes back on screen, as
  // Outreach's list does; a hidden tab waits.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void refresh()
    }, POLL_MS)
    const shown = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', shown)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [refresh])

  function checkedIn(result: VisitQueueCheckIn) {
    setNotice({ tone: result.outcome === 'already_on_list' ? 'info' : 'positive', text: checkedInText(result.outcome, result.entry.fullName) })
    void refresh()
    focus('waiting-notice')
  }

  function changed(text: string, tone: DeptNoticeTone, reload: boolean, updated?: VisitQueueCard) {
    if (updated) setSaved(previous => ({ ...previous, [updated.entryId]: updated }))
    setNotice({ tone, text })
    if (reload) void refresh()
    focus('waiting-notice')
  }

  const items = (list.value?.items ?? []).map(card => {
    const mine = saved[card.entryId]
    return mine && mine.rowVersion > card.rowVersion ? mine : card
  })
  const open = items.filter(card => isOpen(card.stage))
  const closed = items.filter(card => !isOpen(card.stage))
  const listError = list.error && isHidApiError(list.caught) && Object.hasOwn(VISIT_QUEUE_REFUSALS, list.caught.code)
    ? VISIT_QUEUE_REFUSALS[list.caught.code]! : list.error
  const closedRead = list.value?.withClosed === true
  const cut = cutShort(list.value, open.length)
  const today = lagosToday()

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-waiting"
      secondaryActions={<EhrButton variant="secondary" onClick={() => void refresh()} busy={list.loading && list.value !== null}>Refresh</EhrButton>}>
      {canSearchPatients(permissions)
        ? <CheckInSearch facilityId={facilityId} onCheckedIn={checkedIn} />
        : (
          <DeptNotice tone="info" title="Checking a patient in">
            Your role here does not search for patients. Ask the front desk to check the patient in.
          </DeptNotice>
        )}

      {notice ? (
        <DeptNotice id="waiting-notice" tabIndex={-1} role="status" tone={notice.tone} variant="box">{notice.text}</DeptNotice>
      ) : null}

      <DeptSection title={list.value ? `Waiting now (${open.length})` : 'Waiting now'} headingId="waiting-open-title"
        actions={(
          <label className="hid-ehr-dept-waiting-toggle">
            <input type="checkbox" checked={includeClosed} onChange={event => setIncludeClosed(event.target.checked)} />
            <span>Show patients who finished or left today</span>
          </label>
        )}>
        {listError ? <DeptNotice role="alert" tone="critical">{listError}</DeptNotice> : null}
        {list.value === null && list.loading ? <p className="hid-ehr-state-message" role="status">Loading the waiting list…</p> : null}
        {list.value !== null && open.length === 0
          ? <EhrEmptyState title="No one is waiting" message="Patients you check in show here, the most urgent first." />
          : null}
        {open.length > 0 ? (
          <ul className="hid-ehr-dept-waiting-list" aria-label="Patients waiting">
            {open.map(card => (
              <WaitingCard key={card.entryId} card={card} facilityId={facilityId} membershipId={membershipId}
                canSee={canSeePatients(permissions)} today={today} onChanged={changed} />
            ))}
          </ul>
        ) : null}
        {list.value && cut.open ? (
          <DeptNotice tone="caution">
            Only the first {list.value.limit} patients are shown, the most urgent first. Move patients on as they are seen.
          </DeptNotice>
        ) : null}
      </DeptSection>

      {includeClosed && !closedRead && list.loading ? (
        <p className="hid-ehr-state-message" role="status">Loading patients who finished or left today…</p>
      ) : null}
      {includeClosed && closedRead ? (
        <DeptSection title={closedTitle(closed.length, cut.closed)} headingId="waiting-closed-title">
          {list.value && cut.closed ? <DeptNotice tone="caution">{closedCutText(list.value.limit)}</DeptNotice> : null}
          {closed.length === 0
            ? cut.closed ? null : <EhrEmptyState title="No one yet" message="Patients who finish, leave or whose check-in is cancelled today show here." />
            : (
              <ul className="hid-ehr-dept-waiting-list" aria-label="Patients who finished or left today">
                {closed.map(card => <ClosedCard key={card.entryId} card={card} />)}
              </ul>
            )}
        </DeptSection>
      ) : null}
    </DeptPage>
  )
}

/** Who the card is for: sex, date of birth and the Health ID's last 4 characters, never the whole Health ID. */
function Identity({ card }: {
  readonly card: {
    readonly sex: string | null; readonly dateOfBirth: string | null; readonly healthIdLast4: string | null
    readonly dateOfBirthEstimated?: boolean
  }
}) {
  const parts = [sexText(card.sex), bornText(birthDateText(card.dateOfBirth), card.dateOfBirthEstimated)].filter(Boolean)
  return (
    <p className="hid-ehr-dept-waiting-identity">
      {parts.length > 0 ? <span>{parts.join(' · ')}</span> : null}
      {card.healthIdLast4
        ? <span aria-label={`Health ID ending ${card.healthIdLast4}`}>{healthIdEnding(card.healthIdLast4)}</span>
        : null}
    </p>
  )
}

function WaitingCard({ card, facilityId, membershipId, canSee, today, onChanged }: {
  readonly card: VisitQueueCard
  readonly facilityId: string
  readonly membershipId: string | undefined
  readonly canSee: boolean
  /** Today in Lagos (YYYY-MM-DD): a card checked in before it says its day. */
  readonly today: string
  readonly onChanged: (text: string, tone: DeptNoticeTone, reload: boolean, updated?: VisitQueueCard) => void
}) {
  // The card as it was when Change was opened: the form compares with it and sends its row version, so a change
  // someone else made while the form was open (read in by the 30-second poll) answers VISIT_QUEUE_ENTRY_CHANGED instead
  // of being overwritten by the form's unchanged fields.
  const [editing, setEditing] = useState<VisitQueueCard | null>(null)
  const [busy, setBusy] = useState(false)
  const next = NEXT_STEP[card.stage]
  const headingId = `waiting-${card.entryId}`

  async function send(change: VisitQueueChange, done: string, base: VisitQueueCard = card) {
    if (busy) return
    setBusy(true)
    try {
      const updated = await visitQueueApi.update(facilityId, base, change)
      setEditing(null)
      onChanged(done, 'positive', true, updated)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      const reload = isHidApiError(caught) && RELOAD_AFTER.has(caught.code)
      if (reload) setEditing(null)
      onChanged(refusal(caught, 'The change could not be saved. Try again.', UPDATE_INVALID), 'critical', reload)
    } finally { setBusy(false) }
  }

  return (
    <li className="hid-ehr-dept-waiting-card" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name">{card.fullName}</h3>
        <Identity card={card} />
        <div className="hid-ehr-dept-waiting-badges">
          <EhrBadge tone={stageTone(card.stage)}>{stageText(card.stage)}</EhrBadge>
          <EhrBadge tone={triageTone(card.triageLevel)}>{triageText(card.triageLevel)}</EhrBadge>
          {card.chartBlocked ? <EhrBadge tone="critical">Chart cannot be opened</EhrBadge> : null}
          {fromEarlierDay(card, today) ? <EhrBadge tone="caution">{EARLIER_DAY}</EhrBadge> : null}
        </div>
        <dl className="hid-ehr-dept-waiting-facts">
          <div><dt>Checked in</dt><dd>{checkInWhen(card, today)}</dd></div>
          <div><dt>Seen by</dt><dd>{assigneeText(card, membershipId)}</dd></div>
        </dl>
      </div>
      <div className="hid-ehr-dept-waiting-actions">
        {next ? (
          <EhrButton size="sm" busy={busy} onClick={() => void send({ stage: next.stage },
            `${card.fullName}: ${STAGE_WORDS[next.stage].toLowerCase()}.`)}>{next.label}</EhrButton>
        ) : null}
        <EhrButton size="sm" variant="secondary" aria-expanded={editing !== null} aria-controls={`${headingId}-change`}
          onClick={() => setEditing(value => value === null ? card : null)}>{editing ? 'Close' : 'Change'}</EhrButton>
      </div>
      {editing ? (
        <ChangeForm id={`${headingId}-change`} card={editing} membershipId={membershipId} canSee={canSee} busy={busy}
          onSave={(change, done) => void send(change, done, editing)} onCancel={() => setEditing(null)} />
      ) : null}
    </li>
  )
}

/** A closed card: who it was and how the visit ended, with no actions (check them in again if they are back). */
function ClosedCard({ card }: { readonly card: VisitQueueCard }) {
  const headingId = `waiting-${card.entryId}`
  return (
    <li className="hid-ehr-dept-waiting-card" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name">{card.fullName}</h3>
        <Identity card={card} />
        <div className="hid-ehr-dept-waiting-badges">
          <EhrBadge tone="neutral">{stageText(card.stage)}</EhrBadge>
        </div>
        <dl className="hid-ehr-dept-waiting-facts">
          <div><dt>Checked in</dt><dd>{timeText(card.checkedInAt)}</dd></div>
          {card.closedAt ? <div><dt>Ended</dt><dd>{timeText(card.closedAt)}</dd></div> : null}
        </dl>
      </div>
    </li>
  )
}

const KEEP = 'keep'
const MINE = 'mine'
const NOBODY = 'nobody'

/**
 * The card's change form: the stage, the triage level and who will see the patient. Only what was changed is sent.
 * A member who can see patients (a nurse, clinician or doctor) can put themselves down; anyone can clear it. Another
 * member is never named: the card has their membership only.
 */
function ChangeForm({ id, card, membershipId, canSee, busy, onSave, onCancel }: {
  readonly id: string
  readonly card: VisitQueueCard
  readonly membershipId: string | undefined
  readonly canSee: boolean
  readonly busy: boolean
  readonly onSave: (change: VisitQueueChange, done: string) => void
  readonly onCancel: () => void
}) {
  const mine = membershipId !== undefined && card.assignedMembershipId === membershipId
  const initialWho = card.assignedMembershipId === null ? NOBODY : mine ? MINE : KEEP
  const [stage, setStage] = useState<VisitQueueStage>(card.stage)
  const [level, setLevel] = useState(card.triageLevel === null ? '' : String(card.triageLevel))
  const [who, setWho] = useState(initialWho)
  const [problem, setProblem] = useState('')

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const change: VisitQueueChange = {}
    if (stage !== card.stage) change.stage = stage
    const triageLevel = level === '' ? null : Number(level)
    if (triageLevel !== card.triageLevel) change.triageLevel = triageLevel
    if (who !== initialWho) {
      if (who === NOBODY) change.assignedMembershipId = null
      else if (who === MINE && membershipId) change.assignedMembershipId = membershipId
    }
    if (Object.keys(change).length === 0) { setProblem(VISIT_QUEUE_REFUSALS.VISIT_QUEUE_NOTHING_TO_CHANGE!); return }
    setProblem('')
    onSave(change, `${card.fullName}: saved.`)
  }

  return (
    <form id={id} className="hid-ehr-dept-form hid-ehr-dept-waiting-change" noValidate onSubmit={save}
      aria-label={`Change ${card.fullName}`}>
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="Stage" controlId={`${id}-stage`}>
          <EhrSelect value={stage} onChange={event => setStage(event.target.value as VisitQueueStage)}>
            <optgroup label="On the waiting list">
              {OPEN_STAGES.map(value => <option key={value} value={value}>{STAGE_WORDS[value]}</option>)}
            </optgroup>
            <optgroup label="Take off the waiting list">
              {CLOSING_STAGES.map(value => <option key={value} value={value}>{STAGE_WORDS[value]}</option>)}
            </optgroup>
          </EhrSelect>
        </EhrField>
        <EhrField label="Triage level" controlId={`${id}-level`} hint="Level 1 is the most urgent. Patients are listed by level.">
          <EhrSelect value={level} onChange={event => setLevel(event.target.value)}>
            <option value="">No triage level yet</option>
            {TRIAGE_LEVELS.map(value => <option key={value} value={String(value)}>{triageText(value)}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Who will see them" controlId={`${id}-who`}>
          <EhrSelect value={who} onChange={event => setWho(event.target.value)}>
            <option value={NOBODY}>No one yet</option>
            {canSee || mine ? <option value={MINE}>Me</option> : null}
            {initialWho === KEEP ? <option value={KEEP}>Another staff member (keep)</option> : null}
          </EhrSelect>
        </EhrField>
      </div>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="button" variant="quiet" onClick={onCancel}>Cancel</EhrButton>
        <EhrButton type="submit" busy={busy}>Save changes</EhrButton>
      </div>
    </form>
  )
}

/**
 * Check in: a staff patient search (0132) by name, date of birth, phone or Health ID, all in the request body; each
 * card it finds can be checked in by its matchRef for 10 minutes. The keys and the cards stay in this component's state
 * and are cleared once a patient is checked in.
 */
export function CheckInSearch({ facilityId, onCheckedIn }: {
  readonly facilityId: string
  readonly onCheckedIn: (result: VisitQueueCheckIn) => void
}) {
  const [values, setValues] = useState<SearchValues>(EMPTY_SEARCH)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [cards, setCards] = useState<readonly PatientSearchCard[]>([])
  const [checking, setChecking] = useState<string | null>(null)
  const focus = useFocusById()

  function change(next: Partial<SearchValues>) { setValues(previous => ({ ...previous, ...next })) }

  /** Back to an empty search, with the reason said and focus in its first field. */
  function searchAgain(text: string) {
    setCards([]); setSaid(null); setError(text)
    focus('waiting-search-first-name')
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const keys = searchKeys(values)
    setError(''); setSaid(null)
    if (!keys) { setError(SEARCH_EMPTY); focus('waiting-search-first-name'); return }
    setBusy(true)
    try {
      const answer = await staffApi.searchPatients(facilityId, keys)
      const found = answer.outcome === 'found' ? answer.patients : []
      setCards(found)
      setSaid(found.length === 0 ? noCardText(answer) : null)
      focus(found.length > 0 ? 'waiting-search-results-title' : 'waiting-search-said')
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      setCards([])
      setError(checkInSearchRefusal(caught))
    } finally { setBusy(false) }
  }

  async function checkIn(card: PatientSearchCard) {
    if (checking) return
    if (matchRefExpired(card)) { searchAgain(SEARCH_EXPIRED); return }
    setChecking(card.matchRef); setError('')
    try {
      const result = await visitQueueApi.checkIn(facilityId, { matchRef: card.matchRef })
      setCards([]); setSaid(null); setValues(EMPTY_SEARCH)
      onCheckedIn(result)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      if (isHidApiError(caught) && (caught.code === 'CHECK_IN_NEEDS_SEARCH' || caught.code === 'CHECK_IN_NEEDS_ONE_PATIENT'
        || caught.code === 'VALIDATION_FAILED')) {
        searchAgain(refusal(caught, CHECK_IN_INVALID, CHECK_IN_INVALID))
        return
      }
      setError(refusal(caught, 'The patient could not be checked in. Try again.'))
    } finally { setChecking(null) }
  }

  return (
    <DeptSection title="Check in a patient" headingId="waiting-search-title">
      <form className="hid-ehr-dept-form hid-ehr-dept-waiting-search" noValidate onSubmit={event => void search(event)}
        aria-labelledby="waiting-search-title">
        <p className="hid-ehr-dept-waiting-hint">{SEARCH_HINT}</p>
        <div className="hid-ehr-dept-form-grid">
          <EhrField label="First name" controlId="waiting-search-first-name">
            <EhrInput value={values.firstName} onChange={event => change({ firstName: event.target.value })} maxLength={100}
              autoComplete="off" spellCheck={false} />
          </EhrField>
          <EhrField label="Last name" controlId="waiting-search-last-name">
            <EhrInput value={values.lastName} onChange={event => change({ lastName: event.target.value })} maxLength={100}
              autoComplete="off" spellCheck={false} />
          </EhrField>
          <EhrField label="Date of birth" controlId="waiting-search-date-of-birth">
            <EhrInput type="date" value={values.dateOfBirth} onChange={event => change({ dateOfBirth: event.target.value })}
              autoComplete="off" />
          </EhrField>
          <EhrField label="Phone number" controlId="waiting-search-phone">
            <EhrInput type="tel" value={values.phone} onChange={event => change({ phone: event.target.value })} maxLength={24}
              autoComplete="off" />
          </EhrField>
          <EhrField label="Health ID" controlId="waiting-search-health-id" hint="It starts with HID-.">
            <EhrInput value={values.healthId} onChange={event => change({ healthId: event.target.value })} maxLength={36}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </EhrField>
        </div>
        {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" busy={busy}>Find patient</EhrButton>
        </div>
      </form>

      {said ? <p id="waiting-search-said" tabIndex={-1} role="status" className="hid-ehr-state-message">{said}</p> : null}
      {cards.length > 0 ? (
        <div className="hid-ehr-dept-waiting-results">
          <h3 id="waiting-search-results-title" tabIndex={-1}>{countText(cards.length, 'patient')} found</h3>
          <ul className="hid-ehr-dept-waiting-list" aria-labelledby="waiting-search-results-title">
            {cards.map((card, index) => {
              // By its place in the answer: the matchRef stays out of the page's markup.
              const headingId = `waiting-found-${index}`
              return (
                <li key={card.matchRef} className="hid-ehr-dept-waiting-card" aria-labelledby={headingId}>
                  <div className="hid-ehr-dept-waiting-main">
                    <h4 id={headingId} className="hid-ehr-dept-waiting-name">{card.fullName}</h4>
                    <Identity card={card} />
                    <div className="hid-ehr-dept-waiting-badges">
                      <EhrBadge tone={card.ninStatus === 'verified' ? 'positive' : 'neutral'}>{ninStatusLabel(card.ninStatus)}</EhrBadge>
                    </div>
                  </div>
                  <div className="hid-ehr-dept-waiting-actions">
                    <EhrButton size="sm" busy={checking === card.matchRef} aria-label={`Check in ${card.fullName}`}
                      onClick={() => void checkIn(card)}>Check in</EhrButton>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </DeptSection>
  )
}

/**
 * "Check in" on a card of another page's patient search (Patients' Search by name): sends the card's matchRef and says
 * what happened beside the button. Only for members the waiting list is open to (canUseWaitingList).
 */
export function CheckInButton({ facilityId, card }: { readonly facilityId: string; readonly card: PatientSearchCard }) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ readonly tone: 'positive' | 'critical'; readonly text: string } | null>(null)

  async function checkIn() {
    if (busy) return
    if (matchRefExpired(card)) { setSaid({ tone: 'critical', text: SEARCH_EXPIRED }); return }
    setBusy(true); setSaid(null)
    try {
      const result = await visitQueueApi.checkIn(facilityId, { matchRef: card.matchRef })
      setSaid({ tone: 'positive', text: `${checkedInText(result.outcome, result.entry.fullName)} See the Waiting list.` })
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      setSaid({ tone: 'critical', text: refusal(caught, 'The patient could not be checked in. Try again.', CHECK_IN_INVALID) })
    } finally { setBusy(false) }
  }

  return (
    <span className="hid-ehr-dept-waiting-check-in">
      {said?.tone === 'positive' ? null
        : <EhrButton size="sm" variant="secondary" busy={busy} aria-label={`Check in ${card.fullName}`} onClick={() => void checkIn()}>Check in</EhrButton>}
      {said ? <span role={said.tone === 'critical' ? 'alert' : 'status'} data-tone={said.tone}>{said.text}</span> : null}
    </span>
  )
}
