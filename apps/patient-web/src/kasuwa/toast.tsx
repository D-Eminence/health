/**
 * paytrail's toasts (components/ui-client.js ToastProvider): every result the person should know about, at the top of
 * the screen (across the top on a phone, the top-right corner on a computer), newest first. A neutral notice surface
 * with the intent's colour only on the icon and title, as on <Alert>. Errors and warnings stay longer; hovering holds
 * one; the same text already showing is refreshed rather than stacked. Going offline and back online are said too.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, Loader2, TriangleAlert, X } from 'lucide-react'
import { cx, type Icon } from './ui'

export type ToastIntent = 'success' | 'error' | 'warning' | 'info' | 'loading'
export interface ToastInput { title?: string; message?: string; action?: { label: string; onClick: () => void }; duration?: number }
interface Toast extends ToastInput { id: string; intent: ToastIntent }

type Show = (input: string | ToastInput, extra?: Partial<ToastInput>) => string | null
export interface ToastApi {
  (input: string | ToastInput): string | null
  success: Show; error: Show; warning: Show; info: Show; loading: Show
  dismiss: (id: string) => void
  update: (id: string | null, patch: Partial<Toast>) => void
}

const DURATION: Record<ToastIntent, number> = { success: 4200, info: 5000, warning: 7000, error: 8000, loading: 0 }
const LOOK: Record<ToastIntent, { icon: Icon; text: string; role: 'status' | 'alert'; label: string }> = {
  success: { icon: CircleCheck, text: 'text-success-ink', role: 'status', label: 'Done' },
  info: { icon: Info, text: 'text-info-ink', role: 'status', label: 'Note' },
  warning: { icon: TriangleAlert, text: 'text-warn-ink', role: 'alert', label: 'Warning' },
  error: { icon: CircleAlert, text: 'text-danger-ink', role: 'alert', label: 'Error' },
  loading: { icon: Loader2, text: 'text-ink-2', role: 'status', label: 'Working' },
}

const noop = Object.assign(() => null, { success: () => null, error: () => null, warning: () => null, info: () => null, loading: () => null, dismiss: () => {}, update: () => {} }) as ToastApi
const ToastContext = createContext<ToastApi>(noop)
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setState] = useState<Toast[]>([])
  const list = useRef<Toast[]>([])
  const set = useCallback((fn: (t: Toast[]) => Toast[]) => { list.current = fn(list.current); setState(list.current) }, [])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const clear = useCallback((id: string) => { clearTimeout(timers.current.get(id)); timers.current.delete(id) }, [])
  const dismiss = useCallback((id: string) => { clear(id); set(t => t.filter(x => x.id !== id)) }, [clear, set])
  const arm = useCallback((id: string, intent: ToastIntent, ms?: number) => {
    clear(id)
    const time = ms ?? DURATION[intent]
    if (time) timers.current.set(id, setTimeout(() => dismiss(id), time))
  }, [clear, dismiss])

  const api = useMemo(() => {
    const show = (input: string | ToastInput, intent: ToastIntent, extra?: Partial<ToastInput>) => {
      const t: ToastInput = { ...(typeof input === 'string' ? { message: input } : input), ...extra }
      if (!t.message && !t.title) return null
      const same = list.current.find(x => x.intent === intent && x.message === t.message && x.title === t.title)
      if (same) { arm(same.id, intent, t.duration); return same.id }
      const id = Math.random().toString(36).slice(2)
      set(l => [...l.slice(-3), { ...t, id, intent }])
      arm(id, intent, t.duration)
      return id
    }
    const fn = ((input: string | ToastInput) => show(input, 'success')) as ToastApi
    fn.success = (m, x) => show(m, 'success', x)
    fn.error = (m, x) => show(m, 'error', x)
    fn.warning = (m, x) => show(m, 'warning', x)
    fn.info = (m, x) => show(m, 'info', x)
    fn.loading = (m, x) => show(m, 'loading', x)
    fn.dismiss = dismiss
    fn.update = (id, patch) => {
      if (!id) return
      set(l => l.map(x => x.id === id ? { ...x, ...patch } : x))
      if (patch.intent) arm(id, patch.intent, patch.duration)
    }
    return fn
  }, [arm, dismiss, set])

  useEffect(() => {
    let offlineId: string | null = null
    const offline = () => { offlineId = api.warning({ title: 'You’re offline', message: 'Changes won’t save until you’re back online.' }, { duration: 0 }) }
    const online = () => { if (offlineId) api.dismiss(offlineId); offlineId = null; api.success('Back online') }
    addEventListener('offline', offline); addEventListener('online', online)
    const all = timers.current
    return () => { removeEventListener('offline', offline); removeEventListener('online', online); all.forEach(clearTimeout) }
  }, [api])

  return <ToastContext.Provider value={api}>
    {children}
    {/* Phones: across the top; larger screens: the top-right corner. Newest first. */}
    <div className="pointer-events-none fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] z-[var(--z-toast)] flex flex-col-reverse items-center gap-2 px-3 sm:top-5 sm:right-5 sm:left-auto sm:w-[400px] sm:items-end sm:px-0">
      {toasts.map(t => { const it = LOOK[t.intent]
        return <div key={t.id} role={it.role} aria-live={it.role === 'alert' ? 'assertive' : 'polite'}
          onMouseEnter={() => clear(t.id)} onMouseLeave={() => arm(t.id, t.intent, t.duration)}
          className="pointer-events-auto flex w-full max-w-[440px] animate-[toast-drop_.28s_cubic-bezier(.2,.9,.3,1)] items-start gap-3 rounded-2xl border border-notice-line bg-notice px-4 py-3 shadow-[var(--shadow-pop)]">
          <it.icon className={cx('mt-0.5 size-[18px] shrink-0', it.text, t.intent === 'loading' && 'animate-spin')} aria-hidden="true" />
          <div className="min-w-0 flex-1 leading-snug">
            <span className="sr-only">{it.label}: </span>
            {t.title && <p className={cx('m-0 text-sm font-medium', t.intent === 'loading' ? 'text-ink' : it.text)}>{t.title}</p>}
            {t.message && <p className={cx('m-0 text-[13.5px]', t.title ? 'mt-0.5 text-notice-body' : 'text-ink')}>{t.message}</p>}
            {t.action && <button type="button" onClick={() => { dismiss(t.id); t.action?.onClick() }}
              className="mt-2 cursor-pointer rounded-md border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-ink hover:underline">{t.action.label}</button>}
          </div>
          {t.intent !== 'loading' && <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss"
            className="-mr-2 -my-1 inline-flex size-10 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-notice-body hover:text-ink"><X className="size-4" /></button>}
        </div> })}
    </div>
  </ToastContext.Provider>
}
