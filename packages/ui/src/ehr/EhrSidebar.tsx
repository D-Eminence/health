'use client'

/**
 * The EHR sidebar: grouped navigation links in a 247px rail that collapses to
 * 60px. Collapse and group state are controlled props with change callbacks,
 * or in-memory state; nothing is stored in the browser.
 *
 * On phones (max-width 768px) CSS hides the rail and shows the top bar's menu
 * button. That button opens the same navigation as a modal panel in the
 * shell's overlay layer, so no script ever asks the viewport its width.
 */

import { useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon'
import ArrowLeftDoubleIcon from '@hugeicons/core-free-icons/ArrowLeftDoubleIcon'
import ArrowRightDoubleIcon from '@hugeicons/core-free-icons/ArrowRightDoubleIcon'
import ArrowUp01Icon from '@hugeicons/core-free-icons/ArrowUp01Icon'
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon'
import { cx } from '../primitives'
import { EhrModal, useEhrShell } from './EhrAppShell'
import { EhrIconButton } from './EhrButton'

export interface EhrNavItem {
  readonly id: string
  readonly label: string
  readonly href: string
  /** Shown beside the label, and alone in the collapsed rail. Decorative: the label names the link. */
  readonly icon?: ReactNode
}

export interface EhrNavGroup {
  readonly id: string
  /** A group without a label shows its links without a heading. */
  readonly label?: string
  readonly items: readonly EhrNavItem[]
}

export interface EhrSidebarProps {
  readonly groups: readonly EhrNavGroup[]
  /** The id of the link for the current page. */
  readonly currentId?: string
  /** The navigation landmark's name. */
  readonly label?: string
  /** The Health ID logo, as a sized element. */
  readonly brand?: ReactNode
  /** The logo for the collapsed rail; `brand` when absent. */
  readonly brandCollapsed?: ReactNode
  /** A short product line under the logo, such as "Hospital EHR". */
  readonly product?: string
  readonly footer?: ReactNode
  readonly collapsed?: boolean
  readonly defaultCollapsed?: boolean
  readonly onCollapsedChange?: (collapsed: boolean) => void
  /** Ids of the groups that are closed. Every group is open by default. */
  readonly closedGroups?: readonly string[]
  readonly defaultClosedGroups?: readonly string[]
  readonly onClosedGroupsChange?: (closedGroups: readonly string[]) => void
  /** Called when a link is followed; call event.preventDefault() to route in the app instead. */
  readonly onNavigate?: (item: EhrNavItem, event: MouseEvent<HTMLAnchorElement>) => void
  /** The phone menu's heading. */
  readonly menuTitle?: string
  readonly className?: string
}

/** Controlled when `value` is given, in-memory otherwise. */
function useControllable<Value>(value: Value | undefined, initial: Value, onChange?: (next: Value) => void) {
  const [own, setOwn] = useState(initial)
  const current = value === undefined ? own : value
  const set = (next: Value) => {
    if (value === undefined) setOwn(next)
    onChange?.(next)
  }
  return [current, set] as const
}

const NO_GROUPS: readonly string[] = []

export function EhrSidebar({
  groups,
  currentId,
  label = 'Main navigation',
  brand,
  brandCollapsed,
  product,
  footer,
  collapsed: collapsedProp,
  defaultCollapsed = false,
  onCollapsedChange,
  closedGroups: closedProp,
  defaultClosedGroups = NO_GROUPS,
  onClosedGroupsChange,
  onNavigate,
  menuTitle = 'Menu',
  className,
}: EhrSidebarProps) {
  const shell = useEhrShell()
  const menu = shell?.menu ?? null
  const [collapsed, setCollapsed] = useControllable(collapsedProp, defaultCollapsed, onCollapsedChange)
  const [closed, setClosed] = useControllable(closedProp, defaultClosedGroups, onClosedGroupsChange)
  const toggleGroup = (id: string) => setClosed(closed.includes(id) ? closed.filter(group => group !== id) : [...closed, id])
  const menuTitleId = useId()
  const closeMenuRef = useRef<HTMLButtonElement>(null)
  const navigation = { groups, currentId, label, closed, toggleGroup, onNavigate }

  return (
    <>
      <aside className={cx('hid-ehr-sidebar', collapsed && 'hid-ehr-sidebar-collapsed', className)}>
        {brand !== undefined || product !== undefined ? (
          <div className="hid-ehr-sidebar-brand">
            {collapsed ? brandCollapsed ?? brand : brand}
            {product !== undefined && !collapsed ? <span className="hid-ehr-sidebar-product">{product}</span> : null}
          </div>
        ) : null}
        <SidebarNavigation {...navigation} collapsed={collapsed} />
        <div className="hid-ehr-sidebar-footer">
          {footer}
          <button
            type="button"
            className="hid-ehr-sidebar-toggle"
            aria-label={collapsed ? 'Expand sidebar' : undefined}
            title={collapsed ? 'Expand sidebar' : undefined}
            onClick={() => setCollapsed(!collapsed)}
          >
            <HugeiconsIcon icon={collapsed ? ArrowRightDoubleIcon : ArrowLeftDoubleIcon} size={17} strokeWidth={1.65} aria-hidden />
            {collapsed ? null : 'Collapse sidebar'}
          </button>
        </div>
      </aside>
      {menu?.open ? (
        <EhrModal
          scrimClassName="hid-ehr-scrim-start"
          onEscape={() => menu.setOpen(false)}
          initialFocusRef={closeMenuRef}
          returnFocusRef={menu.buttonRef}
        >
          <div
            id={menu.panelId}
            className="hid-ehr-phone-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby={menuTitleId}
            tabIndex={-1}
          >
            <div className="hid-ehr-phone-menu-header">
              <h2 id={menuTitleId} className="hid-ehr-overlay-title">{menuTitle}</h2>
              <EhrIconButton
                ref={closeMenuRef}
                variant="quiet"
                aria-label="Close menu"
                icon={<HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.65} aria-hidden />}
                onClick={() => menu.setOpen(false)}
              />
            </div>
            <SidebarNavigation
              {...navigation}
              collapsed={false}
              onNavigate={(item, event) => {
                onNavigate?.(item, event)
                menu.setOpen(false)
              }}
            />
            {footer}
          </div>
        </EhrModal>
      ) : null}
    </>
  )
}

