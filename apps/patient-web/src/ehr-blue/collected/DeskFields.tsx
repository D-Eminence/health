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
export function DeskFields({ prefix, readOnly, error, fullClassName, contactRequired = true, contactNote }: {
  readonly prefix: string
  readonly readOnly: boolean
  /**
   * Whether the phone and address are required (they are, except for a child registered without a NIN, hid-system
   * 0130). Not required, they are marked optional and their controls are not `required`.
   */
  readonly contactRequired?: boolean
  /** Said under the phone when the contact is optional (why, and that it goes together). */
  readonly contactNote?: string
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
  const contact = (name: DeskField) => name === 'phone' || name === 'addressLine' || name === 'city' || name === 'stateCode'
    || name === 'lga'
  const field = (name: DeskField, control: ReactNode, className?: string) => {
    const optional = !contactRequired && contact(name)
    const hint = optional && name === 'phone' && contactNote ? `${contactNote} ${DESK_HINTS.phone ?? ''}`.trim() : DESK_HINTS[name]
    return (
      <EhrField key={name} label={optional ? `${DESK_LABELS[name]} (optional)` : requiredLabel(DESK_LABELS[name])} hint={hint}
        controlId={id(name)} error={error(id(name))} className={className}>{control}</EhrField>
    )
  }
  const needed = contactRequired
  return <>
    {field('phone', <EhrInput name="phone" type="tel" maxLength={32} autoComplete="off" readOnly={readOnly} required={needed} />)}
    {field('addressLine', <EhrInput name="addressLine" maxLength={300} autoComplete="off" readOnly={readOnly} required={needed} />,
      fullClassName)}
    {field('city', <EhrInput name="city" maxLength={100} autoComplete="off" readOnly={readOnly} required={needed} />)}
    {field('stateCode', <EhrSelect name="stateCode" required={needed} defaultValue="">
      <option value="">Select…</option>
      {NIGERIA_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </EhrSelect>)}
    {field('lga', <EhrInput name="lga" maxLength={100} autoComplete="off" readOnly={readOnly} required={needed} />)}
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
