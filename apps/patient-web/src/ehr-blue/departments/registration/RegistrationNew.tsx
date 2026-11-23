import type { FormEvent, ReactNode } from 'react'
import { EhrButton, EhrField, EhrInput, EhrSelect, EhrSkeleton } from '@hid/ui/ehr'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DESK_PREFIX, FIELD, START_HEADING, type Availability } from './registrationModel'
import { ErrorBox, UnavailableAction, type FormProblems } from './registrationParts'
import { NIN_STILL_CHECKING } from '../../../ninCheck'
import { DeskFields } from '../../collected/DeskFields'
import {
  BACK_TO_LIST, CAPABILITY_FAILED_TITLE, CAPABILITY_LOADING, CHECKING, DISTINCT_PERSON, DOB_LABEL,
  FIRST_LABEL, GENDER_LABEL, GENDER_OPTIONS, LAST_LABEL, NEW_TITLE, NIN_LABEL, NIN_NOT_ENABLED, NIN_OFF_FORM_NOTICE, NIN_OFF_TITLE, NO_OVERRIDE,
  START_TEXT, START_TITLE, TRY_AGAIN, VERIFY, VERIFYING, WITHOUT_NIN_TITLE,
} from './registrationText'
import { RegistrationWithoutNin } from './RegistrationWithoutNin'
import { offersWithoutNin, withoutNinReasons } from './withoutNin'

/** A required field's label, as the design marks it: the star is not read out (the control is required). */
function required(label: string): ReactNode {
  return <>{label}<span aria-hidden="true"> *</span></>
}

/**
 * The design's create form ("New patients", 02-new and 03-new-patient-validation) as classic's "Check their NIN"
 * (Registration.tsx 232-257): classic's fields, checks and words, and the design's phone, address and existing Health
 * ID as required fields (hid-system 0114, DeskFields). The design's allergies and "provisional local identity" are not
 * asked (owner decisions D11, D12). With NIN checks off, the form says so in classic's words and nothing can be sent.
 */
export function RegistrationNew({ availability, busy, problems, error, onInput, onSubmit, onBack, inDrawer = false, stillChecking = false, held = false,
  without }: {
  /** In the side drawer over the list: the drawer's own X closes it, so no Back to list. */
  readonly inDrawer?: boolean
  readonly availability: Availability
  readonly busy: boolean
  readonly problems: FormProblems
  /** What the last verification's refusal said. */
  readonly error: string
  /** The NIN check has been waiting a few seconds: the form says it is still checking. */
  readonly stillChecking?: boolean
  /** Identity holds this NIN for now: the error says until when, and Verify is off until then. */
  readonly held?: boolean
  /** Any change to the form: the next verification gets a new Idempotency-Key. */
  readonly onInput: () => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly onBack: () => void
  /**
   * Register without a NIN (hid-system 0130): shown in place of the NIN form while NIN checks are off and Identity
   * takes a registration without one. Its own refusals, error and submit.
   */
  readonly without?: {
    readonly problems: FormProblems
    readonly error: string
    readonly onInput: () => void
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  }
}) {
  const { capabilities } = availability
  const enabled = capabilities?.nin.enabled === true
  const withoutNin = without && offersWithoutNin(capabilities) ? without : null
  return (
    <DeptPage title={NEW_TITLE} className="hid-ehr-dept-registration-page" primaryAction={inDrawer ? undefined : (
      // Unavailable while the NIN is verified, so its answer (a refusal to correct, or the case made) is not lost.
      <EhrButton variant="secondary" className="hid-ehr-dept-registration-unavailable" aria-disabled={busy || undefined}
        onClick={() => { if (!busy) onBack() }}>{BACK_TO_LIST}</EhrButton>
    )}>
      <DeptSection title={withoutNin ? WITHOUT_NIN_TITLE : START_TITLE} headingId={START_HEADING}>
        {capabilities === null ? (
          availability.answered ? (
            // A read that failed, under classic's title, and Try again, which stays where it is while it reads again
            // (classic's button keeps its focus, Registration.tsx 228): the design's skeleton stands in meanwhile.
            <div className="hid-ehr-dept-registration-retry">
              {availability.error
                ? <DeptNotice role="alert" tone="critical" title={CAPABILITY_FAILED_TITLE}>{availability.error}</DeptNotice>
                : <EhrSkeleton label={CAPABILITY_LOADING} />}
              <EhrButton variant="secondary" size="sm" busy={availability.loading} onClick={availability.refresh}>
                {availability.loading ? CHECKING : TRY_AGAIN}
              </EhrButton>
            </div>
          ) : <EhrSkeleton label={CAPABILITY_LOADING} />
        ) : withoutNin ? (
          <>
            {/* NIN checks are off: the desk is told so, and registers the patient without a NIN instead of stopping. */}
            <DeptNotice tone="caution">{NIN_OFF_FORM_NOTICE}</DeptNotice>
            <RegistrationWithoutNin reasons={withoutNinReasons(capabilities)} busy={busy} problems={withoutNin.problems}
              error={withoutNin.error} onInput={withoutNin.onInput} onSubmit={withoutNin.onSubmit} />
          </>
        ) : (
          <form className="hid-ehr-dept-form" noValidate onInput={onInput} onSubmit={onSubmit}>
            {enabled ? null : <DeptNotice tone="caution" title={NIN_OFF_TITLE}>{NIN_NOT_ENABLED}</DeptNotice>}
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
                <EhrField label={GENDER_LABEL} controlId={FIELD.gender}>
                  <EhrSelect name="gender">
                    {GENDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </EhrSelect>
                </EhrField>
                <DeskFields prefix={DESK_PREFIX} readOnly={busy} error={problems.error} fullClassName="hid-ehr-dept-full" />
              </div>
              {/* Where the design says how its duplicate review works: what today says the NIN goes through. */}
              <p className="hid-ehr-dept-registration-lead">{START_TEXT}</p>
              <ErrorBox message={error} />
              {/* Kept mounted, so the line is a change of a live region, not a new one. */}
              <div role="status">{stillChecking ? <p className="hid-ehr-dept-registration-lead">{NIN_STILL_CHECKING}</p> : null}</div>
              <div className="hid-ehr-dept-registration-footer">
                <EhrButton type="submit" busy={busy} disabled={held}>{busy ? VERIFYING : VERIFY}</EhrButton>
              </div>
            </fieldset>
          </form>
        )}
        <UnavailableAction label={DISTINCT_PERSON} reason={NO_OVERRIDE} variant="secondary" />
      </DeptSection>
    </DeptPage>
  )
}
