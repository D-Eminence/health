import type { FormEvent, ReactNode } from 'react'
import { EhrButton, EhrField, EhrInput, EhrSelect, EhrSkeleton } from '@hid/ui/ehr'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { FIELD, START_HEADING, type Availability } from './registrationModel'
import { ErrorBox, NotCollectedCheck, NotCollectedField, UnavailableAction, type FormProblems } from './registrationParts'
import {
  ADDRESS_LABEL, ALLERGIES_LABEL, BACK_TO_LIST, CAPABILITY_LOADING, CHECK_AGAIN, CHECKING, DISTINCT_PERSON, DOB_LABEL, EXISTING_HID_LABEL,
  FIRST_LABEL, GENDER_LABEL, GENDER_OPTIONS, LAST_LABEL, NEW_TITLE, NIN_LABEL, ninNotEnabledText, NO_OVERRIDE, PHONE_LABEL, START_TEXT,
  START_TITLE, VERIFY, VERIFYING,
} from './registrationText'

/** A required field's label, as the design marks it: the star is not read out (the control is required). */
function required(label: string): ReactNode {
  return <>{label}<span aria-hidden="true"> *</span></>
}

/**
 * The design's create form ("New patients", 02-new and 03-new-patient-validation) as today's "Start with verified
 * identity" (Registration.tsx 229-239): today's fields, checks and words where Health ID takes them; the design's other
 * fields shown, disabled, "Not collected by Health ID yet". Without NIN verification enabled, the form says so in
 * today's words and nothing can be sent.
 */
export function RegistrationNew({ availability, busy, problems, error, onInput, onSubmit, onBack }: {
  readonly availability: Availability
  readonly busy: boolean
  readonly problems: FormProblems
  /** What the last verification's refusal said. */
  readonly error: string
  /** Any change to the form: the next verification gets a new Idempotency-Key. */
  readonly onInput: () => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly onBack: () => void
}) {
  const { capabilities } = availability
  const enabled = capabilities?.nin.enabled === true
  return (
    <DeptPage title={NEW_TITLE} className="hid-ehr-dept-registration-page" primaryAction={(
      // Unavailable while the NIN is verified, so its answer (a refusal to correct, or the case made) is not lost.
      <EhrButton variant="secondary" className="hid-ehr-dept-registration-unavailable" aria-disabled={busy || undefined}
        onClick={() => { if (!busy) onBack() }}>{BACK_TO_LIST}</EhrButton>
    )}>
      <DeptSection title={START_TITLE} headingId={START_HEADING}>
        {capabilities === null ? (
          availability.answered ? (
            // A read that failed, and Check again, which stays where it is while it reads again (today's button keeps
            // its focus, Registration.tsx 221): the design's skeleton stands in for the error box meanwhile.
            <div className="hid-ehr-dept-registration-retry">
              {availability.error ? <ErrorBox message={availability.error} /> : <EhrSkeleton label={CAPABILITY_LOADING} />}
              <EhrButton variant="secondary" size="sm" busy={availability.loading} onClick={availability.refresh}>
                {availability.loading ? CHECKING : CHECK_AGAIN}
              </EhrButton>
            </div>
          ) : <EhrSkeleton label={CAPABILITY_LOADING} />
        ) : (
          <form className="hid-ehr-dept-form" noValidate onInput={onInput} onSubmit={onSubmit}>
            {enabled ? null : <DeptNotice tone="caution">{ninNotEnabledText(capabilities.nin.state)}</DeptNotice>}
            {/* Disabled only while verification is off. While the NIN is verified the fields are read-only, not
                disabled, which would take focus from the button (Registration.tsx 231). */}
            <fieldset className="hid-ehr-dept-registration-fieldset" disabled={!enabled}>
              <div className="hid-ehr-dept-form-grid">
                <EhrField label={required(NIN_LABEL)} controlId={FIELD.nin} error={problems.error(FIELD.nin)}>
                  <EhrInput name="nin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{11}" minLength={11} maxLength={11}
                    readOnly={busy} required />
                </EhrField>
                <EhrField label={required(DOB_LABEL)} controlId={FIELD.dob} error={problems.error(FIELD.dob)}>
                  <EhrInput name="dateOfBirth" type="date" readOnly={busy} required />
                </EhrField>
                <EhrField label={required(FIRST_LABEL)} controlId={FIELD.first} error={problems.error(FIELD.first)}>
                  <EhrInput name="firstName" maxLength={100} autoComplete="off" readOnly={busy} required />
                </EhrField>
                <EhrField label={required(LAST_LABEL)} controlId={FIELD.last} error={problems.error(FIELD.last)}>
                  <EhrInput name="lastName" maxLength={100} autoComplete="off" readOnly={busy} required />
                </EhrField>
                <NotCollectedField label={PHONE_LABEL} />
                <EhrField label={GENDER_LABEL} controlId={FIELD.gender}>
                  <EhrSelect name="gender">
                    {GENDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </EhrSelect>
                </EhrField>
                <NotCollectedField label={ADDRESS_LABEL} />
                <NotCollectedField label={ALLERGIES_LABEL} multiline className="hid-ehr-dept-full" />
                <NotCollectedCheck />
                <NotCollectedField label={EXISTING_HID_LABEL} />
              </div>
              {/* Where the design says how its duplicate review works: what today says the NIN goes through. */}
              <p className="hid-ehr-dept-registration-lead">{START_TEXT}</p>
              <ErrorBox message={error} />
              <div className="hid-ehr-dept-registration-footer">
                <EhrButton type="submit" busy={busy}>{busy ? VERIFYING : VERIFY}</EhrButton>
              </div>
            </fieldset>
          </form>
        )}
        <UnavailableAction label={DISTINCT_PERSON} reason={NO_OVERRIDE} variant="primary" />
      </DeptSection>
    </DeptPage>
  )
}
