'use client'

/**
 * Shared Waya toast feedback.
 *
 * The store lives outside React so an operation can report its result from a
 * service callback as well as from a component. A single ToastProvider is
 * mounted at each application root to render the shared queue.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import Alert02Icon from '@hugeicons/core-free-icons/Alert02Icon'
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon'
import CancelCircleIcon from '@hugeicons/core-free-icons/CancelCircleIcon'
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon'
import InformationCircleIcon from '@hugeicons/core-free-icons/InformationCircleIcon'
import Loading03Icon from '@hugeicons/core-free-icons/Loading03Icon'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

export interface ToastAction {
  /** Keep this to one concise, contextual action: Undo, Retry, View, and so on. */
  readonly label: string
  readonly onAction: () => void | Promise<void>
  /** Use false when the action transforms the same toast into another state. */
  readonly dismissOnAction?: boolean
}

export interface ToastOptions {
  /** Reusing an id updates the existing toast instead of adding another one. */
  readonly id?: string
  readonly description?: ReactNode
  /** Milliseconds; 0 keeps the toast until it is updated or dismissed. */
  readonly duration?: number
  readonly persistent?: boolean
  readonly action?: ToastAction
  readonly dismissible?: boolean
  /** Explicit duplicate-prevention key for repeatable operations such as Copy. */
  readonly dedupeKey?: string
  /** Important errors may use an assertive live region; ordinary feedback stays polite. */
  readonly important?: boolean
}

export interface ToastInput extends ToastOptions {
  readonly title: ReactNode
  readonly type?: ToastType
}

export interface ToastUpdate extends Omit<Partial<ToastInput>, 'id'> {
  readonly type?: ToastType
}

export interface ToastMessageOptions extends Omit<ToastOptions, 'id' | 'dedupeKey'> {
  readonly title: ReactNode
}

/** Convenient compact copy or a richer title/description/action definition. */
export type ToastMessage = ReactNode | ToastMessageOptions

export interface ToastPromiseMessages<Value> {
  readonly loading: ToastMessage
  readonly success: ToastMessage | ((value: Value) => ToastMessage)
  readonly error: ToastMessage | ((reason: unknown) => ToastMessage)
}

export interface ToastPromiseOptions {
  readonly id?: string
  readonly dedupeKey?: string
  readonly dismissible?: boolean
}

interface ToastRecord {
  readonly id: string
  readonly type: ToastType
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly duration: number
  readonly action?: ToastAction
  readonly dismissible: boolean
  readonly dedupeKey?: string
  readonly important: boolean
  /** Lets a transformed loading toast reset its timer without changing its id. */
  readonly revision: number
}

interface ToastSnapshot {
  readonly visible: readonly ToastRecord[]
  readonly queued: readonly ToastRecord[]
}

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3600,
  info: 4000,
  warning: 5500,
  error: 7000,
  loading: 0,
}

const MAX_VISIBLE_TOASTS = 3
const MAX_QUEUED_TOASTS = 10
const MIN_ACTION_DURATION = 6000
const EXIT_DURATION = 180

const EMPTY_SNAPSHOT: ToastSnapshot = { visible: [], queued: [] }
let snapshot: ToastSnapshot = EMPTY_SNAPSHOT
let sequence = 0
const listeners = new Set<() => void>()

function publish(next: ToastSnapshot) {
  snapshot = next
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return snapshot
}

function getServerSnapshot() {
  return EMPTY_SNAPSHOT
}

function nextId() {
  sequence += 1
  return `waya-toast-${sequence}`
}

