import type { ReactNode } from 'react'
import { EhrField, EhrInput } from '@hid/ui/ehr'
import { NOT_COLLECTED } from './setupText'

/** A label with the design's required mark: a star, hidden from screen readers (the control says it is required). */
export function required(label: string): ReactNode {
  return <>{label}<span aria-hidden="true"> *</span></>
}

/**
 * A design field Health ID does not take: shown, disabled and empty, and said to be so. It has no name and is never
 * read, so nothing typed or chosen in it could be sent or kept (nothing can be: it is disabled).
 */
export function NotCollectedField({ label, type = 'text' }: { readonly label: string; readonly type?: string }) {
  return (
    <EhrField label={label} hint={NOT_COLLECTED}>
      <EhrInput type={type} disabled defaultValue={type === 'file' ? undefined : ''} />
    </EhrField>
  )
}

/** A checkbox with its label beside it, in the design's look. */
export function Check({ label, checked, onChange, labelFirst = false, describedBy }: {
  readonly label: ReactNode
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  /** The design writes "Enable insurance support" before its box. */
  readonly labelFirst?: boolean
  readonly describedBy?: string
}) {
  const box = <input type="checkbox" className="hid-ehr-onboarding-check-input" checked={checked} aria-describedby={describedBy}
    onChange={event => onChange(event.target.checked)} />
  return <label className="hid-ehr-onboarding-check">{labelFirst ? <>{label}{box}</> : <>{box}{label}</>}</label>
}

/** One row of a read-only summary (the design's DataView). */
export function Detail({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return <div className="hid-ehr-onboarding-detail"><dt>{term}</dt><dd>{children}</dd></div>
}
