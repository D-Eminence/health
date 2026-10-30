import { EhrButton, EhrCard, EhrEmptyState, EhrField, EhrInput, EhrPageHeading } from '@hid/ui/ehr'
import type { ReactNode } from 'react'
import { RESUME_INTRO, RESUME_TITLE, TITLE, UNAVAILABLE, UNAVAILABLE_TITLE } from './registration'

/** A required field's label: the design's " *" marker, hidden from the accessible name (today's Field marks it too). */
export function Required({ children }: { children: ReactNode }) {
  return <>{children}<span aria-hidden="true"> *</span></>
}

/** Today's refusal ("Registration unavailable"), under the workspace's heading as the frame draws a page not open here. Nothing is read. */
export function RegistrationUnavailable() {
  return (
    <>
      <EhrPageHeading title={TITLE} />
      <EhrEmptyState title={UNAVAILABLE_TITLE} message={UNAVAILABLE} />
    </>
  )
}

/**
 * "Resume a registration case": today's case ID field (controlled, as today's) and "Load case" ("Loading…" while a
 * case is read), in the design's form card. `onLoad` is today's loadCase: it checks the ID before anything is read.
 */
export function ResumeCard({ value, onChange, onLoad, loading, unavailable, error }: {
  value: string
  onChange: (value: string) => void
  onLoad: () => void
  loading: boolean
  /** Another step runs: "Load case" stays focusable and a press does nothing. */
  unavailable: boolean
  /** The case ID field's refusal, from today's useFieldProblems. */
  error: ReactNode
}) {
  return (
    <EhrCard title={RESUME_TITLE}>
      <p>{RESUME_INTRO}</p>
      <form className="hid-ehr-clinical-form" noValidate onSubmit={event => { event.preventDefault(); if (!loading && !unavailable) onLoad() }}>
        <div className="hid-ehr-clinical-form-grid">
          <EhrField controlId="registration-case-id" label={<Required>Registration case ID</Required>} error={error}>
            <EhrInput value={value} onChange={event => onChange(event.target.value)} autoComplete="off" required />
          </EhrField>
        </div>
        <div className="hid-ehr-clinical-form-footer">
          <EhrButton type="submit" busy={loading} aria-disabled={unavailable || undefined}>{loading ? 'Loading…' : 'Load case'}</EhrButton>
        </div>
      </form>
    </EhrCard>
  )
}
