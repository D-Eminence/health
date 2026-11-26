import { useCallback, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { EhrBadge, EhrButton, EhrEmptyState } from '@hid/ui/ehr'
import { edBoardApi, type EdBoard, type EdCard, type EdColumn, type EdHistoryEvent } from '../../../staff/api'
import { useBluePage } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { birthDateText } from '../parts/format'
import { triageText, triageTone } from '../parts/triageLevels'
import { useFacilityRead } from '../parts/useFacilityRead'
import { healthIdEnding, sexText } from '../waiting/waitingRules'
import { EdRecordPage } from './EdRecord'
import {
  ATTENDANCE_ID, BASE, BOARD_REFUSED, COLUMNS, COLUMN_EMPTY, COLUMN_WORDS, DESCRIPTION, EYEBROW, NOT_AVAILABLE, POLL_MS, SCREEN_WARNING,
  TITLE, arrivalModeText, awaitsBoardCodes, canArrive, canRead, cardName, closedWords, complaintText, lagosWhen, learnFrom, memberText,
  minutesText, notServed, refusalWords, stageText,
} from './edRules'
import { usePolling, useStaffNames } from './hooks'
import { NewArrival } from './NewArrival'
import './emergency.css'

/**
 * The emergency department board in the blue EHR (hid-system ED-1, 0168 and 0169), in place of Akos's sample board
 * (clinical/emergency/EmergencyWorkspace.tsx and the sample engine's "emergency" definition): the board with its three
 * columns and counts, New arrival, and one patient's record with triage, start care, the visit link, disposition, leave
 * and cancel. An ED patient is a waiting-list row plus an ED record, so the stage and triage level are the waiting
 * list's own (the same five levels and words). Every time is Lagos's, whatever the device's zone. A card shows identity
 * details and the triage only, never other clinical content, and gives no access to the chart. No Health ID or patient
 * name in any address: the record's address carries the ED record's UUID only.
 */
export function EmergencyDepartment() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canRead(permissions)) return <EmergencyDepartmentUnavailable />
  return <EmergencyDesk key={facility.id} facilityId={facility.id} />
}

/**
 * The board refused before it is read: who can use it, or, for a member it is for on a backend that has not given them
 * its codes yet (before 0169), that it is not available yet.
 */
export function EmergencyDepartmentUnavailable() {
  const { permissions } = useDeptAccess()
  return <DeptUnavailable title={TITLE} message={awaitsBoardCodes(permissions) ? NOT_AVAILABLE : BOARD_REFUSED} />
}

function EmergencyDesk({ facilityId }: { readonly facilityId: string }) {
  const { rest } = useBluePage()
  const [includeClosed, setIncludeClosed] = useState(false)
  const below = rest.replace(/\/+$/, '')
  if (below === '') return <Board facilityId={facilityId} includeClosed={includeClosed} onIncludeClosed={setIncludeClosed} />
  if (below === 'new') return <NewArrival facilityId={facilityId} />
  if (ATTENDANCE_ID.test(below)) return <EdRecordPage key={below} facilityId={facilityId} attendanceId={below.toLowerCase()} />
  // Anything else (a sample record's id, a mistyped address): the board.
  return <Navigate replace to={BASE} />
}

/**
 * One read of the board: the board, or that it is not served (503 ED_BOARD_NOT_AVAILABLE, the flag off, or an ehr-api
 * before 0168). Not served is the read's value, not an error kept beside the last board: switched off after use, the
 * board hands every patient back to the waiting list (ED-1, the kill switch), so a board shown before is no longer true
 * and is dropped, also while it is read again every 30 seconds.
 */
type BoardRead = (EdBoard & { readonly served: true; readonly withClosed: boolean }) | { readonly served: false }
const NOT_SERVED: BoardRead = { served: false }

function Board({ facilityId, includeClosed, onIncludeClosed }: {
  readonly facilityId: string
  readonly includeClosed: boolean
  readonly onIncludeClosed: (value: boolean) => void
}) {
  const navigate = useNavigate()
  const { permissions, membershipId } = useDeptAccess()
  const loader = useCallback((id: string) => edBoardApi.board(id, includeClosed).then(answer => {
    learnFrom()
    return { ...answer, served: true, withClosed: includeClosed } as BoardRead
  }, caught => {
    learnFrom(caught)
    if (notServed(caught)) return NOT_SERVED
    throw caught
  }), [includeClosed])
  const board = useFacilityRead<BoardRead>(facilityId, true, loader, 'The emergency board could not be loaded.')
  const { refresh } = board
  usePolling(refresh, POLL_MS)

  const unavailable = board.value?.served === false
  // The board as last read, never one from before it said it is not served.
  const shown = board.value?.served ? board.value : null
  const items = shown?.items ?? []
  const names = useStaffNames(facilityId, items.map(card => card.assignedMembershipId))
  const error = board.error ? refusalWords(board.caught, board.error) : unavailable ? NOT_AVAILABLE : ''
  const byColumn = (column: EdColumn) => items.filter(card => card.column === column)
  const counts = shown?.counts

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-emergency"
      primaryAction={canArrive(permissions) && !unavailable
        ? <EhrButton onClick={() => navigate(`${BASE}/new`)}>New arrival</EhrButton> : undefined}
      secondaryActions={<EhrButton variant="secondary" onClick={() => void refresh()} busy={board.loading && board.value !== null}>Refresh</EhrButton>}>
      <DeptNotice tone="caution" title="Staff only">{SCREEN_WARNING}</DeptNotice>

      {error ? <DeptNotice role="alert" tone={board.error ? 'critical' : 'info'}>{error}</DeptNotice> : null}
      {board.value === null && board.loading ? <p className="hid-ehr-state-message" role="status">Loading the emergency board…</p> : null}

      {shown !== null ? (
        <>
          {counts ? (
            <dl className="hid-ehr-dept-emergency-counts" aria-label="Patients in the department">
              <div><dt>Waiting</dt><dd>{counts.waiting}</dd></div>
              <div><dt>Being seen</dt><dd>{counts.beingSeen}</dd></div>
              <div><dt>Disposition</dt><dd>{counts.disposition}</dd></div>
            </dl>
          ) : null}
          <div className="hid-ehr-dept-emergency-columns">
            {COLUMNS.map(column => (
              <BoardColumn key={column} column={column} cards={byColumn(column)} membershipId={membershipId} names={names} />
            ))}
          </div>
          {shown.hasMore ? (
            <DeptNotice tone="caution">
              Only the first {shown.limit} patients are shown, the most urgent first. Record where patients go next as they leave.
            </DeptNotice>
          ) : null}
        </>
      ) : null}

      {!unavailable ? (
        <label className="hid-ehr-dept-waiting-toggle hid-ehr-dept-emergency-toggle">
          <input type="checkbox" checked={includeClosed} onChange={event => onIncludeClosed(event.target.checked)} />
          <span>Show patients who left the board today</span>
        </label>
      ) : null}
      {includeClosed && shown?.withClosed ? (
        <BoardColumn column="closed" cards={byColumn('closed')} membershipId={membershipId} names={names} />
      ) : null}
    </DeptPage>
  )
}

