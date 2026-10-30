import { useId, type ReactNode } from 'react'
import { EhrInput } from '@hid/ui/ehr'

export interface DeptSearchProps {
  /** "Search Laboratory". */
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  /** One line under the field, such as what the search covers. */
  readonly hint?: ReactNode
  /** Filters beside the search, such as an outcome select. */
  readonly filters?: ReactNode
  /** The list the search filters, under it in the same card. */
  readonly children?: ReactNode
}

/**
 * The target's list card: a search over what is already loaded, and the list under
 * it. The search sends nothing: it filters the rows on the page, and is kept only
 * in memory.
 */
export function DeptSearch({ label, value, onChange, placeholder = 'Search saved records…', hint, filters, children }: DeptSearchProps) {
  const id = useId()
  return (
    <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-list-card" aria-label={label}>
      <div className={filters ? 'hid-ehr-dept-search-row' : undefined}>
        <div className="hid-ehr-field hid-ehr-dept-search">
          <label className="hid-ehr-label" htmlFor={`${id}-search`}>{label}</label>
          <EhrInput id={`${id}-search`} type="search" value={value} placeholder={placeholder} autoComplete="off"
            aria-describedby={hint ? `${id}-hint` : undefined} onChange={event => onChange(event.target.value)} />
          {hint ? <p id={`${id}-hint`} className="hid-ehr-hint">{hint}</p> : null}
        </div>
        {filters}
      </div>
      {children}
    </section>
  )
}
