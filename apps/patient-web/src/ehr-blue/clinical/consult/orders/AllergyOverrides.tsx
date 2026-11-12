import type {
  AcknowledgementStage, PrescriptionAllergyAcknowledgement, PrescriptionAllergyAcknowledgements, RecordedAllergy,
} from '../../../../staff/allergies'
import type { Actor } from '../../../../staff/api'
import type { Chart } from '../../parts/chart'
import { formatWhen } from '../../parts/format'
import { ClinicalIcon } from '../../parts/icons'
import { recordedAllergyLine, useAllergies, type AllergiesState } from '../../patients/AllergiesCard'

/**
 * The reasons given on this prescription to go ahead over an allergy warning (hid-system#218 at 7fbb04aa: the
 * prescription's allergyAcknowledgements), shown on its page above the actions, oldest first as the EHR serves them:
 * when, at which step, who, the reason in the prescriber's own words, and what it covered. The EHR may let Activate,
 * Resume, a send to another facility or Send to Pharmacy go ahead with no new warning when a reason here covers the
 * allergies, so whoever presses sees it.
 *
 * Shown only when there is one: `[]` is "none". An EHR before 7fbb04aa does not say: the page then says plainly that
 * this can't be shown (OVERRIDES_NOT_SHOWN), never that there is none. Read only: nothing here writes, and the reason
 * is never kept.
 */

const TITLE_ID = 'order-allergy-overrides-title'

/**
 * Where the reasons would be, when the prescription's allergyAcknowledgements is there but can't be read: the page then
 * says it can't be shown, never that there is none. A prescription read with no allergyAcknowledgements at all comes
 * from an EHR without the allergy check (before hid-system#218), where no warning can have been overridden, so the
 * page says nothing about overrides there: this website goes live before that backend does.
 */
export const OVERRIDES_NOT_SHOWN = 'Whether an allergy warning was overridden on this prescription can’t be shown here.'

/**
 * The step the reason was given at, as the prescriber knows it: `send` is "Send to a pharmacy" (another facility's),
 * `handoff` is "Send to Pharmacy" (this facility's own).
 */
export const STAGE_WORDS: Readonly<Record<AcknowledgementStage, string>> = {
  create: 'when it was prescribed',
  activate: 'when it was activated',
  resume: 'when it was resumed',
  send: 'when it was sent to a pharmacy',
  handoff: 'when it was sent to this facility’s Pharmacy',
}

/**
 * Who gave it: the member signed in, or anyone else (the EHR gives ids, never a name, and serves only this facility's).
 * "You" is said only when the reason's membership (createdByMembershipId) is the signed-in member's membership at the
 * chart's facility: the reason's createdBy is an account id, and the session's actor.id is the sign-in's subject, so
 * those two are never compared.
 */
export const BY_YOU = 'you'
export const BY_A_CLINICIAN = 'a clinician at this facility'

/** The signed-in member's membership at this facility, from the session's facilities; null when it has none there. */
export function membershipAt(actor: Pick<Actor, 'facilities' | 'facility'> | null, facilityId: string): string | null {
  if (!actor) return null
  const membershipId = actor.facilities.find(facility => facility.id === facilityId)?.membershipId
    ?? (actor.facility?.id === facilityId ? actor.facility.membershipId : undefined)
  return membershipId?.trim() ? membershipId : null
}

export function overridesTitle(count: number): string {
  return count === 1 ? 'Allergy warning overridden' : 'Allergy warnings overridden'
}

/** "By you on 10 Nov 2026, 10:00, when it was prescribed." */
export function overrideLine(item: PrescriptionAllergyAcknowledgement, membershipId: string | null): string {
  const who = membershipId !== null && item.createdByMembershipId === membershipId ? BY_YOU : BY_A_CLINICIAN
  const when = formatWhen(item.createdAt)
  return `By ${who}${when ? ` on ${when}` : ''}${item.stage ? `, ${STAGE_WORDS[item.stage]}` : ''}.`
}

/** The reason as written, quoted: text only (React never reads it as markup), its own line breaks kept. */
export function reasonLine(reason: string): string {
  return `Reason given: “${reason}”.`
}

const allergies = (count: number) => count === 1 ? 'allergy' : 'allergies'

/**
 * The recorded allergies a reason covered, named from the patient's allergy list (the active ones, every facility's):
 * "Recorded allergies it covered: Penicillin (severe: Anaphylaxis); 1 more recorded allergy no longer on the patient’s
 * list (it may have been marked entered in error)." Only an allergy the list itself says was entered in error is said to
 * be; an id missing from the list is said to be missing, since it may also be an entry the page could not read or one
 * past the list's 200. Where the list can't be read, the count only, and why the names are missing; never a name
 * guessed.
 */
