/**
 * Module tabs: the pages of one module, as navigation links. They are not
 * ARIA tabs: each one goes to a page, so Tab moves between them and there is
 * no arrow-key handling.
 */

import type { MouseEvent } from 'react'
import { cx } from '../primitives'

export interface EhrModuleTab {
  readonly id: string
  readonly label: string
  readonly href: string
}

export interface EhrModuleTabsProps {
  /** The navigation landmark's name, usually the module's name. */
  readonly label: string
  readonly tabs: readonly EhrModuleTab[]
  readonly currentId?: string
  /** Called when a link is followed; call event.preventDefault() to route in the app instead. */
  readonly onNavigate?: (tab: EhrModuleTab, event: MouseEvent<HTMLAnchorElement>) => void
  readonly className?: string
}

export function EhrModuleTabs({ label, tabs, currentId, onNavigate, className }: EhrModuleTabsProps) {
  return (
    <nav className={cx('hid-ehr-module-tabs', className)} aria-label={label}>
      <ul className="hid-ehr-module-tab-list">
        {tabs.map(tab => (
          <li key={tab.id}>
            <a
              className="hid-ehr-module-tab"
              href={tab.href}
              aria-current={tab.id === currentId ? 'page' : undefined}
              // No handler unless asked for: a server component cannot render one.
              onClick={onNavigate ? event => onNavigate(tab, event) : undefined}
            >
              {tab.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
