import { Fragment, type ReactNode } from 'react'

export interface KeyValue {
  readonly label: string
  readonly value: ReactNode
}

/** The design's key and value list (`dl.details`): grey label left, value right. Empty values read "Not recorded". */
export function KeyValueList({ items }: { items: readonly KeyValue[] }) {
  return (
    <dl className="hid-ehr-clinical-kv">
      {items.map(({ label, value }, index) => (
        <Fragment key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd>{value === undefined || value === null || value === '' ? 'Not recorded' : value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
