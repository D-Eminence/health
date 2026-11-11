import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptSection } from '../parts/DeptPage'
import { READING_QUALITY_TOO_FEW_REVIEWERS, REJECTION_REASONS, REMOVAL_REASONS, type ReasonChoice } from '../../../readingLearningContract'
import { readingQualityApi } from './readingQualityApi'

/*
 * "Reading quality" (Migrate learning, phase 1), on the staff side in Migrate: how well paper records were read at this
 * facility, counted from what staff did when they checked each reading. It reads Session B's review-outcome summary
 * (schema hid.ocr.quality-summary/v1: groups by ISO week, facility, kind and prompt version) for the working facility
 * (readingQualityApi.ts) and adds the groups up. Numbers and plain words only: no item, patient, facility, week code,
 * reason code, prompt version or ID is ever shown. A group the server held back as too small (`suppressed`) is left out
 * and said in words, as are reason counts it left out (`smallCellsHidden`). A backend without the read answers 404: the
 * view says it isn't available yet, calmly, and Migrate stops offering it.
 *
 * A facility's manager reads it too (hid-system #236). Their answer counts finished weeks only (its from and to say
 * which), holds back a group fewer than 3 people checked as it holds back a small one, and, when fewer than 3 people
 * checked at all, is { available: false, reason: "too_few_reviewers" }: the view then says so in one calm sentence,
 * with no figures. Any other answer that is not available is said in a calm general sentence.
 */

type Counts = Readonly<Record<string, number>>

