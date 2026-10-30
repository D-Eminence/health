import { useId, type ReactNode } from 'react'
import { EhrField, EhrInput } from '@hid/ui/ehr'

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
        <EhrField label={label} hint={hint || undefined} controlId={`${id}-search`} className="hid-ehr-dept-search">
          <EhrInput type="search" value={value} placeholder={placeholder} autoComplete="off" onChange={event => onChange(event.target.value)} />
        </EhrField>
        {filters}
      </div>
      {children}
    </section>
  )
}
