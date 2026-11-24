import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { EhrButton, EhrField, EhrInput, EhrSelect, EhrSkeleton } from '@hid/ui/ehr'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DESK_PREFIX, FIELD, START_HEADING, type Availability } from './registrationModel'
import { ErrorBox, UnavailableAction, type FormProblems } from './registrationParts'
import { NIN_STILL_CHECKING } from '../../../ninCheck'
import { DeskFields } from '../../collected/DeskFields'
import {
  BACK_TO_LIST, CAPABILITY_FAILED_TITLE, CAPABILITY_LOADING, CHECK_AGAIN, CHECKING, CHOOSE_NIN, CHOOSE_WITHOUT_NIN, CHOOSE_WITHOUT_NIN_TEXT, DISTINCT_PERSON,
  DOB_LABEL, FIRST_LABEL, GENDER_LABEL, GENDER_OPTIONS, LAST_LABEL, NEW_TITLE, NIN_LABEL, NIN_NOT_ENABLED, NIN_OFF_FORM_NOTICE, NIN_OFF_TITLE,
  NO_OVERRIDE, START_TEXT, START_TITLE, TRY_AGAIN, VERIFY, VERIFYING, WITHOUT_NIN_TITLE,
} from './registrationText'
import { RegistrationWithoutNin } from './RegistrationWithoutNin'
import { offersWithoutNin, withoutNinFirst, withoutNinReasons } from './withoutNin'

/** A required field's label, as the design marks it: the star is not read out (the control is required). */
function required(label: string): ReactNode {
  return <>{label}<span aria-hidden="true"> *</span></>
}

/**
 * The design's create form ("New patients", 02-new and 03-new-patient-validation) as classic's "Check their NIN"
 * (Registration.tsx 232-257): classic's fields, checks and words, and the design's phone, address and existing Health
 * ID as required fields (hid-system 0114, DeskFields). The design's allergies and "provisional local identity" are not
 * asked (owner decisions D11, D12). With NIN checks off and no registration without a NIN, there is no form, as in
 * classic (Registration.tsx 230, 232): only classic's "NIN checks are off" and its Check again.
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
   * Register without a NIN (hid-system 0130), where Identity takes a registration without one: in place of the NIN form
   * while NIN checks are off, and otherwise chosen next to it. Its own refusals, error and submit.
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
  const offered = without && offersWithoutNin(capabilities) ? without : null
  const first = offered !== null && withoutNinFirst(capabilities)
  // While NIN checks work, the desk may choose to register without a NIN instead (a child, or someone with no NIN).
  const [chosen, setChosen] = useState(false)
  const withoutNin = offered && (first || chosen) ? offered : null
  // A choice moves focus to the heading of the form it shows, as the button chosen is gone.
  const switched = useRef(false)
  useLayoutEffect(() => {
    if (!switched.current) return
    switched.current = false
    document.getElementById(START_HEADING)?.focus()
  }, [chosen])
  const choose = (value: boolean) => {
    if (busy) return
    switched.current = true
    setChosen(value)
  }
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
            {first ? <DeptNotice tone="caution">{NIN_OFF_FORM_NOTICE}</DeptNotice> : null}
            <RegistrationWithoutNin reasons={withoutNinReasons(capabilities)} busy={busy} problems={withoutNin.problems}
              error={withoutNin.error} onInput={withoutNin.onInput} onSubmit={withoutNin.onSubmit} />
            {first ? null : (
              <div className="hid-ehr-dept-registration-footer hid-ehr-dept-registration-choice">
                <EhrButton variant="secondary" className="hid-ehr-dept-registration-unavailable" aria-disabled={busy || undefined}
                  onClick={() => choose(false)}>{CHOOSE_NIN}</EhrButton>
              </div>
            )}
          </>
        ) : !enabled ? (
          // Registration.tsx 230, 232: classic shows no form while NIN checks are off and nothing else is offered, only
          // its warning with Check again, which stays where it is while it reads (it keeps its focus). The form takes
          // its place once NIN checks work again.
          <div className="hid-ehr-dept-registration-retry">
            <DeptNotice tone="caution" title={NIN_OFF_TITLE}>{NIN_NOT_ENABLED}</DeptNotice>
            <EhrButton variant="secondary" size="sm" busy={availability.loading} onClick={availability.refresh}>
              {availability.loading ? CHECKING : CHECK_AGAIN}
            </EhrButton>
          </div>
        ) : (
          <>
            <form className="hid-ehr-dept-form" noValidate onInput={onInput} onSubmit={onSubmit}>
              {/* While the NIN is verified the fields are read-only, not disabled, which would take focus from the
                  button (Registration.tsx 235). */}
              <fieldset className="hid-ehr-dept-registration-fieldset">
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
            {offered ? (
              // hid-system 0130 (ID-2): offered next to the NIN form while NIN checks work, not only when they are off.
              <div className="hid-ehr-dept-registration-footer hid-ehr-dept-registration-choice">
                <p className="hid-ehr-dept-registration-lead">{CHOOSE_WITHOUT_NIN_TEXT}</p>
                <EhrButton variant="secondary" className="hid-ehr-dept-registration-unavailable" aria-disabled={busy || undefined}
                  onClick={() => choose(true)}>{CHOOSE_WITHOUT_NIN}</EhrButton>
              </div>
            ) : null}
          </>
        )}
        <UnavailableAction label={DISTINCT_PERSON} reason={NO_OVERRIDE} variant="secondary" />
      </DeptSection>
    </DeptPage>
  )
}