export interface ReadingQuality {
  /**
   * Null when the answer has figures; otherwise why not: 'tooFewReviewers' (fewer than 3 people's checks were counted,
   * for a manager), or 'other' for any other reason the answer gives.
   */
  readonly unavailable: 'tooFewReviewers' | 'other' | null
  /** The first and last day counted (whole ISO weeks), as the answer gives them; null when it doesn't. */
  readonly from: string | null
  readonly to: string | null
  /** The server counted only part of the period. */
  readonly truncated: boolean
  readonly validated: number
  readonly rejected: number
  readonly reviewConfirmed: number
  readonly missedItems: number
  readonly rejectionReasons: Counts
  readonly removalReasons: Counts
  readonly changeReasons: Counts
  /** Items, by Session B's decision (kept_unchanged, kept_changed, removed, ...). */
  readonly decisions: Counts
  /** Whether any review or item group was counted at all. */
  readonly anyShown: boolean
  /** Groups held back as too small to show. */
  readonly heldBack: number
  /** Reason counts left out inside groups that are shown. */
  readonly smallCellsHidden: number
  /** Of those, the ones left out of review groups (rejection, removal and change reasons). */
  readonly reviewCellsHidden: number
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const whole = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
const groups = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : []
const DAY = /^\d{4}-\d{2}-\d{2}$/

function addCounts(into: Record<string, number>, value: unknown) {
  for (const [code, count] of Object.entries(record(value))) into[code] = (into[code] ?? 0) + whole(count)
}

/** The answer as the page reads it, added up over every group the server shows. */
export function parseReadingQuality(answer: unknown): ReadingQuality {
  const value = record(answer)
  const totals = { validated: 0, rejected: 0, reviewConfirmed: 0, missedItems: 0 }
  const rejectionReasons: Record<string, number> = {}
  const removalReasons: Record<string, number> = {}
  const changeReasons: Record<string, number> = {}
  const decisions: Record<string, number> = {}
  let heldBack = 0
  let smallCellsHidden = 0
  let reviewCellsHidden = 0
  let anyShown = false
  for (const group of [...groups(value.reviewGroups), ...groups(value.itemGroups)]) {
    if (group.suppressed === true) { heldBack += 1; continue }
    anyShown = true
    smallCellsHidden += whole(group.smallCellsHidden)
  }
  for (const group of groups(value.reviewGroups)) {
    if (group.suppressed === true) continue
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += whole(group[key])
    reviewCellsHidden += whole(group.smallCellsHidden)
    addCounts(rejectionReasons, group.rejectionReasons)
    addCounts(removalReasons, group.removalReasons)
    addCounts(changeReasons, group.changeReasons)
  }
  for (const group of groups(value.itemGroups)) if (group.suppressed !== true) addCounts(decisions, group.decisions)
  return {
    unavailable: value.available !== false ? null : value.reason === READING_QUALITY_TOO_FEW_REVIEWERS ? 'tooFewReviewers' : 'other',
    from: typeof value.from === 'string' && DAY.test(value.from) ? value.from : null,
    to: typeof value.to === 'string' && DAY.test(value.to) ? value.to : null,
    truncated: value.truncated === true,
    ...totals, rejectionReasons, removalReasons, changeReasons, decisions, anyShown, heldBack, smallCellsHidden,
    reviewCellsHidden,
  }
}

const NUMBER = new Intl.NumberFormat('en-NG')
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayText = (day: string) => DATE.format(new Date(`${day}T00:00:00Z`))
/**
 * A reason count. The server stores no zero, so an absent reason is none at all, unless it held back small reason counts in
 * the weeks shown: then it may be a few, and the words say both.
 */
const reasonCount = (data: ReadingQuality, code: string) => data.changeReasons[code] !== undefined ? NUMBER.format(data.changeReasons[code])
  : data.reviewCellsHidden > 0 ? 'None, or too few to show' : NUMBER.format(0)

function Tile({ id, title, value, children }: { id: string; title: string; value: string; children?: ReactNode }) {
  return <article className="hid-ehr-dept-quality-tile" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    <p className="hid-ehr-dept-quality-value">{value}</p>
    {children}
  </article>
}

/** Each reason the page has words for and the server counted; a code it has no words for is never shown. */
function Breakdown({ label, choices, values }: { label: string; choices: readonly ReasonChoice<string>[]; values: Counts }) {
  const shown = choices.filter(choice => values[choice.code] !== undefined)
  if (!shown.length) return null
  return <ul className="hid-ehr-dept-quality-breakdown" aria-label={label}>
    {shown.map(choice => <li key={choice.code}><span>{choice.words}</span><strong>{NUMBER.format(values[choice.code] ?? 0)}</strong></li>)}
  </ul>
}

function Figures({ data, finishedWeeksOnly }: { data: ReadingQuality; readonly finishedWeeksOnly: boolean }) {
  const n = (value: number) => NUMBER.format(value)
  return <>
    {data.from && data.to && <p className="hid-ehr-dept-muted">{`Weeks from ${dayText(data.from)} to ${dayText(data.to)}, at this facility.`}</p>}
    <DeptSection title="Documents checked" headingId="reading-quality-documents">
      <div className="hid-ehr-dept-quality-tiles">
        <Tile id="rq-documents" title="Documents checked and saved" value={n(data.validated)} />
        <Tile id="rq-complete" title="Checks where every item was looked at" value={`${n(data.reviewConfirmed)} of ${n(data.validated)}`}>
          <p className="hid-ehr-dept-muted">Counted from the items each check had on screen. Staff aren’t asked to tick anything. Checks saved
            before this was counted, and checks with no item to look at, count as not looked at.</p>
        </Tile>
        <Tile id="rq-rejected" title="Documents rejected, and why" value={n(data.rejected)}>
          <Breakdown label="Documents rejected, by reason" choices={REJECTION_REASONS} values={data.rejectionReasons} />
        </Tile>
      </div>
    </DeptSection>
    <DeptSection title="Items read from paper" headingId="reading-quality-items">
      <div className="hid-ehr-dept-quality-tiles">
        <Tile id="rq-kept" title="Items kept as read" value={n(data.decisions.kept_unchanged ?? 0)} />
        <Tile id="rq-changed" title="Items changed" value={n(data.decisions.kept_changed ?? 0)} />
        <Tile id="rq-misread" title="Changed because the AI misread the paper" value={reasonCount(data, 'misread')} />
        <Tile id="rq-out-of-date" title="Changed because the paper was out of date" value={reasonCount(data, 'clinical_update')} />
        <Tile id="rq-removed" title="Items removed, and why" value={n(data.decisions.removed ?? 0)}>
          <Breakdown label="Items removed, by reason" choices={REMOVAL_REASONS} values={data.removalReasons} />
        </Tile>
        <Tile id="rq-missed" title="Items the reading missed" value={n(data.missedItems)} />
      </div>
      <p className="hid-ehr-dept-muted">Reasons are optional, so they don’t add up to every item changed, removed or rejected.</p>
      {/* A manager's answer ends on the Sunday before this week (hid-system #236 finishedWeeks). */}
      {finishedWeeksOnly && <p className="hid-ehr-dept-muted">Figures cover finished weeks only.</p>}
    </DeptSection>
    {(data.heldBack > 0 || data.smallCellsHidden > 0 || data.truncated) && <DeptSection title="What these figures leave out" headingId="reading-quality-left-out">
      {data.heldBack > 0 && <p className="hid-ehr-dept-muted">Some weeks had too few checks, or too few people checking, to show without
        pointing at the people who did them. Their figures are left out.</p>}
      {data.smallCellsHidden > 0 && <p className="hid-ehr-dept-muted">A reason given fewer than 5 times in a week is left out of that week’s
        figures.</p>}
      {data.truncated && <p className="hid-ehr-dept-muted">There were too many checks to count them all. These figures count only some of them.</p>}
    </DeptSection>}
  </>
}

type Loaded = { readonly state: 'loading' } | { readonly state: 'shown'; readonly data: ReadingQuality } | { readonly state: 'notServed' }
  | { readonly state: 'refused' } | { readonly state: 'failed' }

/** The view: read once when opened, and again on Refresh. */
export function ReadingQualityView({ facilityId, finishedWeeksOnly = false }: { readonly facilityId: string; readonly finishedWeeksOnly?: boolean }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const current = useRef<AbortController | null>(null)
  const load = useCallback(() => {
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    setRefreshing(true)
    readingQualityApi.summary(facilityId, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setRefreshing(false)
      setLoaded(result.ok ? { state: 'shown', data: parseReadingQuality(result.answer) }
        : 'notServed' in result ? { state: 'notServed' } : 'refused' in result ? { state: 'refused' } : { state: 'failed' })
    }, () => { if (!controller.signal.aborted) { setRefreshing(false); setLoaded({ state: 'failed' }) } })
  }, [facilityId])
  useEffect(() => {
    load()
    return () => current.current?.abort()
  }, [load])

