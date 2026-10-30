import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TableHTMLAttributes, type TdHTMLAttributes, type TextareaHTMLAttributes, type ThHTMLAttributes } from 'react'
import { Icon, type IconName } from './icon'

type ButtonVariant = 'accent' | 'primary' | 'secondary' | 'quiet' | 'danger'
type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: IconName
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading = false, icon, children, disabled, className = '', ...props }, ref) {
  return <button ref={ref} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}<span className="ui-button-label">{children}</span></button>
})

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
  leadingIcon?: IconName
}

export const InputField = forwardRef<HTMLInputElement, FieldProps>(function InputField({ label, hint, error, leadingIcon, id, className = '', ...props }, ref) {
  const inputId = id || `field-${label.toLowerCase().replace(/\W+/g, '-')}`
  const messageId = `${inputId}-message`
  return <div className={`ui-field ${error ? 'is-error' : ''} ${className}`}><label className="ui-label" htmlFor={inputId}>{label}</label><span className="ui-input-wrap">{leadingIcon && <Icon name={leadingIcon} />}<input ref={ref} id={inputId} className="ui-input" aria-invalid={error ? true : undefined} aria-describedby={hint || error ? messageId : undefined} {...props} /></span><small id={messageId} className="ui-field-message">{error || hint || ''}</small></div>
})

export function SelectField({ label, hint, error, id, children, className = '', ...props }: { label: string; hint?: string; error?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const inputId = id || `select-${label.toLowerCase().replace(/\W+/g, '-')}`
  const messageId = `${inputId}-message`
  return <div className={`ui-field ${error ? 'is-error' : ''} ${className}`}><label className="ui-label" htmlFor={inputId}>{label}</label><span className="ui-select-wrap"><select id={inputId} className="ui-input" aria-invalid={error ? true : undefined} aria-describedby={hint || error ? messageId : undefined} {...props}>{children}</select><Icon name="chevron" /></span><small id={messageId} className="ui-field-message">{error || hint || ''}</small></div>
}

export function TextareaField({ label, hint, error, id, className = '', ...props }: { label: string; hint?: string; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const inputId = id || `textarea-${label.toLowerCase().replace(/\W+/g, '-')}`
  const messageId = `${inputId}-message`
  return <div className={`ui-field ${error ? 'is-error' : ''} ${className}`}><label className="ui-label" htmlFor={inputId}>{label}</label><textarea id={inputId} className="ui-input ui-textarea" aria-invalid={error ? true : undefined} aria-describedby={hint || error ? messageId : undefined} {...props} /><small id={messageId} className="ui-field-message">{error || hint || ''}</small></div>
}

export function Checkbox({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className="ui-choice"><button className="ui-checkbox" type="button" role="checkbox" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><Icon name="check" /></button><span>{label}</span></label>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'success' | 'error' | 'warning' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{tone !== 'neutral' && <span aria-hidden="true" />}<span>{children}</span></span>
}

export function Status({ tone, children }: { tone: 'success' | 'pending' | 'failed'; children: ReactNode }) {
  return <span className={`ui-status ui-status--${tone}`}><Icon name={tone === 'success' ? 'success' : tone === 'pending' ? 'pending' : 'error'} /><span>{children}</span></span>
}

export function Card({ title, description, children, className = '' }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={`ui-card ${className}`}>{(title || description) && <header><h3>{title}</h3>{description && <p>{description}</p>}</header>}{children}</section>
}

export function Spinner() {
  return <span className="ui-spinner" aria-hidden="true" />
}

export function Skeleton({ width = '100%', height = 12 }: { width?: string; height?: number }) {
  return <span className="ui-skeleton" style={{ width, height }} aria-hidden="true" />
}

export function Avatar({ name, tone = 'neutral', size = 'md' }: { name: string; tone?: 'neutral' | 'orange' | 'blue' | 'green' | 'purple'; size?: 'sm' | 'md' }) {
  const initials = name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()
  return <span className={`ui-avatar ui-avatar--${tone} ui-avatar--${size}`} aria-label={name}>{initials}</span>
}

export function Table({ className = '', ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="ui-table-scroll"><table className={`ui-table ${className}`} {...props} /></div>
}

export function TableHead(props: HTMLAttributes<HTMLTableSectionElement>) { return <thead {...props} /> }
export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} /> }
export function TableRow(props: HTMLAttributes<HTMLTableRowElement>) { return <tr {...props} /> }
export function TableHeader(props: ThHTMLAttributes<HTMLTableCellElement>) { return <th {...props} /> }
export function TableCell(props: TdHTMLAttributes<HTMLTableCellElement>) { return <td {...props} /> }
