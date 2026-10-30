import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

export type ToastAction = { label: string; onAction: () => void }

export type Toast = {
  id: string
  type: ToastType
  title: string
  message?: string
  action?: ToastAction
  /** ms before auto-dismiss; 0 = persist until dismissed or updated. */
  duration: number
  dismissible: boolean
  /** Dedupe key — a new toast with the same key updates the existing one. */
  key?: string
}

type ToastOptions = {
  id?: string
  key?: string
  action?: ToastAction
  duration?: number
  dismissible?: boolean
}

export type ToastApi = {
  toasts: Toast[]
  show: (type: ToastType, title: string, message?: string, opts?: ToastOptions) => string
  success: (title: string, message?: string, opts?: ToastOptions) => string
  error: (title: string, message?: string, opts?: ToastOptions) => string
  warning: (title: string, message?: string, opts?: ToastOptions) => string
  info: (title: string, message?: string, opts?: ToastOptions) => string
  loading: (title: string, message?: string, opts?: ToastOptions) => string
  update: (id: string, patch: Partial<Omit<Toast, 'id'>>) => void
  dismiss: (id: string) => void
  clear: () => void
}

const DURATIONS: Record<ToastType, number> = {
  success: 3500,
  info: 4500,
  warning: 5500,
  error: 7000,
  loading: 0,
}

const MAX_VISIBLE = 5

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (type: ToastType, title: string, message?: string, opts: ToastOptions = {}): string => {
      const id = opts.id ?? `toast-${Date.now()}-${++seq.current}`
      const toast: Toast = {
        id,
        type,
        title,
        message,
        action: opts.action,
        duration: opts.duration ?? DURATIONS[type],
        dismissible: opts.dismissible ?? true,
        key: opts.key,
      }
      setToasts((prev) => {
        if (opts.key) {
          const existing = prev.find((t) => t.key === opts.key)
          if (existing) return prev.map((t) => (t.key === opts.key ? { ...toast, id: existing.id } : t))
        }
        const next = [...prev, toast]
        while (next.length > MAX_VISIBLE) {
          // Drop the oldest low-priority toast first; keep errors and loading pinned.
          const idx = next.findIndex((t) => t.type !== 'error' && t.type !== 'loading')
          if (idx >= 0) next.splice(idx, 1)
          else next.shift()
        }
        return next
      })
      return id
    },
    [],
  )

  const update = useCallback((id: string, patch: Partial<Omit<Toast, 'id'>>) => {
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, ...patch }
        if (patch.type && patch.type !== t.type && patch.duration === undefined) {
          next.duration = DURATIONS[patch.type]
        }
        return next
      }),
    )
  }, [])

  const clear = useCallback(() => setToasts([]), [])

  const api = useMemo<ToastApi>(
    () => ({
      toasts,
      show,
      dismiss,
      update,
      clear,
      success: (title, message, opts) => show('success', title, message, opts),
      error: (title, message, opts) => show('error', title, message, opts),
      warning: (title, message, opts) => show('warning', title, message, opts),
      info: (title, message, opts) => show('info', title, message, opts),
      loading: (title, message, opts) => show('loading', title, message, opts),
    }),
    [toasts, show, dismiss, update, clear],
  )

  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
