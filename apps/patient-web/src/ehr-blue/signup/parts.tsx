import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { STAFF_SIGN_IN_PATH, staffSignInHref } from '../../productHostname'
import { supportAddress, type Support } from './enrollmentRules'
import type { EnrollmentError } from './useEnrollment'

/**
 * "Contact Health ID support …", with the address when the build has it. Ported verbatim from
 * staff/routes/ProviderEnrollment.tsx:265-277 (not exported there); only the link's class is the blue one.
 */
export function SupportContact({ purpose }: { purpose: Support | 'register' | 'finish' | 'inline' | 'persist' }) {
  const address = supportAddress()
  const lead = purpose === 'register' ? 'To register your facility, contact Health ID support'
    : purpose === 'inline' ? 'contact Health ID support'
      : purpose === 'persist' ? 'If this keeps happening, contact Health ID support'
        : purpose === 'held' ? 'If it belongs to another company, tell Health ID support'
          : purpose === 'help' ? 'If you need help, contact Health ID support'
            : purpose === 'cac-otherwise' ? 'Otherwise, contact Health ID support' : 'Contact Health ID support'
  const tail = purpose === 'cac' || purpose === 'cac-otherwise' ? ', and give your CAC number.' : purpose === 'finish'
    ? ' to finish setting up your facility.' : purpose === 'held' ? ', and give that number, so they can free it.' : '.'
  return <>{lead}{address ? <> at <a className="hid-ehr-signup-link" href={`mailto:${address}`}>{address}</a></> : null}{tail}</>
}

/**
 * Where this administrator signs in next time: the EHR site in production, this portal elsewhere. Ported from
 * staff/routes/ProviderEnrollment.tsx:279-284, drawn as the design's primary button.
 */
export function SignInLink({ children }: { children: ReactNode }) {
  const elsewhere = staffSignInHref(window.location.hostname)
  return elsewhere ? <a className="hid-ehr-button hid-ehr-signup-wide" href={elsewhere}>{children}</a>
    : <Link className="hid-ehr-button hid-ehr-signup-wide" to={STAFF_SIGN_IN_PATH}>{children}</Link>
}

/**
 * A screen's h1 that takes focus in the commit that shows it, as today's FocusedHeading (ProviderEnrollment.tsx:286-291)
 * does for a panel that replaces the step before it.
 */
export function ScreenHeading({ id, children }: { id: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  return <h1 id={id} ref={heading} tabIndex={-1} className="hid-ehr-signup-title">{children}</h1>
}

/**
 * One choice from a short list, as rows of radio buttons (each row a 44px+ target). The group is named by the step's
 * heading, which asks the question, so it has no label of its own; `note` says what the chosen option means.
 */
export function Choices<Value extends string>({ name, labelledBy, value, options, onChange, note, noteId }: {
  readonly name: string
  readonly labelledBy: string
  readonly value: Value
  readonly options: ReadonlyArray<{ readonly value: Value; readonly label: string }>
  readonly onChange: (value: Value) => void
  readonly note?: string | null
  readonly noteId?: string
}) {
  return (
    <>
      <fieldset className="hid-ehr-signup-choices" aria-labelledby={labelledBy}
        aria-describedby={note && noteId ? noteId : undefined}>
        {options.map(option => (
          <label key={option.value} className="hid-ehr-signup-choice">
            <input type="radio" name={name} value={option.value} checked={value === option.value}
              onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      {note && noteId ? <p id={noteId} className="hid-ehr-signup-hint">{note}</p> : null}
    </>
  )
}

/** An error's words, ending with support's address when it has one (today's alert, ProviderEnrollment.tsx:990-991). */
export function ErrorWords({ error }: { readonly error: EnrollmentError }) {
  return <>{error.text}{error.support ? <> <SupportContact purpose={error.support} /></> : null}</>
}
