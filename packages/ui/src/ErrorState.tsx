/**
 * The standard way a Health ID application reports a failed request.
 *
 * Two rules are enforced here rather than left to each screen:
 *
 *  1. Only the backend's sanitised `message` is shown. Nothing is composed out
 *     of a request body, a URL or a record, so a failure cannot put clinical
 *     detail on screen, or into a screenshot pasted into a support ticket.
 *
 *  2. The correlation id is shown, because it is the one piece of information
 *     that lets support find the matching backend log line, and it identifies
 *     a request rather than a person.
 */

import type { ReactNode } from 'react'
import { HidApiError } from '@hid/http'

export interface ErrorStateProps {
  readonly error: unknown
  /** Shown when the failure is retryable. */
  readonly onRetry?: () => void
  readonly children?: ReactNode
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

/** Extracts a message that is safe to render. Never inspects `details`. */
export function toDisplayMessage(error: unknown): string {
  if (error instanceof HidApiError) return error.message
  // An unrecognised error may carry anything, including data from a response
  // body, so its message is not shown.
  return GENERIC_MESSAGE
}

export function ErrorState({ error, onRetry, children }: ErrorStateProps) {
  const apiError = error instanceof HidApiError ? error : null
  const canRetry = apiError?.retryable === true && onRetry !== undefined

  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-(--radius-card) border-[0.5px] border-line-strong bg-surface-sunk p-4"
    >
      <p className="text-[15px] leading-[1.45] text-ink">{toDisplayMessage(error)}</p>

      {children}

      {canRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex h-[38px] items-center rounded-(--radius-button) border border-brand bg-brand px-3.5 text-[14px] font-semibold text-white transition-colors duration-150 hover:border-brand-hover hover:bg-brand-hover active:border-brand-active active:bg-brand-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Try again
        </button>
      ) : null}

      {apiError?.requestId ? (
        <p className="mt-3 font-mono text-xs text-muted">
          Reference: <span>{apiError.requestId}</span>
        </p>
      ) : null}
    </div>
  )
}
