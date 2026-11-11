import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { EhrButton, EhrCard, EhrField, EhrInput } from '@hid/ui/ehr'
import type { Facility, FacilityProfileRead } from '../../staff/api'
import { selfServiceReview } from '../../staff/staffAccess'
import {
  ALL_PROFILE_FIELDS, emptyProfileForm, profileForm, profileProblems, profileValues,
  type FacilityProfileForm, type ProfileField,
} from '../collected/facilityProfile'
import { profileControlId, ProfileFields } from '../collected/ProfileFields'
import type { FacilityProfileHandle } from './facilityProfileState'
import {
  CONTINUE_UNSAVED, facilityCheckDone, facilityCheckPending, PROFILE_CONFLICT, PROFILE_FAILED, PROFILE_KEPT, PROFILE_LOADING,
  PROFILE_NOT_SAVED,
} from './setupText'

const PREFIX = 'hid-ehr-onboarding-profile'

/**
 * Step 1, Facility (screens 14): the facility's registered name as Health ID has it (from its CAC record, read-only)
 * and its details (hid-system 0122), read from Identity and saved there by "Save and continue", every field required.
 * Where Identity keeps the details itself (a facility Health ID support manages, a demo facility) they are not shown,
 * and Continue goes on. While the details are read there is nothing to press; after a failed read the step says the
 * details are not saved, offers Try again first, and only then lets the administrator go on without them. The logo waits for the document store and its virus scanner and is not asked for. Where the
 * design says how the hospital's review stands, today's Facility check says it.
 */
export function FacilityStep({ facility, profile, onNext }: {
  readonly facility: Facility
  readonly profile: FacilityProfileHandle
  readonly onNext: () => void
}) {
  const review = selfServiceReview(facility)
  const { state } = profile
  return (
    <EhrCard>
      <div className="hid-ehr-onboarding-stack">
        {state.status === 'ready' ? <ProfileForm key={state.read.version} facility={facility} read={state.read}
          profile={profile} onNext={onNext} /> : (
          <form noValidate aria-label="Facility" className="hid-ehr-onboarding-grid" onSubmit={event => { event.preventDefault(); onNext() }}>
            <RegisteredName facility={facility} />
            <div className="hid-ehr-onboarding-full">
              {state.status === 'loading' ? <p role="status" className="hid-ehr-onboarding-text">{PROFILE_LOADING}</p> : null}
              {state.status === 'kept' ? <p className="hid-ehr-onboarding-text">{PROFILE_KEPT}</p> : null}
              {state.status === 'failed' ? <div role="alert" className="hid-ehr-onboarding-blocker">
                <p>{PROFILE_FAILED}</p>
                <p>{PROFILE_NOT_SAVED}</p>
              </div> : null}
            </div>
            {/* Continue only where there is nothing to give here (support keeps the details), or, after a failed read, once
                the step has said plainly that the details are not saved. Nothing to press while they are still read. */}
            {state.status === 'kept' ? <div className="hid-ehr-onboarding-full"><EhrButton type="submit">Continue</EhrButton></div> : null}
            {state.status === 'failed' ? <div className="hid-ehr-onboarding-full hid-ehr-onboarding-actions">
              <EhrButton onClick={profile.reload}>Try again</EhrButton>
              <EhrButton type="submit" variant="secondary">{CONTINUE_UNSAVED}</EhrButton>
            </div> : null}
          </form>
        )}
        {review === 'pending' ? <p className="hid-ehr-onboarding-text">{facilityCheckPending(facility.name)}</p> : null}
        {review === 'reviewed' ? <p className="hid-ehr-onboarding-text">{facilityCheckDone(facility.name)}</p> : null}
      </div>
    </EhrCard>
  )
}

function RegisteredName({ facility }: { readonly facility: Facility }) {
  return (
    <EhrField label="Registered name" hint="From your CAC record. Health ID support can correct it.">
      <EhrInput readOnly value={facility.name} />
    </EhrField>
  )
}

function ProfileForm({ facility, read, profile, onNext }: {
  readonly facility: Facility
  readonly read: FacilityProfileRead
  readonly profile: FacilityProfileHandle
  readonly onNext: () => void
}) {
  const [form, setForm] = useState<FacilityProfileForm>(() => (read.profile ? profileForm(read.profile) : emptyProfileForm()))
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [focusId, setFocusId] = useState<{ id: string } | null>(null)
  // One key per save the user makes, reused only to retry that same save after an answer that was lost.
  const key = useRef<{ body: string; key: string } | null>(null)
  useLayoutEffect(() => { if (focusId) document.getElementById(focusId.id)?.focus() }, [focusId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = profileProblems(form)
    setErrors(Object.fromEntries(found))
    setMessage('')
    const first = found[0]
    if (first) { setFocusId({ id: profileControlId(PREFIX, first[0]) }); return }
    const values = profileValues(form)
    const body = JSON.stringify([read.version, values])
    if (key.current?.body !== body) key.current = { body, key: crypto.randomUUID() }
    setBusy(true)
    const outcome = await profile.save(values, key.current.key)
    setBusy(false)
    if (outcome === 'saved' || outcome === 'kept') { key.current = null; onNext(); return }
    if (outcome === 'conflict') { key.current = null; return }
    setMessage(outcome.error)
  }

  return (
    <>
      {profile.conflict ? <p role="alert" className="hid-ehr-onboarding-blocker">{PROFILE_CONFLICT}</p> : null}
      <form noValidate aria-label="Facility" className="hid-ehr-onboarding-grid" onSubmit={event => void submit(event)}>
        <RegisteredName facility={facility} />
        <ProfileFields form={form} fields={ALL_PROFILE_FIELDS} errors={errors} prefix={PREFIX}
          fullClassName="hid-ehr-onboarding-full" readOnly={busy}
          onChange={(field, value) => { setForm(current => ({ ...current, [field]: value })); setMessage('') }} />
        {message ? <p role="alert" className="hid-ehr-onboarding-full hid-ehr-onboarding-blocker">{message}</p> : null}
        <div className="hid-ehr-onboarding-full">
          <EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : 'Save and continue'}</EhrButton>
        </div>
      </form>
    </>
  )
}
