import { useEffect, useRef } from 'react'
import { useToast } from '../../../kasuwa/toast'

/*
 * Outreach says what happened after an action in a toast at the top of the screen (owner, 13 Nov 2026: no notices in
 * the page). A read that failed while something is already shown is said the same way, with Try again; it goes when
 * the read works again. A read that fails with nothing to show is the page's own error state instead (PageState).
 */

/** Says a failed read (or any lasting failure) in a toast while `error` is set, with Try again when `onRetry` is given. */
export function useErrorToast(error: string | null | undefined, title: string, onRetry?: () => void) {
  const toast = useToast()
  const retry = useRef(onRetry)
  useEffect(() => { retry.current = onRetry })
  const canRetry = Boolean(onRetry)
  useEffect(() => {
    if (!error) return
    const id = toast.error({ title, message: error, ...(canRetry ? { action: { label: 'Try again', onClick: () => retry.current?.() } } : {}) })
    return () => { if (id) toast.dismiss(id) }
  }, [error, title, canRetry, toast])
}

/** A failure said in a toast while it lasts (`error` set), drawing nothing in the page. */
export function ErrorToast({ error, title, onRetry }: { readonly error: string | null | undefined; readonly title: string; readonly onRetry?: () => void }) {
  useErrorToast(error, title, onRetry)
  return null
}

/** A note after an action (success, info or warning) said once in a toast as it appears, drawing nothing in the page. */
export function NoteToast({ note, intent = 'info', title }: { readonly note: string | null | undefined; readonly intent?: 'success' | 'info' | 'warning'; readonly title?: string }) {
  const toast = useToast()
  useEffect(() => {
    if (note) toast[intent](title ? { title, message: note } : note)
  }, [note, intent, title, toast])
  return null
}
