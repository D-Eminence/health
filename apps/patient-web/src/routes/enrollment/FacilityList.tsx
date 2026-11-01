import { useCallback, useRef } from 'react'
import { buttonClass } from '../../kasuwa/ui'
import { useRetryFocus } from '../actionFocus'
import { usePatientResource } from '../usePatientResource'
import type { PatientApi, ParticipatingFacility } from '../../api'

/** One facility's place, as the public list gives it: no id, no contact. */
const place = (facility: ParticipatingFacility) =>
  [facility.addressLine, facility.town, `${facility.lga} LGA`, `${facility.state} State`].filter(Boolean).join(', ')

/**
 * The participating facilities and what to bring (hid-system #85, ADR-063,
 * GET .../participating-facilities): public, by name and place only, read each
 * time it is shown. Identity's three lines of what to bring are shown as sent.
 * An empty list means the facility route is closed now.
 */
export function FacilityList({ api, titleLevel = 'h3' }: { api: PatientApi; titleLevel?: 'h2' | 'h3' }) {
  const load = useCallback(() => api.participatingFacilities(), [api])
  const list = usePatientResource(load)
  // After Try again, focus goes to the list once it is shown, or to Try again when it failed again.
  const loaded = useRef<HTMLHeadingElement>(null)
  const retryFocus = useRetryFocus(loaded)
  const Title = titleLevel
  if (list.loading && !list.data) return <p role="status" className="m-0 text-[13px] text-ink-3">Loading participating facilities…</p>
  if (list.error || !list.data) return <div className="flex flex-col items-start gap-2 rounded-lg border border-notice-line bg-notice p-3 text-[13.5px] text-danger-ink [&_p]:m-0" role="alert">
    <p>We could not load the list of participating facilities. Try again.</p>
    <button ref={retryFocus.button} type="button" className={buttonClass({ size: 'lg', block: true })} onClick={() => retryFocus.retry(list.reload)}>Try again</button>
  </div>
  const { facilities, whatToBring } = list.data
  return <div className="flex flex-col gap-4">
    <section className="flex flex-col gap-2 rounded-xl bg-subtle p-4 ring-1 ring-line [&_:is(h2,h3)]:m-0 [&_:is(h2,h3)]:text-sm [&_:is(h2,h3)]:font-semibold [&_:is(h2,h3)]:text-ink [&_a]:font-medium [&_a]:text-brand-ink [&_p]:m-0" aria-labelledby="enroll-bring-title">
      <Title id="enroll-bring-title" ref={loaded} tabIndex={-1}>What to bring</Title>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">{whatToBring.map(line => <li key={line}>{line}</li>)}</ul>
    </section>
    <section className="flex flex-col gap-2 rounded-xl bg-subtle p-4 ring-1 ring-line [&_:is(h2,h3)]:m-0 [&_:is(h2,h3)]:text-sm [&_:is(h2,h3)]:font-semibold [&_:is(h2,h3)]:text-ink [&_a]:font-medium [&_a]:text-brand-ink [&_p]:m-0" aria-labelledby="enroll-facilities-title">
      <Title id="enroll-facilities-title">Participating facilities</Title>
      {facilities.length === 0 ? <p>No healthcare facility is taking part right now. Try again later.</p>
        : <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">{facilities.map((facility, index) => <li key={`${index}-${facility.name}`} className="flex flex-col">
          <strong>{facility.name}</strong>
          <span>{place(facility)}</span>
          {facility.hours && <span>Hours: {facility.hours}</span>}
        </li>)}</ul>}
    </section>
  </div>
}