function hasOwn<Value extends object>(value: Value, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function resolveDuration(type: ToastType, options: Pick<ToastOptions, 'duration' | 'persistent' | 'action'>) {
  if (type === 'loading' || options.persistent) return 0

  const requested = options.duration ?? DEFAULT_DURATION[type]
  const duration = Number.isFinite(requested) ? Math.max(0, requested) : DEFAULT_DURATION[type]
  return options.action && duration > 0 ? Math.max(duration, MIN_ACTION_DURATION) : duration
}

function deriveDedupeKey(
  type: ToastType,
  title: ReactNode,
  description: ReactNode | undefined,
  provided: string | undefined,
) {
  if (provided) return `key:${provided}`
  // Automatically collapse repeated simple copy/status feedback while leaving
  // rich notification content to callers that supply an explicit key.
  if (typeof title !== 'string') return undefined
  if (description !== undefined && typeof description !== 'string') return undefined
  return `message:${type}:${title}:${description ?? ''}`
}

function createRecord(type: ToastType, title: ReactNode, options: ToastOptions, id = options.id ?? nextId()): ToastRecord {
  const dedupeKey = deriveDedupeKey(type, title, options.description, options.dedupeKey)

  return {
    id,
    type,
    title,
    ...(options.description !== undefined ? { description: options.description } : {}),
    duration: resolveDuration(type, options),
    ...(options.action ? { action: options.action } : {}),
    dismissible: options.dismissible ?? true,
    ...(dedupeKey ? { dedupeKey } : {}),
    important: options.important ?? false,
    revision: 0,
  }
}

function isPinned(toast: ToastRecord) {
  return toast.type === 'error' || toast.type === 'loading'
}

function indexOfToast(items: readonly ToastRecord[], id: string, dedupeKey: string | undefined) {
  return items.findIndex(item => item.id === id || (dedupeKey !== undefined && item.dedupeKey === dedupeKey))
}

function mergeRecord(current: ToastRecord, patch: ToastUpdate): ToastRecord {
  const type = patch.type ?? current.type
  const action = hasOwn(patch, 'action') ? patch.action : current.action
  const persistent = hasOwn(patch, 'persistent') ? patch.persistent : false
  const duration = hasOwn(patch, 'duration') || hasOwn(patch, 'persistent') || type !== current.type
    ? resolveDuration(type, { duration: patch.duration, persistent, action })
    : current.duration
  const title = hasOwn(patch, 'title') ? patch.title : current.title
  const description = hasOwn(patch, 'description') ? patch.description : current.description
  const suppliedKey = hasOwn(patch, 'dedupeKey') ? patch.dedupeKey : undefined
  const dedupeKey = suppliedKey === undefined
    ? current.dedupeKey
    : deriveDedupeKey(type, title, description, suppliedKey)

  return {
    ...current,
    type,
    title,
    ...(description !== undefined ? { description } : {}),
    ...(description === undefined ? { description: undefined } : {}),
    duration,
    ...(action ? { action } : { action: undefined }),
    dismissible: hasOwn(patch, 'dismissible') ? patch.dismissible ?? true : current.dismissible,
    ...(dedupeKey ? { dedupeKey } : { dedupeKey: undefined }),
    important: hasOwn(patch, 'important') ? patch.important ?? false : current.important,
    revision: current.revision + 1,
  }
}

function replaceIn(items: readonly ToastRecord[], index: number, value: ToastRecord) {
  return [...items.slice(0, index), value, ...items.slice(index + 1)]
}

function show(type: ToastType, title: ReactNode, options: ToastOptions = {}) {
  const candidate = createRecord(type, title, options)
  const visibleIndex = indexOfToast(snapshot.visible, candidate.id, candidate.dedupeKey)
  const queuedIndex = visibleIndex < 0
    ? indexOfToast(snapshot.queued, candidate.id, candidate.dedupeKey)
    : -1

  if (visibleIndex >= 0) {
    const existing = snapshot.visible[visibleIndex]
    if (existing) publish({ ...snapshot, visible: replaceIn(snapshot.visible, visibleIndex, mergeRecord(existing, { ...options, type, title })) })
    return existing?.id ?? candidate.id
  }

  if (queuedIndex >= 0) {
    const existing = snapshot.queued[queuedIndex]
    if (existing) publish({ ...snapshot, queued: replaceIn(snapshot.queued, queuedIndex, mergeRecord(existing, { ...options, type, title })) })
    return existing?.id ?? candidate.id
  }

  if (snapshot.visible.length < MAX_VISIBLE_TOASTS) {
    publish({ ...snapshot, visible: [candidate, ...snapshot.visible] })
    return candidate.id
  }

  // Surface errors and pending work immediately. The oldest low-priority toast
  // is queued rather than silently discarded; errors/loading states stay put.
  if (isPinned(candidate)) {
    const oldestLowPriority = [...snapshot.visible].reverse().find(item => !isPinned(item))
    if (oldestLowPriority) {
      const visible = snapshot.visible.filter(item => item.id !== oldestLowPriority.id)
      const queued = [...snapshot.queued, oldestLowPriority].slice(0, MAX_QUEUED_TOASTS)
      publish({ visible: [candidate, ...visible], queued })
      return candidate.id
    }
  }

  publish({ ...snapshot, queued: [candidate, ...snapshot.queued].slice(0, MAX_QUEUED_TOASTS) })
  return candidate.id
}

function update(id: string, patch: ToastUpdate) {
  const visibleIndex = snapshot.visible.findIndex(item => item.id === id)
  if (visibleIndex >= 0) {
    const existing = snapshot.visible[visibleIndex]
    if (existing) publish({ ...snapshot, visible: replaceIn(snapshot.visible, visibleIndex, mergeRecord(existing, patch)) })
    return id
  }

  const queuedIndex = snapshot.queued.findIndex(item => item.id === id)
  if (queuedIndex >= 0) {
    const existing = snapshot.queued[queuedIndex]
    if (existing) publish({ ...snapshot, queued: replaceIn(snapshot.queued, queuedIndex, mergeRecord(existing, patch)) })
    return id
  }

  return undefined
}

function dismiss(id?: string) {
  if (id === undefined) {
    publish(EMPTY_SNAPSHOT)
    return
  }

  const visible = snapshot.visible.filter(item => item.id !== id)
  const queued = snapshot.queued.filter(item => item.id !== id)
  if (visible.length === snapshot.visible.length && queued.length === snapshot.queued.length) return

  if (visible.length < MAX_VISIBLE_TOASTS && queued.length > 0) {
    const [next, ...remaining] = queued
    if (next) publish({ visible: [next, ...visible], queued: remaining })
    return
  }

  publish({ visible, queued })
}

function asMessage(value: ToastMessage): ToastMessageOptions {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'title' in value) {
    return value as ToastMessageOptions
  }
  return { title: value }
}

