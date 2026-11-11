import type { ReactNode } from 'react'
import './collected.css'
import { EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  CARE_LEVELS, DEPARTMENTS, OWNERSHIP, PROFILE_HINTS, PROFILE_LABELS, profileFieldShown,
  type DepartmentCode, type FacilityProfileForm, type ProfileField,
} from './facilityProfile'
import { NIGERIA_STATES } from './places'

/** A required field's label: the design's " *", which the control's own `required` says to assistive technology. */
export function requiredLabel(label: ReactNode): ReactNode {
  return <>{label}<span aria-hidden="true"> *</span></>
}

/** The id of a field's control, so a refusal can move focus to it. */
export function profileControlId(prefix: string, field: ProfileField): string {
  return `${prefix}-${field}`
}

const YES_NO_FIELDS: ReadonlySet<ProfileField> = new Set(['emergency24h', 'hasRegistryId', 'hasNhiaAccreditation',
  'migratingRecords', 'needsInteroperability'])
const FULL_FIELDS: ReadonlySet<ProfileField> = new Set(['addressLine', 'departments', 'servicesOffered'])

function Choices({ list }: { readonly list: ReadonlyArray<readonly [string, string]> }) {
  return <><option value="">Select…</option>{list.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>
}

/**
 * The facility's details as named, required inputs (contract section 43.1), in the order given: facility sign-up draws them over
 * three of its steps, and Facility setup draws them all. A registry ID or NHIA number appears once the facility says
 * it has one. Errors are by field; each control's id is profileControlId(prefix, field).
 */
export function ProfileFields({ form, fields, errors, prefix, fullClassName, readOnly = false, onChange }: {
  readonly form: FacilityProfileForm
  readonly fields: readonly ProfileField[]
  readonly errors: Partial<Record<ProfileField, string>>
  readonly prefix: string
  /** The grid's class for a field that takes the whole row. */
  readonly fullClassName: string
  readonly readOnly?: boolean
  readonly onChange: <K extends ProfileField>(field: K, value: FacilityProfileForm[K]) => void
}) {
  return <>{fields.filter(field => profileFieldShown(field, form)).map(field => {
    const id = profileControlId(prefix, field)
    const label = requiredLabel(PROFILE_LABELS[field])
    const hint = PROFILE_HINTS[field]
    const error = errors[field]
    const className = FULL_FIELDS.has(field) ? fullClassName : undefined
    if (field === 'departments') {
      return <DepartmentChoices key={field} id={id} chosen={form.departments} error={error} className={className}
        readOnly={readOnly} onChange={value => onChange('departments', value)} />
    }
    const text = (value: string, props: Parameters<typeof EhrInput>[0] = {}) => (
      <EhrInput required readOnly={readOnly} value={value}
        onChange={event => onChange(field, event.target.value as FacilityProfileForm[typeof field])} {...props} />
    )
    let control: ReactNode
    if (YES_NO_FIELDS.has(field)) {
      control = <EhrSelect required disabled={readOnly} value={String(form[field])}
        onChange={event => onChange(field, event.target.value as FacilityProfileForm[typeof field])}>
        <Choices list={[['yes', 'Yes'], ['no', 'No']]} />
      </EhrSelect>
    } else if (field === 'ownership' || field === 'careLevel' || field === 'stateCode') {
      const list = field === 'ownership' ? OWNERSHIP : field === 'careLevel' ? CARE_LEVELS : NIGERIA_STATES
      control = <EhrSelect required disabled={readOnly} value={form[field]}
        onChange={event => onChange(field, event.target.value as FacilityProfileForm[typeof field])}>
        <Choices list={list} />
      </EhrSelect>
    } else if (field === 'servicesOffered') {
      control = <EhrTextarea required readOnly={readOnly} rows={3} maxLength={2000} value={form.servicesOffered}
        onChange={event => onChange('servicesOffered', event.target.value)} />
    } else if (field === 'phone') {
      control = text(form.phone, { type: 'tel', autoComplete: 'off', maxLength: 32 })
    } else if (field === 'email') {
      control = text(form.email, { type: 'email', autoComplete: 'off', maxLength: 254 })
    } else if (field === 'gpsLatitude' || field === 'gpsLongitude' || field === 'bedCount' || field === 'expectedStaff') {
      const decimal = field === 'gpsLatitude' || field === 'gpsLongitude'
      control = text(form[field], { inputMode: decimal ? 'decimal' : 'numeric', autoComplete: 'off', maxLength: 12 })
    } else {
      const max = field === 'addressLine' ? 300 : field === 'tradingName' || field === 'operatingHours'
        || field === 'medicalDirectorName' ? 200 : 100
      control = text(String(form[field]), { maxLength: max, autoComplete: 'off',
        ...(field === 'medicalDirectorMdcn' ? { autoCapitalize: 'characters', spellCheck: false } : {}) })
    }
    return <EhrField key={field} label={label} hint={hint} error={error} controlId={id} className={className}>{control}</EhrField>
  })}</>
}

/** The departments, as boxes to tick (the design's list), in a group with its own label, hint and error. */
function DepartmentChoices({ id, chosen, error, className, readOnly, onChange }: {
  readonly id: string
  readonly chosen: readonly DepartmentCode[]
  readonly error: string | undefined
  readonly className: string | undefined
  readonly readOnly: boolean
  readonly onChange: (value: DepartmentCode[]) => void
}) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  return (
    <fieldset className={['hid-ehr-field', 'hid-ehr-collected-departments', className].filter(Boolean).join(' ')}
      aria-describedby={[error ? errorId : null, hintId].filter(Boolean).join(' ')}
      aria-invalid={error ? true : undefined}>
      <legend className="hid-ehr-label">{requiredLabel(PROFILE_LABELS.departments)}</legend>
      <div className="hid-ehr-collected-choices">
        {DEPARTMENTS.map(([code, name], index) => (
          <label key={code} className="hid-ehr-collected-choice">
            <input type="checkbox" id={index === 0 ? id : undefined} name="departments" value={code} disabled={readOnly}
              checked={chosen.includes(code)}
              onChange={event => onChange(event.target.checked ? [...chosen, code] : chosen.filter(other => other !== code))} />
            {name}
          </label>
        ))}
      </div>
      <p id={hintId} className="hid-ehr-hint">{PROFILE_HINTS.departments}</p>
      {error ? <p id={errorId} className="hid-ehr-error">{error}</p> : null}
    </fieldset>
  )
}
