/**
 * The header every printed paper carries (owner, 23 Nov 2026): the Health ID logo and the name of the facility it was
 * printed at, over a brand-blue rule. The host passes the logo (its own brand asset) and the facility's name. The paper
 * is often printed outside the shell (put straight under <body>), so the header carries the .hid-ehr root itself. It
 * is a <div>, not a <header>, so it can sit inside a paper's own header.
 *
 * `printOnly` keeps it off the screen and shows it only in print: for a page printed as it is, where the screen has its
 * own header. A paper that is never shown on screen does not need it. `stacked` puts the name under the logo, centred,
 * for a narrow slip (an 80 mm receipt).
 */

import type { ReactNode } from 'react'
import { cx } from '../primitives'

export interface EhrPrintHeaderProps {
  /** The Health ID logo, as the host draws it, with the class `hid-ehr-print-header-mark` (it sizes it for paper). */
  readonly logo: ReactNode
  /** The facility the paper is printed at. Left out when not known: the logo prints alone. */
  readonly facility?: string | null
  readonly printOnly?: boolean
  readonly stacked?: boolean
  readonly className?: string
}

export function EhrPrintHeader({ logo, facility, printOnly = false, stacked = false, className }: EhrPrintHeaderProps) {
  const name = facility?.trim()
  return (
    <div data-print-header="" className={cx('hid-ehr hid-ehr-print-header', printOnly && 'hid-ehr-print-only', stacked && 'hid-ehr-print-header-stacked', className)}>
      <span className="hid-ehr-print-header-logo">{logo}</span>
      {name ? <p className="hid-ehr-print-header-facility">{name}</p> : null}
    </div>
  )
}
