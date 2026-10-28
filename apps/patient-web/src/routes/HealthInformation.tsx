import { useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { useSession } from '../session'
import { describedBy } from '../authSteps'
import type { ImportedHealthProfile } from '../importedRecords'
import {
  BLOOD_GROUPS, GENOTYPES, HEALTH_FIELDS, HEALTH_TEXT_FIELDS, HEALTH_TEXT_LIMIT, bloodGroupOf, genotypeOf, multiLine, sentText,
  type BloodGroup, type Genotype, type HealthFields, type HealthProfile, type HealthTextField,
} from '../profileParity'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { ItemName } from '../ItemName'
import { useShownOnceServed, type ProfileResource } from './ProfileCoverage'

/** What each health field is called, as hid-1.0's biodata named them; the sixth is its "Medical notes for my care team". */
export const HEALTH_LABELS: Readonly<Record<keyof HealthFields, string>> = {
  bloodGroup: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', currentMedications: 'Current medications',
  chronicConditions: 'Chronic conditions', medicalNotes: 'Medical notes for my care team',
}

const TEXT_HINTS: Readonly<Record<HealthTextField, string>> = {
  allergies: 'Medicines, foods or anything else you react to, and how.',
  currentMedications: 'What you take now, with the dose if you know it.',
  chronicConditions: 'Long-term conditions such as diabetes, hypertension, asthma or sickle cell disease.',
  medicalNotes: 'Anything else you want the people caring for you to know.',
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

/** Whether the patient has entered nothing here yet. */
export const nothingEntered = (saved: HealthFields): boolean => HEALTH_FIELDS.every(field => saved[field] === null)

const sameFields = (a: HealthFields, b: HealthFields) => HEALTH_FIELDS.every(field => a[field] === b[field])

/** Where the form starts: what the patient saved, or, while they have saved nothing, what they kept in hid-1.0. */
const startOf = (saved: HealthProfile, fromHid1: ImportedHealthProfile | null): Draft =>
  nothingEntered(saved) && fromHid1 ? draftFromImported(fromHid1) : draftOf(saved)

const CONFLICT = 'Your health information was changed somewhere else (in another window, perhaps), so this was not saved. '
  + 'The latest is shown now: make your change again.'

function savedOn(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/**
 * "Health information" on the profile (hid-1.0 parity B3, the owner's decision of 2026-10-28): blood group, genotype,
 * allergies, current medications, chronic conditions and medical notes, as the patient states them. It is kept in EHR
 * apart from what clinicians record; a clinician with access sees it marked "Reported by the patient". When the
 * patient has entered nothing yet, the form starts from the details they kept in hid-1.0, which they save to keep
 * here. Not shown where EHR does not serve it (404).
 */
export function HealthInformationCard({ resource, fromHid1 }: {
  resource: ProfileResource<HealthProfile | null>
  /** The patient's hid-1.0 health details (Novu's records answer), or null. */
  fromHid1: ImportedHealthProfile | null
}) {
  return useShownOnceServed(resource) ? <HealthInformationForm resource={resource} fromHid1={fromHid1} /> : null
}

function HealthInformationForm({ resource, fromHid1 }: { resource: ProfileResource<HealthProfile | null>; fromHid1: ImportedHealthProfile | null }) {
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

  const changed = saved !== null && draft !== null && !sameFields(fieldsOf(draft), saved)
  const seeded = saved !== null && nothingEntered(saved) && fromHid1 !== null
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft(current => current ? { ...current, [field]: value } : current)
    setNotice(null)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!saved || !draft || busy || !changed) return
    setBusy(true); setError(null); setNotice(null)
    try {
      resource.replace(await api.saveHealthProfile({ ...fieldsOf(draft), expectedVersion: saved.rowVersion }))
      setNotice('Your health information was saved.')
      focusAfter(() => heading.current)
    } catch (cause) {
      if (isHidApiError(cause) && cause.code === 'VERSION_CONFLICT') {
        setError(CONFLICT)
        await resource.reload()
        focusAfter(() => heading.current)
        return
      }
      setError(isHidApiError(cause) ? cause.message : 'Your health information could not be saved. Try again.')
      focusAfter(() => document.getElementById('health-bloodGroup'))
    } finally { setBusy(false) }
  }

  const when = savedOn(saved?.updatedAt ?? null)
  return <div className="patient-card" id="health-information" aria-busy={resource.loading || undefined}>
    <h2 ref={heading} tabIndex={-1}>Health information</h2>
    <p id="health-hint" className="patient-field-hint">What you tell the people caring for you about your health. Clinicians with
      access to your record see it marked as reported by you; it does not change what they record.</p>
    {resource.error && <div role="alert"><p>{resource.error}</p>
      <button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(resource.reload)}>Try again <ItemName>loading your health information</ItemName></button></div>}
    {seeded && <p className="patient-field-hint">We started this from the health details you kept in hid-1.0. Check them, then save
      to keep them here.</p>}
    {when && <p className="patient-field-hint">Last saved {when}.</p>}
    {error && <p id="health-error" role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    {saved && draft && <form className="patient-form" onSubmit={event => void save(event)}>
      <div className="patient-health-selects">
        <label>{HEALTH_LABELS.bloodGroup}<select id="health-bloodGroup" value={draft.bloodGroup}
          onChange={event => set('bloodGroup', event.target.value as Draft['bloodGroup'])} aria-describedby={describedBy(error && 'health-error')}>
          <option value="">Not stated</option>
          {BLOOD_GROUPS.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>{HEALTH_LABELS.genotype}<select id="health-genotype" value={draft.genotype}
          onChange={event => set('genotype', event.target.value as Draft['genotype'])}>
          <option value="">Not stated</option>
          {GENOTYPES.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
      </div>
      {HEALTH_TEXT_FIELDS.map(field => <div key={field} className="patient-field">
        <label>{HEALTH_LABELS[field]}<textarea id={`health-${field}`} rows={3} maxLength={HEALTH_TEXT_LIMIT} value={draft[field]}
          onChange={event => set(field, multiLine(event.target.value).slice(0, HEALTH_TEXT_LIMIT))}
          aria-describedby={`health-${field}-hint`} /></label>
        <p id={`health-${field}-hint`} className="patient-field-hint">{TEXT_HINTS[field]} At most {HEALTH_TEXT_LIMIT.toLocaleString('en-NG')} characters.</p>
      </div>)}
      <button type="submit" className="patient-primary-button" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save health information'}</button>
    </form>}
  </div>
}