interface SidebarNavigationProps {
  readonly groups: readonly EhrNavGroup[]
  readonly currentId: string | undefined
  readonly label: string
  readonly collapsed: boolean
  readonly closed: readonly string[]
  readonly toggleGroup: (id: string) => void
  readonly onNavigate: EhrSidebarProps['onNavigate']
}

function SidebarNavigation({ groups, currentId, label, collapsed, closed, toggleGroup, onNavigate }: SidebarNavigationProps) {
  const idPrefix = useId()

  return (
    <nav className="hid-ehr-nav" aria-label={label}>
      {groups.map(group => {
        const listId = `${idPrefix}-${group.id}`
        // The collapsed rail shows every link, without group headings.
        const heading = group.label !== undefined && !collapsed
        const open = !heading || !closed.includes(group.id)
        return (
          <div key={group.id} className="hid-ehr-nav-group">
            {heading ? (
              <button
                type="button"
                className="hid-ehr-nav-group-toggle"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggleGroup(group.id)}
              >
                {group.label}
                <HugeiconsIcon icon={open ? ArrowUp01Icon : ArrowDown01Icon} size={14} strokeWidth={1.65} aria-hidden />
              </button>
            ) : null}
            <ul id={listId} className="hid-ehr-nav-list" hidden={!open}>
              {group.items.map(item => (
                <li key={item.id}>
                  <a
                    className="hid-ehr-nav-link"
                    href={item.href}
                    aria-current={item.id === currentId ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={event => onNavigate?.(item, event)}
                  >
                    {item.icon !== undefined || collapsed ? (
                      // Without an icon, the collapsed rail shows the label's first letter.
                      <span className="hid-ehr-nav-icon" aria-hidden="true">{item.icon ?? item.label.charAt(0)}</span>
                    ) : null}
                    {/* The collapsed rail keeps the label for assistive technology. */}
                    <span className={collapsed ? 'hid-ehr-sr-only' : undefined}>{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
