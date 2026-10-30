import type { ReactNode } from 'react'
import { Icon } from './icon'
import { Button, Spinner } from './primitives'

export function Alert({ tone, title, children, onDismiss }: { tone: 'success' | 'error' | 'warning' | 'info' | 'loading'; title: string; children: ReactNode; onDismiss?: () => void }) {
  const icon = tone === 'success' ? 'check' : tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : tone === 'loading' ? null : 'info'
  return <div className={`ui-alert ui-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}><span className="ui-alert-icon">{icon ? <Icon name={icon} /> : <Spinner />}</span><div><strong>{title}</strong><p>{children}</p></div>{onDismiss && <button type="button" aria-label="Dismiss notification" onClick={onDismiss}><Icon name="close" /></button>}</div>
}

export function StatePanel({ state, title, children, action }: { state: 'empty' | 'error' | 'loading'; title: string; children: ReactNode; action?: string }) {
  return <div className="ui-state">{state === 'loading' ? <Spinner /> : <Icon name={state === 'error' ? 'error' : 'info'} />}<strong>{title}</strong><p>{children}</p>{action && <Button size="sm">{action}</Button>}</div>
}
