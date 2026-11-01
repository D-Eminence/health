import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { useSession } from '../session'
import { describedBy } from '../authSteps'
import type { ImportedHealthProfile } from '../importedRecords'
import {
  BLOOD_GROUPS, EDGE_BODY_MAX_BYTES, GENOTYPES, HEALTH_FIELDS, HEALTH_TEXT_FIELDS, HEALTH_TEXT_LIMIT, bloodGroupOf, genotypeOf,
  jsonBodyBytes, multiLine, sentText, type BloodGroup, type Genotype, type HealthFields, type HealthProfile, type HealthTextField,
} from '../profileParity'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { ItemName } from '../ItemName'
import { useShownOnceServed, type ProfileResource } from './ProfileCoverage'
import { ProfileSection } from './ProfileSection'
import { Button, Field, Select, Textarea } from '../kasuwa/ui'
import { Hint, LoadProblem, Problem, Saved } from './profileParts'

/** What each health field is called, as hid-1.0's biodata named them; the sixth is its "Medical notes for my care team". */
export const HEALTH_LABELS: Readonly<Record<keyof HealthFields, string>> = {
  bloodGroup: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', currentMedications: 'Current medications',
  chronicConditions: 'Long-term conditions', medicalNotes: 'Notes for my doctors',
}

const TEXT_HINTS: Readonly<Record<HealthTextField, string>> = {
  allergies: 'Medicines, foods or other things you react to, and what happens.',
  currentMedications: 'Medicines you take now, with the dose if you know it.',
  chronicConditions: 'Like diabetes, high blood pressure, asthma or sickle cell.',
  medicalNotes: 'Anything else your doctors and nurses should know.',
}

interface Draft {
  bloodGroup: BloodGroup | ''
  genotype: Genotype | ''
  allergies: string
  currentMedications: string
  chronicConditions: string
  medicalNotes: string
}

const draftOf = (saved: HealthFields): Draft => ({
  bloodGroup: saved.bloodGroup ?? '', genotype: saved.genotype ?? '', allergies: saved.allergies ?? '',
  currentMedications: saved.currentMedications ?? '', chronicConditions: saved.chronicConditions ?? '', medicalNotes: saved.medicalNotes ?? '',
})

const imported = (text: string | undefined) => multiLine(text ?? '').slice(0, HEALTH_TEXT_LIMIT)

/** A first draft from what the patient kept in hid-1.0 (free text there): a blood group or genotype only when it is one of the choices. */
export function draftFromImported(profile: ImportedHealthProfile): Draft {
  const content = profile.content
  return {
    bloodGroup: bloodGroupOf(content.blood_group) ?? '', genotype: genotypeOf(content.genotype) ?? '',
    allergies: imported(content.allergies), currentMedications: imported(content.current_medications),
    chronicConditions: imported(content.chronic_conditions), medicalNotes: imported(content.medical_notes),
  }
}

/** What is sent: each text trimmed, and null for anything left empty. */
const fieldsOf = (draft: Draft): HealthFields => ({
  bloodGroup: draft.bloodGroup || null, genotype: draft.genotype || null, allergies: sentText(draft.allergies),
  currentMedications: sentText(draft.currentMedications), chronicConditions: sentText(draft.chronicConditions),
  medicalNotes: sentText(draft.medicalNotes),
})

/**
 * Whether the patient has never saved health information here: EHR answers rowVersion 0 until the first save. Once
 * saved, even with every field cleared, what is shown is the patient's own.
 */
export const neverSaved = (saved: HealthProfile): boolean => saved.rowVersion === 0

const sameFields = (a: HealthFields, b: HealthFields) => HEALTH_FIELDS.every(field => a[field] === b[field])

/** Where the form starts: what the patient saved, or, until they first save, what they kept in hid-1.0. */
const startOf = (saved: HealthProfile, fromHid1: ImportedHealthProfile | null): Draft =>
  neverSaved(saved) && fromHid1 ? draftFromImported(fromHid1) : draftOf(saved)

const CONFLICT = 'Your health information was changed somewhere else, so this wasn’t saved. '
  + 'The latest is shown now. Make your change again.'
const TOO_LONG = 'This is too long to save. Shorten the longer answers, then save again.'

