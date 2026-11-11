import { useCallback, type ReactNode } from 'react'
import { adminApi } from './api'
import { isProblem } from './problems'
import { Page, Refresh, useResource } from './ui'
import { learnReadingQualityServed } from '../readingLearningServed'
import {
  CHANGE_REASONS, MISSED_KINDS, READING_QUALITY_DAYS, READING_QUALITY_FIELDS as F, REJECTION_REASONS, REMOVAL_REASONS, type ReasonChoice,
} from '../readingLearningContract'

/*
 * "Reading quality" (Migrate learning, phase 1): how well paper records are read, counted from what staff do when they
 * check a reading (readingLearningContract.ts names the proposed read and its fields). Numbers and plain words only:
 * no item, patient, facility, code or ID is ever shown. Super admins only (platform.dashboard.read, as the overview's
 * activity figures). An Identity without the read answers 404 (said as READING_QUALITY_UNAVAILABLE): the page says it
 * isn't available yet, calmly, and the sidebar stops listing it.
 */

/** A count as the page shows it: a whole number, or null when the backend can't count it yet. */
type Count = number | null

export interface ReadingQuality {
  readonly itemsKept: Count
  readonly itemsChanged: Readonly<Record<string, Count>>
  readonly itemsRemoved: Readonly<Record<string, Count>>
  readonly itemsMissed: Readonly<Record<string, Count>>
  readonly itemsSeen: Count
  readonly itemsShown: Count
  readonly pagesChecked: Count
  readonly pagesTotal: Count
  readonly documentsChecked: Count
  readonly documentsRejected: Readonly<Record<string, Count>>
}

function count(value: unknown): Count {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Each code the page has words for, and its count; a code it doesn't know is left out, never shown. */
function counts(value: unknown, choices: readonly ReasonChoice<string>[]): Record<string, Count> {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return Object.fromEntries(choices.map(choice => [choice.code, count(record[choice.code])]))
}

/** The answer as the page reads it; anything not a count reads as not counted yet. */
export function parseReadingQuality(answer: unknown): ReadingQuality {
  const value = answer && typeof answer === 'object' ? answer as Record<string, unknown> : {}
  return {
    itemsKept: count(value[F.itemsKept]),
    itemsChanged: counts(value[F.itemsChanged], CHANGE_REASONS),
    itemsRemoved: counts(value[F.itemsRemoved], REMOVAL_REASONS),
    itemsMissed: counts(value[F.itemsMissed], MISSED_KINDS),
    itemsSeen: count(value[F.itemsSeen]),
    itemsShown: count(value[F.itemsShown]),
    pagesChecked: count(value[F.pagesChecked]),
    pagesTotal: count(value[F.pagesTotal]),
    documentsChecked: count(value[F.documentsChecked]),
    documentsRejected: counts(value[F.documentsRejected], REJECTION_REASONS),
  }
}

const NUMBER = new Intl.NumberFormat('en-NG')
const shown = (value: Count) => value === null ? 'Not yet' : NUMBER.format(value)
/** The sum of what is counted, or null when nothing is. */
function total(values: Readonly<Record<string, Count>>): Count {
  const known = Object.values(values).filter((value): value is number => value !== null)
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null
}
function outOf(part: Count, whole: Count): string {
  if (part === null) return 'Not yet'
  return whole === null ? NUMBER.format(part) : `${NUMBER.format(part)} of ${NUMBER.format(whole)}`
}

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

function Breakdown({ label, choices, values }: { label: string; choices: readonly ReasonChoice<string>[]; values: Readonly<Record<string, Count>> }) {
  return <ul className="admin-reading-breakdown" aria-label={label}>
    {choices.map(choice => <li key={choice.code}><span>{choice.words}</span><strong>{shown(values[choice.code] ?? null)}</strong></li>)}
  </ul>
}

export function ReadingQualityPage() {
  const load = useCallback((signal?: AbortSignal) => learnFrom(adminApi.readingQuality(signal)), [])
  const resource = useResource(load, 'Reading quality could not be loaded.')
  const data = resource.data
  return <Page eyebrow="Operations" title="Reading quality"
    description={`How well paper records were read in the last ${READING_QUALITY_DAYS} days, from what staff kept, changed, removed and found missing when they checked each reading.`}
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
            <section className="admin-stack" aria-labelledby="reading-quality-items">
              <h2 id="reading-quality-items" className="admin-section-title">Items read from paper</h2>
              <div className="admin-tile-grid">
                <Tile id="rq-kept" title="Items kept as read" value={shown(data.itemsKept)} />
                <Tile id="rq-misread" title="Items changed because the AI misread the paper" value={shown(data.itemsChanged.ai_misread ?? null)} />
                <Tile id="rq-out-of-date" title="Items changed because the paper was out of date" value={shown(data.itemsChanged.paper_out_of_date ?? null)} />
                <Tile id="rq-removed" title="Items removed, and why" value={shown(total(data.itemsRemoved))}>
                  <Breakdown label="Items removed, by reason" choices={REMOVAL_REASONS} values={data.itemsRemoved} />
                </Tile>
                <Tile id="rq-missed" title="Items the reading missed" value={shown(total(data.itemsMissed))}>
                  <Breakdown label="Items the reading missed, by kind" choices={MISSED_KINDS} values={data.itemsMissed} />
                </Tile>
                <Tile id="rq-seen" title="Items staff looked at" value={outOf(data.itemsSeen, data.itemsShown)} />
              </div>
            </section>
            <section className="admin-stack" aria-labelledby="reading-quality-documents">
              <h2 id="reading-quality-documents" className="admin-section-title">Pages and documents</h2>
              <div className="admin-tile-grid">
                <Tile id="rq-pages" title="Pages checked" value={outOf(data.pagesChecked, data.pagesTotal)} />
                <Tile id="rq-documents" title="Documents checked and saved" value={shown(data.documentsChecked)} />
                <Tile id="rq-rejected" title="Documents rejected, and why" value={shown(total(data.documentsRejected))}>
                  <Breakdown label="Documents rejected, by reason" choices={REJECTION_REASONS} values={data.documentsRejected} />
                </Tile>
              </div>
            </section>
          </>}
  </Page>
}