function BoardColumn({ column, cards, membershipId, names }: {
  readonly column: EdColumn
  readonly cards: readonly EdCard[]
  readonly membershipId: string | undefined
  readonly names: ReadonlyMap<string, string | null>
}) {
  const headingId = `ed-column-${column}`
  return (
    <DeptSection title={`${COLUMN_WORDS[column]} (${cards.length})`} headingId={headingId} className="hid-ehr-dept-emergency-column">
      {cards.length === 0 ? <EhrEmptyState title={COLUMN_EMPTY[column]} message={column === 'closed' ? 'Patients who leave the board today show here.' : 'Patients show here, the most urgent first.'} /> : (
        <ul className="hid-ehr-dept-waiting-list" aria-labelledby={headingId}>
          {cards.map(card => <BoardCard key={card.attendanceId} card={card} membershipId={membershipId} names={names} />)}
        </ul>
      )}
    </DeptSection>
  )
}

/** Who the card is for: sex, date of birth (an estimate says so) and the Health ID's last 4 characters, never all of it. */
export function EdIdentity({ card }: { readonly card: EdCard }) {
  const born = card.dateOfBirthEstimated
    ? card.dateOfBirth ? `Estimated age, born about ${birthDateText(card.dateOfBirth)}` : 'Estimated age'
    : card.dateOfBirth ? `Born ${birthDateText(card.dateOfBirth)}` : ''
  const parts = [sexText(card.sex), born].filter(Boolean)
  return (
    <p className="hid-ehr-dept-waiting-identity">
      {parts.length > 0 ? <span>{parts.join(' · ')}</span> : null}
      {card.healthIdLast4
        ? <span aria-label={`Health ID ending ${card.healthIdLast4}`}>{healthIdEnding(card.healthIdLast4)}</span>
        : null}
    </p>
  )
}

/**
 * The card's badges: the triage level (1 and 2 in the critical tone, as the waiting list), the stage and the decision.
 * The record page passes its history, so a closed record with no decision says how it closed (closedWords).
 */
export function EdBadges({ card, history = [] }: { readonly card: EdCard; readonly history?: readonly EdHistoryEvent[] }) {
  return (
    <div className="hid-ehr-dept-waiting-badges">
      <EhrBadge tone={triageTone(card.triageLevel)}>{triageText(card.triageLevel)}</EhrBadge>
      {card.status === 'open' ? <EhrBadge tone="brand">{stageText(card.stage)}</EhrBadge>
        : <EhrBadge tone={card.status === 'decided' ? 'caution' : 'neutral'}>{closedWords(card, history)}</EhrBadge>}
      {card.recordKind === 'unknown' ? <EhrBadge tone="caution">Unknown patient</EhrBadge> : null}
      {card.chartBlocked ? <EhrBadge tone="critical">Chart cannot be opened</EhrBadge> : null}
    </div>
  )
}

function BoardCard({ card, membershipId, names }: {
  readonly card: EdCard
  readonly membershipId: string | undefined
  readonly names: ReadonlyMap<string, string | null>
}) {
  const headingId = `ed-${card.attendanceId}`
  const urgent = card.triageLevel !== null && card.triageLevel <= 2
  return (
    <li className={['hid-ehr-dept-waiting-card', 'hid-ehr-dept-emergency-card', urgent ? 'hid-ehr-dept-emergency-urgent' : ''].filter(Boolean).join(' ')}
      aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name">
          <Link className="hid-ehr-dept-link" to={`${BASE}/${card.attendanceId}`}>{cardName(card)}</Link>
        </h3>
        <EdIdentity card={card} />
        <EdBadges card={card} />
        <dl className="hid-ehr-dept-waiting-facts">
          <div><dt>Arrived</dt><dd>{lagosWhen(card.arrivedAt)}</dd></div>
          <div><dt>In the department</dt><dd>{minutesText(card.minutesInDepartment)}</dd></div>
          <div><dt>How they came</dt><dd>{arrivalModeText(card.arrivalMode)}</dd></div>
          <div><dt>Seen by</dt><dd>{memberText(card.assignedMembershipId, membershipId, names)}</dd></div>
          {!card.complaintHidden ? <div><dt>Complaint</dt><dd>{complaintText(card)}</dd></div> : null}
        </dl>
      </div>
    </li>
  )
}
