import { useEffect, useState } from 'react'
import { useToast, type Toast, type ToastType } from '../store/ToastContext'

function ToastGlyph({ type }: { type: ToastType }) {
  if (type === 'loading') {
    return <span className="product-toast-spinner" aria-hidden="true" />
  }
  return (
    <svg className="toast-glyph" aria-hidden="true" viewBox="0 0 20 20">
      {type === 'success' && <path d="m4 10 4 4 8-9" />}
      {type === 'error' && <path d="m6 6 8 8m0-8-8 8" />}
      {type === 'warning' && (
        <>
          <path d="M10 3 18 17H2L10 3Z" />
          <path d="M10 8v4m0 2.5h.01" />
        </>
      )}
      {type === 'info' && (
        <>
          <circle cx="10" cy="10" r="8" />
          <path d="M10 9v5m0-8h.01" />
        </>
      )}
    </svg>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setOpen(true), 0)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (toast.duration <= 0) return
    const t = window.setTimeout(() => setLeaving(true), toast.duration)
    return () => window.clearTimeout(t)
  }, [toast.duration, toast.id])

  useEffect(() => {
    if (!leaving) return
    const t = window.setTimeout(() => onDismiss(toast.id), 280)
    return () => window.clearTimeout(t)
  }, [leaving, onDismiss, toast.id])

  return (
    <article
      className={`product-toast${open ? ' is-open' : ''}`}
      data-type={toast.type}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
    >
      <span className="product-toast-icon">
        <ToastGlyph type={toast.type} />
      </span>

      <div className="product-toast-copy">
        <strong className="product-toast-title">{toast.title}</strong>
        {toast.message && <p className="product-toast-message">{toast.message}</p>}
        {toast.action && (
          <button
            type="button"
            className="product-toast-action"
            onClick={() => {
              toast.action!.onAction()
              onDismiss(toast.id)
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {toast.dismissible && (
        <button
          type="button"
          className="product-toast-close"
          aria-label="Dismiss notification"
          onClick={() => setLeaving(true)}
        >
          <svg className="toast-glyph" aria-hidden="true" viewBox="0 0 20 20">
            <path d="m5 5 10 10m0-10L5 15" />
          </svg>
        </button>
      )}

      {toast.duration > 0 && (
        <span className="product-toast-progress" aria-hidden="true">
          <span style={{ animationDuration: `${toast.duration}ms` }} />
        </span>
      )}
    </article>
  )
}

export function ToastViewport() {
  const { toasts, dismiss } = useToast()
  if (toasts.length === 0) return null
  return (
    <div className="toast-region" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  )
}
