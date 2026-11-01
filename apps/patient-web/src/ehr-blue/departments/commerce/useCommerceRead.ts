import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommerceResult } from './api'

export type CommerceRead<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'off'; data: null; error: null }
  | { status: 'error'; data: T | null; error: string }

/**
 * One point-of-care read: again whenever `key` changes and on `reload`; an answer for an earlier request is dropped,
 * and what was read stays shown while it is read again. 'off' is the routes' 404: not switched on yet.
 */
export function useCommerceRead<T>(key: string | null, loader: (signal: AbortSignal) => Promise<CommerceResult<T>>) {
  const [state, setState] = useState<{ key: string | null; read: CommerceRead<T> }>({ key: null, read: { status: 'loading', data: null, error: null } })
  const loaderRef = useRef(loader)
  useEffect(() => { loaderRef.current = loader })
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    loaderRef.current(controller.signal).then(result => {
      if (controller.signal.aborted) return
      setState(previous => ({
        key,
        read: result.ok ? { status: 'ready', data: result.data, error: null }
          : result.notAvailable ? { status: 'off', data: null, error: null }
            : { status: 'error', data: previous.key === key ? previous.read.data : null, error: result.error },
      }))
    }, (caught: unknown) => {
      if (controller.signal.aborted) return
      setState(previous => ({ key, read: { status: 'error', data: previous.key === key ? previous.read.data : null,
        error: caught instanceof Error && caught.message ? caught.message : 'Something went wrong. Try again.' } }))
    })
    return () => controller.abort()
  }, [key, round])

  const reload = useCallback(() => setRound(value => value + 1), [])
  /** Puts a newer copy in place after a save, without a read. */
  const replace = useCallback((data: T) => setState({ key, read: { status: 'ready', data, error: null } }), [key])
  const read: CommerceRead<T> = state.key === key ? state.read : { status: 'loading', data: null, error: null }
  return { ...read, reload, replace }
}