function resolveMessage<Value>(value: ToastMessage | ((result: Value) => ToastMessage), result: Value) {
  return asMessage(typeof value === 'function' ? value(result) : value)
}

export interface ToastApi {
  readonly show: (input: ToastInput) => string
  readonly success: (title: ReactNode, options?: ToastOptions) => string
  readonly error: (title: ReactNode, options?: ToastOptions) => string
  readonly warning: (title: ReactNode, options?: ToastOptions) => string
  readonly info: (title: ReactNode, options?: ToastOptions) => string
  readonly information: (title: ReactNode, options?: ToastOptions) => string
  readonly loading: (title: ReactNode, options?: ToastOptions) => string
  readonly update: (id: string, patch: ToastUpdate) => string | undefined
  readonly dismiss: (id?: string) => void
  readonly promise: <Value>(
    source: PromiseLike<Value>,
    messages: ToastPromiseMessages<Value>,
    options?: ToastPromiseOptions,
  ) => Promise<Value>
}

/**
 * Imperative feedback API. It is safe to call from event handlers and async
 * services; the provider simply decides where the current queue is rendered.
 */
export const toast: ToastApi = {
  show: ({ type = 'info', title, ...options }) => show(type, title, options),
  success: (title, options) => show('success', title, options),
  error: (title, options) => show('error', title, options),
  warning: (title, options) => show('warning', title, options),
  info: (title, options) => show('info', title, options),
  information: (title, options) => show('info', title, options),
  loading: (title, options) => show('loading', title, options),
  update,
  dismiss,
  promise: (source, messages, options = {}) => {
    const loading = asMessage(messages.loading)
    const id = show('loading', loading.title, {
      ...loading,
      id: options.id,
      dedupeKey: options.dedupeKey,
      dismissible: options.dismissible ?? loading.dismissible,
      persistent: true,
    })

    return Promise.resolve(source).then(
      value => {
        const success = resolveMessage(messages.success, value)
        update(id, { ...success, type: 'success', persistent: success.persistent ?? false })
        return value
      },
      reason => {
        const error = resolveMessage(messages.error, reason)
        update(id, { ...error, type: 'error', persistent: error.persistent ?? false })
        throw reason
      },
    )
  },
}

const ToastContext = createContext<ToastApi | null>(null)

export interface ToastProviderProps {
  readonly children: ReactNode
  /** Bottom-right is the product default; bottom-center is useful beside fixed controls. */
  readonly position?: 'bottom-right' | 'bottom-center'
  /** Reserve space for an app's persistent mobile action bar or bottom navigation. */
  readonly bottomOffset?: number | string
}

export function ToastProvider({
  children,
  position = 'bottom-right',
  bottomOffset = 0,
}: ToastProviderProps) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const value = useMemo(() => toast, [])
  const offset = typeof bottomOffset === 'number' ? `${bottomOffset}px` : bottomOffset

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={current.visible} position={position} bottomOffset={offset} />
    </ToastContext.Provider>
  )
}

/** Use inside ToastProvider when a component prefers a hook over the static API. */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}

interface ToastViewportProps {
  readonly toasts: readonly ToastRecord[]
  readonly position: ToastProviderProps['position']
  readonly bottomOffset: string
}

