/**
 * An EHR data table: a real <table> with a caption and column headers, inside
 * a horizontally scrolling region that a keyboard can reach and scroll. While
 * loading it shows an EhrSkeleton; with no rows, an EhrEmptyState.
 */

import type { ReactNode } from 'react'
import { cx } from '../primitives'
import { EhrEmptyState } from './EhrEmptyState'
import { EhrSkeleton } from './EhrSkeleton'

export interface EhrDataTableColumn<Row> {
  readonly id: string
  readonly header: ReactNode
  readonly cell: (row: Row) => ReactNode
  /** Numbers and amounts align to the end. */
  readonly align?: 'start' | 'end'
}

export interface EhrDataTableProps<Row> {
  /** Names the table and its scrolling region. */
  readonly caption: string
  /** Keep the caption for assistive technology only, when a visible heading already names the table. */
  readonly captionHidden?: boolean
  readonly columns: readonly EhrDataTableColumn<Row>[]
  readonly rows: readonly Row[]
  readonly rowKey: (row: Row) => string
  readonly loading?: boolean
  readonly emptyTitle?: ReactNode
  /** One line on what to do next. */
  readonly emptyMessage?: ReactNode
  readonly emptyAction?: ReactNode
  readonly className?: string
}

export function EhrDataTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle = 'Nothing to show yet',
  emptyMessage = 'Records appear here once they are added.',
  emptyAction,
  className,
}: EhrDataTableProps<Row>) {
  if (loading) return <EhrSkeleton label={`Loading ${caption}`} className={className} />
  if (rows.length === 0) return <EhrEmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} className={className} />

  return (
    <div className={cx('hid-ehr-table-scroll', className)} role="region" aria-label={caption} tabIndex={0}>
      <table className="hid-ehr-table">
        <caption className={captionHidden ? 'hid-ehr-sr-only' : 'hid-ehr-table-caption'}>{caption}</caption>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.id} scope="col" className={cx('hid-ehr-table-header', column.align === 'end' && 'hid-ehr-align-end')}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={rowKey(row)} className="hid-ehr-table-row">
              {columns.map(column => (
                <td key={column.id} className={cx('hid-ehr-table-cell', column.align === 'end' && 'hid-ehr-align-end')}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
