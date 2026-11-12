import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { DESK_HINTS, DESK_LABELS, type DeskField } from './deskFields'
import { NIGERIA_STATES } from './places'
import { requiredLabel } from './ProfileFields'

/** The id of a desk field's control, so a refusal can move focus to it. */
export function deskControlId(prefix: string, field: DeskField): string {
  return `${prefix}-${field}`
}

/**
 * The desk fields (collected/deskFields.ts) as named, required controls in the blue look, read from the form's own
 * values (FormData) when it is sent. The existing Health ID appears once "Yes" is chosen; a reset of the form hides it.
 */
export function DeskFields({ prefix, readOnly, error, fullClassName }: {
  readonly prefix: string
  readonly readOnly: boolean
  /** A field's error by its control's id (useFormProblems). */
  readonly error: (id: string) => ReactNode
  readonly fullClassName: string
}) {
  const [has, setHas] = useState('')
  const select = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    const form = select.current?.form
    if (!form) return
    const reset = () => setHas('')
    form.addEventListener('reset', reset)
    return () => form.removeEventListener('reset', reset)
  }, [])
  const id = (field: DeskField) => deskControlId(prefix, field)
  const field = (name: DeskField, control: ReactNode, className?: string) => (
    <EhrField key={name} label={requiredLabel(DESK_LABELS[name])} hint={DESK_HINTS[name]} controlId={id(name)}
      error={error(id(name))} className={className}>{control}</EhrField>
  )
  return <>
    {field('phone', <EhrInput name="phone" type="tel" maxLength={32} autoComplete="off" readOnly={readOnly} required />)}
    {field('addressLine', <EhrInput name="addressLine" maxLength={300} autoComplete="off" readOnly={readOnly} required />,
      fullClassName)}
    {field('city', <EhrInput name="city" maxLength={100} autoComplete="off" readOnly={readOnly} required />)}
    {field('stateCode', <EhrSelect name="stateCode" required defaultValue="">
      <option value="">Select…</option>
      {NIGERIA_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </EhrSelect>)}
    {field('lga', <EhrInput name="lga" maxLength={100} autoComplete="off" readOnly={readOnly} required />)}
    {field('hasExistingHealthId', <EhrSelect ref={select} name="hasExistingHealthId" required value={has}
      onChange={event => setHas(event.target.value)}>
      <option value="">Select…</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </EhrSelect>)}
    {has === 'yes' ? field('existingHealthId', <EhrInput name="existingHealthId" maxLength={36} autoComplete="off"
      autoCapitalize="characters" spellCheck={false} placeholder="HID-" readOnly={readOnly} required />) : null}
  </>
}