export function coveredLine(ids: readonly string[], state: AllergiesState): string {
  const head = `Recorded ${allergies(ids.length)} it covered: `
  if (state.status === 'loading') return `${head}${ids.length}.`
  if (state.status === 'hidden' || (state.status === 'shown' && !state.recordedOffered)) return `${head}${ids.length} (their names can’t be shown here).`
  if (state.status === 'failed') return `${head}${ids.length} (their names could not be loaded).`
  const byId = new Map<string, RecordedAllergy>(state.recorded.map(item => [item.id, item]))
  const named: string[] = []
  let gone = 0
  for (const id of ids) {
    const item = byId.get(id)
    if (!item) gone += 1
    else named.push(item.status === 'active' ? recordedAllergyLine(item) : `${recordedAllergyLine(item)}, since marked entered in error`)
  }
  if (gone > 0) {
    const missing = `no longer on the patient’s list (${gone === 1 ? 'it' : 'they'} may have been marked entered in error)`
    named.push(named.length > 0 ? `${gone} more recorded ${allergies(gone)} ${missing}` : `${gone === 1 ? 'one' : gone} ${missing}`)
  }
  return `${head}${named.join('; ')}.`
}

/** What the patient wrote that it covered, labelled as the patient's own words (lower case, as the EHR matched them). */
export function patientWordsLine(terms: readonly string[]): string {
  return terms.length > 0
    ? `The patient’s own words it covered, from their Health ID portal: ${terms.map(term => `“${term}”`).join(', ')}.`
    : 'It covered allergies the patient entered in their Health ID portal.'
}

/**
 * The stored reasons that could not be read: "1 more allergy warning override can’t be shown here." after those shown;
 * with none shown, "An allergy warning override on this prescription can’t be shown here."
 */
export function unreadLine(count: number, anyShown: boolean): string {
  const overrides = count === 1 ? 'override' : 'overrides'
  if (anyShown) return `${count} more allergy warning ${overrides} can’t be shown here.`
  return `${count === 1 ? 'An' : count} allergy warning ${overrides} on this prescription can’t be shown here.`
}

export function AllergyOverrides({ chart, overrides, membershipId }: {
  chart: Chart
  overrides: PrescriptionAllergyAcknowledgements
  /** The signed-in member's membership at this facility (membershipAt), said as "you". */
  membershipId: string | null
}) {
  const ids = [...new Set(overrides.items.flatMap(item => item.matchedRecordedAllergyIds))]
  // The allergy list is read only when there is an allergy to name, and afresh whenever the allergies to name change
  // (a reason given since on this page may cover an allergy recorded since the list was read).
  return ids.length > 0
    ? <NamedOverrides key={ids.join(',')} chart={chart} overrides={overrides} membershipId={membershipId} />
    : <OverrideList overrides={overrides} membershipId={membershipId} allergies={null} />
}

function NamedOverrides({ chart, overrides, membershipId }: { chart: Chart; overrides: PrescriptionAllergyAcknowledgements; membershipId: string | null }) {
  const { state } = useAllergies(chart)
  return <OverrideList overrides={overrides} membershipId={membershipId} allergies={state} />
}

function OverrideList({ overrides, membershipId, allergies: state }: {
  overrides: PrescriptionAllergyAcknowledgements
  membershipId: string | null
  allergies: AllergiesState | null
}) {
  const count = overrides.items.length + overrides.unread
  return (
    <section aria-labelledby={TITLE_ID} className="hid-ehr-clinical-allergy-warning hid-ehr-clinical-allergy-override">
      <h3 id={TITLE_ID} className="hid-ehr-clinical-allergy-warning-title">
        <ClinicalIcon name="alert" size={18} />
        <span>{overridesTitle(count)}</span>
      </h3>
      {overrides.items.length > 0 ? (
        <ul className="hid-ehr-clinical-allergy-warning-lines">
          {overrides.items.map(item => (
            <li key={item.id}>
              <p>{overrideLine(item, membershipId)}</p>
              <p className="hid-ehr-clinical-allergy-override-reason">{reasonLine(item.reason)}</p>
              {state && item.matchedRecordedAllergyIds.length > 0 ? <p>{coveredLine(item.matchedRecordedAllergyIds, state)}</p> : null}
              {item.patientReportedMatched ? <p>{patientWordsLine(item.patientReportedTerms)}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {overrides.unread > 0 ? <p>{unreadLine(overrides.unread, overrides.items.length > 0)}</p> : null}
      {state?.status === 'failed' ? (
        <p><button type="button" className="hid-ehr-clinical-link hid-ehr-clinical-link-button" onClick={state.retry}>Try again</button></p>
      ) : null}
    </section>
  )
}