function ToastViewport({ toasts, position, bottomOffset }: ToastViewportProps) {
  const style = { '--waya-toast-offset': bottomOffset } as CSSProperties
  if (toasts.length === 0) return null

  return (
    <section
      aria-label="Notifications"
      className="waya-toast-region"
      data-position={position}
      style={style}
    >
      {toasts.map(item => <ToastItem key={item.id} item={item} />)}
    </section>
  )
}

function ToastItem({ item }: { readonly item: ToastRecord }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAtRef = useRef(0)
  const remainingRef = useRef(item.duration)
  const timerEnabledRef = useRef(item.duration > 0)
  const interactionRef = useRef({ hovered: false, focused: false, pressed: false })
  const [leaving, setLeaving] = useState(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const requestDismiss = useCallback(() => setLeaving(true), [])

  const pauseTimer = useCallback(() => {
    if (timerRef.current === null) return
    clearTimer()
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
  }, [clearTimer])

  const startTimer = useCallback(() => {
    if (!timerEnabledRef.current || timerRef.current !== null) return
    if (remainingRef.current <= 0) {
      requestDismiss()
      return
    }
    startedAtRef.current = Date.now()
    timerRef.current = setTimeout(requestDismiss, remainingRef.current)
  }, [requestDismiss])

  const syncTimer = useCallback(() => {
    const interacting = interactionRef.current.hovered || interactionRef.current.focused || interactionRef.current.pressed
    if (interacting) pauseTimer()
    else startTimer()
  }, [pauseTimer, startTimer])

  useEffect(() => {
    setLeaving(false)
    clearTimer()
    remainingRef.current = item.duration
    timerEnabledRef.current = item.duration > 0
    syncTimer()
    return clearTimer
  }, [clearTimer, item.duration, item.id, item.revision, syncTimer])

  useEffect(() => {
    if (!leaving) return
    pauseTimer()
    const exitTimer = setTimeout(() => toast.dismiss(item.id), EXIT_DURATION)
    return () => clearTimeout(exitTimer)
  }, [item.id, leaving, pauseTimer])

  const setHovered = (hovered: boolean) => {
    interactionRef.current.hovered = hovered
    syncTimer()
  }

  const onFocus = () => {
    interactionRef.current.focused = true
    syncTimer()
  }

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    interactionRef.current.focused = false
    syncTimer()
  }

  const setPressed = (pressed: boolean) => {
    interactionRef.current.pressed = pressed
    syncTimer()
  }

  const onAction = () => {
    const result = item.action?.onAction()
    if (result && typeof result.then === 'function') void result
    if (item.action?.dismissOnAction !== false) requestDismiss()
  }

  const complex = item.description !== undefined || item.action !== undefined
  const assertive = item.type === 'error' && item.important

  return (
    <article
      aria-atomic="true"
      aria-live={assertive ? 'assertive' : 'polite'}
      className="waya-toast"
      data-complex={complex || undefined}
      data-state={leaving ? 'closing' : 'open'}
      data-type={item.type}
      role={assertive ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={onFocus}
      onBlurCapture={onBlur}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      <span aria-hidden="true" className="waya-toast__icon">
        <ToastStatusIcon type={item.type} />
      </span>
      <div className="waya-toast__content">
        <p className="waya-toast__title">{item.title}</p>
        {item.description !== undefined ? <p className="waya-toast__description">{item.description}</p> : null}
      </div>
      {item.action ? (
        <button type="button" className="waya-toast__action" onClick={onAction}>
          {item.action.label}
        </button>
      ) : null}
      {item.dismissible ? (
        <button type="button" className="waya-toast__close" aria-label="Dismiss notification" onClick={requestDismiss}>
          <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={1.65} aria-hidden />
        </button>
      ) : null}
    </article>
  )
}

function ToastStatusIcon({ type }: { readonly type: ToastType }) {
  if (type === 'success') return <HugeiconsIcon icon={CheckmarkCircle02Icon} size={17} strokeWidth={1.65} aria-hidden />
  if (type === 'error') return <HugeiconsIcon icon={CancelCircleIcon} size={17} strokeWidth={1.65} aria-hidden />
  if (type === 'warning') return <HugeiconsIcon icon={Alert02Icon} size={17} strokeWidth={1.65} aria-hidden />
  if (type === 'loading') return <HugeiconsIcon icon={Loading03Icon} size={17} strokeWidth={1.65} aria-hidden className="waya-toast__spinner" />
  return <HugeiconsIcon icon={InformationCircleIcon} size={17} strokeWidth={1.65} aria-hidden />
}
