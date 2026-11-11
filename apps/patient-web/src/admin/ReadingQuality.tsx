import { useCallback, type ReactNode } from 'react'
import { adminApi } from './api'
import { isProblem } from './problems'
import { Page, Refresh, useResource } from './ui'
import { learnReadingQualityServed } from '../readingLearningServed'
import { REJECTION_REASONS, REMOVAL_REASONS, type ReasonChoice } from '../readingLearningContract'

/*
 * "Reading quality" (Migrate learning, phase 1): how well paper records are read, counted from what staff do when they
 * check a reading. It reads Session B's review-outcome summary (schema hid.ocr.quality-summary/v1: groups by ISO week,
 * facility, kind and prompt version) from the proposed admin read (readingLearningContract.ts READING_QUALITY_PATH),
 * and adds the groups up. Numbers and plain words only: no item, patient, facility, week code, reason code or ID is
 * ever shown. A group the server held back as too small (`suppressed`) is left out and said in words, as are reason
 * counts it left out (`smallCellsHidden`). An Identity without the read answers 404 (said as
 * READING_QUALITY_UNAVAILABLE): the page says it isn't available yet, calmly, and the sidebar stops listing it.
 */

type Counts = Readonly<Record<string, number>>

export interface ReadingQuality {
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
  let anyShown = false
  for (const group of [...groups(value.reviewGroups), ...groups(value.itemGroups)]) {
    if (group.suppressed === true) { heldBack += 1; continue }
    anyShown = true
    smallCellsHidden += whole(group.smallCellsHidden)
  }
  for (const group of groups(value.reviewGroups)) {
    if (group.suppressed === true) continue
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += whole(group[key])
    addCounts(rejectionReasons, group.rejectionReasons)
    addCounts(removalReasons, group.removalReasons)
    addCounts(changeReasons, group.changeReasons)
  }
  for (const group of groups(value.itemGroups)) if (group.suppressed !== true) addCounts(decisions, group.decisions)
  return {
    from: typeof value.from === 'string' && DAY.test(value.from) ? value.from : null,
    to: typeof value.to === 'string' && DAY.test(value.to) ? value.to : null,
    truncated: value.truncated === true,
    ...totals, rejectionReasons, removalReasons, changeReasons, decisions, anyShown, heldBack, smallCellsHidden,
  }
}

const NUMBER = new Intl.NumberFormat('en-NG')
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayText = (day: string) => DATE.format(new Date(`${day}T00:00:00Z`))
/** A reason count: absent means the server left it out (fewer than it shows) or there were none. */
const reasonCount = (counts: Counts, code: string) => counts[code] === undefined ? 'Too few to show' : NUMBER.format(counts[code])

/** A read noting what it says of the backend: an answer means served, a 404 that it is not. */
async function learnFrom(read: Promise<unknown>): Promise<ReadingQuality | null> {
  try {
    const answer = await read
    learnReadingQualityServed(true)
    return parseReadingQuality(answer)
  } catch (caught) {
    if (isProblem(caught, 'READING_QUALITY_UNAVAILABLE')) { learnReadingQualityServed(false); return null }
    throw caught
  }
}

function Tile({ id, title, value, children }: { id: string; title: string; value: string; children?: ReactNode }) {
  return <article className="admin-tile" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    <p><strong className="admin-attention-count">{value}</strong></p>
    {children}
  </article>
}

/** Each reason the page has words for and the server counted; a code it has no words for is never shown. */
function Breakdown({ label, choices, values }: { label: string; choices: readonly ReasonChoice<string>[]; values: Counts }) {
  const shown = choices.filter(choice => values[choice.code] !== undefined)
  if (!shown.length) return null
  return <ul className="admin-reading-breakdown" aria-label={label}>
    {shown.map(choice => <li key={choice.code}><span>{choice.words}</span><strong>{NUMBER.format(values[choice.code] ?? 0)}</strong></li>)}
  </ul>
}

