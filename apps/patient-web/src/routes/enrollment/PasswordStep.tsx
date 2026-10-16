import type { FormEvent } from 'react'
import { describedBy } from '../../authSteps'
import { ENROLLMENT_GENDERS, type EnrollmentGender, type EnrollmentProfileField } from '../../api'
import type { StepProps } from './stepProps'

/** One enrollment's activation attempts are limited to 15 in 15 minutes (hid-system #61 and #50). */
const ACTIVATION_LIMIT_HINT = 'This enrollment has had too many activation attempts. Wait about 15 minutes, then activate again: the enrollment is kept.'

const GENDER_LABELS: Record<EnrollmentGender, string> = {
  female: 'Female', male: 'Male', intersex: 'Intersex', other: 'Other', unknown: 'Unknown',
}
const FIELD_NAMES: Record<EnrollmentProfileField, string> = { dateOfBirth: 'date of birth', gender: 'gender' }

/** The field a refusal at this step is about. */
export type PasswordStepField = 'password' | EnrollmentProfileField

/** Today as YYYY-MM-DD in the browser's time zone, the latest date of birth offered. */
export function localToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Whether a date of birth may be sent (ADR-061): a real YYYY-MM-DD date from
 * 1900-01-01 to today. Identity checks it again against today in UTC, and its
 * refusal is shown at the field as this one is.
 */
export function plausibleDateOfBirth(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= '1900-01-01' && value <= localToday()
}
export const DATE_OF_BIRTH_RULE = 'Enter a real date of birth. It cannot be before 1 January 1900 or in the future.'

interface PasswordStepProps extends Omit<StepProps, 'invalid'> {
  password: string
  onPassword: (password: string) => void
  onSubmit: (event: FormEvent) => void
  /** Why the step cannot be sent yet, besides a password of 12 characters and the profile fields. */
  blocked: boolean
  /** Activation was refused for too many attempts. */
  limitNote: boolean
  /** What the NIN record lacks, which the patient enters here (ADR-061). */
  profileFields: readonly EnrollmentProfileField[]
  dateOfBirth: string
  onDateOfBirth: (value: string) => void
  gender: EnrollmentGender | ''
  onGender: (value: EnrollmentGender | '') => void
  /** The field the error is about, if any; focus goes there, or to the first field. */
  errorField: PasswordStepField | null
}

/** The password, with any date of birth or gender the NIN record lacks, which activates the Health ID. */
export function PasswordStep({ focusTarget, busy, errorId, password, onPassword, onSubmit, blocked, limitNote,
  profileFields, dateOfBirth, onDateOfBirth, gender, onGender, errorField }: PasswordStepProps) {
  const focusOn: PasswordStepField = errorField ?? profileFields[0] ?? 'password'
  const target = (field: PasswordStepField) => focusOn === field ? focusTarget : undefined
  const invalid = (field: PasswordStepField) => errorField === field ? true : undefined
  const errorFor = (field: PasswordStepField) => errorField === field ? errorId : undefined
  const missing = profileFields.filter(field => field === 'dateOfBirth' ? dateOfBirth === '' : gender === '')
  const lacks = profileFields.map(field => FIELD_NAMES[field])
  // The date's limits are checked by the page (plausibleDateOfBirth), which says so at the field.
  return <form onSubmit={onSubmit} className="patient-form" noValidate>
    <h2>Activate your account</h2>
    {profileFields.length > 0 && <p id="enroll-profile-hint" className="patient-field-hint">
      Your NIN record does not include your {lacks.join(' or ')}, so enter {lacks.length > 1 ? 'them' : 'it'} here for your Health ID.
    </p>}
    {profileFields.includes('dateOfBirth') && <label>Date of birth<input ref={target('dateOfBirth')} required type="date" min="1900-01-01" max={localToday()}
      value={dateOfBirth} onChange={event => onDateOfBirth(event.target.value)}
      aria-invalid={invalid('dateOfBirth')} aria-describedby={describedBy('enroll-profile-hint', errorFor('dateOfBirth'))} /></label>}
    {profileFields.includes('gender') && <label>Gender<select ref={target('gender')} required value={gender} onChange={event => onGender(event.target.value as EnrollmentGender | '')}
      aria-invalid={invalid('gender')} aria-describedby={describedBy('enroll-profile-hint', errorFor('gender'))}>
      <option value="">Select…</option>
      {ENROLLMENT_GENDERS.map(value => <option key={value} value={value}>{GENDER_LABELS[value]}</option>)}
    </select></label>}
    <p id="enroll-password-hint" className="patient-field-hint">Choose a password of at least 12 characters.</p>
    <label>Password<input ref={target('password')} required type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => onPassword(event.target.value)}
      aria-invalid={invalid('password')} aria-describedby={describedBy('enroll-password-hint', errorFor('password'))} /></label>
    {missing.length > 0 && <p id="enroll-profile-missing" className="patient-field-hint">Enter your {missing.map(field => FIELD_NAMES[field]).join(' and ')} to activate.</p>}
    <button type="submit" className="patient-primary-button" disabled={busy || password.length < 12 || blocked || missing.length > 0}
      aria-describedby={missing.length > 0 ? 'enroll-profile-missing' : undefined}>{busy ? 'Activating…' : 'Activate Health ID'}</button>
    {limitNote && <p className="patient-field-hint">{ACTIVATION_LIMIT_HINT}</p>}
  </form>
}
