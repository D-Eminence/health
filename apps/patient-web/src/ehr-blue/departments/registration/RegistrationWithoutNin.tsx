import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import type { NoNinReason } from '../../../staff/api'
import { DeskFields } from '../../collected/DeskFields'
import { DESK_PREFIX, FIELD } from './registrationModel'
import { ErrorBox, type FormProblems } from './registrationParts'
import {
  CHILD_CONTACT_NOTE, DOB_LABEL, FIRST_LABEL, GENDER_LABEL, GENDER_OPTIONS, LAST_LABEL, REASON_LABEL, REGISTER_WITHOUT_NIN,
  REGISTERING, SELECT_REASON, WITHOUT_NIN_TEXT,
} from './registrationText'
import { lagosToday, NO_NIN_REASON_LABELS } from './withoutNin'

function required(label: string): ReactNode {
  return <>{label}<span aria-hidden="true"> *</span></>
}

/**
 * "Register without a NIN" (hid-system 0130, owner Q106): the new patient form while NIN checks are off. The names,
 * date of birth and gender as on the NIN form, why there is no NIN (Identity's own list), and the desk's phone, address
 * and existing Health ID (collected/DeskFields), whose phone and address become optional once the reason is a child.
 */
export function RegistrationWithoutNin({ reasons, busy, problems, error, onInput, onSubmit }: {
  /** The reasons Identity takes (registration-capabilities withoutNin.reasons). */
  readonly reasons: readonly NoNinReason[]
  readonly busy: boolean
  readonly problems: FormProblems
  /** What the last request's refusal said. */
  readonly error: string
  /** Any change to the form. */
  readonly onInput: () => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const [reason, setReason] = useState('')
  const select = useRef<HTMLSelectElement>(null)
  // A reset of the form (after a registration) shows the phone and address as required again.
  useEffect(() => {
    const form = select.current?.form
    if (!form) return
    const reset = () => setReason('')
    form.addEventListener('reset', reset)
    return () => form.removeEventListener('reset', reset)
  }, [])
  const child = reason === 'child'
  return (
    <form className="hid-ehr-dept-form" noValidate aria-label="Register without a NIN" onInput={onInput} onSubmit={onSubmit}>
      <p className="hid-ehr-dept-registration-lead">{WITHOUT_NIN_TEXT}</p>
      <div className="hid-ehr-dept-form-grid">
        <EhrField label={required(FIRST_LABEL)} controlId={FIELD.withoutFirst} error={problems.error(FIELD.withoutFirst)}>
          <EhrInput name="firstName" maxLength={100} autoComplete="off" readOnly={busy} required />
        </EhrField>
        <EhrField label={required(LAST_LABEL)} controlId={FIELD.withoutLast} error={problems.error(FIELD.withoutLast)}>
          <EhrInput name="lastName" maxLength={100} autoComplete="off" readOnly={busy} required />
        </EhrField>
        <EhrField label={required(DOB_LABEL)} controlId={FIELD.withoutDob} error={problems.error(FIELD.withoutDob)}>
          <EhrInput name="dateOfBirth" type="date" max={lagosToday()} readOnly={busy} required />
        </EhrField>
        <EhrField label={GENDER_LABEL} controlId={FIELD.withoutGender}>
          <EhrSelect name="gender">
            {GENDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label={required(REASON_LABEL)} controlId={FIELD.reason} error={problems.error(FIELD.reason)} className="hid-ehr-dept-full">
          <EhrSelect ref={select} name="noNinReason" required value={reason} onChange={event => setReason(event.target.value)}>
            <option value="">{SELECT_REASON}</option>
            {reasons.map(value => <option key={value} value={value}>{NO_NIN_REASON_LABELS[value]}</option>)}
          </EhrSelect>
        </EhrField>
        <DeskFields prefix={DESK_PREFIX} readOnly={busy} error={problems.error} fullClassName="hid-ehr-dept-full"
          contactRequired={!child} contactNote={CHILD_CONTACT_NOTE} />
      </div>
      <ErrorBox message={error} />
      <div className="hid-ehr-dept-registration-footer">
        <EhrButton type="submit" busy={busy}>{busy ? REGISTERING : REGISTER_WITHOUT_NIN}</EhrButton>
      </div>
    </form>
  )
}