function Figures({ data }: { data: ReadingQuality }) {
  const n = (value: number) => NUMBER.format(value)
  return <>
    {data.from && data.to && <p className="admin-note">{`Weeks from ${dayText(data.from)} to ${dayText(data.to)}.`}</p>}
    <section className="admin-stack" aria-labelledby="reading-quality-documents">
      <h2 id="reading-quality-documents" className="admin-section-title">Documents checked</h2>
      <div className="admin-tile-grid">
        <Tile id="rq-documents" title="Documents checked and saved" value={n(data.validated)} />
        <Tile id="rq-complete" title="Checks with every page ticked" value={`${n(data.reviewConfirmed)} of ${n(data.validated)}`}>
          <p className="admin-note">Every page was ticked as checked, and every item was looked at.</p>
        </Tile>
        <Tile id="rq-rejected" title="Documents rejected, and why" value={n(data.rejected)}>
          <Breakdown label="Documents rejected, by reason" choices={REJECTION_REASONS} values={data.rejectionReasons} />
        </Tile>
      </div>
    </section>
    <section className="admin-stack" aria-labelledby="reading-quality-items">
      <h2 id="reading-quality-items" className="admin-section-title">Items read from paper</h2>
      <div className="admin-tile-grid">
        <Tile id="rq-kept" title="Items kept as read" value={n(data.decisions.kept_unchanged ?? 0)} />
        <Tile id="rq-misread" title="Items changed because the AI misread the paper" value={reasonCount(data.changeReasons, 'misread')} />
        <Tile id="rq-out-of-date" title="Items changed because the paper was out of date" value={reasonCount(data.changeReasons, 'clinical_update')} />
        <Tile id="rq-removed" title="Items removed, and why" value={n(data.decisions.removed ?? 0)}>
          <Breakdown label="Items removed, by reason" choices={REMOVAL_REASONS} values={data.removalReasons} />
        </Tile>
        <Tile id="rq-missed" title="Items the reading missed" value={n(data.missedItems)} />
      </div>
    </section>
    {(data.heldBack > 0 || data.smallCellsHidden > 0 || data.truncated) && <section className="admin-panel" aria-labelledby="reading-quality-left-out">
      <h2 id="reading-quality-left-out" className="admin-section-title">What these figures leave out</h2>
      {data.heldBack > 0 && <p className="admin-note">Some weeks had too few checks to show without pointing at the people who did them.
        Their figures are left out.</p>}
      {data.smallCellsHidden > 0 && <p className="admin-note">A reason given fewer than 5 times in a week is left out of that week’s
        figures.</p>}
      {data.truncated && <p className="admin-note">There were too many checks to count them all. These figures count only some of them.</p>}
    </section>}
  </>
}

export function ReadingQualityPage() {
  const load = useCallback((signal?: AbortSignal) => learnFrom(adminApi.readingQuality(signal)), [])
  const resource = useResource(load, 'Reading quality could not be loaded.')
  const data = resource.data
  return <Page eyebrow="Operations" title="Reading quality"
    description="How well paper records were read in the last four weeks, from what staff kept, changed, removed and found missing when they checked each reading."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    {resource.loading && data === null ? <p className="admin-state" role="status">Loading reading quality…</p>
      : resource.error ? <div className="admin-state" role="alert"><p className="admin-error">{resource.error}</p>
        <button type="button" className="admin-secondary" onClick={resource.reload}>Try again</button></div>
        : data === null ? <section className="admin-panel" aria-labelledby="reading-quality-not-yet">
          <h2 id="reading-quality-not-yet">Not available yet</h2>
          <p className="admin-note">Reading quality appears here once the reading service records what staff do when they check paper
            records. Nothing needs doing.</p>
        </section>
          : <>
            {resource.loading && <p className="admin-note" role="status">Refreshing…</p>}
            {data.anyShown || data.heldBack > 0 ? <Figures data={data} />
              : <section className="admin-panel" aria-labelledby="reading-quality-none">
                <h2 id="reading-quality-none">No checks yet</h2>
                <p className="admin-note">No paper reading was checked in these weeks.</p>
              </section>}
          </>}
  </Page>
}
