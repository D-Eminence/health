import type { ReactNode } from 'react'

/** A label with the design's required mark: a star, hidden from screen readers (the control says it is required). */
export function required(label: string): ReactNode {
  return <>{label}<span aria-hidden="true"> *</span></>
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