function savedOn(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/**
 * "Health information" on the profile (hid-1.0 parity B3, the owner's decision of 2026-10-28): blood group, genotype,
 * allergies, current medications, chronic conditions and medical notes, as the patient states them. It is kept in EHR
 * apart from what clinicians record; a clinician with access sees it marked "Reported by the patient". Until the
 * patient first saves here, the form starts from the details they kept in hid-1.0, which they save to keep here. Not
 * shown where EHR does not serve it (404).
 */
export function HealthInformationCard({ resource, fromHid1, contacts }: {
  resource: ProfileResource<HealthProfile | null>
  /** The patient's hid-1.0 health details (Novu's records answer), or null. */
  fromHid1: ImportedHealthProfile | null
  /**
   * The emergency contacts, after the form in the same section (the owner's decision of 2026-10-28). Where the health
   * information is not served (404) they are `alone`, and are the section themselves, or nothing where they are not
   * served either.
   */
  contacts?: (alone: boolean) => ReactNode
}) {
  const shown = useShownOnceServed(resource)
  if (shown) return <HealthInformationForm resource={resource} fromHid1={fromHid1}>{contacts?.(false)}</HealthInformationForm>
  const unserved = resource.data === null && resource.error === null && !resource.loading
  return unserved ? contacts?.(true) ?? null : null
}

function HealthInformationForm({ resource, fromHid1, children }: {
  resource: ProfileResource<HealthProfile | null>; fromHid1: ImportedHealthProfile | null; children?: ReactNode
}) {
  const { api } = useSession()
  const saved = resource.data
  const [draft, setDraft] = useState<Draft | null>(() => saved ? startOf(saved, fromHid1) : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(heading)

  // A new reading, or the hid-1.0 details arriving, starts the form again where it starts, unless the patient has
  // changed it meanwhile and it was not saved somewhere else.
  const [basis, setBasis] = useState({ saved, fromHid1 })
  if (saved !== basis.saved || fromHid1 !== basis.fromHid1) {
    const untouched = draft === null || basis.saved === null || sameFields(fieldsOf(draft), fieldsOf(startOf(basis.saved, basis.fromHid1)))
    setBasis({ saved, fromHid1 })
    if (saved && (untouched || saved.rowVersion !== basis.saved?.rowVersion)) setDraft(startOf(saved, fromHid1))
  }

  const seeded = saved !== null && neverSaved(saved) && fromHid1 !== null
  // A form started from hid-1.0 can be saved as it stands, even emptied: that is how the patient says "none".
  const changed = saved !== null && draft !== null && (seeded || !sameFields(fieldsOf(draft), saved))
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft(current => current ? { ...current, [field]: value } : current)
    setNotice(null)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!saved || !draft || busy || !changed) return
    const body = { ...fieldsOf(draft), expectedVersion: saved.rowVersion }
    // Production's edge refuses a body over 8 KB (EDGE_BODY_MAX_BYTES): long texts in a script of several bytes a
    // character can pass it, so such a save is not sent.
    if (jsonBodyBytes(body) > EDGE_BODY_MAX_BYTES) { setError(TOO_LONG); setNotice(null); return }
    setBusy(true); setError(null); setNotice(null)
    try {
      resource.replace(await api.saveHealthProfile(body))
      setNotice('Health information saved.')
      focusAfter(() => heading.current)
    } catch (cause) {
      if (isHidApiError(cause) && cause.code === 'VERSION_CONFLICT') {
        setError(CONFLICT)
        await resource.reload()
        focusAfter(() => heading.current)
        return
      }
      setError(isHidApiError(cause) ? cause.message : 'Couldn’t save. Try again.')
      focusAfter(() => document.getElementById('health-bloodGroup'))
    } finally { setBusy(false) }
  }

  const when = savedOn(saved?.updatedAt ?? null)
  // A read that failed is said in the heading too: the card's alert is not seen while it is closed.
  return <ProfileSection id="health-information" title="Health information" state={resource.error ? 'Could not load' : when ? `Saved ${when}` : null}
    busy={resource.loading} headingRef={heading}>
    <Hint id="health-hint">{seeded ? 'Filled in from your old Health ID account. Check it, then save to keep it.' : 'Doctors and nurses you share with see that you wrote this.'}</Hint>
    {resource.error && <LoadProblem what="your health information" error={resource.error} buttonRef={retryFocus.button}
      onRetry={() => retryFocus.retry(resource.reload)} name={<ItemName>loading your health information</ItemName>} />}
    <Saved>{notice}</Saved>
    {saved && draft && <form className="flex flex-col gap-4" onSubmit={event => void save(event)}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={HEALTH_LABELS.bloodGroup} htmlFor="health-bloodGroup">
          <Select id="health-bloodGroup" value={draft.bloodGroup}
            onChange={event => set('bloodGroup', event.target.value as Draft['bloodGroup'])} aria-describedby={describedBy(error && 'health-error')}>
            <option value="">Not stated</option>
            {BLOOD_GROUPS.map(value => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
        <Field label={HEALTH_LABELS.genotype} htmlFor="health-genotype">
          <Select id="health-genotype" value={draft.genotype} onChange={event => set('genotype', event.target.value as Draft['genotype'])}>
            <option value="">Not stated</option>
            {GENOTYPES.map(value => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
      </div>
      {HEALTH_TEXT_FIELDS.map(field => <Field key={field} label={HEALTH_LABELS[field]} htmlFor={`health-${field}`} hintId={`health-${field}-hint`} hint={TEXT_HINTS[field]}>
        <Textarea id={`health-${field}`} rows={3} maxLength={HEALTH_TEXT_LIMIT} value={draft[field]}
          onChange={event => set(field, multiLine(event.target.value).slice(0, HEALTH_TEXT_LIMIT))}
          aria-describedby={`health-${field}-hint`} />
      </Field>)}
      {error && <Problem id="health-error">{error}</Problem>}
      <Button type="submit" variant="primary" className="self-start" loading={busy} disabled={busy || !changed}>{busy ? 'Saving…' : 'Save health information'}</Button>
    </form>}
    {children}
  </ProfileSection>
}