  const refresh = <div className="hid-ehr-dept-form-actions">
    <EhrButton variant="secondary" busy={refreshing} onClick={load}>{refreshing ? 'Refreshing…' : 'Refresh'}</EhrButton>
  </div>
  return <div className="hid-ehr-dept-quality">
    <p className="hid-ehr-dept-muted">How well paper records were read at this facility in recent weeks, from what staff kept, changed,
      removed and found missing when they checked each reading.</p>
    <div id="reading-quality-status" role="status">{loaded.state === 'loading' ? <p className="hid-ehr-dept-muted">Loading reading quality…</p> : null}</div>
    {loaded.state === 'notServed' && <DeptSection title="Not available yet" headingId="reading-quality-not-yet">
      <p className="hid-ehr-dept-muted">Reading quality appears here once the reading service records what staff do when they check paper
        records. Nothing needs doing.</p>
    </DeptSection>}
    {loaded.state === 'refused' && <DeptNotice tone="info">Reading quality isn’t open to you at this facility.</DeptNotice>}
    {loaded.state === 'failed' && <div role="alert"><DeptNotice tone="critical">Reading quality could not be loaded. Try again.</DeptNotice>{refresh}</div>}
    {loaded.state === 'shown' && <>
      {refresh}
      {loaded.data.unavailable === 'tooFewReviewers' ? <DeptSection title="No figures yet" headingId="reading-quality-too-few-reviewers">
        <p className="hid-ehr-dept-muted">Not enough reviews yet to show figures for this facility.</p>
      </DeptSection>
        : loaded.data.unavailable ? <DeptSection title="No figures yet" headingId="reading-quality-unavailable">
          <p className="hid-ehr-dept-muted">Figures can’t be shown for this facility at the moment. Nothing needs doing.</p>
        </DeptSection>
        : loaded.data.anyShown ? <Figures data={loaded.data} finishedWeeksOnly={finishedWeeksOnly} />
        : loaded.data.heldBack > 0 ? <DeptSection title="Too few checks to show" headingId="reading-quality-too-few">
          <p className="hid-ehr-dept-muted">There were too few checks, or too few people checking, at this facility in these weeks to show
            figures without pointing at the people who did them. Nothing needs doing.</p>
          {loaded.data.truncated && <p className="hid-ehr-dept-muted">Only some of the checks in these weeks could be counted.</p>}
        </DeptSection>
        : <DeptSection title="No checks yet" headingId="reading-quality-none">
          <p className="hid-ehr-dept-muted">No paper reading was checked at this facility in these weeks.</p>
        </DeptSection>}
    </>}
  </div>
}
