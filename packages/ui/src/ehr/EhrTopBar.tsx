'use client'

/**
 * The EHR top bar: the shell's banner, 76px high (64px on phones). Inside a
 * shell with a sidebar it carries the phone menu button, which CSS shows only
 * where the sidebar rail is hidden.
 */

import type { ReactNode } from 'react'
import { cx } from '../primitives'
import { useEhrShell } from './EhrAppShell'
import { EhrButton } from './EhrButton'

export interface EhrTopBarProps {
  /** The facility or workspace context. */
  readonly start?: ReactNode
  /** Search, notifications and the account menu. */
  readonly end?: ReactNode
  /** The phone menu button's name. */
  readonly menuLabel?: string
  readonly className?: string
}

export function EhrTopBar({ start, end, menuLabel = 'Menu', className }: EhrTopBarProps) {
  const menu = useEhrShell()?.menu ?? null

  return (
    <header className={cx('hid-ehr-topbar', className)}>
      {menu ? (
        <EhrButton
          ref={menu.buttonRef}
          variant="secondary"
          className="hid-ehr-topbar-menu"
          aria-expanded={menu.open}
          aria-controls={menu.panelId}
          onClick={() => menu.setOpen(!menu.open)}
        >
          {menuLabel}
        </EhrButton>
      ) : null}
      <div className="hid-ehr-topbar-start">{start}</div>
      {end !== undefined ? <div className="hid-ehr-topbar-end">{end}</div> : null}
    </header>
  )
}
