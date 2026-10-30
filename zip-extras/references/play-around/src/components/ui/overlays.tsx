import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from './primitives'
import { Icon } from './icon'

export type TabItem = { id: string; label: string; icon?: ReactNode }

export function Tabs({ items, value, onChange, label = 'Sections' }: { items: TabItem[]; value: string; onChange: (value: string) => void; label?: string }) {
  return <div className="ui-tabs" role="tablist" aria-label={label}>{items.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === value} tabIndex={item.id === value ? 0 : -1} onClick={() => onChange(item.id)}>{item.icon}{item.label}</button>)}</div>
}

export type MenuItem = { id: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect?: () => void }

export function DropdownMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  return <div className="ui-menu-root" ref={root}><Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>{label}<Icon name="chevron" /></Button>{open && <div className="ui-menu" role="menu">{items.map(item => <button key={item.id} type="button" role="menuitem" disabled={item.disabled} className={item.danger ? 'is-danger' : ''} onClick={() => { item.onSelect?.(); setOpen(false) }}>{item.icon}{item.label}</button>)}</div>}</div>
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="ui-tooltip"><span tabIndex={0} aria-describedby={`tooltip-${label.replace(/\W+/g, '-')}`}>{children}</span><span id={`tooltip-${label.replace(/\W+/g, '-')}`} role="tooltip">{label}</span></span>
}

export function Dialog({ open, title, description, children, onClose, footer }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [open, onClose])
  if (!open) return null
  return <div className="ui-dialog-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div><button ref={closeRef} type="button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></header><div className="ui-dialog-body">{children}</div>{footer && <footer>{footer}</footer>}</section></div>
}
